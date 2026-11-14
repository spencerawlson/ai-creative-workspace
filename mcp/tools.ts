/** The MCP server's tools, independent of the MCP library so they can be
 * tested directly: a name, what it's for, a zod input schema, and a
 * function from the session and the checked input to text. */

import { z } from "zod";
import { PRESETS } from "@/lib/lighting";
import { MAX_BEATS, parseBeat, splitBeats } from "@/lib/studio/beats";
import { roundTime } from "@/lib/studio/animation";
import type { CastEntry } from "@/lib/studio/cast";
import { MOTIONS } from "@/lib/studio/motions";
import { describeOptions, searchMotions } from "@/lib/studio/motionSearch";
import { JOINTS, POSE_PRESETS } from "@/lib/studio/pose";
import { BACKDROP_PRESETS, MATERIAL_PRESETS } from "@/lib/studio/presets";
import { FigureIdSchema, LIMITS } from "@/lib/studio/schema";
import { decodeSceneLink, encodeSceneLink } from "@/lib/studio/share";
import { describeScene } from "./describe";
import {
  AGENT_ACTION_TYPES,
  AgentActionSchema,
  issueText,
  type ActOutcome,
  type StudioSession,
} from "./session";

export interface ToolContext {
  /** Where the studio runs, for share links (no trailing slash). */
  studioUrl: string;
  /** The app's built-in cast (public/cast/cast.json). */
  cast: CastEntry[];
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

interface ToolDef<S extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** Only reads: changes nothing in the scene. */
  readOnly?: boolean;
  run(
    session: StudioSession,
    args: z.infer<S>,
    ctx: ToolContext,
  ): ToolResult | Promise<ToolResult>;
}

export type Tool = ToolDef<z.ZodObject>;

const tool = <S extends z.ZodObject>(t: ToolDef<S>) => t as unknown as Tool;

const failed = (text: string): ToolResult => ({ text, isError: true });

function afterAct(
  session: StudioSession,
  r: ActOutcome,
  what = "action",
): ToolResult {
  if (!r.ok)
    return failed(
      `Nothing changed: ${what} ${r.index + 1} was refused (${r.error}).`,
    );
  const done = r.done.length
    ? `Done: ${r.done.join("; ")}.`
    : "Nothing changed: the scene was already like that.";
  return { text: `${done}\n\n${describeScene(session.scene)}` };
}

const firstSentence = (s: string) => s.split(/(?<=\.)\s/)[0];

const CATALOGS = [
  "lighting",
  "poses",
  "motions",
  "joints",
  "materials",
  "backdrops",
  "characters",
] as const;

function catalog(list: (typeof CATALOGS)[number], ctx: ToolContext): string {
  switch (list) {
    case "lighting":
      return [
        'Lighting presets (applyPreset {"presetId"}):',
        ...PRESETS.map((p) => `- ${p.id}: ${p.name}. ${firstSentence(p.note)}`),
      ].join("\n");
    case "poses":
      return [
        'Pose presets (applyPosePreset {"presetId", "figure"}):',
        ...POSE_PRESETS.map((p) => `- ${p.id}: ${p.name}. ${p.note}`),
      ].join("\n");
    case "motions": {
      const out = [
        'The motion library (applyMotion {"motion", "figure"}; find_motion turns words into one). A pose is held; a move becomes keyframes.',
      ];
      const byCategory = new Map<string, string[]>();
      for (const m of MOTIONS) {
        const list = byCategory.get(m.category) ?? [];
        list.push(`${m.id}${m.kind === "pose" ? " (pose)" : ""}`);
        byCategory.set(m.category, list);
      }
      for (const [cat, ids] of byCategory)
        out.push(`${cat}: ${ids.join(", ")}`);
      return out.join("\n");
    }
    case "joints":
      return [
        'Joints and their ranges in degrees, relative to the scan\'s A-pose (0). Sides are the figure\'s own: L is its left. Set with updateJoint {"joint", "patch": {dof: value}} or updateJoints.',
        ...Object.entries(JOINTS).map(
          ([id, j]) =>
            `- ${id} (${j.label}): ${Object.entries(j.dofs)
              .map(
                ([dof, d]) =>
                  `${dof} ${d.min}..${d.max}${"hint" in d && d.hint ? ` (+ = ${d.hint.toLowerCase()})` : ""}`,
              )
              .join(", ")}`,
        ),
      ].join("\n");
    case "materials":
      return [
        'Mannequin materials (applyMaterialPreset {"presetId"}):',
        ...MATERIAL_PRESETS.map(
          (m) =>
            `- ${m.id}: ${m.name} (${m.color}, roughness ${m.roughness}, metalness ${m.metalness})`,
        ),
      ].join("\n");
    case "backdrops":
      return [
        'Backdrops (applyBackdropPreset {"presetId"}):',
        ...BACKDROP_PRESETS.map(
          (b) => `- ${b.id}: ${b.name} (${b.style}, ${b.color})`,
        ),
      ].join("\n");
    case "characters":
      return [
        'Mannequins: setModel {"model": "male" | "female"}.',
        ctx.cast.length
          ? 'The built-in cast (setCharacter {"figure", "character", "name"}; character null goes back to the mannequin):'
          : "The built-in cast is empty for now. Characters imported in the studio live on that device only.",
        ...ctx.cast.map(
          (c) =>
            `- ${c.id}: ${c.name}${c.credit.prompt ? ` ("${c.credit.prompt}")` : ""}`,
        ),
      ].join("\n");
  }
}

