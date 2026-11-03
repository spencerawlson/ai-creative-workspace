"use client";

/** Compatibility wrapper with the M1–M3 props API, used by /photography.
 * It renders through the same StudioEngine as Lighting Studio, so both
 * pages share one scene implementation (models, lights, disposal). */

import { useMemo } from "react";
import { StudioViewport } from "@/components/studio/StudioViewport";
import type { LightState } from "@/lib/lighting";
import { defaultScene, fromLegacyLight } from "@/lib/studio/presets";
import type { MannequinModel, SceneDoc } from "@/lib/studio/schema";

export type { MannequinModel };

export function LightingScene({
  lights,
  view,
  viewNonce,
  model,
  fov,
  exposure,
}: {
  lights: LightState[];
  view: "face" | "full";
  viewNonce: number;
  model: MannequinModel;
  /** Optional camera override: vertical field of view in degrees.
   * Undefined keeps the Lighting Studio default (~40°). */
  fov?: number;
  /** Optional preview brightness multiplier. Undefined keeps the
   * Lighting Studio default 1.1. This is a preview brightness aid,
   * not a camera sensor simulation. */
  exposure?: number;
}) {
  const scene = useMemo<SceneDoc>(
    () => ({
      ...defaultScene(),
      preset: "custom",
      figures: [{ ...defaultScene().figures[0], model }],
      lights: lights.map(fromLegacyLight),
    }),
    [lights, model],
  );
  const overrides = useMemo(() => ({ fov, exposure }), [fov, exposure]);
  return (
    <div className="h-full w-full overflow-hidden rounded-xl bg-[#111118]">
      <StudioViewport
        scene={scene}
        overrides={overrides}
        view={view}
        viewNonce={viewNonce}
        showHandles={false}
        label="3D scene with a mannequin"
      />
    </div>
  );
}
