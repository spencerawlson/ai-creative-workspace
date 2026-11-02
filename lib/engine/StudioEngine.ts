/** StudioEngine: the imperative Three.js side of the studio.
 *
 * React owns the scene document; the engine renders it. The engine
 * never mutates the document — user gestures inside the viewport
 * (selecting or dragging a light handle) are reported through
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
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { LIGHT_PIVOT_Y, kelvinToRgb, lightPosition } from "@/lib/lighting";
import { exposureMultiplier, focalToVerticalFov } from "@/lib/studio/presets";
import {
  LIMITS,
  type MannequinModel,
  type SceneDoc,
  type StudioLight,
} from "@/lib/studio/schema";

export type CameraView = "face" | "full" | "studio";
export type Selection = string | null; // light id, "model", "camera", "backdrop"

export const MODEL_URLS: Record<MannequinModel, string> = {
  male: "/models/mannequin-male.glb",
  female: "/models/mannequin-female.glb",
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
  onSelect?: (selection: Selection) => void;
  onLightDrag?: (
    id: string,
    patch: { azimuth: number; elevation: number },
  ) => void;
  onLightDragEnd?: (id: string) => void;
  onStatus?: (status: EngineStatus) => void;
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

interface CachedModel {
  object: THREE.Object3D;
  headHeight: number;
}

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
  private models = new Map<string, CachedModel>();
  private modelUrl: string | null = null;
  private loadToken = 0;
  private headHeight = 1.72;
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
    this.scene.add(this.handlesRoot);

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

    if (!prev || prev.model !== doc.model)
      this.loadModel(MODEL_URLS[doc.model]);
    if (!prev || prev.lights !== doc.lights || prev.shadows !== doc.shadows) {
      this.shadowQuality = doc.shadows.quality;
      this.syncLights(doc.lights);
    }
    if (!prev || prev.material !== doc.material) this.syncMaterial(doc);
    if (!prev || prev.backdrop !== doc.backdrop) this.syncBackdrop(doc);

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
      this.controls.target.set(0, this.headHeight, 0);
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
    if (this.disposed) return;
    const moving = this.controls.update();
    this.trackFrameTime(now, moving);
    this.render();
    if (this.benchmark) this.stepBenchmark(now);
    if (moving || this.interacting || this.dragging || this.benchmark) {
      this.invalidate();
    } else if (this.pixelRatio !== this.maxPixelRatio) {
      // Idle again: restore full resolution for a crisp still frame.
      this.setPixelRatio(this.maxPixelRatio);
      this.invalidate();
    }
  };

  private render(): void {
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
      moving || this.interacting || this.dragging || this.benchmark;
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
    if (this.disposed) return;
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
    this.invalidate();
  };

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

  private loadModel(url: string): void {
    const token = ++this.loadToken;
    const cached = this.models.get(url);
    if (cached) {
      this.showModel(url, cached);
      return;
    }
    this.callbacks.onStatus?.({ model: "loading" });
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      url,
      (gltf) => {
        const model = this.prepareModel(gltf.scene);
        if (this.disposed) {
          disposeObject(model.object, this.material);
          return;
        }
        this.models.set(url, model);
        if (token === this.loadToken) this.showModel(url, model);
      },
      undefined,
      () => {
        if (this.disposed || token !== this.loadToken) return;
        // Keep the previous figure (if any) rather than a wrong one.
        this.callbacks.onStatus?.({
          model: "error",
          message:
            "The mannequin could not be downloaded. Check your connection and try again.",
        });
      },
    );
  }

  retryModel(): void {
    if (this.doc) this.loadModel(MODEL_URLS[this.doc.model]);
  }

  private prepareModel(root: THREE.Object3D): CachedModel {
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = FIGURE_HEIGHT / size.y;
    root.scale.setScalar(s);
    root.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      // The studio material replaces whatever the GLB shipped with.
      const old = mesh.material;
      for (const m of Array.isArray(old) ? old : [old])
        if (m !== this.material) m.dispose();
      mesh.material = this.material;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = "model";
    });
    // Head height from THIS model's geometry: average Y of vertices in
    // the top 0.25 units (head + neck band), clamped inside the figure.
    root.updateMatrixWorld(true);
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
    const headHeight =
      count > 0
        ? THREE.MathUtils.clamp(sum / count, topY - 0.3, topY - 0.05)
        : 1.72;
    return { object: root, headHeight };
  }

  private showModel(url: string, model: CachedModel): void {
    this.figure.clear();
    this.figure.add(model.object);
    this.modelUrl = url;
    this.headHeight = model.headHeight;
    if (this.view === "face") {
      this.controls.target.set(0, this.headHeight, 0);
      this.camera.position.set(0.35, this.headHeight + 0.13, 0.65);
      this.controls.update();
    }
    this.callbacks.onStatus?.({ model: "ready" });
    this.invalidate();
  }

  get loadedModelUrl(): string | null {
    return this.modelUrl;
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

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    const id = this.pickLight(e);
    if (!id) return;
    // Grab the handle: keep OrbitControls from starting a rotate.
    e.stopImmediatePropagation();
    e.preventDefault();
    this.dragging = { id, pointerId: e.pointerId };
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.selection = id;
    this.updateHandleStyles();
    this.callbacks.onSelect?.(id);
    this.invalidate();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || e.pointerId !== this.dragging.pointerId) return;
    const rig = this.rigs.get(this.dragging.id);
    if (!rig) return;
    const patch = dragOnSphere(this.pointerRay(e), rig.state);
    if (patch) this.callbacks.onLightDrag?.(rig.state.id, patch);
  };

  private onPointerUp = (e: PointerEvent): void => {
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
    const hit = this.raycaster.intersectObjects(
      [this.figure, this.cyc],
      true,
    )[0];
    const sel: Selection = hit
      ? hit.object.name === "model"
        ? "model"
        : "backdrop"
      : null;
    this.selection = sel;
    this.updateHandleStyles();
    this.callbacks.onSelect?.(sel);
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
    for (const model of this.models.values())
      disposeObject(model.object, this.material);
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

function disposeObject(root: THREE.Object3D, keep: THREE.Material): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]) {
      if (m !== keep) m.dispose();
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
