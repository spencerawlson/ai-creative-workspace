/** Finds a person's body landmarks in a photo, on this device: MediaPipe
 * Pose Landmarker (Apache-2.0), its WebAssembly runtime and model served
 * by this site (public/mediapipe; the runtime is copied there from
 * node_modules by scripts/copy-mediapipe.mjs). The photo never leaves
 * the browser. Loaded on first use (about 20 MB, cached after). */

import type { Landmark } from "@/lib/engine/photoPose";

const BASE = "/mediapipe";
/** Longest side the photo is scaled to before detection: plenty for the
 * model (it works at 256 px), and quick to decode on a phone. */
const MAX_SIDE = 1280;

type Landmarker = import("@mediapipe/tasks-vision").PoseLandmarker;
let loading: Promise<Landmarker> | null = null;

function landmarker(): Promise<Landmarker> {
  loading ??= (async () => {
    const { FilesetResolver, PoseLandmarker } =
      await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: `${BASE}/pose_landmarker_full.task`,
        // The CPU path: no second WebGL context next to the studio's.
        delegate: "CPU",
      },
      runningMode: "IMAGE",
      numPoses: 1,
    });
  })();
  // A failed load (offline, say) can be tried again.
  loading.catch(() => (loading = null));
  return loading;
}

export interface DetectedPose {
  /** 33 points in metres around the hips, with visibility. */
  world: Landmark[];
  /** The same points on the photo, 0..1 across and down. */
  image: Landmark[];
  /** The photo as detected (orientation applied, scaled down). */
  canvas: HTMLCanvasElement;
}

/** The photo, upright (browsers apply its EXIF orientation when drawing)
 * and at most MAX_SIDE pixels on its longest side. */
async function loadPhoto(file: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error("That file isn't a photo this browser can open.");
    });
    const scale = Math.min(
      1,
      MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Load the model now (e.g. when the photo picker opens). */
export function preloadPoseDetector(): void {
  void landmarker().catch(() => {});
}

/** The body in `file`, or null if no person was found. */
export async function detectPose(file: Blob): Promise<DetectedPose | null> {
  const [canvas, model] = await Promise.all([
    loadPhoto(file),
    landmarker().catch(() => {
      throw new Error(
        "The pose finder couldn't load. Check the connection and try again.",
      );
    }),
  ]);
  const result = model.detect(canvas);
  const image = result.landmarks[0];
  const world = result.worldLandmarks[0];
  if (!image || !world) return null;
  // Visibility comes with the image landmarks; give it to both.
  return {
    canvas,
    image: image.map((l) => ({ ...l })),
    world: world.map((l, i) => ({ ...l, visibility: image[i].visibility })),
  };
}
