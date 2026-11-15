/** The built-in creatures: animals that come with the app, served from
 * its own address (public/creatures/), listed in
 * public/creatures/creatures.json. They are made with Meshy and slimmed
 * by scripts/slim-creatures.mjs on a developer's machine; the app never
 * talks to Meshy and holds no key.
 *
 * Unlike the cast, a creature has no human skeleton, so it can't be
 * posed — it stands in the scene as a static figure (a picker + place
 * in the scene, no posing). Its heightMeters is how tall it stands:
 * the engine scales it so its height is that many metres, where a
 * human figure is 1.88 m. */

import { z } from "zod";

export const CREATURES_URL = "/creatures/creatures.json";

export const CreatureEntrySchema = z.object({
  id: z.string().regex(/^creature-[a-z0-9][a-z0-9-]{1,23}$/),
  name: z.string().trim().min(1).max(40),
  /** The GLB, next to the list. */
  file: z.string().regex(/^[a-z0-9][a-z0-9-]{1,23}\.glb$/),
  size: z.number().int().positive(),
  /** How tall it stands in the scene, in metres. */
  heightMeters: z.number().min(0.1).max(4),
  /** How it was made, shown with it. */
  credit: z.object({
    tool: z.string().max(40),
    prompt: z.string().max(800),
    made: z.string().max(10).optional(),
  }),
});
export type CreatureEntry = z.infer<typeof CreatureEntrySchema>;

const CreatureListSchema = z.object({
  version: z.literal(1),
  creatures: z.array(z.unknown()).max(24),
});

/** The creatures list's entries that are valid; anything else is left
 * out (a bad entry never takes the rest with it). */
export function readCreaturesList(json: unknown): CreatureEntry[] {
  const list = CreatureListSchema.safeParse(json);
  if (!list.success) return [];
  return list.data.creatures.flatMap((c) => {
    const e = CreatureEntrySchema.safeParse(c);
    return e.success ? [e.data] : [];
  });
}

export const creatureFileUrl = (e: CreatureEntry) => `/creatures/${e.file}`;

/** The creatures, from the app's own address; empty if there are none. */
export async function loadCreatures(): Promise<CreatureEntry[]> {
  try {
    const res = await fetch(CREATURES_URL, { cache: "no-cache" });
    return res.ok ? readCreaturesList(await res.json()) : [];
  } catch {
    return [];
  }
}
