/** IKO 3D's MCP server: lets an AI (Claude, or a local model in an
 * MCP client) read and direct a studio scene with the studio's own
 * actions. Speaks MCP over stdio; started by the client with
 * `node mcp/start.mjs` (see docs/mcp-server.md).
 *
 * stdout carries the protocol: anything else goes to stderr. */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readCastList } from "@/lib/studio/cast";
import { blenderContext } from "./blender";
import { StudioSession } from "./session";
import { callTool, listTools, type ToolContext } from "./tools";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const INSTRUCTIONS = `You are directing a scene in IKO 3D, a 3D studio for lighting, posing and animating figures.
Start with "scene" to see what's there. "catalog" lists ids (lighting presets, poses, moves, joints, materials, backdrops, characters). "find_motion" turns words into a move. "direct" writes a figure's performance as beats, one per line; "act" applies any studio action. Every change is an undo step ("undo", "history").
Distances are metres on a floor from -3 to 3: x runs left to right as the camera sees it, z towards the camera. Rotation 0 faces the camera, 90 faces +x (right), -90 faces -x, 180 faces away. The default view frames about x -1 to 1. A move that travels takes the figure with it (find_motion says how far; the scene says where each figure ends): leave room. Joint angles are degrees from the A-pose.
When the scene is ready, "share_link" gives a link that opens it in the studio: give it to the person.
Model files (a .glb, or a built-in id like cast-real-man or creature-lion) go to Blender, when it is installed: "blender_retopo" makes a clean quad mesh, "blender_export" writes FBX or USD, "blender_render" renders a still or an MP4. They write into the output folder and say where.`;

/** Where share links point: IKO_STUDIO_URL, or the dev server. */
export function studioUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.IKO_STUDIO_URL?.trim() || "http://localhost:3000";
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`IKO_STUDIO_URL must be http(s), not ${url.protocol}`);
  return url.origin + url.pathname.replace(/\/+$/, "");
}

async function readCast() {
  try {
    const text = await readFile(join(ROOT, "public/cast/cast.json"), "utf8");
    return readCastList(JSON.parse(text));
  } catch {
    return [];
  }
}

export async function main() {
  const ctx: ToolContext = {
    studioUrl: studioUrl(),
    cast: await readCast(),
    blender: blenderContext(ROOT),
  };
  const session = new StudioSession();
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));

  const server = new Server(
    { name: "iko3d-studio", title: "IKO 3D studio", version: pkg.version },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  const tools = listTools();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const r = await callTool(
      session,
      req.params.name,
      req.params.arguments,
      ctx,
    );
    return {
      content: [{ type: "text" as const, text: r.text }],
      ...(r.isError ? { isError: true } : {}),
    };
  });

  await server.connect(new StdioServerTransport());
  console.error(
    `IKO 3D MCP server ready: ${tools.length} tools, links to ${ctx.studioUrl}`,
  );
}
