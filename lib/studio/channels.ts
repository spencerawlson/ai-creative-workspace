/** The animated values (channels) of a scene, as the graph editor lists
 * them: which exist, their labels, valid ranges and display precision.
 * Pure; no React. */

import { JOINTS, type Dof, type JointId } from "./pose";
import { figureLabel } from "./figures";
import { LIMITS, type Channel, type SceneDoc } from "./schema";

/** Something with channels: a figure, a light, or the camera. */
export type ChannelOwner =
  | { kind: "figure"; id: string }
  | { kind: "light"; id: string }
  | { kind: "camera" };

export const ownerId = (o: ChannelOwner) =>
  o.kind === "camera" ? "camera" : `${o.kind}:${o.id}`;

export function owners(
  scene: SceneDoc,
): { owner: ChannelOwner; label: string }[] {
  return [
    ...scene.figures.map((f) => ({
      owner: { kind: "figure", id: f.id } as ChannelOwner,
      label: scene.figures.length > 1 ? figureLabel(scene, f.id) : "Mannequin",
    })),
    ...scene.lights.map((l) => ({
      owner: { kind: "light", id: l.id } as ChannelOwner,
      label: l.label,
    })),
    { owner: { kind: "camera" } as ChannelOwner, label: "Camera" },
  ];
}

const LIGHT_LABELS = {
  azimuth: "Direction",
  elevation: "Height",
  distance: "Distance",
  intensity: "Intensity",
  temperature: "Colour temperature",
  softness: "Softness",
  spotAngle: "Spot angle",
  size: "Softbox size",
} as const;

/** Every channel of an owner, grouped for the list. */
export function channelsOf(
  scene: SceneDoc,
  owner: ChannelOwner,
): { group: string; channel: Channel; label: string }[] {
  if (owner.kind === "camera")
    return [
      {
        group: "Camera",
        channel: { kind: "camera", field: "focalMm" },
        label: "Focal length",
      },
    ];
  if (owner.kind === "light") {
    const light = scene.lights.find((l) => l.id === owner.id);
    if (!light) return [];
    const fields = (Object.keys(LIGHT_LABELS) as (keyof typeof LIGHT_LABELS)[])
      .filter((f) => f !== "spotAngle" || light.kind === "spot")
      .filter((f) => f !== "size" || light.kind === "area");
    return fields.map((field) => ({
      group: light.label,
      channel: { kind: "light", light: light.id, field },
      label: LIGHT_LABELS[field],
    }));
  }
  const id = owner.id;
  return [
    ...(["x", "z", "rotation"] as const).map((field) => ({
      group: "Placement",
      channel: { kind: "figure", figure: id, field } as Channel,
      label: { x: "Left / right", z: "Forward / back", rotation: "Turn" }[
        field
      ],
    })),
    ...(Object.keys(JOINTS) as JointId[]).flatMap((joint) =>
      Object.entries(JOINTS[joint].dofs as Record<string, Dof>).map(
        ([dof, d]) => ({
          group: JOINTS[joint].label,
          channel: { kind: "joint", figure: id, joint, dof } as Channel,
          label: d.label,
        }),
      ),
    ),
  ];
}

/** Valid range and the step values are rounded to. */
export function channelRange(ch: Channel): {
  min: number;
  max: number;
  step: number;
  unit: string;
} {
  switch (ch.kind) {
    case "figure":
      return ch.field === "rotation"
        ? {
            min: LIMITS.rotation[0],
            max: LIMITS.rotation[1],
            step: 0.1,
            unit: "°",
          }
        : {
            min: LIMITS[ch.field === "x" ? "figureX" : "figureZ"][0],
            max: LIMITS[ch.field === "x" ? "figureX" : "figureZ"][1],
            step: 0.01,
            unit: " m",
          };
    case "joint": {
      const d = (JOINTS[ch.joint as JointId]?.dofs as Record<string, Dof>)?.[
        ch.dof
      ];
      return { min: d?.min ?? -180, max: d?.max ?? 180, step: 0.1, unit: "°" };
    }
    case "light": {
      const [min, max] = LIMITS[ch.field];
      const step =
        ch.field === "temperature"
          ? 10
          : ch.field === "intensity" || ch.field === "size"
            ? 0.01
            : 0.1;
      const unit =
        ch.field === "temperature"
          ? " K"
          : ch.field === "distance" || ch.field === "size"
            ? " m"
            : ["azimuth", "elevation", "spotAngle"].includes(ch.field)
              ? "°"
              : "";
      return { min, max, step, unit };
    }
    case "camera":
      return {
        min: LIMITS.focalMm[0],
        max: LIMITS.focalMm[1],
        step: 1,
        unit: " mm",
      };
  }
}

/** Clamp to the channel's range and round to its step. */
export function fitValue(ch: Channel, v: number): number {
  const { min, max, step } = channelRange(ch);
  const r = Math.round(Math.min(max, Math.max(min, v)) / step) * step;
  return Math.round(r * 1000) / 1000;
}
