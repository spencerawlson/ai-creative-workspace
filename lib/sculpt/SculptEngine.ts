/** The 3D view for sculpting: the clay under studio-like lights on a
 * shadow-catching floor, orbit and zoom, and brush strokes with the
 * pointer (mouse, finger or pen).
 *
 * The clay is drawn straight from the SculptMesh arrays (brushes change
 * them in place; the GPU copy is refreshed once per frame). Pointer hits
 * use a bounding-volume tree (three-mesh-bvh), refitted as the clay
 * moves. Strokes start on the clay; a drag that starts off it, a right
 * drag, or two fingers turns the view instead. */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import {
  Stroke,
  applyDab,
  applyLayerOp,
  applyMask,
  applyPaint,
  moveGrab,
  startGrab,
  type BrushId,
  type BrushSettings,
  type Dab,
  type Grab,
  type LayerOp,
} from "./brushes";
import { SculptHistory } from "./history";
import { faceCount, hasAny, type Channel, type SculptMesh } from "./mesh";
import { bakeColors, hexToSrgb } from "./paint";

export interface SculptTool {
  brush: BrushId;
  /** Brush radius on screen, in CSS pixels. */
  sizePx: number;
  strength: number;
  invert: boolean;
  symmetry: boolean;
  /** Turn the view with every drag, even on the clay (phones, where
   * the clay fills the screen). */
  turnView?: boolean;
  /** The paint brush's colour, "#rrggbb". */
  color?: string;
}

export interface ClayLook {
  color: string;
  roughness: number;
  metalness: number;
}

export interface SculptCallbacks {
  /** After every stroke, undo and redo. */
  onChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  /** A stroke finished (to save). */
  onStroke?: () => void;
}

/** Dabs along a stroke, as a fraction of the brush radius. */
const SPACING = 0.3;
/** Least time between hit-tree refits during a stroke. */
const REFIT_MS = 120;

/** The clay as drawn: its own position and normal arrays (brushes move
 * them; the GPU copy follows), with a hit-test tree. The index is a
 * copy: MeshBVH reorders the index it's given, which would leave the
 * clay's face lists pointing at the wrong triangles (and its normals
 * wrong wherever a brush recomputes them). */
export function clayGeometry(clay: SculptMesh): {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
} {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(clay.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(clay.normals, 3));
  // Paint (sRGB colour + coverage) and the mask, drawn by the shader
  // added in withPaintAndMask.
  g.setAttribute("color", new THREE.BufferAttribute(clay.paint, 4));
  g.setAttribute("mask", new THREE.BufferAttribute(clay.mask, 1));
  g.setIndex(new THREE.BufferAttribute(clay.index.slice(), 1));
  const bvh = new MeshBVH(g);
  g.boundsTree = bvh;
  return { geometry: g, bvh };
}

/** The clay's material, drawing its paint and mask: paint laid over
 * the material's colour by its coverage (converted from sRGB), masked
 * areas shown darker. */
function withPaintAndMask(m: THREE.MeshStandardMaterial) {
  m.vertexColors = true;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float mask;\nvarying float vMask;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvMask = mask;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vMask;")
      .replace(
        "#include <color_fragment>",
        [
          "#if defined( USE_COLOR_ALPHA )",
          "  diffuseColor.rgb = mix( diffuseColor.rgb, sRGBTransferEOTF( vec4( vColor.rgb, 1.0 ) ).rgb, vColor.a );",
          "#endif",
          "diffuseColor.rgb *= 1.0 - 0.6 * vMask;",
        ].join("\n"),
      );
  };
  m.customProgramCacheKey = () => "sculpt-paint-mask";
  return m;
}

