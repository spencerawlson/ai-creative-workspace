/** StudioEngine: the imperative Three.js side of the studio.
 *
 * React owns the scene document; the engine renders it. The engine
 * never mutates the document — user gestures inside the viewport
 * (selecting or dragging a light handle, dragging a body part to pose
 * the figure) are reported through
 * callbacks and come back as validated actions.
 *
 * Lifecycle guarantees:
 * - Renders on demand: nothing is drawn unless the document, camera,
 *   size or a gesture changed (damping keeps frames coming until it
 *   settles). Idle tabs cost ~0 GPU.
 * - `dispose()` frees every geometry, material, texture, shadow map
 *   and listener it created, and is safe to call more than once.
 * - Model loads are token-guarded, cached per URL, and never leave a
 *   half-swapped figure.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { LIGHT_PIVOT_Y, kelvinToRgb, lightPosition } from "@/lib/lighting";
import { exposureMultiplier, focalToVerticalFov } from "@/lib/studio/presets";
import { FINGERS, type JointId } from "@/lib/studio/pose";
import {
  BONE_NAMES,
  CORE_BONES,
  JOINT_DOTS,
  applyPose,
  dragVariables,
  makeReach,
  solveReach,
  type BoneName,
  type DragVar,
  type JointDot,
  type RigDirections,
} from "./posing";
import {
  applyFace,
  buildFace,
  faceControls,
  findEyes,
  shapeMeshes,
  vrmExpressions,
  vrmEyeNodes,
  type FaceControls,
  type FaceRig,
} from "./face";
import {
  JOINT_PARENT,
  computeRetarget,
  isIdentityRetarget,
  matchHumanoid,
  referenceDirections,
  vrmHumanoid,
  type Retarget,
} from "./humanoid";
import {
  LIMITS,
  type CameraPlacement,
  type MannequinModel,
  type SceneDoc,
  type StudioLight,
} from "@/lib/studio/schema";

export type CameraView = "face" | "full" | "studio";
/** Light id, "model", "camera", "backdrop", "pose", or `pose:<joint>`
 * (a body part tapped in the viewport). */
export type Selection = string | null;

/** `?v=` changes whenever the GLBs are rebuilt (v2: feet and fingers),
 * so browsers don't keep a cached older rig for a week. */
export const MODEL_URLS: Record<MannequinModel, string> = {
  male: "/models/mannequin-male.glb?v=2",
  female: "/models/mannequin-female.glb?v=2",
};

export interface EngineStatus {
  model: "loading" | "ready" | "error";
  message?: string;
}

export interface EngineStats {
  /** Frames per second over the last interactive/benchmark burst. */
  fps: number | null;
  /** CPU time of the last render call, ms. */
  cpuMs: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  shadowCasters: number;
  maxExportSize: number;
}

export interface BenchmarkResult {
  frames: number;
  durationMs: number;
  avgFps: number;
  p95FrameMs: number;
  pixelRatio: number;
  drawCalls: number;
  triangles: number;
  renderer: string;
}

export interface ExportOptions {
  width: number;
  height: number;
  format: "image/png" | "image/jpeg";
  /** PNG only: transparent background (keeps the shadow catcher). */
  transparent?: boolean;
  quality?: number;
}

export interface EngineOverrides {
  /** Vertical FOV in degrees; overrides scene.camera.focalMm. */
  fov?: number;
  /** Tone-mapping exposure multiplier; overrides scene.camera.exposureEv. */
  exposure?: number;
}

export interface EngineCallbacks {
  /** `figure`: the figure tapped or grabbed, when there is one. */
  onSelect?: (selection: Selection, figure?: string) => void;
  onLightDrag?: (
    id: string,
    patch: { azimuth: number; elevation: number },
  ) => void;
  onLightDragEnd?: (id: string) => void;
  /** A body part is being dragged: new angles (degrees) per joint. */
  onPoseDrag?: (
    figure: string,
    patches: Partial<Record<JointId, Record<string, number>>>,
  ) => void;
  onPoseDragEnd?: () => void;
  /** A figure is being dragged across the floor (metres). */
  onFigureMove?: (figure: string, at: { x: number; z: number }) => void;
  onFigureMoveEnd?: () => void;
  /** The user finished orbiting or zooming the camera. */
  onCameraEnd?: () => void;
  onStatus?: (status: EngineStatus) => void;
  /** An imported character couldn't be used; its figures show their
   * mannequin instead. */
  onCharacterProblem?: (character: string, message: string) => void;
  /** An imported character is loaded: which face controls it has
   * (empty when it has no face shapes or eye bones). */
  onCharacterFace?: (character: string, controls: FaceControls) => void;
}

const PIVOT = new THREE.Vector3(0, LIGHT_PIVOT_Y, 0);
/** Spot and softbox lights aim at the upper body, where portraits live. */
const AIM = new THREE.Vector3(0, 1.4, 0);
/** Point/spot/area intensities are scaled so that, at this distance,
 * they light the subject about as brightly as a directional light with
 * the same slider value. Closer is brighter (inverse-square). */
const REF_DISTANCE_SQ = 16;
const SHADOW_MAP_SIZE = { low: 512, medium: 1024, high: 2048 } as const;
/** Elevated three-quarter view that shows every light handle. */
const STUDIO_VIEW = {
  target: new THREE.Vector3(0, 1.4, 0),
  position: new THREE.Vector3(4.6, 7.4, 11.2),
};
const FULL_VIEW = {
  target: new THREE.Vector3(0, 0.95, 0),
  position: new THREE.Vector3(0.6, 1.25, 3.4),
};
const FIGURE_HEIGHT = 1.88;

interface LightRig {
  kind: StudioLight["kind"];
  light:
    | THREE.DirectionalLight
    | THREE.SpotLight
    | THREE.PointLight
    | THREE.RectAreaLight;
  handle: THREE.Group;
  icon: THREE.Mesh;
  pick: THREE.Mesh;
  line: THREE.Line;
  state: StudioLight;
}

interface PoseDot {
  def: JointDot;
  ring: THREE.Mesh;
  pick: THREE.Mesh;
  /** The point dragging the dot moves, in the joint bone's frame. */
  effector: THREE.Vector3;
}

interface ModelRig {
  bones: Record<BoneName, THREE.Bone>;
  dirs: RigDirections;
  /** Per-bone corrections when the skeleton isn't the mannequin's own
   * (lib/engine/humanoid.ts); undefined for the mannequin. */
  retarget?: Retarget;
  /** Each joint's bone name in the file, to find it again in clones. */
  names: Partial<Record<BoneName, string>>;
  dots: PoseDot[];
  dotMaterial: THREE.Material;
  activeDotMaterial: THREE.Material;
  /** Bone lines, in world space (added to the scene while shown). */
  lines: THREE.LineSegments;
  /** Each line: from a bone's joint to a child bone or a tip offset. */
  segments: Array<[BoneName, BoneName | THREE.Vector3]>;
}

/** One figure on stage: a clone of a prepared model with its own
 * skeleton; geometry and materials are shared with the template. */
interface FigureInstance {
  id: string;
  url: string;
  /** Placed and turned per the document; holds `object`. */
  root: THREE.Group;
  object: THREE.Object3D;
  headHeight: number;
  rig: ModelRig | null;
  /** The pose last applied (by identity), to skip unchanged figures. */
  joints: unknown;
  /** A character's face, with this clone's shape meshes and eye bones. */
  face: {
    rig: FaceRig;
    meshes: THREE.Mesh[];
    eyes: Map<string, THREE.Bone>;
  } | null;
}

interface CachedModel {
  object: THREE.Object3D;
  headHeight: number;
  /** Null for an unrigged GLB: it renders, but can't be posed. */
  rig: ModelRig | null;
  /** An imported character's face, when it has one. */
  face?: FaceRig | null;
}

/** Tap targets: one invisible capsule per bone, from the joint to the
 * next joint (or limb tip), radius as a fraction of figure height. */
/** [bone, to, radius (x figure height), joint selected, start along
 * bone->to (default 0)] */
type Capsule = [BoneName, BoneName | "tip", number, JointId, number?];
const PICK_CAPSULES: Capsule[] = [
  ["pelvis", "spine", 0.09, "spine"],
  ["spine", "neck", 0.1, "spine"],
  ["neck", "tip", 0.06, "head"],
  ["shoulderL", "elbowL", 0.04, "shoulderL"],
  ["elbowL", "wristL", 0.035, "elbowL"],
  ["wristL", "tip", 0.03, "wristL"],
  ["shoulderR", "elbowR", 0.04, "shoulderR"],
  ["elbowR", "wristR", 0.035, "elbowR"],
  ["wristR", "tip", 0.03, "wristR"],
  ["hipL", "kneeL", 0.06, "hipL"],
  ["kneeL", "tip", 0.045, "kneeL"],
  ["hipR", "kneeR", 0.06, "hipR"],
  ["kneeR", "tip", 0.045, "kneeR"],
];

/** Version 2 rigs: the hand capsule covers the palm only and each
 * finger, thumb and foot gets its own (finger-thin, so a tap picks the
 * right finger even on a phone, where the hand is small). */
function pickCapsules(full: boolean): Capsule[] {
  if (!full) return PICK_CAPSULES;
  const out = PICK_CAPSULES.filter(([b]) => !/^(wrist|knee)/.test(b));
  for (const s of ["L", "R"] as const) {
    out.push(
      [`wrist${s}`, `middle1${s}`, 0.03, `wrist${s}`],
      [`knee${s}`, `ankle${s}`, 0.045, `knee${s}`],
      [`ankle${s}`, "tip", 0.04, `ankle${s}`],
      // The thumb's base starts halfway out and stays slim: seen from the
      // front the scan's thumb lies over the palm, and a fat capsule from
      // inside the palm took every press meant for the palm.
      [`thumb1${s}`, `thumb2${s}`, 0.009, `thumb1${s}`, 0.5],
      [`thumb2${s}`, `thumb3${s}`, 0.008, `thumb2${s}`],
      [`thumb3${s}`, "tip", 0.008, `thumb3${s}`],
    );
    for (const f of FINGERS)
      out.push(
        [`${f}1${s}`, `${f}2${s}`, 0.007, `${f}1${s}`],
        [`${f}2${s}`, `${f}3${s}`, 0.006, `${f}2${s}`],
        [`${f}3${s}`, "tip", 0.006, `${f}3${s}`],
      );
  }
  return out;
}
/** Where the face camera aims, between the base of the neck and the
 * crown. 0.445 reproduces the pre-rig vertex-average heuristic. */
