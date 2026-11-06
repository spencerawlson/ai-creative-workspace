"use client";

import { FlipHorizontal2, RotateCcw, ScanFace } from "lucide-react";
import type { CameraView, Selection } from "@/lib/engine/StudioEngine";
import {
  FINGERS,
  HAND_SHAPES,
  JOINTS,
  POSE_GROUPS,
  POSE_PRESETS,
  groupOfJoint,
  handShapePatches,
  neutralFace,
  posePreset,
  type Dof,
  type JointId,
} from "@/lib/studio/pose";
import { MotionSearch } from "./MotionSearch";
import type { Studio } from "./useStudio";
import type { CharacterLibrary } from "./useCharacters";
import { figureLabel } from "@/lib/studio/figures";
import type { Figure } from "@/lib/studio/schema";
import { Button, PanelHeader, SectionTitle, Slider, Tip, cx } from "./ui";

/** `pose:<joint>` (from a tap on the figure or a body-part button) picks
 * the body part; plain "pose" opens the right arm. */
export function jointFromSelection(selection: Selection): JointId | null {
  if (!selection?.startsWith("pose:")) return null;
  const id = selection.slice(5);
  return id in JOINTS ? (id as JointId) : null;
}

export function isPoseSelection(selection: Selection): boolean {
  return selection === "pose" || jointFromSelection(selection) !== null;
}

