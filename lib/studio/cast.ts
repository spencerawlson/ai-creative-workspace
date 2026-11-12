/** The built-in cast: characters that come with the app, served from its
 * own address (public/cast/), listed in public/cast/cast.json. They are
 * made with Meshy by scripts/meshy-cast.mjs on a developer's machine;
 * the app never talks to Meshy and holds no key.
 *
 * Unlike imported characters, every device has them, so a share link
 * with a cast member shows that character everywhere. */

import { z } from "zod";

export const CAST_URL = "/cast/cast.json";

export const CastEntrySchema = z.object({
  id: z.string().regex(/^cast-[a-z0-9][a-z0-9-]{1,23}$/),
  name: z.string().trim().min(1).max(40),
  /** The GLB, next to the list. */
  file: z.string().regex(/^[a-z0-9][a-z0-9-]{1,23}\.glb$/),
  size: z.number().int().positive(),
  /** How it was made, shown with it. */
  credit: z.object({
    tool: z.string().max(40),
    prompt: z.string().max(800),
    made: z.string().max(10).optional(),
  }),
});
export type CastEntry = z.infer<typeof CastEntrySchema>;

const CastListSchema = z.object({
  version: z.literal(1),
  cast: z.array(z.unknown()).max(24),
});

/** The cast list's entries that are valid; anything else is left out
 * (a bad entry never takes the rest with it). */
export function readCastList(json: unknown): CastEntry[] {
  const list = CastListSchema.safeParse(json);
  if (!list.success) return [];
  return list.data.cast.flatMap((c) => {
    const e = CastEntrySchema.safeParse(c);
    return e.success ? [e.data] : [];
  });
}

export const castFileUrl = (e: CastEntry) => `/cast/${e.file}`;

/** The cast, from the app's own address; empty if there's none. */
export async function loadCast(): Promise<CastEntry[]> {
  try {
    const res = await fetch(CAST_URL, { cache: "no-cache" });
    return res.ok ? readCastList(await res.json()) : [];
  } catch {
    return [];
  }
}