export class SculptEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  private readonly controls: OrbitControls;
  private readonly material = withPaintAndMask(
    new THREE.MeshStandardMaterial({ color: "#b0705a", roughness: 0.85 }),
  );
  private readonly cursor: THREE.Mesh;
  private readonly floor: THREE.Mesh;
  private readonly envMap: THREE.Texture;
  private readonly raycaster = new THREE.Raycaster();
  private readonly resize: ResizeObserver;
  private object: THREE.Mesh | null = null;
  private bvh: MeshBVH | null = null;
  private clay: SculptMesh | null = null;
  readonly history = new SculptHistory();
  private tool: SculptTool = {
    brush: "draw",
    sizePx: 60,
    strength: 0.5,
    invert: false,
    symmetry: true,
  };
  private stroke: {
    pointerId: number;
    /** Made with a pen (palms and fingers are ignored meanwhile). */
    pen: boolean;
    stroke: Stroke;
    last: THREE.Vector3;
    lastScreen: { x: number; y: number };
    radius: number;
    grab: Grab | null;
    plane: THREE.Plane;
    start: THREE.Vector3;
  } | null = null;
  private touches = new Set<number>();
  /** A pen has touched the screen: from then on fingers only navigate. */
  private penSeen = false;
  private dirty = false;
  private needsRefit = false;
  private lastRefit = 0;
  private frame = 0;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: SculptCallbacks = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.style.touchAction = "none";
    this.renderer.domElement.setAttribute("data-testid", "sculpt-canvas");
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color("#111118");
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.material.envMap = this.envMap;
    this.material.envMapIntensity = 0.35;

    const key = new THREE.DirectionalLight("#fff4e6", 2.6);
    key.position.set(2.2, 3.2, 2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -1.5;
    key.shadow.camera.right = 1.5;
    key.shadow.camera.top = 2;
    key.shadow.camera.bottom = -1;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    const fill = new THREE.DirectionalLight("#dfe8ff", 0.8);
    fill.position.set(-3, 1.5, 1.5);
    const rim = new THREE.DirectionalLight("#ffffff", 1.4);
    rim.position.set(-1, 2.5, -3);
    this.scene.add(
      key,
      fill,
      rim,
      new THREE.HemisphereLight("#ffffff", "#222228", 0.4),
    );

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ opacity: 0.4 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48),
      new THREE.MeshBasicMaterial({
        color: "#f5b942",
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    this.cursor.renderOrder = 10;
    this.cursor.visible = false;
    this.scene.add(this.cursor);

    this.camera.position.set(0, 0.9, 3);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.5, 0);
    this.controls.enableDamping = false;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 8;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.addEventListener("change", this.invalidate);

    const el = this.renderer.domElement;
    // Capture: sees the press before OrbitControls, to claim strokes.
    el.addEventListener("pointerdown", this.onDown, { capture: true });
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    this.resize = new ResizeObserver(() => this.fitCanvas());
    this.resize.observe(container);
    this.fitCanvas();
  }

  // -------------------------------------------------------------- setup

  /** Show `clay` (a new or opened sculpture); clears undo. */
  setMesh(clay: SculptMesh): void {
    if (this.object) {
      this.scene.remove(this.object);
      this.object.geometry.dispose();
    }
    const { geometry: g, bvh } = clayGeometry(clay);
    this.bvh = bvh;
    const mesh = new THREE.Mesh(g, this.material);
    mesh.raycast = acceleratedRaycast;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.object = mesh;
    this.clay = clay;
    this.scene.add(mesh);
    this.history.clear();
    this.emitChange();
    this.frameView();
  }

  get mesh(): SculptMesh | null {
    return this.clay;
  }

  setTool(tool: SculptTool): void {
    this.tool = tool;
    this.invalidate();
  }

  setLook(look: ClayLook): void {
    this.material.color.set(look.color);
    this.material.roughness = look.roughness;
    this.material.metalness = look.metalness;
    this.material.envMapIntensity = 0.35 + 0.65 * look.metalness;
    this.invalidate();
  }

  /** Look at the whole sculpture, from the front. */
  frameView(): void {
    if (!this.object) return;
    this.object.geometry.computeBoundingSphere();
    const s = this.object.geometry.boundingSphere!;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (s.radius * 1.25) / Math.sin(fov / 2);
    this.controls.target.copy(s.center);
    this.camera.position.set(
      s.center.x,
      s.center.y + s.radius * 0.3,
      s.center.z + dist,
    );
    this.controls.update();
    this.invalidate();
  }

  undo(): void {
    if (!this.clay || this.stroke) return;
    if (this.history.undo(this.clay)) this.changed(true, "all");
  }

  redo(): void {
    if (!this.clay || this.stroke) return;
    if (this.history.redo(this.clay)) this.changed(true, "all");
  }

  /** Clear the paint, clear the mask or invert it: one undo step. */
  layerOp(op: LayerOp): boolean {
    if (!this.clay || this.stroke) return false;
    const rec = applyLayerOp(this.clay, op);
    if (!rec) return false;
    this.history.push(rec);
    this.changed(true, rec.channel);
    this.callbacks.onStroke?.();
    return true;
  }

  get triangles(): number {
    return this.clay ? faceCount(this.clay) : 0;
  }

  /** The sculpture as a glTF binary (no skeleton, no studio parts). */
  async exportGlb(): Promise<Blob> {
    if (!this.object) throw new Error("There's nothing to export yet.");
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      this.object.geometry.attributes.position.clone(),
    );
    g.setAttribute("normal", this.object.geometry.attributes.normal.clone());
    g.setIndex(this.object.geometry.index!.clone());
    // Paint, baked over the material's colour into plain vertex colours
    // (what every glTF viewer shows); the material itself then white.
    const painted = this.clay && hasAny(this.clay.paint, 4, 3);
    if (painted) {
      const c = this.material.color;
      g.setAttribute(
        "color",
        new THREE.BufferAttribute(bakeColors(this.clay!, [c.r, c.g, c.b]), 3),
      );
    }
    const out = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({
        color: painted ? 0xffffff : this.material.color,
        vertexColors: !!painted,
        roughness: this.material.roughness,
        metalness: this.material.metalness,
      }),
    );
    out.name = "Sculpture";
    const scene = new THREE.Scene();
    scene.add(out);
    const buffer = (await new GLTFExporter().parseAsync(scene, {
      binary: true,
    })) as ArrayBuffer;
    g.dispose();
    (out.material as THREE.Material).dispose();
    return new Blob([buffer], { type: "model/gltf-binary" });
  }

  // ----------------------------------------------------------- strokes

  private ndc(e: PointerEvent): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
  }

  private hitAt(x: number, y: number): THREE.Intersection | null {
    if (!this.object) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((x - r.left) / r.width) * 2 - 1,
        -((y - r.top) / r.height) * 2 + 1,
      ),
      this.camera,
    );
    this.raycaster.firstHitOnly = true;
    return this.raycaster.intersectObject(this.object, false)[0] ?? null;
  }

  /** World metres per CSS pixel at a point (for the brush size). */
  private worldPerPixel(point: THREE.Vector3): number {
    const dist = this.camera.position.distanceTo(point);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const h = this.renderer.domElement.clientHeight || 1;
    return (2 * dist * Math.tan(fov / 2)) / h;
  }

  private dabFrom(hit: THREE.Intersection, e: PointerEvent): Dab {
    const n = hit.face!.normal.clone();
    // The face normal from the geometry; the clay isn't transformed.
    return {
      point: [hit.point.x, hit.point.y, hit.point.z],
      normal: [n.x, n.y, n.z],
      // Pens report pressure; mice and fingers report 0.5 or 0 while down.
      pressure: e.pointerType === "pen" ? Math.max(0.1, e.pressure) : 1,
    };
  }

  private settings(radius: number): BrushSettings {
    return {
      radius,
      strength: this.tool.strength,
      invert: this.tool.invert,
      symmetry: this.tool.symmetry,
    };
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === "pen") this.penSeen = true;
    if (e.pointerType === "touch") {
      // A palm or finger while the pen sculpts: ignored, so it can't
      // turn the view mid-stroke.
      if (this.stroke?.pen) {
        e.stopImmediatePropagation();
        return;
      }
      this.touches.add(e.pointerId);
      // Once a pen has been used, fingers only turn and zoom the view
      // (iPad and Pencil: the pen sculpts, fingers move around).
      if (this.penSeen) return;
    }
    // A second finger: the view, not a stroke (end the one in progress).
    if (this.touches.size > 1) {
      if (this.stroke) this.endStroke();
      return;
    }
    if (e.button !== 0 || !this.clay || this.stroke || this.tool.turnView)
      return;
    const hit = this.hitAt(e.clientX, e.clientY);
    if (!hit) return; // off the clay: OrbitControls turns the view
    e.stopImmediatePropagation();
    e.preventDefault();
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer tracks: the stroke still works.
    }
    const radius = this.tool.sizePx * this.worldPerPixel(hit.point);
    const b = this.tool.brush;
    const stroke = new Stroke(
      b === "paint" ? "paint" : b === "mask" ? "mask" : "position",
    );
    const dab = this.dabFrom(hit, e);
    const view = this.camera.getWorldDirection(new THREE.Vector3());
    this.stroke = {
      pointerId: e.pointerId,
      pen: e.pointerType === "pen",
      stroke,
      last: hit.point.clone(),
      lastScreen: { x: e.clientX, y: e.clientY },
      radius,
      grab:
        this.tool.brush === "grab"
          ? startGrab(this.clay, dab, this.settings(radius), stroke)
          : null,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
        view.negate(),
        hit.point,
      ),
      start: hit.point.clone(),
    };
    if (this.tool.brush !== "grab") this.dab(dab, radius);
    this.showCursor(hit, radius);
  };

  private onMove = (e: PointerEvent): void => {
    const s = this.stroke;
    if (!s) {
      if (e.pointerType === "mouse" || e.pointerType === "pen") this.hover(e);
      return;
    }
    if (e.pointerId !== s.pointerId || !this.clay) return;
    if (s.grab) {
      this.raycaster.setFromCamera(this.ndc(e), this.camera);
      const to = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(s.plane, to)) return;
      const d = to.sub(s.start);
      moveGrab(this.clay, s.grab, [d.x, d.y, d.z]);
      this.changed(false);
      return;
    }
    // Dabs every SPACING × radius along the way, each where the pointer
    // passed over the clay.
    const from = s.lastScreen;
    const px = Math.hypot(e.clientX - from.x, e.clientY - from.y);
    const stepPx = Math.max(1, this.tool.sizePx * SPACING);
    const steps = Math.floor(px / stepPx);
    for (let i = 1; i <= steps; i++) {
      const t = (i * stepPx) / px;
      const x = from.x + (e.clientX - from.x) * t;
      const y = from.y + (e.clientY - from.y) * t;
      const hit = this.hitAt(x, y);
      if (hit) {
        this.dab(this.dabFrom(hit, e), s.radius);
        s.last.copy(hit.point);
        this.showCursor(hit, s.radius);
      }
      s.lastScreen = { x, y };
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    if (this.stroke && e.pointerId === this.stroke.pointerId) this.endStroke();
  };

  private onLeave = (): void => {
    if (!this.stroke) {
      this.cursor.visible = false;
      this.invalidate();
    }
  };

  private hover(e: PointerEvent): void {
    const hit = this.hitAt(e.clientX, e.clientY);
    if (!hit) {
      if (this.cursor.visible) {
        this.cursor.visible = false;
        this.invalidate();
      }
      return;
    }
    this.showCursor(hit, this.tool.sizePx * this.worldPerPixel(hit.point));
  }

  private showCursor(hit: THREE.Intersection, radius: number): void {
    const n = hit.face!.normal;
    this.cursor.position.copy(hit.point).addScaledVector(n, 0.002);
    this.cursor.lookAt(hit.point.clone().add(n));
    this.cursor.scale.setScalar(radius);
    this.cursor.visible = true;
    (this.cursor.material as THREE.MeshBasicMaterial).color.set(
      this.tool.invert ? "#7aa7ff" : "#f5b942",
    );
    this.invalidate();
  }

  private dab(dab: Dab, radius: number): void {
    const brush = this.tool.brush;
    if (!this.clay || brush === "grab") return;
    const stroke = this.stroke!.stroke;
    const s = this.settings(radius);
    if (brush === "paint") {
      applyPaint(
        this.clay,
        dab,
        s,
        hexToSrgb(this.tool.color ?? "#c0392b"),
        stroke,
      );
      this.changed(false, "paint");
    } else if (brush === "mask") {
      applyMask(this.clay, dab, s, stroke);
      this.changed(false, "mask");
    } else {
      applyDab(this.clay, brush, dab, s, stroke);
      this.changed(false, "position");
    }
  }

  private endStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s || !this.clay) return;
    try {
      this.renderer.domElement.releasePointerCapture(s.pointerId);
    } catch {
      // Already released.
    }
    const rec = s.stroke.finish(this.clay);
    if (rec) {
      this.history.push(rec);
      this.changed(true);
      this.callbacks.onStroke?.();
    }
  }

  /** The clay moved: refresh the GPU copy and the hit tree next frame. */
  /** Something changed: refresh the GPU copy of what did (and, for the
   * shape, the hit tree next frame). */
  private changed(stepDone: boolean, what: Channel | "all" = "position"): void {
    const g = this.object?.geometry;
    if (what === "position" || what === "all") {
      this.needsRefit = true;
      if (g) {
        g.attributes.position.needsUpdate = true;
        g.attributes.normal.needsUpdate = true;
      }
    }
    if (g && (what === "paint" || what === "all"))
      g.attributes.color.needsUpdate = true;
    if (g && (what === "mask" || what === "all"))
      g.attributes.mask.needsUpdate = true;
    if (stepDone) this.emitChange();
    this.invalidate();
  }

  private emitChange(): void {
    this.callbacks.onChange?.({
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    });
  }

  // ------------------------------------------------------------ render

  private fitCanvas(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  invalidate = (): void => {
    if (this.dirty || this.disposed) return;
    this.dirty = true;
    this.frame = requestAnimationFrame(() => {
      this.dirty = false;
      // The hit-test tree follows the clay: a full refit costs ~45 ms on
      // a 480k-triangle figure, so mid-stroke it's done a few times a
      // second (dabs move the surface only a little), and always when
      // the stroke ends.
      const now = performance.now();
      if (
        this.needsRefit &&
        this.bvh &&
        (!this.stroke || now - this.lastRefit > REFIT_MS)
      ) {
        this.bvh.refit();
        this.object?.geometry.computeBoundingSphere();
        this.needsRefit = false;
        this.lastRefit = now;
      } else if (this.needsRefit) {
        // Not this frame: come back for it.
        requestAnimationFrame(() => this.invalidate());
      }
      this.renderer.render(this.scene, this.camera);
    });
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.removeEventListener("change", this.invalidate);
    this.controls.dispose();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onDown, { capture: true });
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onUp);
    el.removeEventListener("pointerleave", this.onLeave);
    this.object?.geometry.dispose();
    this.material.dispose();
    this.cursor.geometry.dispose();
    (this.cursor.material as THREE.Material).dispose();
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
    this.envMap.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
