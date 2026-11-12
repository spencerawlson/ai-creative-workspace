// The built-in cast, made with Meshy: for each character in the spec
// (assets/cast/cast.spec.json), a draft model from its description, a
// textured model, then a Mixamo-style skeleton, downloaded as a GLB.
//
// Resumable: every task id is saved to the state file the moment it is
// created, so running again picks up where it stopped and never pays
// for a step twice. Changing a character's description starts that
// character over. A dry run spends nothing and needs no key.

/** Credits per step (https://docs.meshy.ai/en/api/pricing, Nov 2026). */
export const CREDITS = { preview: 20, refine: 10, rig: 5 };

/** Settings sent with each step; the same for every character. */
export const SETTINGS = {
  preview: {
    ai_model: "latest",
    // Arms out from the body: what the rigging step needs.
    pose_mode: "a-pose",
    should_remesh: true,
    // Plenty for a face close-up, light enough for phones (the scanned
    // mannequin is ~240k), and well under rigging's 380k limit.
    target_polycount: 60000,
  },
  refine: { enable_pbr: true, texture_resolution: "2k" },
  rig: { skeleton_template: "mixamo" },
};

const ID = /^[a-z0-9][a-z0-9-]{1,23}$/;

/** Check a spec file's contents; returns the cast or throws why not. */
export function readSpec(json) {
  if (json?.version !== 1 || !Array.isArray(json.cast))
    throw new Error('The cast spec needs { "version": 1, "cast": [...] }.');
  const seen = new Set();
  return json.cast.map((c, i) => {
    const at = `cast[${i}]`;
    if (typeof c.id !== "string" || !ID.test(c.id))
      throw new Error(
        `${at}.id: lowercase letters, digits and dashes, 2–24 long`,
      );
    if (seen.has(c.id)) throw new Error(`${at}.id "${c.id}" is used twice`);
    seen.add(c.id);
    if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 40)
      throw new Error(`${at}.name: 1–40 characters`);
    if (
      typeof c.prompt !== "string" ||
      !c.prompt.trim() ||
      c.prompt.length > 800
    )
      throw new Error(`${at}.prompt: 1–800 characters`);
    const height = c.heightMeters ?? 1.7;
    if (typeof height !== "number" || height < 0.5 || height > 2.5)
      throw new Error(`${at}.heightMeters: 0.5–2.5`);
    return {
      id: c.id,
      name: c.name.trim(),
      prompt: c.prompt.trim(),
      heightMeters: height,
      fingers: c.fingers ?? true,
    };
  });
}

/** What's left to do for one character, given its saved state. */
export function stepsLeft(member, saved) {
  const s = saved && saved.prompt === member.prompt ? saved : {};
  if (s.file) return [];
  return ["preview", "refine", "rig", "download"].filter(
    (step) => step === "download" || !(s[step] && s[`${step}Done`]),
  );
}

/** Credits the remaining steps will spend (tasks already created but
 * not finished are paid for: they aren't counted again). */
export function estimate(cast, state, only) {
  let total = 0;
  const lines = [];
  for (const m of cast) {
    if (only && !only.includes(m.id)) continue;
    const saved = state[m.id]?.prompt === m.prompt ? state[m.id] : {};
    const steps = stepsLeft(m, state[m.id]);
    const cost = steps
      .filter((s) => s !== "download" && !saved[s])
      .reduce((sum, s) => sum + CREDITS[s], 0);
    total += cost;
    lines.push(
      steps.length === 0
        ? `${m.id}: done`
        : `${m.id}: ${steps.join(" → ")} (${cost} credits)`,
    );
  }
  return { total, lines };
}

/**
 * Make (or finish making) the cast.
 * @param {{
 *   cast: ReturnType<typeof readSpec>,
 *   state: Record<string, any>,
 *   meshy: ReturnType<typeof import("./client.mjs").createMeshy>,
 *   saveState: (state: Record<string, any>) => Promise<void>,
 *   writeSource: (id: string, bytes: Uint8Array) => Promise<string>,
 *   log?: (line: string) => void,
 *   only?: string[],
 * }} o
 * @returns {Promise<{ made: string[], failed: Array<{ id: string, error: string }> }>}
 */
export async function makeCast(o) {
  const log = o.log ?? (() => {});
  const made = [];
  const failed = [];
  for (const m of o.cast) {
    if (o.only && !o.only.includes(m.id)) continue;
    let s = o.state[m.id];
    if (!s || s.prompt !== m.prompt) {
      if (s) log(`${m.id}: the description changed, starting over`);
      s = o.state[m.id] = { prompt: m.prompt, credits: 0 };
      await o.saveState(o.state);
    }
    if (s.file) {
      log(`${m.id}: already made (${s.file})`);
      continue;
    }
    log(`${m.id}: ${m.name}`);
    try {
      /** Create the step's task once, wait for it, note what it cost.
       * A finished step isn't asked about again, except rigging, whose
       * result (the download link) is still needed. */
      const step = async (name, kind, body) => {
        if (s[`${name}Done`] && name !== "rig") return null;
        if (!s[name]) {
          s[name] = await o.meshy.create(kind, body);
          await o.saveState(o.state);
        }
        const task = await o.meshy.wait(kind, s[name]);
        if (!s[`${name}Done`]) {
          s[`${name}Done`] = true;
          s.credits += task.consumed_credits ?? CREDITS[name];
          await o.saveState(o.state);
        }
        return task;
      };
      await step("preview", "textTo3d", {
        mode: "preview",
        prompt: m.prompt,
        ...SETTINGS.preview,
        target_formats: ["glb"],
      });
      await step("refine", "textTo3d", {
        mode: "refine",
        preview_task_id: s.preview,
        ...SETTINGS.refine,
        target_formats: ["glb"],
      });
      const rig = await step("rig", "rigging", {
        input_task_id: s.refine,
        height_meters: m.heightMeters,
        include_fingers: m.fingers,
        ...SETTINGS.rig,
      });
      const url = rig.result?.rigged_character_glb_url;
      if (!url) throw new Error("the rigging result has no GLB");
      s.file = await o.writeSource(m.id, await o.meshy.download(url));
      s.madeAt = new Date().toISOString().slice(0, 10);
      delete s.error;
      await o.saveState(o.state);
      log(`${m.id}: saved ${s.file} (${s.credits} credits)`);
      made.push(m.id);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      s.error = error;
      // A failed task is refunded and can't be continued: try it afresh
      // next time. Anything else (a network error) resumes the same task.
      if (/ failed: /.test(error))
        for (const k of ["preview", "refine", "rig"])
          if (s[k] && !s[`${k}Done`]) delete s[k];
      await o.saveState(o.state);
      log(`${m.id}: ${error}`);
      failed.push({ id: m.id, error });
    }
  }
  return { made, failed };
}

/** The app's cast list (public/cast/cast.json) from the spec, the saved
 * state and the optimised files' sizes. */
export function manifest(cast, state, sizes) {
  return {
    version: 1,
    cast: cast
      .filter((m) => sizes[m.id] && state[m.id]?.prompt === m.prompt)
      .map((m) => ({
        id: `cast-${m.id}`,
        name: m.name,
        file: `${m.id}.glb`,
        size: sizes[m.id],
        credit: {
          tool: "Meshy",
          prompt: m.prompt,
          ...(state[m.id].madeAt ? { made: state[m.id].madeAt } : {}),
        },
      })),
  };
}
