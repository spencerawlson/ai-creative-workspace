/** The scene an AI is directing through the MCP server: the studio's own
 * document, changed only by the studio's own validated actions, with
 * the studio's undo history. Nothing here touches a screen or a GPU;
 * the studio shows the result (a share link now, a live link later). */

import { z } from "zod";
import {
  SceneActionSchema,
  applyAction,
  type SceneAction,
} from "@/lib/studio/actions";
import {
  COALESCE_MS,
  canRedo,
  canUndo,
  createHistory,
  historyReducer,
  present,
  type HistoryState,
} from "@/lib/studio/history";
import { defaultScene } from "@/lib/studio/presets";
import type { SceneDoc } from "@/lib/studio/schema";

/** Actions an agent may send. Left out: `loadScene` (the open_link tool
 * does that), `addSpeech` (lip sync is read from a real sound, in the
 * studio) and the graph editor's tangent handles (hand tuning). */
const LEFT_OUT = new Set([
  "loadScene",
  "addSpeech",
  "setKeyTangent",
  "setKeyTangents",
]);
type AgentOption = (typeof SceneActionSchema.options)[number];
export const AgentActionSchema = z.discriminatedUnion(
  "type",
  SceneActionSchema.options.filter(
    (o) => !LEFT_OUT.has(o.shape.type.value),
  ) as unknown as [AgentOption, ...AgentOption[]],
);
export const AGENT_ACTION_TYPES = SceneActionSchema.options
  .map((o) => o.shape.type.value)
  .filter((t) => !LEFT_OUT.has(t));

export type ActOutcome =
  { ok: true; done: string[] } | { ok: false; index: number; error: string };

export class StudioSession {
  private history: HistoryState;
  /** A clock of its own: every agent step is its own undo step, never
   * merged with the one before (the studio merges slider drags). */
  private clock = 0;

  constructor(scene: SceneDoc = defaultScene()) {
    this.history = createHistory(scene, "New scene");
  }

  get scene(): SceneDoc {
    return present(this.history);
  }

  /** Undo steps, oldest first, and which one is showing. */
  get steps(): { labels: string[]; index: number } {
    return {
      labels: this.history.entries.map((e) => e.label),
      index: this.history.index,
    };
  }

  /** Apply actions in order, all or nothing: if one fails, none apply
   * and the failure names which. Returns the history label of each
   * step that changed something. */
  act(actions: readonly unknown[]): ActOutcome {
    const checked: SceneAction[] = [];
    let scene = this.scene;
    for (const [index, input] of actions.entries()) {
      const parsed = AgentActionSchema.safeParse(input);
      if (!parsed.success)
        return { ok: false, index, error: issueText(parsed.error) };
      const r = applyAction(scene, parsed.data);
      if (!r.ok) return { ok: false, index, error: r.error };
      scene = r.scene;
      checked.push(parsed.data);
    }
    return this.commit(checked);
  }

  /** Open a whole scene (a share link), as one undo step. */
  load(scene: SceneDoc, label: string): ActOutcome {
    const r = applyAction(this.scene, { type: "loadScene", scene, label });
    if (!r.ok) return { ok: false, index: 0, error: r.error };
    return this.commit([{ type: "loadScene", scene, label }]);
  }

  /** Step back (or forward) up to `n` times; returns the labels passed. */
  undo(n = 1): string[] {
    const passed: string[] = [];
    while (passed.length < n && canUndo(this.history)) {
      passed.push(this.history.entries[this.history.index].label);
      this.history = historyReducer(this.history, { type: "undo" });
    }
    return passed;
  }

  redo(n = 1): string[] {
    const passed: string[] = [];
    while (passed.length < n && canRedo(this.history)) {
      this.history = historyReducer(this.history, { type: "redo" });
      passed.push(this.history.entries[this.history.index].label);
    }
    return passed;
  }

  private commit(actions: SceneAction[]): ActOutcome {
    let h = this.history;
    const done: string[] = [];
    for (const action of actions) {
      this.clock += COALESCE_MS * 2;
      const next = historyReducer(h, {
        type: "commit",
        action,
        now: this.clock,
      });
      // Checked above, so this only guards against the two disagreeing.
      if (next.error)
        return { ok: false, index: done.length, error: next.error };
      // A no-op keeps the same entries; a change adds one (or, at the
      // history limit, drops the oldest to make room).
      if (next.entries !== h.entries) done.push(next.entries[next.index].label);
      h = next;
    }
    this.history = h;
    return { ok: true, done };
  }
}

/** A zod error as one or a few short lines, with where it is. */
export function issueText(error: z.ZodError, max = 3): string {
  return error.issues
    .slice(0, max)
    .map((i) =>
      i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
    )
    .join("; ");
}
