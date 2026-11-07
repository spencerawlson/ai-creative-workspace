"use client";

/** "Pose from photo": pick a photo, the body is found on this device
 * (poseDetector.ts), the figure's joint angles are fitted to it
 * (lib/engine/photoPose.ts), and after a look at what was found, one
 * click poses the figure (one undo step). */

import { useEffect, useRef, useState } from "react";
import { ImageUp } from "lucide-react";
import type {
  Landmark,
  PhotoImage,
  PhotoPart,
  PhotoPoseResult,
} from "@/lib/engine/photoPose";
import type { BodyJointId } from "@/lib/studio/pose";
import {
  detectPose,
  preloadPoseDetector,
  type DetectedPose,
} from "./poseDetector";
import { Button, Dialog } from "./ui";

/** lib/engine/photoPose.ts's labels, here so the dialog doesn't pull in
 * the engine (three.js) before the 3D view has. */
const PART_LABEL: Record<PhotoPart, string> = {
  torso: "torso",
  head: "head",
  armL: "left arm",
  armR: "right arm",
  handL: "left hand",
  handR: "right hand",
  legL: "left leg",
  legR: "right leg",
  footL: "left foot",
  footR: "right foot",
};

/** Lines drawn between landmarks on the photo: [from, to, side]. */
const BONES: Array<[number, number, "L" | "R" | "C"]> = [
  [11, 12, "C"],
  [23, 24, "C"],
  [11, 23, "L"],
  [12, 24, "R"],
  [11, 13, "L"],
  [13, 15, "L"],
  [15, 19, "L"],
  [15, 17, "L"],
  [12, 14, "R"],
  [14, 16, "R"],
  [16, 20, "R"],
  [16, 18, "R"],
  [23, 25, "L"],
  [25, 27, "L"],
  [27, 29, "L"],
  [29, 31, "L"],
  [24, 26, "R"],
  [26, 28, "R"],
  [28, 30, "R"],
  [30, 32, "R"],
  [7, 2, "L"],
  [2, 5, "C"],
  [5, 8, "R"],
];
const SIDE_COLOUR = { L: "#5eead4", R: "#fbbf24", C: "#e5e7eb" };

type State =
  | { step: "idle" }
  | { step: "working"; first: boolean }
  | { step: "error"; message: string }
  | { step: "found"; detected: DetectedPose; result: PhotoPoseResult };

let usedBefore = false;

export function PhotoPoseButton({
  figureName,
  solve,
  onApply,
}: {
  /** Shown on the apply button ("Pose Figure 2"). */
  figureName: string;
  /** The figure's angles for a photo's landmarks; null if the 3D view
   * isn't ready. Throws (with a message to show) on an unusable body. */
  solve: (world: Landmark[], image: PhotoImage) => PhotoPoseResult | null;
  onApply: (
    patches: Partial<Record<BodyJointId, Record<string, number>>>,
  ) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ step: "idle" });
  const run = useRef(0);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const id = ++run.current;
    setState({ step: "working", first: !usedBefore });
    try {
      const detected = await detectPose(file);
      usedBefore = true;
      if (id !== run.current) return;
      if (!detected) {
        setState({
          step: "error",
          message:
            "No person was found in that photo. A clear, full-body shot works best.",
        });
        return;
      }
      const result = solve(detected.world, {
        points: detected.image,
        aspect: detected.canvas.width / detected.canvas.height,
      });
      if (!result) {
        setState({
          step: "error",
          message: "The 3D view isn't ready yet. Try again in a moment.",
        });
        return;
      }
      setState({ step: "found", detected, result });
    } catch (e) {
      if (id !== run.current) return;
      setState({
        step: "error",
        message: e instanceof Error ? e.message : "The pose couldn't be read.",
      });
    }
  }

  function close() {
    run.current++;
    setState({ step: "idle" });
  }

  return (
    <>
      <Button
        size="sm"
        icon={ImageUp}
        data-testid="pose-from-photo"
        onPointerEnter={preloadPoseDetector}
        onClick={() => {
          // Start loading while the photo is being picked.
          preloadPoseDetector();
          input.current?.click();
        }}
      >
        From photo
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="pose-photo-input"
        aria-label="Photo to take the pose from"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = ""; // the same photo can be picked again
        }}
      />
      <Dialog
        open={state.step !== "idle"}
        onClose={close}
        title="Pose from photo"
        testId="photo-pose-dialog"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            {state.step === "found" ? (
              <Button
                variant="primary"
                data-testid="photo-pose-apply"
                onClick={() => {
                  onApply(state.result.patches);
                  close();
                }}
              >
                Pose {figureName}
              </Button>
            ) : (
              state.step === "error" && (
                <Button
                  variant="primary"
                  onClick={() => input.current?.click()}
                >
                  Pick another photo
                </Button>
              )
            )}
          </>
        }
      >
        {state.step === "working" && (
          <p
            className="flex items-center gap-2 py-6 text-sm text-ink-200"
            role="status"
          >
            <span
              aria-hidden
              className="h-3 w-3 animate-spin rounded-full border-2 border-ink-500 border-t-accent"
            />
            {state.first
              ? "Loading the pose finder (about 20 MB, once) and finding the pose…"
              : "Finding the pose…"}
          </p>
        )}
        {state.step === "error" && (
          <p
            role="alert"
            className="py-4 text-sm text-ink-200"
            data-testid="photo-pose-error"
          >
            {state.message}
          </p>
        )}
        {state.step === "found" && (
          <Found detected={state.detected} result={state.result} />
        )}
        <p className="mt-2 text-2xs text-ink-400">
          The pose is found on this device; the photo isn&apos;t uploaded or
          kept. Fingers and the face stay as they are.
        </p>
      </Dialog>
    </>
  );
}

function Found({
  detected,
  result,
}: {
  detected: DetectedPose;
  result: PhotoPoseResult;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const src = detected.canvas;
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext("2d")!;
    g.drawImage(src, 0, 0);
    // What was found, drawn over the photo: the person's left in teal,
    // right in amber.
    const pts = detected.image;
    const seen = (i: number) => (pts[i].visibility ?? 1) >= 0.5;
    const w = Math.max(2, Math.round(Math.max(c.width, c.height) / 250));
    g.lineWidth = w;
    g.lineCap = "round";
    for (const [a, b, side] of BONES) {
      if (!seen(a) || !seen(b)) continue;
      g.strokeStyle = SIDE_COLOUR[side];
      g.beginPath();
      g.moveTo(pts[a].x * c.width, pts[a].y * c.height);
      g.lineTo(pts[b].x * c.width, pts[b].y * c.height);
      g.stroke();
    }
    g.fillStyle = "#ffffff";
    for (let i = 11; i < pts.length; i++) {
      if (!seen(i)) continue;
      g.beginPath();
      g.arc(pts[i].x * c.width, pts[i].y * c.height, w * 1.2, 0, Math.PI * 2);
      g.fill();
    }
  }, [detected]);

  const list = (parts: PhotoPart[]) =>
    parts.map((p) => PART_LABEL[p]).join(", ");
  return (
    <>
      <canvas
        ref={canvas}
        role="img"
        aria-label="The photo, with the body that was found drawn over it"
        className="mx-auto block max-h-[45dvh] max-w-full rounded-md bg-ink-900 object-contain"
      />
      <div className="mt-2 space-y-1 text-xs" data-testid="photo-pose-summary">
        <p className="text-ink-200">Found: {list(result.found)}.</p>
        {result.missing.length > 0 && (
          <p className="text-ink-300">
            Not clear in the photo, so left as they are: {list(result.missing)}.
          </p>
        )}
      </div>
    </>
  );
}