const HEAD_FRACTION = 0.445;
/** Skeleton overlay colours, after Maya: blue joints, green selected. */
const JOINT_BLUE = 0x4f86ff;
const JOINT_GREEN = 0x5cf25c;
const BONE_BLUE = 0x3f6fd8;

export class StudioEngine {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly container: HTMLElement;
  private readonly callbacks: EngineCallbacks;
  private readonly resizeObserver: ResizeObserver;

  private readonly figure = new THREE.Group();
  private readonly handlesRoot = new THREE.Group();
  private readonly skeletonRoot = new THREE.Group();
  private readonly material = new THREE.MeshStandardMaterial();
  private readonly catcher: THREE.Mesh<
    THREE.CircleGeometry,
    THREE.ShadowMaterial
  >;
  private readonly cyc: THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >;
  private readonly selectionRing: THREE.Mesh<
    THREE.RingGeometry,
    THREE.MeshBasicMaterial
  >;
  private readonly handleGeometries: Record<
    StudioLight["kind"],
    THREE.BufferGeometry
  >;
  private readonly pickGeometry = new THREE.SphereGeometry(1, 8, 6);
  private readonly pickMaterial = new THREE.MeshBasicMaterial();
  private envMap: THREE.Texture | null = null;

  private rigs = new Map<string, LightRig>();
  /** Prepared models by URL: templates, never on stage themselves. */
  private models = new Map<string, CachedModel>();
  private loading = new Set<string>();
  private failed = new Set<string>();
  /** Imported characters: file URL by character id, and back. */
  private characterUrls = new Map<string, string>();
  private characterIds = new Map<string, string>();
  /** Character files that loaded but can't be posed. */
  private unusable = new Set<string>();
  private instances = new Map<string, FigureInstance>();
  private activeFigure: string | null = null;
  private statusKey = "";
  /** Video capture in progress: the canvas is at the video's size. */
  private capture: { handles: boolean } | null = null;
  private view: CameraView = "full";

  private doc: SceneDoc | null = null;
  private overrides: EngineOverrides = {};
  private selection: Selection = null;
  private showHandles = true;
  private shadowQuality: keyof typeof SHADOW_MAP_SIZE = "medium";

