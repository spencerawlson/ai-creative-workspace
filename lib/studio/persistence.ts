/** Local persistence: autosave/recovery in localStorage and portable
 * project files (.lighting.json). Both are validated with SceneSchema on
 * the way in, so a corrupted or hand-edited file can't break the app.
 * This is device-local storage only — there are no accounts yet.
 */

import { z } from "zod";
import { SceneSchema, type SceneDoc } from "./schema";

export const AUTOSAVE_KEY = "acw.lighting.autosave.v2";
export const PROJECT_FORMAT = "ai-creative-workspace/lighting-project";

const AutosaveSchema = z.object({
  savedAt: z.number(),
  name: z.string().max(80),
  scene: SceneSchema,
});
export type Autosave = z.infer<typeof AutosaveSchema>;

const ProjectFileSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  formatVersion: z.literal(1),
  name: z.string().trim().min(1).max(80),
  savedAt: z.string(),
  scene: SceneSchema,
});
export type ProjectFile = z.infer<typeof ProjectFileSchema>;

/** Storage is injected so tests (and private-mode browsers where
 * localStorage throws) behave predictably. */
type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): KV | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function saveAutosave(
  data: Autosave,
  kv: KV | null = storage(),
): boolean {
  if (!kv) return false;
  try {
    kv.setItem(AUTOSAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false; // quota exceeded or storage disabled
  }
}

export function loadAutosave(kv: KV | null = storage()): Autosave | null {
  if (!kv) return null;
  try {
    const raw = kv.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = AutosaveSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearAutosave(kv: KV | null = storage()): void {
  try {
    kv?.removeItem(AUTOSAVE_KEY);
  } catch {
    // ignore
  }
}

export function serializeProject(
  name: string,
  scene: SceneDoc,
  now = new Date(),
): string {
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    formatVersion: 1,
    name: name.trim() || "Untitled lighting setup",
    savedAt: now.toISOString(),
    scene,
  };
  return JSON.stringify(file, null, 2);
}

export const MAX_PROJECT_BYTES = 256 * 1024;

export function parseProject(
  text: string,
): { ok: true; project: ProjectFile } | { ok: false; error: string } {
  if (text.length > MAX_PROJECT_BYTES)
    return { ok: false, error: "File is too large." };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
  const parsed = ProjectFileSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `Not a valid lighting project (${issue?.path.join(".") || "root"}: ${issue?.message}).`,
    };
  }
  return { ok: true, project: parsed.data };
}
