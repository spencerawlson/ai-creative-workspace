/** Export the stage as a glTF 2.0 binary (.glb) for Blender, Unity,
 * Unreal, Maya and the like.
 *
 * Each figure is cloned with its skeleton, as it is posed and placed
 * now, and the studio's own helpers (tap targets, joint dots) are left
 * out. With the animation, every bone, the figure's place and turn, and
 * the face's shapes are sampled frame by frame through the same path as
 * playback (`seek`), so the file moves exactly as the studio does; parts
 * that never move get no track. Optionally the camera (animated too)
 * and the lights (KHR_lights_punctual: directional, spot and point;
 * glTF has no area lights) come along. */

import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

/** Objects the studio adds to a figure that aren't part of it. */
const HELPERS = new Set(["pose-dot", "pose-dot-ring", "pose-pick"]);
export const EXPORT_FPS = 30;

export interface GlbSource {
  figures: Array<{ name: string; root: THREE.Object3D }>;
  camera: THREE.PerspectiveCamera;
  lights: Array<{ name: string; light: THREE.Light }>;
  /** Seconds; with `seek`, the length of the animation. */
  duration: number;
  /** Show the scene as it is at `t` seconds (synchronously); absent
   * when there's no animation. */
  seek?: (t: number) => void;
  /** Put the scene back as it was before sampling. */
  restore?: () => void;
}

export interface GlbOptions {
  animation: boolean;
  /** The camera and the lights. */
  stage: boolean;
}

export interface GlbResult {
  blob: Blob;
  /** Lights glTF can't hold (area lights), left out. */
  skippedLights: number;
  /** Frames in the animation; 0 without one. */
  frames: number;
}

/** Vertex data that may be stored quantized (meshopt-compressed models
 * are), which would need KHR_mesh_quantization to read. */
const FLOAT_ATTRIBUTES = ["position", "normal", "tangent", "uv", "uv1", "uv2"];

/** `mesh` with its own copy of the geometry, the attributes above as
 * plain floats: every glTF importer reads those. Morph targets too. */
function withFloatGeometry(mesh: THREE.Mesh) {
  const g = mesh.geometry.clone();
  const toFloat = (
    a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  ) => {
    if (
      a.array instanceof Float32Array &&
      !a.normalized &&
      !("isInterleavedBufferAttribute" in a)
    )
      return a;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < a.itemSize; k++)
        out[i * a.itemSize + k] = a.getComponent(i, k);
    return new THREE.BufferAttribute(out, a.itemSize);
  };
  for (const name of FLOAT_ATTRIBUTES) {
    const a = g.getAttribute(name);
    if (a) g.setAttribute(name, toFloat(a));
  }
  for (const [name, list] of Object.entries(g.morphAttributes))
    g.morphAttributes[name] = list.map(toFloat);
  mesh.geometry = g;
}

/** The world transform of `from`, as `to`'s own (`to` sits at the root). */
function placeAsWorld(to: THREE.Object3D, from: THREE.Object3D) {
  from.updateWorldMatrix(true, false);
  from.matrixWorld.decompose(to.position, to.quaternion, to.scale);
}

function exportLight(light: THREE.Light, name: string): THREE.Light | null {
  let out: THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight;
  if (light instanceof THREE.DirectionalLight)
    out = new THREE.DirectionalLight(light.color, light.intensity);
  else if (light instanceof THREE.SpotLight) {
    out = new THREE.SpotLight(light.color, light.intensity);
    out.angle = light.angle;
    out.penumbra = light.penumbra;
    out.distance = light.distance;
    out.decay = 2;
  } else if (light instanceof THREE.PointLight) {
    out = new THREE.PointLight(light.color, light.intensity);
    out.distance = light.distance;
    out.decay = 2;
  } else return null;
  out.name = name;
  out.position.copy(light.getWorldPosition(new THREE.Vector3()));
  if (
    light instanceof THREE.DirectionalLight ||
    light instanceof THREE.SpotLight
  ) {
    // glTF lights shine down their own −z: aim it at the target, and
    // keep the target where glTF expects it.
    out.lookAt(light.target.getWorldPosition(new THREE.Vector3()));
    const target = out instanceof THREE.PointLight ? null : out.target;
    if (target) {
      target.position.set(0, 0, -1);
      out.add(target);
    }
  }
  return out;
}

/** A track only if the values change; else null. */
function track(
  Type:
    | typeof THREE.QuaternionKeyframeTrack
    | typeof THREE.VectorKeyframeTrack
    | typeof THREE.NumberKeyframeTrack,
  name: string,
  times: number[],
  values: number[],
  size: number,
): THREE.KeyframeTrack | null {
  let moves = false;
  for (let i = size; i < values.length && !moves; i++)
    moves = Math.abs(values[i] - values[i % size]) > 1e-6;
  return moves ? new Type(name, times, values) : null;
}