  private raf = 0;
  private disposed = false;
  private interacting = false;
  private dragging: { id: string; pointerId: number } | null = null;
  /** A body part held in pose mode. `moved` stays false for a tap. */
  private poseDrag: {
    pointerId: number;
    figure: string;
    vars: DragVar[];
    x: number[];
    reach: (x: number[]) => THREE.Vector3;
    origin: THREE.Vector3;
    start: THREE.Vector3;
    plane: THREE.Plane;
    down: { x: number; y: number };
    moved: boolean;
  } | null = null;
  /** A figure held in mannequin mode, sliding across the floor. */
  private moveDrag: {
    pointerId: number;
    figure: string;
    /** The pointer moves across this plane, through the grabbed point. */
    plane: THREE.Plane;
    /** Where the press met `plane`, and the figure's position then. */
    start: THREE.Vector3;
    from: THREE.Vector3;
    down: { x: number; y: number };
    moved: boolean;
  } | null = null;
  private downAt: { x: number; y: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly maxPixelRatio: number;
  private pixelRatio: number;
  private frameTimes: number[] = [];
  private lastFrameAt = 0;
  private slowFrames = 0;
  private lastCpuMs = 0;
  private lastFps: number | null = null;
  private benchmark: {
    start: number;
    last: number;
    frames: number[];
    resolve: (r: BenchmarkResult) => void;
    durationMs: number;
    startAzimuth: number;
  } | null = null;

  constructor(container: HTMLElement, callbacks: EngineCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    // PCF honours light.shadow.radius; PCFSoftShadowMap ignores it,
    // which is why the M2 softness slider used to do nothing.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute("data-engine", "studio");
    container.appendChild(this.renderer.domElement);
    RectAreaLightUniformsLib.init();

    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    this.camera.position.copy(FULL_VIEW.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(FULL_VIEW.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 16;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.controls.addEventListener("change", this.invalidate);
    this.controls.addEventListener("start", this.onControlsStart);
    this.controls.addEventListener("end", this.onControlsEnd);
    this.controls.update();

    // Low ambient so Low-key stays dark and High-key is carried by fill.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    this.scene.add(this.figure);
    this.scene.add(this.handlesRoot, this.skeletonRoot);

    this.catcher = new THREE.Mesh(
      new THREE.CircleGeometry(6, 48),
      new THREE.ShadowMaterial({ opacity: 0.4 }),
    );
    this.catcher.rotation.x = -Math.PI / 2;
    this.catcher.receiveShadow = true;
    this.catcher.name = "backdrop";
    this.scene.add(this.catcher);

    this.cyc = new THREE.Mesh(
      buildCycGeometry(),
      new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }),
    );
    this.cyc.receiveShadow = true;
    this.cyc.name = "backdrop";
    this.cyc.visible = false;
    this.scene.add(this.cyc);

    this.handleGeometries = {
      directional: new THREE.OctahedronGeometry(1, 0),
      spot: new THREE.ConeGeometry(0.8, 1.6, 16, 1, true).rotateX(-Math.PI / 2),
      point: new THREE.SphereGeometry(1, 16, 12),
      area: new THREE.PlaneGeometry(1, 1),
    };
    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.85, 32),
      new THREE.MeshBasicMaterial({
        color: 0xf2b35a,
        toneMapped: false,
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    this.selectionRing.renderOrder = 10;
    this.selectionRing.visible = false;
    this.handlesRoot.add(this.selectionRing);

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown, { capture: true });
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    el.addEventListener("webglcontextlost", this.onContextLost);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  // ---------------------------------------------------------------- state

  update(doc: SceneDoc, overrides: EngineOverrides = {}): void {
    if (this.disposed) return;
    const prev = this.doc;
    this.doc = doc;
    this.overrides = overrides;

    if (!prev || prev.lights !== doc.lights || prev.shadows !== doc.shadows) {
      this.shadowQuality = doc.shadows.quality;
      this.syncLights(doc.lights);
    }
    if (!prev || prev.material !== doc.material) this.syncMaterial(doc);
    if (!prev || prev.backdrop !== doc.backdrop) this.syncBackdrop(doc);
    if (!prev || prev.figures !== doc.figures) this.syncFigures();

    const fov = overrides.fov ?? focalToVerticalFov(doc.camera.focalMm);
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.toneMapping = TONE_MAPPING[doc.camera.toneMapping];
    this.renderer.toneMappingExposure =
      overrides.exposure ?? exposureMultiplier(doc.camera.exposureEv);
    this.invalidate();
  }

  setSelection(selection: Selection): void {
    this.selection = selection;
    this.updateHandleStyles();
    this.invalidate();
  }

  setShowHandles(show: boolean): void {
    this.showHandles = show;
    this.handlesRoot.visible = show;
    this.invalidate();
  }

  setView(view: CameraView): void {
    this.view = view;
    if (view === "face") {
      // Keep the current orbit direction; pull in close to the head.
      const dir = this.camera.position
        .clone()
        .sub(this.controls.target)
        .normalize();
      this.controls.target.copy(this.activeHead());
      this.camera.position
        .copy(this.controls.target)
        .addScaledVector(dir, 0.75);
    } else {
      const preset = view === "studio" ? STUDIO_VIEW : FULL_VIEW;
      this.controls.target.copy(preset.target);
      this.camera.position.copy(preset.position);
    }
    this.controls.update();
    this.invalidate();
  }

  /** Keyboard camera control: rotate around the target / dolly. */
  orbitBy(
    deltaAzimuthDeg: number,
    deltaPolarDeg: number,
    dollyFactor = 1,
  ): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const s = new THREE.Spherical().setFromVector3(offset);
    s.theta += THREE.MathUtils.degToRad(deltaAzimuthDeg);
    s.phi = THREE.MathUtils.clamp(
      s.phi + THREE.MathUtils.degToRad(deltaPolarDeg),
      this.controls.minPolarAngle,
      this.controls.maxPolarAngle,
    );
    s.radius = THREE.MathUtils.clamp(
      s.radius * dollyFactor,
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    this.camera.position
      .copy(this.controls.target)
      .add(new THREE.Vector3().setFromSpherical(s));
    this.controls.update();
    this.invalidate();
  }

  getStats(): EngineStats {
    const info = this.renderer.info.render;
    return {
      fps: this.lastFps,
      cpuMs: this.lastCpuMs,
      drawCalls: info.calls,
      triangles: info.triangles,
      pixelRatio: this.pixelRatio,
      shadowCasters: [...this.rigs.values()].filter((r) => r.light.castShadow)
        .length,
      maxExportSize: this.maxExportSize(),
    };
  }

  maxExportSize(): number {
    const gl = this.renderer.getContext();
    return Math.min(
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      this.renderer.capabilities.maxTextureSize,
      8192,
    );
  }

  // ------------------------------------------------------------- rendering

  invalidate = (): void => {
    if (!this.disposed && !this.raf)
      this.raf = requestAnimationFrame(this.frame);
  };

  private frame = (now: number): void => {
    this.raf = 0;
    // While recording a video the recorder draws every frame itself.
    if (this.disposed || this.capture) return;
    const moving = this.controls.update();
    this.trackFrameTime(now, moving);
    this.render();
    if (this.benchmark) this.stepBenchmark(now);
    if (
      moving ||
      this.interacting ||
      this.dragging ||
      this.poseDrag ||
      this.moveDrag ||
      this.benchmark
    ) {
      this.invalidate();
    } else if (this.pixelRatio !== this.maxPixelRatio) {
      // Idle again: restore full resolution for a crisp still frame.
      this.setPixelRatio(this.maxPixelRatio);
      this.invalidate();
    }
  };

  private render(): void {
    this.layoutDots(this.poseMode);
    // Keep handles a constant on-screen size and the ring facing us.
    for (const rig of this.rigs.values()) {
      const d = this.camera.position.distanceTo(rig.handle.position);
      const s = Math.max(0.035, d * 0.022);
      rig.icon.scale.setScalar(s);
      rig.pick.scale.setScalar(s * 3.2);
      if (rig.kind === "area")
        rig.icon.scale.set(rig.state.size, rig.state.size, 1);
    }
    const selected = this.selection ? this.rigs.get(this.selection) : undefined;
    this.selectionRing.visible = !!selected && this.showHandles;
    if (selected) {
      const d = this.camera.position.distanceTo(selected.handle.position);
      this.selectionRing.position.copy(selected.handle.position);
      this.selectionRing.quaternion.copy(this.camera.quaternion);
      this.selectionRing.scale.setScalar(
        selected.kind === "area"
          ? Math.max(d * 0.022, selected.state.size * 0.4)
          : Math.max(0.035, d * 0.022),
      );
    }
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.lastCpuMs = performance.now() - t0;
  }

  private trackFrameTime(now: number, moving: boolean): void {
    const continuous =
      moving ||
      this.interacting ||
      this.dragging ||
      this.poseDrag ||
      this.moveDrag ||
      this.benchmark;
    if (continuous && this.lastFrameAt) {
      const dt = now - this.lastFrameAt;
      if (dt < 500) {
        this.frameTimes.push(dt);
        if (this.frameTimes.length > 60) this.frameTimes.shift();
        this.lastFps =
          1000 /
          (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length);
        // Adaptive resolution while moving: below ~40 fps for half a
        // second, drop to 1x; full resolution returns when idle.
        if (!this.benchmark && dt > 25 && this.pixelRatio > 1) {
          if (++this.slowFrames > 20) {
            this.setPixelRatio(1);
            this.slowFrames = 0;
          }
        } else {
          this.slowFrames = Math.max(0, this.slowFrames - 1);
        }
      }
    }
    this.lastFrameAt = continuous ? now : 0;
  }

  private setPixelRatio(ratio: number): void {
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(
      this.container.clientWidth,
      this.container.clientHeight,
      false,
    );
  }

  private resize(): void {
    if (this.disposed || this.capture) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.invalidate();
  }

  private onControlsStart = () => {
    this.interacting = true;
  };

  private onControlsEnd = () => {
    this.interacting = false;
    this.callbacks.onCameraEnd?.();
    this.invalidate();
  };

  /** Where the camera is and what it orbits around. */
  getCameraPlacement(): CameraPlacement {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
    };
  }

  setCameraPlacement(p: CameraPlacement): void {
    this.camera.position.fromArray(p.position);
    this.controls.target.fromArray(p.target);
    this.controls.update();
    this.invalidate();
  }

  // ---------------------------------------------------------------- lights

  private syncLights(lights: StudioLight[]): void {
    const keep = new Set(lights.map((l) => l.id));
    for (const [id, rig] of this.rigs) {
      if (!keep.has(id)) this.removeRig(id, rig);
    }
    for (const state of lights) {
      let rig = this.rigs.get(state.id);
      if (!rig || rig.kind !== state.kind) {
        if (rig) this.removeRig(state.id, rig);
        rig = this.createRig(state);
      }
      this.applyLight(rig, state);
    }
    this.updateHandleStyles();
  }

  private createRig(state: StudioLight): LightRig {
    let light: LightRig["light"];
    switch (state.kind) {
      case "directional": {
        const l = new THREE.DirectionalLight();
        Object.assign(l.shadow.camera, {
          left: -2,
          right: 2,
          top: 3,
          bottom: -1,
          near: 0.5,
          far: 20,
        });
        l.target.position.copy(PIVOT);
        this.scene.add(l.target);
        light = l;
        break;
      }
      case "spot": {
        const l = new THREE.SpotLight();
        l.decay = 2;
        l.shadow.camera.near = 0.3;
        l.shadow.camera.far = 20;
        l.target.position.copy(AIM);
        this.scene.add(l.target);
        light = l;
        break;
      }
      case "point": {
        const l = new THREE.PointLight();
        l.decay = 2;
        l.shadow.camera.near = 0.3;
        l.shadow.camera.far = 20;
        light = l;
        break;
      }
      case "area":
        light = new THREE.RectAreaLight();
        break;
    }
    const shadow = shadowOf(light);
    if (shadow) {
      shadow.bias = -0.0005;
      shadow.normalBias = 0.02;
    }
    light.name = `light:${state.id}`;
    this.scene.add(light);

    const handle = new THREE.Group();
    const icon = new THREE.Mesh(
      this.handleGeometries[state.kind],
      new THREE.MeshBasicMaterial({
        toneMapped: false,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    const pick = new THREE.Mesh(this.pickGeometry, this.pickMaterial);
    pick.visible = false;
    pick.userData.lightId = state.id;
    handle.add(icon, pick);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(),
      ]),
      new THREE.LineBasicMaterial({
        transparent: true,
        opacity: 0.35,
        toneMapped: false,
      }),
    );
    this.handlesRoot.add(handle, line);
    const rig: LightRig = {
      kind: state.kind,
      light,
      handle,
      icon,
      pick,
      line,
      state,
    };
    this.rigs.set(state.id, rig);
    return rig;
  }

  private applyLight(rig: LightRig, state: StudioLight): void {
    rig.state = state;
    const { light } = rig;
    const [x, y, z] = lightPosition(state);
    light.position.set(x, y, z);
    const [r, g, b] = kelvinToRgb(state.temperature);
    light.color.setRGB(r, g, b);
    light.visible = state.on;
    const aim = rig.kind === "directional" ? PIVOT : AIM;

    switch (rig.kind) {
      case "directional":
        light.intensity = state.on ? state.intensity : 0;
        break;
      case "spot": {
        const l = light as THREE.SpotLight;
        l.intensity = state.on ? state.intensity * REF_DISTANCE_SQ : 0;
        l.angle = THREE.MathUtils.degToRad(state.spotAngle / 2);
        l.penumbra = 0.15 + (state.softness / LIMITS.softness[1]) * 0.7;
        break;
      }
      case "point":
        light.intensity = state.on ? state.intensity * REF_DISTANCE_SQ : 0;
        break;
      case "area": {
        const l = light as THREE.RectAreaLight;
        l.width = state.size;
        l.height = state.size;
        // Luminance so total output, not brightness per m², is the slider.
        l.intensity = state.on
          ? (state.intensity * REF_DISTANCE_SQ) / (state.size * state.size)
          : 0;
        l.lookAt(AIM);
        break;
      }
    }

    const shadow = shadowOf(light);
    if (shadow) {
      light.castShadow = state.on && state.shadows;
      // PCF radius is in shadow-map texels; 0–10 maps to ~1–5 texels.
      shadow.radius = 1 + state.softness * 0.4;
      // Point shadows render 6 faces, so they stay at 512 for cost.
      const size =
        rig.kind === "point"
          ? Math.min(512, SHADOW_MAP_SIZE[this.shadowQuality])
          : SHADOW_MAP_SIZE[this.shadowQuality];
      if (shadow.mapSize.x !== size) {
        shadow.mapSize.set(size, size);
        shadow.map?.dispose();
        shadow.map = null;
      }
    } else {
      light.castShadow = false;
    }

    // Handle: icon at the light, oriented toward its aim, line to aim.
    rig.handle.position.set(x, y, z);
    rig.handle.lookAt(aim);
    const pts = rig.line.geometry.attributes.position as THREE.BufferAttribute;
    pts.setXYZ(0, x, y, z);
    pts.setXYZ(1, aim.x, aim.y, aim.z);
    pts.needsUpdate = true;
    rig.line.geometry.computeBoundingSphere();
    const mat = rig.icon.material as THREE.MeshBasicMaterial;
    mat.color.setRGB(r, g, b);
    (rig.line.material as THREE.LineBasicMaterial).color.setRGB(r, g, b);
  }

  private updateHandleStyles(): void {
    for (const [id, rig] of this.rigs) {
      const mat = rig.icon.material as THREE.MeshBasicMaterial;
      const selected = id === this.selection;
      mat.opacity = rig.state.on ? 1 : 0.3;
      (rig.line.material as THREE.LineBasicMaterial).opacity = selected
        ? 0.8
        : rig.state.on
          ? 0.3
          : 0.1;
    }
  }

  private removeRig(id: string, rig: LightRig): void {
    const { light } = rig;
    if ("target" in light && light.target) this.scene.remove(light.target);
    shadowOf(light)?.dispose();
    light.dispose();
    this.scene.remove(light);
    this.handlesRoot.remove(rig.handle, rig.line);
    (rig.icon.material as THREE.Material).dispose();
    rig.line.geometry.dispose();
    (rig.line.material as THREE.Material).dispose();
    this.rigs.delete(id);
  }

  // ------------------------------------------------------ material/backdrop

  private syncMaterial(doc: SceneDoc): void {
    const m = doc.material;
    this.material.color.set(m.color);
    this.material.roughness = m.roughness;
    this.material.metalness = m.metalness;
    // Metals reflect their surroundings; without an environment they read
    // as black. Only metals get one, so dielectric presets keep exactly
    // the light the user placed.
    const wantsEnv = m.metalness > 0.3;
    if (wantsEnv && !this.envMap) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.envMap = pmrem.fromScene(room, 0.04).texture;
      room.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose?.();
      });
      pmrem.dispose();
    }
    const env = wantsEnv ? this.envMap : null;
    if (this.material.envMap !== env) {
      this.material.envMap = env;
      this.material.needsUpdate = true;
    }
    this.material.envMapIntensity = 0.35 * m.metalness;
  }

  private syncBackdrop(doc: SceneDoc): void {
    const b = doc.backdrop;
    const color = new THREE.Color(b.color);
    const cyc = b.style === "cyc";
    this.cyc.visible = cyc;
    this.cyc.material.color.copy(color);
    this.catcher.visible = !cyc;
    this.catcher.material.opacity = b.shadowOpacity;
    // Outside the sweep, the studio falls off to a darker version of it.
    this.scene.background = cyc ? color.clone().multiplyScalar(0.18) : color;
  }

  // ----------------------------------------------------------------- model

  /** Download and prepare a model once; figures are clones of it. */
  private loadModel(url: string): void {
    if (this.models.has(url) || this.loading.has(url) || this.failed.has(url))
      return;
    this.loading.add(url);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      url,
      (gltf) => {
        this.loading.delete(url);
        const character = this.characterIds.get(url);
        const model = character
          ? this.prepareCharacter(gltf)
          : this.prepareModel(gltf.scene);
        if (typeof model === "string") {
          disposeObject(gltf.scene, this.material);
          if (this.disposed) return;
          this.unusable.add(url);
          this.callbacks.onCharacterProblem?.(character!, model);
          this.syncFigures();
          return;
        }
        if (this.disposed) {
          disposeModel(model, this.material);
          return;
        }
        this.models.set(url, model);
        if (character)
          this.callbacks.onCharacterFace?.(
            character,
            faceControls(model.face ?? null),
          );
        this.syncFigures();
      },
      undefined,
      () => {
        this.loading.delete(url);
        if (this.disposed) return;
        // Figures already on stage keep their model rather than vanish.
        this.failed.add(url);
        const character = this.characterIds.get(url);
        if (character)
          this.callbacks.onCharacterProblem?.(
            character,
            "The file couldn't be read as a 3D model (GLB or VRM).",
          );
        this.syncFigures();
      },
    );
  }

  /** Imported characters' files (object URLs), by character id. A
   * figure whose character isn't here, or can't be used, shows its
   * mannequin. */
  setCharacters(urls: Record<string, string>): void {
    const before = [...this.characterIds.keys()];
    this.characterUrls = new Map(Object.entries(urls));
    this.characterIds = new Map(
      [...this.characterUrls].map(([id, url]) => [url, id]),
    );
    this.syncFigures();
    // Free characters no longer on the device (their figures have just
    // gone back to the mannequin).
    for (const url of before) {
      if (this.characterIds.has(url)) continue;
      const model = this.models.get(url);
      const used = [...this.instances.values()].some((i) => i.url === url);
      if (model && !used) {
        disposeModel(model, this.material);
        this.models.delete(url);
      }
      this.failed.delete(url);
      this.unusable.delete(url);
    }
  }

  /** The file a figure shows: its character's when that can be used. */
  private figureUrl(f: SceneDoc["figures"][number]): string {
    const url = f.character ? this.characterUrls.get(f.character) : undefined;
    return url && !this.failed.has(url) && !this.unusable.has(url)
      ? url
      : MODEL_URLS[f.model];
  }

  retryModel(): void {
    this.failed.clear();
    this.syncFigures();
  }

  /** Bring the stage in line with the document's figures: load models
   * as needed, add, remove or swap clones, place them and apply their
   * poses. A figure whose new model is still downloading keeps the old
   * one meanwhile, so nothing is ever half-swapped. */
  private syncFigures(): void {
    const doc = this.doc;
    if (!doc || this.disposed) return;
    for (const inst of [...this.instances.values()])
      if (!doc.figures.some((f) => f.id === inst.id)) this.removeInstance(inst);
    let waiting = false;
    let failed = false;
    for (const f of doc.figures) {
      const url = this.figureUrl(f);
      const template = this.models.get(url);
      let inst = this.instances.get(f.id);
      if (!template) {
        if (this.failed.has(url)) failed = true;
        else waiting = true;
        this.loadModel(url);
      } else if (!inst || inst.url !== url) {
        if (inst) this.removeInstance(inst);
        inst = this.instantiate(f.id, url, template);
        if (this.view === "face" && inst === this.active) this.aimAtFace();
      }
      if (!inst) continue;
      inst.root.position.set(f.x, f.y, f.z);
      inst.root.rotation.y = THREE.MathUtils.degToRad(f.rotation);
      if (inst.rig && inst.joints !== f.pose.joints) {
        applyPose(
          inst.rig.bones,
          f.pose.joints,
          inst.rig.dirs,
          inst.rig.retarget,
        );
        if (inst.face)
          applyFace(
            inst.face.rig,
            inst.face.meshes,
            inst.face.eyes,
            f.pose.joints,
          );
        inst.joints = f.pose.joints;
      }
    }
    this.setStatus(
      failed
        ? {
            model: "error",
            message:
              "The mannequin could not be downloaded. Check your connection and try again.",
          }
        : { model: waiting ? "loading" : "ready" },
    );
    this.invalidate();
  }

  private setStatus(status: EngineStatus): void {
    const key = `${status.model}:${status.message ?? ""}`;
    if (key === this.statusKey) return;
    this.statusKey = key;
    this.callbacks.onStatus?.(status);
  }

  /** A figure on stage: a clone of a prepared model with its own
   * skeleton, pick capsules and joint overlay; geometry is shared. */
  private instantiate(
    id: string,
    url: string,
    template: CachedModel,
  ): FigureInstance {
    const object = cloneSkinned(template.object);
    const root = new THREE.Group();
    root.userData.figureId = id;
    root.add(object);
    let rig: ModelRig | null = null;
    if (template.rig) {
      const t = template.rig;
      const bones = {} as Record<BoneName, THREE.Bone>;
      const rings = new Map<string, THREE.Mesh>();
      const picks = new Map<string, THREE.Mesh>();
      // Cloning copies properties but not the raycast overrides.
      const byName = new Map(
        Object.entries(t.names).map(([b, n]) => [n, b as BoneName]),
      );
      object.traverse((o) => {
        const joint = (o as THREE.Bone).isBone ? byName.get(o.name) : undefined;
        if (joint && !bones[joint]) bones[joint] = o as THREE.Bone;
        if ((o as THREE.SkinnedMesh).isSkinnedMesh)
          (o as THREE.Mesh).raycast = () => {};
        if (o.name === "pose-dot-ring") {
          (o as THREE.Mesh).raycast = () => {};
          rings.set(o.userData.joint as string, o as THREE.Mesh);
        }
        if (o.name === "pose-dot")
          picks.set(o.userData.joint as string, o as THREE.Mesh);
      });
      const lines = new THREE.LineSegments(
        t.lines.geometry.clone(),
        t.lines.material,
      );
      lines.renderOrder = t.lines.renderOrder;
      lines.frustumCulled = false;
      lines.visible = false;
      lines.raycast = () => {};
      this.skeletonRoot.add(lines);
      rig = {
        ...t,
        bones,
        lines,
        dots: t.dots.map((d) => ({
          ...d,
          ring: rings.get(d.def.joint)!,
          pick: picks.get(d.def.joint)!,
        })),
      };
    }
    let face: FigureInstance["face"] = null;
    if (template.face) {
      const names = new Set(template.face.eyes.map((e) => e.name));
      const eyes = new Map<string, THREE.Bone>();
      object.traverse((o) => {
        if ((o as THREE.Bone).isBone && names.has(o.name))
          eyes.set(o.name, o as THREE.Bone);
      });
      face = { rig: template.face, meshes: shapeMeshes(object), eyes };
    }
    this.figure.add(root);
    const inst: FigureInstance = {
      id,
      url,
      root,
      object,
      headHeight: template.headHeight,
      rig,
      joints: null,
      face,
    };
    this.instances.set(id, inst);
    return inst;
  }

  private removeInstance(inst: FigureInstance): void {
    this.figure.remove(inst.root);
    if (inst.rig) {
      this.skeletonRoot.remove(inst.rig.lines);
      inst.rig.lines.geometry.dispose();
    }
    this.instances.delete(inst.id);
    if (this.poseDrag?.figure === inst.id) this.poseDrag = null;
    if (this.moveDrag?.figure === inst.id) this.moveDrag = null;
  }

  /** The figure being posed or edited: the one the UI picked, else the
   * first on stage. */
  private get active(): FigureInstance | null {
    const id = this.activeFigure ?? this.doc?.figures[0]?.id;
    return (id && this.instances.get(id)) || null;
  }

  setActiveFigure(id: string | null): void {
    this.activeFigure = id;
    this.invalidate();
  }

  /** World position the face camera aims at, on the active figure. */
  private activeHead(): THREE.Vector3 {
    const a = this.active;
    return a
      ? a.root.localToWorld(new THREE.Vector3(0, a.headHeight, 0))
      : new THREE.Vector3(0, 1.72, 0);
  }

  /** Face view framed on the active figure, from its front-left. */
  private aimAtFace(): void {
    const head = this.activeHead();
    const turn = this.active?.root.rotation.y ?? 0;
    this.controls.target.copy(head);
    this.camera.position
      .copy(head)
      .add(
        new THREE.Vector3(0.35, 0.13, 0.65).applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          turn,
        ),
      );
    this.controls.update();
  }

  /** The figure an object (pick capsule, joint dot) belongs to. */
  private instanceOf(obj: THREE.Object3D | null): FigureInstance | null {
    for (let o = obj; o; o = o.parent)
      if (o.userData.figureId)
        return this.instances.get(o.userData.figureId as string) ?? null;
    return null;
  }

  /** An imported character: its own skeleton (from the VRM bone map or
   * by bone names), turned to face +Z, with its own materials. Returns
   * why it can't be used instead, when it can't. */
  private prepareCharacter(gltf: GLTF): CachedModel | string {
    const holder = new THREE.Group();
    holder.add(gltf.scene);
    holder.updateMatrixWorld(true);
    const nodes = new Map<number, THREE.Object3D>();
    for (const [o, a] of gltf.parser.associations)
      if ((o as THREE.Object3D).isObject3D && a?.nodes !== undefined)
        nodes.set(a.nodes, o as THREE.Object3D);
    const all: THREE.Bone[] = [];
    gltf.scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) all.push(o as THREE.Bone);
    });
    const bones =
      vrmHumanoid(gltf.parser.json, (i) => nodes.get(i)) ?? matchHumanoid(all);
    const missing = CORE_BONES.filter((b) => !bones[b]);
    if (missing.length)
      return all.length === 0
        ? "This file has no skeleton, so it can't be posed. Rig it first (for example with Mixamo, or export from VRoid Studio)."
        : "This file's skeleton isn't one the studio knows (it needs a human rig: VRM, VRoid, Mixamo, Blender or Unreal bone names).";
    // Face +Z, its left on +X (VRM 0.x and some exports face -Z).
    const x = (b: BoneName) =>
      bones[b]!.getWorldPosition(new THREE.Vector3()).x;
    if (x("shoulderL") < x("shoulderR")) {
      gltf.scene.rotation.y += Math.PI;
      holder.updateMatrixWorld(true);
    }
    const face = this.prepareFace(holder, gltf, nodes, bones.neck!);
    const model = this.prepareModel(holder, bones);
    if (!model)
      return "This character's skeleton is put together in a way the studio can't pose yet.";
    model.face = face;
    return model;
  }

  /** The character's face shapes and eye bones, at rest, facing +Z.
   * Clones find eye bones by name, so only uniquely named ones count. */
  private prepareFace(
    holder: THREE.Object3D,
    gltf: GLTF,
    nodes: Map<number, THREE.Object3D>,
    neck: THREE.Bone,
  ): FaceRig | null {
    const meshes = shapeMeshes(holder);
    const nodeMeshes = (i: number) => {
      const o = nodes.get(i);
      if (!o) return [];
      const own = (o as THREE.Mesh).isMesh ? [o] : o.children;
      return own
        .map((m) => meshes.indexOf(m as THREE.Mesh))
        .filter((k) => k >= 0);
    };
    const counts = new Map<string, number>();
    holder.traverse((o) => counts.set(o.name, (counts.get(o.name) ?? 0) + 1));
    const eyes = findEyes(
      neck,
      vrmEyeNodes(gltf.parser.json, (i) => nodes.get(i)),
    ).filter((e) => e.name && counts.get(e.name) === 1);
    return buildFace(
      holder,
      vrmExpressions(gltf.parser.json, nodeMeshes),
      eyes,
    );
  }

  private prepareModel(root: THREE.Object3D): CachedModel;
  private prepareModel(
    root: THREE.Object3D,
    character: Partial<Record<BoneName, THREE.Bone>>,
  ): CachedModel | null;
  private prepareModel(
    root: THREE.Object3D,
    character?: Partial<Record<BoneName, THREE.Bone>>,
  ): CachedModel | null {
    root.updateMatrixWorld(true);
    const rig = character
      ? this.characterRig(root, character)
      : this.prepareRig(root);
    if (character && !rig) return null;
    // Bounds in the bind pose (the skinned box applies the bones).
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = FIGURE_HEIGHT / size.y;
    root.scale.setScalar(s);
    root.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      // The studio material replaces whatever the mannequin GLB shipped
      // with; characters keep their own (skin, clothes, face).
      if (!character) {
        const old = mesh.material;
        for (const m of Array.isArray(old) ? old : [old])
          if (m !== this.material) m.dispose();
        mesh.material = this.material;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = "model";
    });
    root.updateMatrixWorld(true);
    let headHeight = 1.72;
    let posing: ReturnType<StudioEngine["addPoseTargets"]> | null = null;
    if (rig) {
      const toWorldY = (y: number) => (y - box.min.y) * s;
      headHeight = THREE.MathUtils.lerp(
        toWorldY(rig.neckY),
        toWorldY(rig.crownY),
        HEAD_FRACTION,
      );
      // After the material pass, so the capsules keep their own.
      posing = this.addPoseTargets(root, rig, size.y);
    } else {
      // Unrigged GLB: average Y of the vertices in the top 0.25 units.
      const topY = size.y * s;
      let sum = 0;
      let count = 0;
      const v = new THREE.Vector3();
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        const pos = mesh.isMesh ? mesh.geometry.attributes.position : null;
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          if (v.y >= topY - 0.25) {
            sum += v.y;
            count += 1;
          }
        }
      });
      if (count > 0)
        headHeight = THREE.MathUtils.clamp(
          sum / count,
          topY - 0.3,
          topY - 0.05,
        );
    }
    return {
      object: root,
      headHeight,
      rig:
        rig && posing
          ? {
              bones: rig.bones,
              dirs: rig.dirs,
              retarget: rig.retarget,
              names: rig.names,
              ...posing,
            }
          : null,
    };
  }

  /** Find the skeleton baked by scripts/rig-mannequin.mjs and measure it
   * in the bind pose, before the figure is scaled into the studio. */
  private prepareRig(root: THREE.Object3D) {
    let mesh: THREE.SkinnedMesh | null = null;
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    });
    const skinned = mesh as THREE.SkinnedMesh | null;
    if (!skinned) return null;
    const bones = {} as Record<BoneName, THREE.Bone>;
    for (const b of skinned.skeleton.bones) bones[b.name as BoneName] = b;
    const tips = (skinned.userData.rig?.tips ?? {}) as Record<string, number[]>;
    if (CORE_BONES.some((n) => !bones[n]) || !tips.neck) return null;
    // Version 2 rigs add feet and fingers; older (cached) GLBs still pose.
    const full =
      BONE_NAMES.every((n) => bones[n]) && !!skinned.userData.rig?.palm;
    // Posed limbs leave the bind-pose bounds, and the one figure is
    // always in view, so skip culling. Taps hit the capsules instead of
    // CPU-skinning half a million triangles.
    skinned.frustumCulled = false;
    skinned.raycast = () => {};
    const at = (b: BoneName) => bones[b].getWorldPosition(new THREE.Vector3());
    const tip = (key: string) => new THREE.Vector3().fromArray(tips[key]);
    const dir = (a: THREE.Vector3, b: THREE.Vector3) =>
      b.clone().sub(a).normalize();
    const dirs: RigDirections = {
      upperArmL: dir(at("shoulderL"), at("elbowL")),
      upperArmR: dir(at("shoulderR"), at("elbowR")),
      forearmL: dir(at("elbowL"), at("wristL")),
      forearmR: dir(at("elbowR"), at("wristR")),
      thighL: dir(at("hipL"), at("kneeL")),
      thighR: dir(at("hipR"), at("kneeR")),
    };
    const tipOf: Partial<Record<BoneName, THREE.Vector3>> = {
      neck: tip("neck"),
      wristL: tip("wristL"),
      wristR: tip("wristR"),
      kneeL: tip("kneeL"),
      kneeR: tip("kneeR"),
    };
    if (full) {
      const palm = skinned.userData.rig.palm as Record<
        "L" | "R",
        { normal: number[]; thumb: number[] }
      >;
      dirs.bones = {};
      dirs.palm = { L: undefined!, R: undefined! };
      for (const s of ["L", "R"] as const) {
        dirs.palm[s] = {
          normal: new THREE.Vector3().fromArray(palm[s].normal).normalize(),
          thumb: new THREE.Vector3().fromArray(palm[s].thumb).normalize(),
        };
        delete tipOf[`knee${s}`]; // the shin now ends at the ankle
        tipOf[`ankle${s}`] = tip(`ankle${s}`);
        for (const f of ["thumb", ...FINGERS] as const) {
          const [b1, b2, b3] = ([1, 2, 3] as const).map(
            (k) => `${f}${k}${s}` as BoneName,
          );
          tipOf[b3] = tip(b3);
          dirs.bones[b1] = dir(at(b1), at(b2));
          dirs.bones[b2] = dir(at(b2), at(b3));
          dirs.bones[b3] = dir(at(b3), tipOf[b3]!);
        }
      }
    }
    // The standard-skeleton layer: identity for the mannequin, whose
    // bones are world-aligned at rest; anything else gets corrections.
    const { retarget, problems } = computeRetarget(
      root,
      matchHumanoid(skinned.skeleton.bones),
      dirs,
      dirs,
    );
    if (problems.length) return null;
    return {
      bones,
      dirs,
      retarget: isIdentityRetarget(retarget) ? undefined : retarget,
      names: Object.fromEntries(
        Object.keys(bones).map((b) => [b, b]),
      ) as Partial<Record<BoneName, string>>,
      at,
      tipOf,
      full,
      neckY: at("neck").y,
      crownY: tipOf.neck!.y,
    };
  }

  /** Measure an imported character's skeleton at rest, like prepareRig
   * does the mannequin's: limb ends come from end bones where the file
   * has them, else are extended from the last bone. Poses go through
   * the mannequin's reference directions and per-bone corrections. */
  private characterRig(
    root: THREE.Object3D,
    matched: Partial<Record<BoneName, THREE.Bone>>,
  ) {
    const bones = matched as Record<BoneName, THREE.Bone>;
    const full = BONE_NAMES.every((n) => bones[n]);
    root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      // As for the mannequin: no culling, and taps hit the capsules.
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
    });
    const at = (b: BoneName) => bones[b].getWorldPosition(new THREE.Vector3());
    const dir = (a: THREE.Vector3, b: THREE.Vector3) =>
      b.clone().sub(a).normalize();
    const box = new THREE.Box3().setFromObject(root);
    const owned = new Set<THREE.Object3D>(Object.values(bones));
    /** Where a bone's end is: its first child bone that isn't a joint
     * (an "end" bone), else the bone's length again past its joint. */
    const end = (b: BoneName, from?: BoneName) => {
      const child = bones[b].children.find(
        (c) => (c as THREE.Bone).isBone && !owned.has(c),
      );
      if (child) return child.getWorldPosition(new THREE.Vector3());
      const p = at(b);
      return from ? p.clone().add(p.clone().sub(at(from))) : p;
    };
    const dirs: RigDirections = {
      upperArmL: dir(at("shoulderL"), at("elbowL")),
      upperArmR: dir(at("shoulderR"), at("elbowR")),
      forearmL: dir(at("elbowL"), at("wristL")),
      forearmR: dir(at("elbowR"), at("wristR")),
      thighL: dir(at("hipL"), at("kneeL")),
      thighR: dir(at("hipR"), at("kneeR")),
    };
    const neck = at("neck");
    const tipOf: Partial<Record<BoneName, THREE.Vector3>> = {
      // The crown: the top of the model above the neck.
      neck: new THREE.Vector3(neck.x, box.max.y, neck.z),
    };
    for (const s of ["L", "R"] as const) {
      const wrist = at(`wrist${s}`);
      tipOf[`wrist${s}`] = wrist.clone().add(
        at(`wrist${s}`)
          .sub(at(`elbow${s}`))
          .multiplyScalar(0.4),
      );
      tipOf[`knee${s}`] = bones[`ankle${s}`]
        ? at(`ankle${s}`)
        : end(`knee${s}`, `hip${s}`);
    }
    if (full) {
      dirs.bones = {};
      dirs.palm = { L: undefined!, R: undefined! };
      for (const s of ["L", "R"] as const) {
        delete tipOf[`knee${s}`]; // the shin ends at the ankle
        // The toes' end bone if there is one; else forward along the floor.
        const ankle = at(`ankle${s}`);
        const isBone = (c: THREE.Object3D) => (c as THREE.Bone).isBone;
        const toe = bones[`ankle${s}`].children.find(isBone);
        const toeEnd = toe?.children.find(isBone);
        tipOf[`ankle${s}`] =
          (toeEnd ?? toe)?.getWorldPosition(new THREE.Vector3()) ??
          new THREE.Vector3(
            ankle.x,
            box.min.y,
            ankle.z + 0.06 * (box.max.y - box.min.y),
          );
        for (const f of ["thumb", ...FINGERS] as const) {
          const [b1, b2, b3] = ([1, 2, 3] as const).map(
            (k) => `${f}${k}${s}` as BoneName,
          );
          tipOf[b3] = end(b3, b2);
          dirs.bones[b1] = dir(at(b1), at(b2));
          dirs.bones[b2] = dir(at(b2), at(b3));
          dirs.bones[b3] = dir(at(b3), tipOf[b3]!);
        }
        // The hand ends at the middle fingertip, as the mannequin's does.
        tipOf[`wrist${s}`] = tipOf[`middle3${s}`]!.clone();
        // The palm from the knuckles: towards the thumb runs from the
        // little finger to the index; the normal is across the hand.
        const hand = dir(at(`wrist${s}`), at(`middle1${s}`));
        const thumb = at(`index1${s}`)
          .sub(at(`pinky1${s}`))
          .normalize();
        const normal =
          s === "L"
            ? hand.clone().cross(thumb).normalize()
            : thumb.clone().cross(hand).normalize();
        dirs.palm[s] = { normal, thumb };
      }
    }
    const ref = referenceDirections();
    const { retarget, problems } = computeRetarget(root, bones, dirs, ref);
    if (problems.length) return null;
    const names = Object.fromEntries(
      Object.entries(bones).map(([b, bone]) => [b, bone.name]),
    ) as Partial<Record<BoneName, string>>;
    // Clones find bones by name, so each joint's must be unique.
    const counts = new Map<string, number>();
    root.traverse((o) => counts.set(o.name, (counts.get(o.name) ?? 0) + 1));
    if (Object.values(names).some((n) => !n || counts.get(n)! > 1)) return null;
    return {
      bones,
      dirs: ref,
      retarget,
      names,
      at,
      tipOf,
      full,
      neckY: neck.y,
      crownY: tipOf.neck!.y,
    };
  }

  /** Invisible tap/drag capsules on every bone, and a dot on every
   * posable joint (shown in pose mode, drawn over the figure). */
  private addPoseTargets(
    root: THREE.Object3D,
    rig: NonNullable<ReturnType<StudioEngine["prepareRig"]>>,
    height: number,
  ) {
    // Work in the GLB's own units, like the stored tips. (The figure has
    // been scaled into the studio since the rig was measured.) Offsets
    // on a bone go into its own frame: a character's bones can point
    // any way, unlike the mannequin's world-aligned ones.
    root.updateMatrixWorld(true);
    const at = (b: BoneName) => root.worldToLocal(rig.at(b));
    const onBone = (b: BoneName, p: THREE.Vector3) =>
      rig.bones[b].worldToLocal(root.localToWorld(p.clone()));
    const material = new THREE.MeshBasicMaterial();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [bone, to, radius, joint, from = 0] of pickCapsules(rig.full)) {
      const joint0 = at(bone);
      const b = to === "tip" ? rig.tipOf[bone]! : at(to);
      const a = joint0.clone().lerp(b, from);
      const r = radius * height;
      const capsule = new THREE.Mesh(
        new THREE.CapsuleGeometry(
          r,
          Math.max(0.001, a.distanceTo(b) - r),
          2,
          8,
        ),
        material,
      );
      capsule.name = "pose-pick";
      capsule.userData.joint = joint;
      capsule.userData.bone = bone;
      capsule.visible = false;
      // Placed in the model's frame, then moved onto the bone keeping
      // where it is (whatever the bone's rotation and scale).
      capsule.position.copy(a.clone().lerp(b, 0.5));
      capsule.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
      root.add(capsule);
      capsule.updateMatrixWorld();
      rig.bones[bone].attach(capsule);
    }
    // Maya-style skeleton overlay: a small hollow circle on each joint,
    // thin bone lines between them, drawn through the mesh.
    const overlay = <M extends THREE.Material>(m: M): M => {
      m.transparent = true;
      m.depthTest = false;
      m.depthWrite = false;
      m.toneMapped = false;
      return m;
    };
    const ringGeometry = new THREE.RingGeometry(0.58, 1, 24);
    const pickGeometry = new THREE.SphereGeometry(1, 8, 6);
    const dotMaterial = overlay(
      new THREE.MeshBasicMaterial({ color: JOINT_BLUE }),
    );
    const activeDotMaterial = overlay(
      new THREE.MeshBasicMaterial({ color: JOINT_GREEN }),
    );
    // Older rigs have no feet or fingers to put dots on.
    const defs = JOINT_DOTS.filter(
      (d) =>
        rig.bones[d.bone] &&
        (d.effector === "tip" ? rig.tipOf[d.bone] : rig.bones[d.effector]),
    );
    const dots: PoseDot[] = defs.map((def) => {
      const end =
        def.effector === "tip" ? rig.tipOf[def.bone]! : at(def.effector);
      const ring = new THREE.Mesh(ringGeometry, dotMaterial);
      ring.name = "pose-dot-ring";
      ring.userData.joint = def.joint;
      ring.renderOrder = 21;
      ring.visible = false;
      ring.raycast = () => {};
      const pick = new THREE.Mesh(pickGeometry, material);
      pick.name = "pose-dot";
      pick.userData.joint = def.joint;
      pick.visible = false;
      rig.bones[def.bone].add(ring, pick);
      return { def, ring, pick, effector: onBone(def.bone, end) };
    });
    // Bones: each joint to its children, and on to the limb tips.
    const segments: Array<[BoneName, BoneName | THREE.Vector3]> = [];
    for (const name of BONE_NAMES) {
      const parent = JOINT_PARENT[name];
      if (parent && rig.bones[name] && rig.bones[parent])
        segments.push([parent, name]);
    }
    for (const [bone, tip] of Object.entries(rig.tipOf) as Array<
      [BoneName, THREE.Vector3]
    >)
      segments.push([bone, onBone(bone, tip)]);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(segments.length * 6), 3),
    );
    const lines = new THREE.LineSegments(
      lineGeometry,
      overlay(new THREE.LineBasicMaterial({ color: BONE_BLUE, opacity: 0.75 })),
    );
    lines.renderOrder = 20;
    lines.frustumCulled = false;
    lines.visible = false;
    lines.raycast = () => {};
    return { dots, dotMaterial, activeDotMaterial, lines, segments };
  }

  /** Show the skeleton overlay (pose mode) on the active figure only:
   * joint circles facing the camera at a constant on-screen size, the
   * selected one green. */
  private layoutDots(show: boolean): void {
    const active = this.active;
    const joint = this.selection?.startsWith("pose:")
      ? this.selection.slice(5)
      : null;
    for (const inst of this.instances.values()) {
      const rig = inst.rig;
      if (!rig) continue;
      const on = show && inst === active;
      rig.lines.visible = on;
      // Finger dots: only while posing that hand (its wrist or a finger).
      const hand = joint?.match(
        /^(wrist|thumb|index|middle|ring|pinky)\d?(L|R)$/,
      )?.[2];
      for (const d of rig.dots)
        d.ring.visible = on && (!d.def.detail || d.def.detail === hand);
      if (!on) continue;
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const k = new THREE.Vector3();
      for (const d of rig.dots) {
        const bone = rig.bones[d.def.bone];
        // A character's bones may carry a scale of their own.
        const scale = bone.getWorldScale(k).x;
        const dist = this.camera.position.distanceTo(bone.getWorldPosition(p));
        const selected = d.def.joint === joint;
        const r = Math.max(0.0035, dist * 0.0035) * (selected ? 1.3 : 1);
        d.ring.scale.setScalar(r / scale);
        // Generous touch target around a small circle.
        d.pick.scale.setScalar(Math.max(r * 4.5, 0.02) / scale);
        // Face the camera whatever the bone's rotation.
        d.ring.quaternion
          .copy(bone.getWorldQuaternion(q).invert())
          .multiply(this.camera.quaternion);
        d.ring.material = selected ? rig.activeDotMaterial : rig.dotMaterial;
      }
      const pos = rig.lines.geometry.attributes
        .position as THREE.BufferAttribute;
      const b = new THREE.Vector3();
      rig.segments.forEach(([from, to], i) => {
        const bone = rig.bones[from];
        bone.getWorldPosition(p);
        if (to instanceof THREE.Vector3) bone.localToWorld(b.copy(to));
        else rig.bones[to].getWorldPosition(b);
        pos.setXYZ(i * 2, p.x, p.y, p.z);
        pos.setXYZ(i * 2 + 1, b.x, b.y, b.z);
      });
      pos.needsUpdate = true;
    }
  }

  /** For automated tests: what a figure (default: the active one) is
   * showing, an imported character or its mannequin. */
  figureShows(figure?: string): "character" | "mannequin" | null {
    const inst = figure ? this.instances.get(figure) : this.active;
    if (!inst) return null;
    return this.characterIds.has(inst.url) ? "character" : "mannequin";
  }

  /** For automated tests: a figure's face shape weights (every shape
   * mesh's, in order) and eye bone rotations; null without a face. */
  faceState(figure?: string): { shapes: number[]; eyes: number[][] } | null {
    const inst = figure ? this.instances.get(figure) : this.active;
    if (!inst?.face) return null;
    return {
      shapes: inst.face.meshes.flatMap((m) => [
        ...(m.morphTargetInfluences ?? []),
      ]),
      eyes: [...inst.face.eyes.values()].map((b) => b.quaternion.toArray()),
    };
  }

  /** For automated tests: where each posable joint (and each hand's
   * middle) of a figure (default: the active one) is on screen, in
   * client pixels, plus `body`: the middle of the chest. */
  jointsOnScreen(figure?: string): Record<string, { x: number; y: number }> {
    const inst = figure ? this.instances.get(figure) : this.active;
    const rig = inst?.rig;
    if (!rig) return {};
    const rect = this.renderer.domElement.getBoundingClientRect();
    const out: Record<string, { x: number; y: number }> = {};
    const put = (name: string, p: THREE.Vector3) => {
      p.project(this.camera);
      out[name] = {
        x: rect.left + ((p.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - p.y) / 2) * rect.height,
      };
    };
    this.figure.updateMatrixWorld(true);
    for (const d of rig.dots) {
      const bone = rig.bones[d.def.bone];
      put(d.def.joint, bone.getWorldPosition(new THREE.Vector3()));
      if (d.def.bone.startsWith("wrist"))
        // The middle of the palm (a third of the way to the fingertips):
        // with finger bones, halfway is already on the knuckles.
        put(
          `hand${d.def.bone.slice(-1)}`,
          bone.localToWorld(d.effector.clone().multiplyScalar(0.3)),
        );
      if (d.def.bone === "spine")
        put("body", bone.localToWorld(d.effector.clone().multiplyScalar(0.5)));
    }
    return out;
  }

  // -------------------------------------------------------------- pointer

  private pointerRay(e: PointerEvent): THREE.Ray {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  private pickLight(e: PointerEvent): string | null {
    if (!this.showHandles) return null;
    this.pointerRay(e);
    const picks = [...this.rigs.values()].map((r) => r.pick);
    const hit = this.raycaster.intersectObjects(picks, false)[0];
    return hit ? (hit.object.userData.lightId as string) : null;
  }

  /** Body parts and joint dots can be dragged while the pose controls
   * are open. */
  private get poseMode(): boolean {
    return this.selection === "pose" || !!this.selection?.startsWith("pose:");
  }

  /** Figures can be dragged across the floor while the mannequin
   * controls are open. */
  private get moveMode(): boolean {
    return this.selection === "model";
  }

  /** The body part (pick capsule) under the pointer, on any figure. */
  private pickBodyPart(): THREE.Intersection | null {
    return (
      this.raycaster
        .intersectObject(this.figure, true)
        .find((h) => h.object.name === "pose-pick") ?? null
    );
  }

  /** What a press in pose mode would grab: one of the active figure's
   * joint dots (they sit on top), then a body part of any figure. Null
   * if nothing draggable is there. */
  private pickPoseTarget(e: PointerEvent): {
    figure: string;
    joint: string;
    vars: DragVar[];
    grabbed: THREE.Object3D;
    /** The point that follows the pointer, world space. */
    origin: THREE.Vector3;
    /** Where the press landed, world space. */
    at: THREE.Vector3;
  } | null {
    if (!this.poseMode) return null;
    const ray = this.pointerRay(e);
    const partHit = this.pickBodyPart();
    const active = this.active;
    const rig = active?.rig;
    // Of the dots whose touch target the pointer is in, the one whose
    // centre is closest to it (not the nearest to the camera: with a
    // hand's finger dots showing, the thumb's base dot sits in front of
    // the wrist's).
    const p = new THREE.Vector3();
    const dot = rig?.dots
      .filter((d) => d.ring.visible)
      .map((d) => ({
        d,
        miss: ray.distanceToPoint(d.ring.getWorldPosition(p)),
        reach: d.pick.getWorldScale(new THREE.Vector3()).x,
      }))
      .filter((c) => c.miss < c.reach)
      .sort((a, b) => a.miss - b.miss)[0]?.d;
    // A dot's generous touch target only counts off the body: over a body
    // part, the press must land near the circle itself. (On a phone the
    // whole hand sits inside the wrist dot's target.)
    const onCircle =
      dot &&
      ray.distanceToPoint(dot.ring.getWorldPosition(new THREE.Vector3())) <
        dot.ring.getWorldScale(new THREE.Vector3()).x * 2;
    if (active && rig && dot && (!partHit || onCircle)) {
      const grabbed = rig.bones[dot.def.bone];
      return {
        figure: active.id,
        joint: dot.def.joint,
        vars: dot.def.vars,
        grabbed,
        origin: grabbed.localToWorld(dot.effector.clone()),
        at: grabbed.getWorldPosition(new THREE.Vector3()),
      };
    }
    const owner = partHit && this.instanceOf(partHit.object);
    if (!partHit || !owner) return null;
    let bone = partHit.object.userData.bone as BoneName;
    let joint = partHit.object.userData.joint as string;
    let grabbed = partHit.object.parent!;
    // Fingers are grabbed one by one only while that hand is being
    // posed (like their dots); otherwise the whole hand is the handle
    // and lifts the arm. Seen from the front the thumb lies over the
    // palm, and on a phone a finger is a few pixels wide.
    const finger = bone.match(/^(thumb|index|middle|ring|pinky)\d(L|R)$/);
    const posing = this.selection?.match(
      /^pose:(wrist|thumb|index|middle|ring|pinky)\d?(L|R)$/,
    );
    if (finger && owner.rig && posing?.[2] !== finger[2]) {
      bone = `wrist${finger[2]}` as BoneName;
      joint = bone;
      grabbed = owner.rig.bones[bone];
    }
    const vars = dragVariables(bone);
    if (vars.length === 0) return null;
    return {
      figure: owner.id,
      joint,
      vars,
      grabbed,
      origin: partHit.point.clone(),
      at: partHit.point.clone(),
    };
  }

  private startPoseDrag(
    e: PointerEvent,
    t: NonNullable<ReturnType<StudioEngine["pickPoseTarget"]>>,
  ): boolean {
    const inst = this.instances.get(t.figure);
    const figure = this.doc?.figures.find((f) => f.id === t.figure);
    if (!inst?.rig || !figure) return false;
    this.figure.updateMatrixWorld(true);
    const joints = figure.pose.joints as Record<string, Record<string, number>>;
    this.poseDrag = {
      pointerId: e.pointerId,
      figure: t.figure,
      vars: t.vars,
      x: t.vars.map((v) => joints[v.joint][v.dof]),
      reach: makeReach(
        inst.rig.bones,
        inst.rig.dirs,
        figure.pose.joints,
        t.vars,
        t.grabbed,
        t.grabbed.worldToLocal(t.origin.clone()),
        inst.rig.retarget,
      ),
      origin: t.origin,
      start: t.at,
      // The pointer moves across a plane facing the camera, through
      // where it pressed; the grabbed point moves with it.
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
        this.camera.getWorldDirection(new THREE.Vector3()),
        t.at,
      ),
      down: { x: e.clientX, y: e.clientY },
      moved: false,
    };
    return true;
  }

  /** Grab a figure to slide it across the floor (mannequin controls). */
  private startMoveDrag(e: PointerEvent): FigureInstance | null {
    if (!this.moveMode) return null;
    this.pointerRay(e);
    const hit = this.pickBodyPart();
    const owner = this.instanceOf(hit?.object ?? null);
    if (!hit || !owner) return null;
    // Looking down on the set, the pointer slides over a level plane
    // through the grabbed point (like the floor). Near eye level that
    // plane is seen edge-on, so use one facing the camera instead; only
    // the horizontal part of the motion moves the figure either way.
    const view = this.camera.getWorldDirection(new THREE.Vector3());
    const normal =
      Math.abs(view.y) > 0.35 ? new THREE.Vector3(0, 1, 0) : view.negate();
    this.moveDrag = {
      pointerId: e.pointerId,
      figure: owner.id,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point),
      start: hit.point.clone(),
      from: owner.root.position.clone(),
      down: { x: e.clientX, y: e.clientY },
      moved: false,
    };
    return owner;
  }

  private grab(e: PointerEvent, selection: Selection, figure?: string): void {
    // Hold it: keep OrbitControls from starting a rotate.
    e.stopImmediatePropagation();
    e.preventDefault();
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.selection = selection;
    if (figure) this.activeFigure = figure;
    this.updateHandleStyles();
    this.callbacks.onSelect?.(selection, figure);
    this.invalidate();
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    // A second finger during a drag must not start an orbit.
    if (this.dragging || this.poseDrag || this.moveDrag) {
      e.stopImmediatePropagation();
      return;
    }
    this.downAt = { x: e.clientX, y: e.clientY };
    const id = this.pickLight(e);
    if (id) {
      this.dragging = { id, pointerId: e.pointerId };
      this.grab(e, id);
      return;
    }
    const target = this.pickPoseTarget(e);
    if (target && this.startPoseDrag(e, target)) {
      this.renderer.domElement.style.cursor = "grabbing";
      this.grab(e, `pose:${target.joint}`, target.figure);
      return;
    }
    const moving = this.startMoveDrag(e);
    if (moving) {
      this.renderer.domElement.style.cursor = "grabbing";
      this.grab(e, "model", moving.id);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const drag = this.poseDrag;
    if (drag) {
      if (e.pointerId !== drag.pointerId) return;
      if (
        !drag.moved &&
        Math.hypot(e.clientX - drag.down.x, e.clientY - drag.down.y) < 4
      )
        return;
      drag.moved = true;
      const p = this.pointerRay(e).intersectPlane(
        drag.plane,
        new THREE.Vector3(),
      );
      if (!p) return;
      const target = drag.origin.clone().add(p.sub(drag.start));
      drag.x = solveReach(drag.vars, drag.x, drag.reach, target);
      const patches: Partial<Record<JointId, Record<string, number>>> = {};
      drag.vars.forEach((v, i) => {
        (patches[v.joint] ??= {})[v.dof] = Math.round(drag.x[i] * 10) / 10;
      });
      this.callbacks.onPoseDrag?.(drag.figure, patches);
      this.invalidate();
      return;
    }
    const move = this.moveDrag;
    if (move) {
      if (e.pointerId !== move.pointerId) return;
      if (
        !move.moved &&
        Math.hypot(e.clientX - move.down.x, e.clientY - move.down.y) < 4
      )
        return;
      move.moved = true;
      const p = this.pointerRay(e).intersectPlane(
        move.plane,
        new THREE.Vector3(),
      );
      if (!p) return;
      const delta = p.sub(move.start).setY(0);
      const at = move.from.clone().add(delta);
      const clamp = (v: number, [lo, hi]: readonly [number, number]) =>
        Math.round(THREE.MathUtils.clamp(v, lo, hi) * 100) / 100;
      this.callbacks.onFigureMove?.(move.figure, {
        x: clamp(at.x, LIMITS.figureX),
        z: clamp(at.z, LIMITS.figureZ),
      });
      return;
    }
    if (!this.dragging) {
      // Hover feedback: what a press here would do.
      if (e.pointerType === "mouse" && e.buttons === 0) {
        let cursor = "";
        if (this.poseMode && this.pickPoseTarget(e)) cursor = "grab";
        else if (this.moveMode) {
          this.pointerRay(e);
          if (this.pickBodyPart()) cursor = "move";
        }
        this.renderer.domElement.style.cursor = cursor;
      }
      return;
    }
    if (e.pointerId !== this.dragging.pointerId) return;
    const rig = this.rigs.get(this.dragging.id);
    if (!rig) return;
    const patch = dragOnSphere(this.pointerRay(e), rig.state);
    if (patch) this.callbacks.onLightDrag?.(rig.state.id, patch);
  };

  private onPointerUp = (e: PointerEvent): void => {
    const drag = this.poseDrag;
    if (drag && e.pointerId === drag.pointerId) {
      this.poseDrag = null;
      this.downAt = null;
      this.renderer.domElement.releasePointerCapture?.(e.pointerId);
      this.renderer.domElement.style.cursor = "";
      if (drag.moved) this.callbacks.onPoseDragEnd?.();
      // Bones back in step with the document (a tap changed nothing).
      const inst = this.instances.get(drag.figure);
      if (inst) inst.joints = null;
      this.syncFigures();
      return;
    }
    const move = this.moveDrag;
    if (move && e.pointerId === move.pointerId) {
      this.moveDrag = null;
      this.downAt = null;
      this.renderer.domElement.releasePointerCapture?.(e.pointerId);
      this.renderer.domElement.style.cursor = "";
      if (move.moved) this.callbacks.onFigureMoveEnd?.();
      this.invalidate();
      return;
    }
    if (this.dragging && e.pointerId === this.dragging.pointerId) {
      const { id } = this.dragging;
      this.dragging = null;
      this.renderer.domElement.releasePointerCapture?.(e.pointerId);
      this.callbacks.onLightDragEnd?.(id);
      this.invalidate();
      return;
    }
    // A tap (not an orbit) selects what's under the pointer.
    const down = this.downAt;
    this.downAt = null;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    this.pointerRay(e);
    // Joint dots only exist while posing.
    const hit = this.raycaster
      .intersectObjects([this.figure, this.cyc], true)
      .find((h) => h.object.name !== "pose-dot" || this.poseMode);
    const owner = hit ? this.instanceOf(hit.object) : null;
    const part =
      hit?.object.name === "pose-pick" || hit?.object.name === "pose-dot";
    const sel: Selection = !hit
      ? null
      : owner && this.moveMode
        ? "model"
        : part
          ? `pose:${hit.object.userData.joint as string}`
          : owner
            ? "model"
            : "backdrop";
    this.selection = sel;
    if (owner) this.activeFigure = owner.id;
    this.updateHandleStyles();
    this.callbacks.onSelect?.(sel, owner?.id);
    this.invalidate();
  };

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.callbacks.onStatus?.({
      model: "error",
      message:
        "The graphics context was lost (the GPU was reset or ran out of memory). Reload to continue — your work is autosaved.",
    });
  };

  // ---------------------------------------------------------------- export

  /** Render one frame at an arbitrary size and return it as a Blob.
   * Handles and the selection ring are hidden; the viewport is restored
   * before the promise resolves. */
  async exportImage(opts: ExportOptions): Promise<Blob> {
    const max = this.maxExportSize();
    const width = Math.round(THREE.MathUtils.clamp(opts.width, 16, max));
    const height = Math.round(THREE.MathUtils.clamp(opts.height, 16, max));
    const canvas = this.renderer.domElement;
    const prev = {
      w: this.container.clientWidth,
      h: this.container.clientHeight,
      ratio: this.pixelRatio,
      background: this.scene.background,
      handles: this.handlesRoot.visible,
      cyc: this.cyc.visible,
      catcher: this.catcher.visible,
    };
    const transparent = opts.transparent && opts.format === "image/png";
    this.handlesRoot.visible = false;
    this.layoutDots(false);
    if (transparent) {
      this.scene.background = null;
      this.cyc.visible = false;
      this.catcher.visible = true;
    }
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setClearColor(0x000000, transparent ? 0 : 1);
    this.renderer.render(this.scene, this.camera);
    // toBlob snapshots the drawing buffer synchronously, so restoring
    // the viewport right after is safe.
    const blob = new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error("The browser could not encode the image.")),
        opts.format,
        opts.quality ?? 0.92,
      ),
    );
    this.scene.background = prev.background;
    this.handlesRoot.visible = prev.handles;
    this.cyc.visible = prev.cyc;
    this.catcher.visible = prev.catcher;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(prev.ratio);
    this.renderer.setSize(prev.w, prev.h);
    this.camera.aspect = prev.w / prev.h;
    this.camera.updateProjectionMatrix();
    this.render();
    return blob;
  }

  // ---------------------------------------------------------- video capture

  /** Switch the canvas to a fixed size for recording a video: handles
   * and the joint overlay hidden, adaptive resolution and resizing
   * paused. Draw frames with renderCapture(); always endCapture(). */
  beginCapture(width: number, height: number): HTMLCanvasElement {
    if (!this.capture) this.capture = { handles: this.handlesRoot.visible };
    this.handlesRoot.visible = false;
    this.layoutDots(false);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    return this.renderer.domElement;
  }

  /** Draw the current scene into the capture canvas now. */
  renderCapture(): void {
    if (!this.capture) return;
    this.controls.update();
    this.layoutDots(false);
    this.renderer.render(this.scene, this.camera);
  }

  endCapture(): void {
    if (!this.capture) return;
    this.handlesRoot.visible = this.capture.handles;
    this.capture = null;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.resize();
  }

  // ------------------------------------------------------------- benchmark

  /** Orbit the camera 360° continuously and measure real frame times. */
  runBenchmark(durationMs = 4000): Promise<BenchmarkResult> {
    if (this.benchmark)
      return Promise.reject(new Error("Benchmark already running"));
    const offset = this.camera.position.clone().sub(this.controls.target);
    const startAzimuth = Math.atan2(offset.x, offset.z);
    this.setPixelRatio(this.maxPixelRatio);
    return new Promise((resolve) => {
      this.benchmark = {
        start: 0,
        last: 0,
        frames: [],
        resolve,
        durationMs,
        startAzimuth,
      };
      this.lastFrameAt = 0;
      this.invalidate();
    });
  }

  private stepBenchmark(now: number): void {
    const b = this.benchmark!;
    if (!b.start) b.start = now;
    else b.frames.push(now - b.last);
    b.last = now;
    const t = (now - b.start) / b.durationMs;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const s = new THREE.Spherical().setFromVector3(offset);
    s.theta = b.startAzimuth + t * Math.PI * 2;
    this.camera.position
      .copy(this.controls.target)
      .add(new THREE.Vector3().setFromSpherical(s));
    this.camera.lookAt(this.controls.target);
    if (t < 1) return;
    this.benchmark = null;
    const frames = b.frames.slice().sort((x, y) => x - y);
    const total = b.frames.reduce((a, c) => a + c, 0);
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const info = this.renderer.info.render;
    b.resolve({
      frames: frames.length,
      durationMs: Math.round(total),
      avgFps: frames.length
        ? Math.round((frames.length / total) * 1000 * 10) / 10
        : 0,
      p95FrameMs: frames.length
        ? Math.round(frames[Math.floor(frames.length * 0.95)] * 10) / 10
        : 0,
      pixelRatio: this.pixelRatio,
      drawCalls: info.calls,
      triangles: info.triangles,
      renderer: dbg
        ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
        : "unknown",
    });
  }

  // --------------------------------------------------------------- dispose

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown, {
      capture: true,
    });
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerUp);
    el.removeEventListener("webglcontextlost", this.onContextLost);
    this.controls.removeEventListener("change", this.invalidate);
    this.controls.removeEventListener("start", this.onControlsStart);
    this.controls.removeEventListener("end", this.onControlsEnd);
    this.controls.dispose();
    for (const [id, rig] of [...this.rigs]) this.removeRig(id, rig);
    for (const inst of [...this.instances.values()]) this.removeInstance(inst);
    for (const model of this.models.values())
      disposeModel(model, this.material);
    this.models.clear();
    for (const g of Object.values(this.handleGeometries)) g.dispose();
    this.pickGeometry.dispose();
    this.pickMaterial.dispose();
    this.selectionRing.geometry.dispose();
    this.selectionRing.material.dispose();
    this.catcher.geometry.dispose();
    this.catcher.material.dispose();
    this.cyc.geometry.dispose();
    this.cyc.material.dispose();
    this.material.dispose();
    this.envMap?.dispose();
    this.renderer.dispose();
    el.remove();
  }
}

