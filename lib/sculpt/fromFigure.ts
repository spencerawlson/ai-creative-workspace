/** A posed figure from the studio, as a sculpture: its triangles (as
 * StudioEngine.bakeFigure gives them) welded into clay and kept on the
 * device, for the Sculpt page to open. */

import { weld } from "./mesh";
import { newSculptId, saveSculpt } from "./store";

/** The Sculpt page's address that opens sculpture `id`. */
export const sculptUrl = (id: string) =>
  `/sculpt?open=${encodeURIComponent(id)}`;

/** The id asked for in a Sculpt address, if it looks like one. */
export function openParam(search: string): string | null {
  const id = new URLSearchParams(search).get("open");
  return id && /^sc-[a-z0-9]{6,24}$/.test(id) ? id : null;
}

/** Weld `corners` (x, y, z per triangle corner) and keep the result as a
 * new sculpture named `name`. Returns its id, or an error message. */
export async function keepFigureSculpture(
  corners: Float32Array,
  name: string,
): Promise<{ id: string } | { error: string }> {
  const { positions, index } = weld(corners);
  if (!index.length) return { error: "The figure has no surface to sculpt." };
  const id = newSculptId();
  const error = await saveSculpt(
    {
      id,
      name: name.slice(0, 60),
      updatedAt: Date.now(),
      triangles: index.length / 3,
    },
    { id, positions, index },
  );
  return error ? { error } : { id };
}