export const TOOLS: Tool[] = [
  tool({
    name: "scene",
    title: "Read the scene",
    description:
      "What is in the scene now: figures and their poses, lights, camera, material, backdrop, keyframes, beats. Read it before changing things; ids here are what actions take.",
    input: z.object({
      json: z
        .boolean()
        .optional()
        .describe("The whole scene document as JSON instead of a summary."),
    }),
    readOnly: true,
    run: (session, { json }) => ({
      text: json ? JSON.stringify(session.scene) : describeScene(session.scene),
    }),
  }),

  tool({
    name: "catalog",
    title: "List what's available",
    description:
      "Ids to use in actions: lighting presets, pose presets, the motion library, joints with their ranges, materials, backdrops, characters.",
    input: z.object({ list: z.enum(CATALOGS) }),
    readOnly: true,
    run: (_s, { list }, ctx) => ({ text: catalog(list, ctx) }),
  }),

  tool({
    name: "find_motion",
    title: "Find a move",
    description:
      'Turn words ("wave with the left hand", "walk 3 steps slowly", "sit down") into a move from the motion library, with the applyMotion action that does it.',
    input: z.object({
      text: z.string().trim().min(1).max(120),
      limit: z.number().int().min(1).max(8).optional(),
    }),
    readOnly: true,
    run: (_s, { text, limit }) => {
      const found = searchMotions(text, limit ?? 3);
      if (!found.length)
        return {
          text: `No move matches "${text}". catalog {"list": "motions"} lists them all.`,
        };
      return {
        text: found
          .map((m) => {
            const how = describeOptions(m);
            const action = {
              type: "applyMotion",
              motion: m.motion.id,
              ...m.options,
            };
            return `- ${m.motion.name} (${m.motion.kind}${how ? `, ${how}` : ""}), match ${m.score.toFixed(2)}: ${m.motion.note}\n  ${JSON.stringify(action)}`;
          })
          .join("\n"),
      };
    },
  }),

  tool({
    name: "act",
    title: "Change the scene",
    description: `Apply studio actions in order, as undo steps; all or nothing (if one is refused, none apply). Each is {"type", ...}: ${AGENT_ACTION_TYPES.join(", ")}. Figures default to the first when an action's figure is optional. Returns what changed and the scene after.`,
    input: z.object({ actions: z.array(AgentActionSchema).min(1).max(20) }),
    run: (session, { actions }) => afterAct(session, session.act(actions)),
  }),

  tool({
    name: "direct",
    title: "Direct a figure in beats",
    description: `Write what a figure does as beats, one per line (or ";"), played one after another from time "from": a move from the library ("walk 2 times", "wave"), "face the camera" / "turn left" / "turn right" / "turn away", "pause 1 s". A note can follow " — ". At most ${MAX_BEATS} beats. Lines with speech ("say …") need a recorded sound and are done in the studio.`,
    input: z.object({
      figure: FigureIdSchema,
      script: z.string().trim().min(1).max(4000),
      from: z.number().finite().min(0).max(LIMITS.duration[1]).optional(),
    }),
    run: (session, { figure, script, from }) => {
      const lines = splitBeats(script).map(parseBeat);
      if (!lines.length) return failed("The script has no beats.");
      if (lines.length > MAX_BEATS)
        return failed(`That's ${lines.length} beats; at most ${MAX_BEATS}.`);
      const problems = lines.flatMap((l, i) =>
        !l.ok
          ? [`line ${i + 1} "${l.text}": ${l.error}`]
          : l.beat.do.kind === "say"
            ? [
                `line ${i + 1} "${l.beat.text}": speech needs a recorded sound; add it in the studio`,
              ]
            : [],
      );
      if (problems.length)
        return failed(`Nothing directed:\n- ${problems.join("\n- ")}`);
      const read = lines.map((l) => (l.ok ? l.label : ""));
      const r = session.act([
        {
          type: "directBeats",
          figure,
          t: roundTime(from ?? 0),
          beats: lines.flatMap((l) => (l.ok ? [l.beat] : [])),
        },
      ]);
      const result = afterAct(session, r, "the beats");
      return r.ok
        ? { text: `Read as: ${read.join(" → ")}.\n${result.text}` }
        : result;
    },
  }),

  tool({
    name: "undo",
    title: "Undo",
    description: "Step back through the changes (the studio's undo).",
    input: z.object({ steps: z.number().int().min(1).max(50).optional() }),
    run: (session, { steps }) => {
      const passed = session.undo(steps ?? 1);
      return passed.length
        ? {
            text: `Undid: ${passed.join("; ")}.\n\n${describeScene(session.scene)}`,
          }
        : failed("Nothing to undo.");
    },
  }),

  tool({
    name: "redo",
    title: "Redo",
    description: "Step forward again after undo.",
    input: z.object({ steps: z.number().int().min(1).max(50).optional() }),
    run: (session, { steps }) => {
      const passed = session.redo(steps ?? 1);
      return passed.length
        ? {
            text: `Redid: ${passed.join("; ")}.\n\n${describeScene(session.scene)}`,
          }
        : failed("Nothing to redo.");
    },
  }),

  tool({
    name: "history",
    title: "List the undo steps",
    description: "Every change so far, oldest first, and where undo stands.",
    input: z.object({}),
    readOnly: true,
    run: (session) => {
      const { labels, index } = session.steps;
      return {
        text: labels
          .map((l, i) => `${i === index ? "→" : " "} ${i}. ${l}`)
          .join("\n"),
      };
    },
  }),

  tool({
    name: "share_link",
    title: "Link to open the scene in the studio",
    description:
      "A link that opens this scene in the I-K-O 3D studio, with its animation when it fits in a link. Give it to the person to see the result.",
    input: z.object({}),
    readOnly: true,
    run: async (session, _args, ctx) => {
      const link = await encodeSceneLink(session.scene);
      const url = `${ctx.studioUrl}/studio?s=${link.param}`;
      return {
        text: link.tooLong
          ? `${url}\n\nThe animation is too long for a link, so this opens the scene as it stands, without keyframes.`
          : url,
      };
    },
  }),

  tool({
    name: "open_link",
    title: "Open a studio share link",
    description:
      "Load a scene from an I-K-O 3D share link (the whole URL, or its s= value), as one undo step.",
    input: z.object({ link: z.string().trim().min(1).max(20000) }),
    run: async (session, { link }) => {
      let param: string | null = link;
      if (/^https?:\/\//i.test(link)) {
        try {
          param = new URL(link).searchParams.get("s");
        } catch {
          param = null;
        }
      }
      const scene = param ? await decodeSceneLink(param) : null;
      if (!scene)
        return failed("That isn't a studio share link, or it's damaged.");
      return afterAct(session, session.load(scene, "Open shared scene"));
    },
  }),
];

/** Run a tool by name with unchecked arguments. Never throws. */
export async function callTool(
  session: StudioSession,
  name: string,
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return failed(`No tool "${name}".`);
  const parsed = t.input.safeParse(args ?? {});
  if (!parsed.success) return failed(`Bad input: ${issueText(parsed.error)}`);
  try {
    return await t.run(session, parsed.data, ctx);
  } catch (e) {
    return failed(`The tool failed: ${e instanceof Error ? e.message : e}`);
  }
}

/** The tools as MCP lists them: JSON Schema inputs. */
export function listTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, {
      io: "input",
      unrepresentable: "any",
    }) as { type: "object"; [k: string]: unknown },
    annotations: {
      title: t.title,
      readOnlyHint: !!t.readOnly,
      destructiveHint: false,
      openWorldHint: false,
    },
  }));
}