const TONE_MAPPING = {
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
} as const;

function shadowOf(light: LightRig["light"]): THREE.LightShadow | null {
  return light instanceof THREE.RectAreaLight ? null : (light.shadow ?? null);
}

function disposeModel(model: CachedModel, keep: THREE.Material): void {
  disposeObject(model.object, keep);
  if (!model.rig) return;
  model.rig.lines.geometry.dispose();
  (model.rig.lines.material as THREE.Material).dispose();
  model.rig.dotMaterial.dispose();
  model.rig.activeDotMaterial.dispose();
}

function disposeObject(root: THREE.Object3D, keep: THREE.Material): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]) {
      if (m === keep) continue;
      for (const v of Object.values(m))
        if ((v as THREE.Texture | null)?.isTexture)
          (v as THREE.Texture).dispose();
      m.dispose();
    }
  });
}

/** Map a pointer ray onto the light's orbit sphere (centre = pivot,
 * radius = light distance) and return the new azimuth/elevation. Of the
 * two intersections, the one nearer the light's current position wins,
 * so a light behind the subject stays behind while dragged. */
export function dragOnSphere(
  ray: THREE.Ray,
  light: Pick<StudioLight, "azimuth" | "elevation" | "distance">,
): { azimuth: number; elevation: number } | null {
  const r = light.distance;
  const oc = ray.origin.clone().sub(PIVOT);
  const b = oc.dot(ray.direction);
  const c = oc.lengthSq() - r * r;
  const disc = b * b - c;
  let point: THREE.Vector3;
  if (disc >= 0) {
    const sq = Math.sqrt(disc);
    const current = new THREE.Vector3(...lightPosition(light));
    const candidates = [-b - sq, -b + sq]
      .filter((t) => t > 0)
      .map((t) => ray.at(t, new THREE.Vector3()));
    if (!candidates.length) return null;
    candidates.sort(
      (p, q) => p.distanceToSquared(current) - q.distanceToSquared(current),
    );
    point = candidates[0];
  } else {
    // Missed the sphere: use the closest point on the ray, pushed out.
    point = ray.closestPointToPoint(PIVOT, new THREE.Vector3());
  }
  const local = point.sub(PIVOT);
  if (local.lengthSq() < 1e-6) return null;
  local.setLength(r);
  const azimuth =
    (THREE.MathUtils.radToDeg(Math.atan2(local.x, local.z)) + 360) % 360;
  const elevation = THREE.MathUtils.radToDeg(
    Math.asin(THREE.MathUtils.clamp(local.y / r, -1, 1)),
  );
  return {
    azimuth: Math.round(azimuth) % 360,
    elevation: Math.round(
      THREE.MathUtils.clamp(
        elevation,
        LIMITS.elevation[0],
        LIMITS.elevation[1],
      ),
    ),
  };
}

/** Seamless studio sweep: floor in front, a curve, and a back wall. */
function buildCycGeometry(): THREE.BufferGeometry {
  const width = 16;
  const floorFront = 6;
  const curveStart = -3.5; // z where the floor starts to curve up
  const radius = 2;
  const wallTop = 7;
  const profile: Array<[number, number]> = [[floorFront, 0]];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    profile.push([
      curveStart - Math.sin(a) * radius,
      radius - Math.cos(a) * radius,
    ]);
  }
  profile.push([curveStart - radius, wallTop]);
  const positions: number[] = [];
  const indices: number[] = [];
  profile.forEach(([z, y], i) => {
    positions.push(-width / 2, y, z, width / 2, y, z);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
