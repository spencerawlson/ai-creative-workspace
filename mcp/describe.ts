/** The scene as short plain text, for a model to read: what is there,
 * by id, with the numbers an action would change. */

import { JOINTS, type JointId } from "@/lib/studio/pose";
import { LIMITS, type Figure, type SceneDoc } from "@/lib/studio/schema";

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const secs = (t: number) => `${r2(t)} s`;

/** A figure's pose: the preset, and every joint value that isn't zero
 * (zero is the scan's A-pose). */
export function describePose(figure: Figure, max = 24): string {
  const set: string[] = [];
  for (const [id, values] of Object.entries(figure.pose.joints)) {
    if (!(id in JOINTS)) continue;
    for (const [dof, v] of Object.entries(values as Record<string, number>))
      if (Math.abs(v) >= 0.05) set.push(`${id as JointId}.${dof} ${r1(v)}`);
  }
  const preset =
    figure.pose.preset === "custom" ? "custom" : `"${figure.pose.preset}"`;
  if (!set.length) return `pose ${preset}, all joints at 0`;
  const more = set.length > max ? `, … ${set.length - max} more` : "";
  return `pose ${preset}: ${set.slice(0, max).join(", ")}${more}`;
}

export function describeScene(scene: SceneDoc): string {
  const out: string[] = [];
  out.push(`Figures (${scene.figures.length} of ${LIMITS.maxFigures}):`);
  for (const f of scene.figures) {
    const who = f.character
      ? `character ${f.character} (stands in as the ${f.model} mannequin where it isn't available)`
      : `${f.model} mannequin`;
    out.push(
      `- ${f.id}: ${who} at x ${r2(f.x)}, z ${r2(f.z)}, y ${r2(f.y)} m, facing ${r1(f.rotation)}° (0 = the camera)`,
      `  ${describePose(f)}`,
    );
    // Where its animation leaves it: a move travels, so the next beat,
    // or another figure, has to allow for it.
    const last = scene.animation.keys.findLast((k) => k.figures[f.id]);
    const end = last?.figures[f.id];
    if (
      last &&
      end &&
      last !== scene.animation.keys.find((k) => k.figures[f.id])
    )
      out.push(
        `  animated: ends at x ${r2(end.x)}, z ${r2(end.z)}, y ${r2(end.y)} m, facing ${r1(end.rotation)}° (at ${secs(last.t)})`,
      );
  }

  out.push(
    `Lights (${scene.lights.length} of ${LIMITS.maxLights}), preset "${scene.preset}":`,
  );
  for (const l of scene.lights) {
    const extra =
      l.kind === "spot"
        ? `, cone ${r1(l.spotAngle)}°`
        : l.kind === "area"
          ? `, size ${r2(l.size)} m`
          : "";
    out.push(
      `- ${l.id} "${l.label}" (${l.kind}) ${l.on ? "on" : "off"}: azimuth ${r1(l.azimuth)}°, elevation ${r1(l.elevation)}°, distance ${r2(l.distance)} m, intensity ${r2(l.intensity)}, ${Math.round(l.temperature)} K, softness ${r1(l.softness)}, shadows ${l.shadows ? "on" : "off"}${extra}`,
    );
  }

  const c = scene.camera;
  const lens = [
    c.aperture ? `f/${c.aperture}` : "all sharp",
    c.bloom ? `bloom ${r2(c.bloom)}` : "",
    c.vignette ? `vignette ${r2(c.vignette)}` : "",
    c.grain ? `grain ${r2(c.grain)}` : "",
  ].filter(Boolean);
  out.push(
    `Camera: ${r1(c.focalMm)} mm, exposure ${c.exposureEv >= 0 ? "+" : ""}${r1(c.exposureEv)} EV, ${c.toneMapping} tone mapping, ${lens.join(", ")}`,
    `Material: "${scene.material.preset}" ${scene.material.color}, roughness ${r2(scene.material.roughness)}, metalness ${r2(scene.material.metalness)}`,
    `Backdrop: "${scene.backdrop.preset}" ${scene.backdrop.style} ${scene.backdrop.color}, shadow opacity ${r2(scene.backdrop.shadowOpacity)}; shadows ${scene.shadows.quality}`,
  );

  const keys = scene.animation.keys;
  out.push(
    keys.length
      ? `Animation: ${secs(scene.animation.duration)} long, ${keys.length} keys at ${keys
          .slice(0, 20)
          .map((k) => r2(k.t))
          .join(", ")}${keys.length > 20 ? ", …" : ""} s`
      : `Animation: ${secs(scene.animation.duration)} long, no keys`,
  );
  if (scene.beats.length) {
    out.push("Beats:");
    for (const b of scene.beats)
      out.push(
        `- ${b.figure} at ${secs(b.t)} for ${secs(b.length)}: "${b.text}"${b.note ? ` (${b.note})` : ""}`,
      );
  }
  if (scene.speech.length) {
    out.push("Lip sync:");
    for (const sp of scene.speech)
      out.push(`- ${sp.figure} says "${sp.name}" from ${secs(sp.start)}`);
  }
  return out.join("\n");
}
