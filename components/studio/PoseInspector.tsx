"use client";

import { FlipHorizontal2, RotateCcw } from "lucide-react";
import type { Selection } from "@/lib/engine/StudioEngine";
import {
  JOINTS,
  POSE_GROUPS,
  POSE_PRESETS,
  groupOfJoint,
  posePreset,
  type Dof,
  type JointId,
} from "@/lib/studio/pose";
import type { Studio } from "./useStudio";
import { figureLabel } from "@/lib/studio/figures";
import type { Figure } from "@/lib/studio/schema";
import { Button, PanelHeader, SectionTitle, Slider, cx } from "./ui";

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
}: {
  studio: Studio;
  figure: Figure;
  selection: Selection;
  onSelect: (s: Selection, figure?: string) => void;
}) {
  const { scene, dispatch, seal } = studio;
  const target = { figure: figure.id };
  const joint = jointFromSelection(selection);
  const groupId = joint ? groupOfJoint(joint) : "armR";
  const group = POSE_GROUPS.find((g) => g.id === groupId)!;
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
          className="grid grid-cols-3 gap-1 rounded-md bg-ink-800 p-0.5"
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
                "h-7 rounded px-1 text-xs font-medium transition-colors",
                g.id === groupId
                  ? "bg-ink-600 text-ink-100 shadow-sm"
                  : "text-ink-300 hover:text-ink-100",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-2xs text-ink-400">
          Left and right are the mannequin&apos;s own. In the viewport, drag a
          body part to pose it; grab a hand to move the whole arm.
        </p>

        {group.joints.map((id) => (
          <section
            key={id}
            aria-label={JOINTS[id].label}
            data-testid={`pose-joint-${id}`}
            className={cx(
              "mt-2 rounded-md px-2 pb-1",
              id === joint && group.joints.length > 1 && "bg-ink-800/60",
            )}
          >
            <SectionTitle>{JOINTS[id].label}</SectionTitle>
            {Object.entries(JOINTS[id].dofs as Record<string, Dof>).map(
              ([dof, d]) => (
                <Slider
                  key={dof}
                  label={d.label}
                  value={joints[id][dof]}
                  min={d.min}
                  max={d.max}
                  step={1}
                  unit="°"
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
              ),
            )}
          </section>
        ))}
      </div>
    </>
  );
}