export function PoseInspector({
  studio,
  figure,
  selection,
  onSelect,
  time = 0,
  onPlayFrom,
  characters,
  onView,
}: {
  studio: Studio;
  figure: Figure;
  selection: Selection;
  onSelect: (s: Selection, figure?: string) => void;
  time?: number;
  onPlayFrom?: (t: number) => void;
  characters?: CharacterLibrary;
  onView?: (v: CameraView) => void;
}) {
  const { scene, dispatch, seal } = studio;
  const target = { figure: figure.id };
  const joint = jointFromSelection(selection);
  const groupId = joint ? groupOfJoint(joint) : "armR";
  const group = POSE_GROUPS.find((g) => g.id === groupId)!;
  // A hand has 15 joints: show one finger's at a time.
  const hand = groupId === "handL" ? "L" : groupId === "handR" ? "R" : null;
  const finger = hand
    ? (joint?.match(/^(thumb|index|middle|ring|pinky)/)?.[1] ?? "thumb")
    : null;
  const isFace = groupId === "face";
  // A character's face has the controls its file supports; on the
  // mannequin (no face) every control shows, for when a character is on.
  const controls =
    isFace && figure.character
      ? characters?.faces[figure.character]
      : undefined;
  const has = (id: JointId, dof: string) =>
    !controls || controls.includes(`${id}.${dof}`);
  const shown = (group.joints as readonly JointId[]).filter(
    (id) =>
      (!finger || id.startsWith(finger)) &&
      Object.keys(JOINTS[id].dofs).some((dof) => has(id, dof)),
  );
  const preset = posePreset(figure.pose.preset);
  const joints = figure.pose.joints as Record<string, Record<string, number>>;

  return (
    <>
      <PanelHeader
        title={
          scene.figures.length > 1
            ? `Pose · ${figureLabel(scene, figure.id)}`
            : "Pose"
        }
      />
      <div className="px-3 py-3">
        <MotionSearch
          studio={studio}
          figure={figure}
          time={time}
          onPlayFrom={onPlayFrom}
        />
        <SectionTitle>Poses</SectionTitle>
        <div
          className="grid grid-cols-2 gap-1.5 py-1.5"
          role="group"
          aria-label="Pose presets"
        >
          {POSE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={figure.pose.preset === p.id}
              data-testid={`pose-preset-${p.id}`}
              onClick={() =>
                dispatch({
                  type: "applyPosePreset",
                  presetId: p.id,
                  ...target,
                })
              }
              className={cx(
                "rounded-md border px-2 py-1.5 text-left text-xs font-medium transition-colors",
                figure.pose.preset === p.id
                  ? "border-accent bg-accent/10 text-ink-100"
                  : "border-ink-700 text-ink-200 hover:border-ink-500",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="text-2xs leading-relaxed text-ink-300">
          {preset?.note ?? "Custom pose. Pick a preset to start again."}
        </p>
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            icon={FlipHorizontal2}
            onClick={() => dispatch({ type: "mirrorPose", ...target })}
            data-testid="pose-mirror"
          >
            Mirror
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={RotateCcw}
            onClick={() =>
              dispatch({
                type: "applyPosePreset",
                presetId: "neutral",
                ...target,
              })
            }
            data-testid="pose-reset"
          >
            Reset pose
          </Button>
        </div>

        <SectionTitle>Body part</SectionTitle>
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-1 rounded-md bg-ink-800 p-0.5"
          role="group"
          aria-label="Body part"
        >
          {POSE_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={g.id === groupId}
              data-testid={`pose-group-${g.id}`}
              onClick={() => onSelect(`pose:${g.joints[0]}`)}
              className={cx(
                "min-h-8 rounded px-1 text-xs font-medium transition-colors",
                g.id === groupId
                  ? "bg-ink-600 text-ink-100 shadow-sm"
                  : "text-ink-300 hover:text-ink-100",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        {isFace ? (
          <FaceNote
            figure={figure}
            controls={controls}
            loaded={!!characters}
            onView={onView}
            onReset={() =>
              dispatch({
                type: "updateJoints",
                patches: neutralFace(),
                ...target,
              })
            }
          />
        ) : (
          <Tip className="mt-1.5">
            Left and right are the mannequin&apos;s own. In the viewport, drag a
            body part to pose it; grab a palm to move the whole arm, a finger to
            curl it. Pick a hand here to see and drag its finger joints.
          </Tip>
        )}

        {hand && (
          <>
            <SectionTitle>Hand shape</SectionTitle>
            <div
              className="grid grid-cols-4 gap-1"
              role="group"
              aria-label="Hand shapes"
            >
              {HAND_SHAPES.map((h) => (
                <Button
                  key={h.id}
                  size="sm"
                  variant="ghost"
                  className="justify-center border border-ink-700"
                  data-testid={`hand-shape-${h.id}`}
                  onClick={() =>
                    dispatch({
                      type: "updateJoints",
                      patches: handShapePatches(hand, h.id)!,
                      ...target,
                    })
                  }
                >
                  {h.name}
                </Button>
              ))}
            </div>
            <SectionTitle>Finger</SectionTitle>
            <div
              className="grid grid-cols-5 gap-0.5 rounded-md bg-ink-800 p-0.5"
              role="group"
              aria-label="Finger"
            >
              {(["thumb", ...FINGERS] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={f === finger}
                  data-testid={`pose-finger-${f}`}
                  onClick={() => onSelect(`pose:${f}1${hand}`)}
                  className={cx(
                    "min-h-8 rounded px-0.5 text-2xs font-medium transition-colors",
                    f === finger
                      ? "bg-ink-600 text-ink-100 shadow-sm"
                      : "text-ink-300 hover:text-ink-100",
                  )}
                >
                  {f === "pinky" ? "Little" : f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </>
        )}

        {shown.map((id) => (
          <section
            key={id}
            aria-label={JOINTS[id].label}
            data-testid={`pose-joint-${id}`}
            className={cx(
              "mt-2 rounded-md px-2 pb-1",
              id === joint && shown.length > 1 && "bg-ink-800/60",
            )}
          >
            <SectionTitle>{JOINTS[id].label}</SectionTitle>
            {Object.entries(JOINTS[id].dofs as Record<string, Dof>)
              .filter(([dof]) => has(id, dof))
              .map(([dof, d]) => (
                <Slider
                  key={dof}
                  label={d.label}
                  value={joints[id][dof]}
                  min={d.min}
                  max={d.max}
                  step={1}
                  unit={d.unit ?? "°"}
                  hint={d.hint}
                  testId={`pose-${id}-${dof}`}
                  onChange={(v) =>
                    dispatch({
                      type: "updateJoint",
                      joint: id,
                      patch: { [dof]: v },
                      ...target,
                    })
                  }
                  onCommitEnd={seal}
                />
              ))}
          </section>
        ))}
      </div>
    </>
  );
}

/** What the face controls do on this figure, and its face actions. */
function FaceNote({
  figure,
  controls,
  loaded,
  onView,
  onReset,
}: {
  figure: Figure;
  controls: string[] | undefined;
  loaded: boolean;
  onView?: (v: CameraView) => void;
  onReset: () => void;
}) {
  const message = !figure.character
    ? "The mannequin has no face. Import a character with face shapes (VRM, VRoid, or ARKit blendshapes) in the figure's panel; the face you set here shows on it."
    : !loaded || !controls
      ? "Loading the character's face…"
      : controls.length === 0
        ? "This character's file has no face shapes or eye bones, so the face can't move. VRM and VRoid characters have them."
        : "Expressions come from the character's own face shapes; only the ones its file has are shown.";
  return (
    <>
      <p
        className="mt-1.5 text-2xs leading-relaxed text-ink-300"
        data-testid="face-note"
      >
        {message}
      </p>
      <div className="mt-2 flex gap-2">
        {onView && (
          <Button
            size="sm"
            icon={ScanFace}
            onClick={() => onView("face")}
            data-testid="face-close-up"
          >
            Close-up
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={RotateCcw}
          onClick={onReset}
          data-testid="face-reset"
        >
          Reset face
        </Button>
      </div>
    </>
  );
}