export async function exportGlb(
  src: GlbSource,
  opts: GlbOptions,
): Promise<GlbResult> {
  const scene = new THREE.Scene();
  scene.name = "I-K-O 3D";
  /** Live object → its clone in the file, for the animation. */
  const pairs: Array<[THREE.Object3D, THREE.Object3D]> = [];
  for (const f of src.figures) {
    const copy = cloneSkinned(f.root);
    // Clones keep the hierarchy's order: pair them up before trimming.
    const live: THREE.Object3D[] = [];
    const mine: THREE.Object3D[] = [];
    f.root.traverse((o) => live.push(o));
    copy.traverse((o) => mine.push(o));
    live.forEach((o, i) => {
      if (!HELPERS.has(o.name)) pairs.push([o, mine[i]]);
    });
    for (const o of mine.filter((o) => HELPERS.has(o.name)))
      o.removeFromParent();
    copy.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) withFloatGeometry(o as THREE.Mesh);
    });
    copy.name = f.name;
    placeAsWorld(copy, f.root);
    scene.add(copy);
  }

  let camera: THREE.PerspectiveCamera | null = null;
  let skippedLights = 0;
  if (opts.stage) {
    const c = src.camera;
    camera = new THREE.PerspectiveCamera(c.fov, c.aspect, c.near, c.far);
    camera.name = "Camera";
    placeAsWorld(camera, c);
    scene.add(camera);
    for (const { name, light } of src.lights) {
      const out = exportLight(light, name);
      if (out) scene.add(out);
      else skippedLights++;
    }
  }

  const animations: THREE.AnimationClip[] = [];
  let frames = 0;
  if (opts.animation && src.seek) {
    frames = Math.max(2, Math.round(src.duration * EXPORT_FPS) + 1);
    const times = Array.from({ length: frames }, (_, i) => i / EXPORT_FPS);
    const roots = new Set(src.figures.map((f) => f.root));
    type Sampled = {
      live: THREE.Object3D;
      copy: THREE.Object3D;
      world: boolean;
      position: number[];
      quaternion: number[];
      morphs: number[];
    };
    const sampled: Sampled[] = pairs
      .filter(
        ([o]) =>
          roots.has(o) ||
          (o as THREE.Bone).isBone ||
          !!(o as THREE.Mesh).morphTargetInfluences?.length,
      )
      .map(([live, copy]) => ({
        live,
        copy,
        world: roots.has(live),
        position: [],
        quaternion: [],
        morphs: [],
      }));
    if (camera)
      sampled.push({
        live: src.camera,
        copy: camera,
        world: true,
        position: [],
        quaternion: [],
        morphs: [],
      });
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    try {
      for (const t of times) {
        src.seek(Math.min(t, src.duration));
        for (const x of sampled) {
          if (x.world) {
            x.live.updateWorldMatrix(true, false);
            x.live.matrixWorld.decompose(p, q, s);
          } else {
            p.copy(x.live.position);
            q.copy(x.live.quaternion);
          }
          x.position.push(p.x, p.y, p.z);
          x.quaternion.push(q.x, q.y, q.z, q.w);
          const m = (x.live as THREE.Mesh).morphTargetInfluences;
          if (m) x.morphs.push(...m);
        }
      }
    } finally {
      src.restore?.();
    }
    const tracks: THREE.KeyframeTrack[] = [];
    for (const x of sampled) {
      const id = x.copy.uuid;
      const add = (k: THREE.KeyframeTrack | null) => k && tracks.push(k);
      if (x.world)
        add(
          track(
            THREE.VectorKeyframeTrack,
            `${id}.position`,
            times,
            x.position,
            3,
          ),
        );
      add(
        track(
          THREE.QuaternionKeyframeTrack,
          `${id}.quaternion`,
          times,
          x.quaternion,
          4,
        ),
      );
      const n = (x.live as THREE.Mesh).morphTargetInfluences?.length ?? 0;
      if (n)
        add(
          track(
            THREE.NumberKeyframeTrack,
            `${id}.morphTargetInfluences`,
            times,
            x.morphs,
            n,
          ),
        );
    }
    if (tracks.length)
      animations.push(
        new THREE.AnimationClip(
          "I-K-O 3D animation",
          times[frames - 1],
          tracks,
        ),
      );
  }

  const { GLTFExporter } =
    await import("three/examples/jsm/exporters/GLTFExporter.js");
  const glb = (await new GLTFExporter().parseAsync(scene, {
    binary: true,
    animations,
    onlyVisible: true,
  })) as ArrayBuffer;
  return {
    blob: new Blob([glb], { type: "model/gltf-binary" }),
    skippedLights,
    frames,
  };
}
