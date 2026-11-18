# The Zaka 3D MCP server

An [MCP](https://modelcontextprotocol.io) server that lets an AI read and
direct a studio scene: Claude Desktop, Claude Code, or a local model in
an MCP client such as LM Studio. It is the groundwork for running
Zaka 3D with a local AI behind it. Later tools (live view, generating
and rigging characters, generating motion) plug into the same server.

It changes the scene only through the studio's own actions
(`lib/studio/actions.ts`), so an AI can do exactly what a person can
in the studio and nothing else. Every action is validated, applied by
the same reducer, and kept as an undo step. Nothing runs on a GPU yet,
and the server makes no network calls.

## Tools

| Tool          | What it does                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `scene`       | What is in the scene: figures and poses, lights, camera, material, backdrop, keys, beats (or the whole scene as JSON)     |
| `catalog`     | Ids to use: lighting presets, pose presets, the motion library, joints and their ranges, materials, backdrops, characters |
| `find_motion` | Words to a move ("wave with the left hand", "walk 3 steps slowly"), with the action that does it                          |
| `act`         | Apply studio actions in order, all or nothing (if one is refused, none apply)                                             |
| `direct`      | A figure's performance as beats, one per line: "walk 2 times", "face the camera", "pause 1 s"                             |
| `undo`/`redo` | Step back and forward, like the studio's undo                                                                             |
| `history`     | Every change so far                                                                                                       |
| `share_link`  | A link that opens the scene, with its animation, in the studio                                                            |
| `open_link`   | Load a scene from a studio share link                                                                                     |

### Blender tools

These work on model files (a `.glb` path, or a built-in model id such
as `cast-real-man`, `creature-lion` or `mannequin-female`) and run
Blender headless on the machine the server runs on. Blender is found
from `BLENDER`, the PATH, or the usual install folders; without it they
say so. Results go only into the output folder (`IKO_OUTPUT_DIR`,
default `out/` in the app's folder) under a fresh name, so a tool never
overwrites a file.

| Tool             | What it does                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `blender_retopo` | A clean, even quad mesh of about `faces` faces (a dense sculpt becomes light and animatable)     |
| `blender_export` | FBX (Unity, Unreal) or USD (film pipelines), keeping skeleton, skin and animations               |
| `blender_render` | A studio render: a PNG still, or an MP4 turntable or of the model's own animation (EEVEE/Cycles) |

`act` takes every studio action except three: opening a whole scene
(`open_link` does that), lip sync (read from a real sound, in the
studio) and the graph editor's tangent handles. "say" beats need a
recorded sound for the same reason, so `direct` refuses them.

## Connecting a client

The client starts the server itself; nothing has to be running first.
It needs Node 22 or later and `npm install` done in the repo. Replace
`<repo>` with the repo's full path.

Share links point at `http://localhost:3000` (`npm run dev` or
`npm start`). Set `IKO_STUDIO_URL` to point them at another studio,
for example the home server at `http://192.168.1.46:3000`.

**Claude Code:**

```sh
claude mcp add iko3d -e IKO_STUDIO_URL=http://192.168.1.46:3000 -- node <repo>/mcp/start.mjs
```

**Claude Desktop, LM Studio and other clients** that read an
`mcpServers` file (Claude Desktop: Settings › Developer › Edit Config;
LM Studio: Program › Install › Edit mcp.json):

```json
{
  "mcpServers": {
    "iko3d": {
      "command": "node",
      "args": ["<repo>/mcp/start.mjs"],
      "env": { "IKO_STUDIO_URL": "http://192.168.1.46:3000" }
    }
  }
}
```

On Windows, write the path with forward slashes or doubled
backslashes. Then ask for a scene, for example: _"Two figures facing
each other under Rembrandt light; the first waves, walks two steps
toward the other and sits down. Give me the link."_

To try it by hand, `npx @modelcontextprotocol/inspector node mcp/start.mjs`
opens the MCP Inspector in a browser.

## How it works

- `mcp/start.mjs` starts the server from any folder. It runs the
  TypeScript with `tsx`, using the repo's tsconfig for the `@/` imports.
- `mcp/server.ts` speaks MCP over stdio. stdout carries the protocol,
  and the server's own messages go to stderr.
- `mcp/session.ts` holds one scene per server process, with the
  studio's undo history (`lib/studio/history.ts`). A batch of actions
  is checked in full before any of it is applied.
- `mcp/tools.ts` defines the tools, independent of the MCP library.
  Inputs are zod schemas, and `act`'s schema is generated from
  `SceneActionSchema`, so a new studio action becomes a tool input
  without extra work.
- `mcp/describe.ts` is the scene as short text, which a model reads
  more cheaply than JSON.

The scene lives as long as the server process. To keep it, take a
share link; `open_link` brings it back.

## What comes next

1. **Live view.** The open studio follows the server's scene as it
   changes, so you can watch the AI direct and undo it in the studio.
2. **Making characters locally.** Local services on a GPU that generate a
   character from words or a photo (open models such as TRELLIS or
   TripoSG) and rig it (UniRig). Each character is checked and slimmed
   by the cast pipeline (`scripts/meshy/optimize-cast.mjs`), and Meshy
   remains a fallback. Each model's licence is checked before it is
   used.
3. **Generated motion.** A text-to-motion model (MoMask, MDM) for
   moves the library doesn't have, written as ordinary keys.
4. **Rendering from the server.** Images and video made without a
   browser open.
