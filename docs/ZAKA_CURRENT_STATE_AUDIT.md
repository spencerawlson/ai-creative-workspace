# Zaka 3D: current state audit (Phase 0)

What the app is today, verified against the code and its tests, before
the redesign in `Zaka_Studio_3D_Design_Specification.md` (the
"spec"). The product name is **Zaka 3D**: where the spec says "Zaka
Studio 3D", read Zaka 3D.

- Repository: `spencerawlson/ai-creative-workspace`, branch `main` at
  `e1f6ef5` (18 Nov 2026), deployed at the same commit.
- Companion: [ZAKA_CAPABILITY_MATRIX.md](ZAKA_CAPABILITY_MATRIX.md)
  classifies every command in the spec's menus.

## 1. Stack

| Layer                         | What                                                                             | Licence                                      |
| ----------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------- |
| App                           | Next.js 15 (App Router), React 19, TypeScript 5.6, Tailwind 3                    | MIT                                          |
| 3D                            | three.js r170 (WebGL 2), three-mesh-bvh (fast raycasts)                          | MIT                                          |
| Data                          | zod 4 schemas for every document and link                                        | MIT                                          |
| Video                         | mediabunny (MP4/H.264 or WebM/VP9 in the browser)                                | MPL-2.0 (used unmodified, as a library)      |
| Pose from photo               | MediaPipe Pose Landmarker, on the device                                         | Apache-2.0                                   |
| Model tools (scripts, server) | glTF-Transform, meshoptimizer                                                    | MIT                                          |
| AI control                    | Model Context Protocol server (`mcp/`)                                           | MIT (SDK)                                    |
| Blender                       | Optional, an external program the server runs on files (`lib/server/blender.ts`) | GPL; not linked, bundled or shipped (see §7) |

Everything renders in the browser. The server is a Next.js app with
three optional routes (`/api/blender`, `/api/blender/[job]`,
`/api/rig`); they're off unless `IKO_BLENDER` / `IKO_AUTORIG` are set.

## 2. Workspaces (pages)

| Page           | What it is                                                                                                                                            | Main code                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `/studio`      | Lighting, posing and animation stage: camera, up to 8 lights, up to 4 figures (mannequins, cast, imported characters, creatures), backdrop, keyframes | `components/studio/*`, `lib/studio/*`, `lib/engine/StudioEngine.ts` |
| `/sculpt`      | Digital clay: a welded triangle mesh shaped by brushes, painted, masked; kept on the device                                                           | `components/sculpt/SculptStudio.tsx`, `lib/sculpt/*`                |
| `/photography` | Teaching page: framing, lenses, exposure on the studio's renderer                                                                                     | `app/photography/page.tsx`, `lib/photography.ts`                    |
| `/`            | Landing page                                                                                                                                          | `app/page.tsx`                                                      |

## 3. Scene model and storage

**Studio scene document** (`lib/studio/schema.ts`, `SceneSchema`,
`version: 2`). It is a _fixed stage_, not an open scene graph:

- `camera` (position, target, focal length), `lights[]` (≤ 8; key,
  fill, rim, …; intensity, colour temperature, position on a sphere),
  `figures[]` (≤ 4; model or character or creature, pose as joint
  angles, position, rotation, plinth), `backdrop`, `material`,
  `shadows`, `animation` (keyframes over figures, lights, camera, with
  eases and tangents), `speech` (lip-sync tracks), `beats`.
- Changed only through actions (`lib/studio/actions.ts`, about 40
  action types), with undo/redo (`lib/studio/history.ts`).
- Saved: autosave in localStorage (`acw.lighting.autosave.v2`),
  project files as JSON (`ai-creative-workspace/lighting-project`,
  ≤ 256 KB, `lib/studio/persistence.ts`), share links (`?s=`, version 2
  codec, `lib/studio/share.ts`).
- **There are no free objects**: no primitives, meshes, groups or
  parent/child hierarchy. Figures, lights and the camera are the only
  things in a scene.

**Sculpt document** (`lib/sculpt/*`): one welded triangle mesh with
per-vertex colour and mask, undo per stroke, stored in IndexedDB
(`iko3d-sculpts`).

**Device libraries** (IndexedDB): imported characters (`.glb`, `.vrm`),
creatures auto-rigged on the server, sounds for lip sync.

## 4. Verified capabilities

Evidence: the automated tests named (CI runs all of them on every PR)
and the deploy smoke checks.

| Area         | Works today                                                                                                                                                      | Evidence                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Lighting     | 6 presets, add/remove/duplicate lights, temperature, drag handles                                                                                                | `tests/e2e/studio.spec.ts`, `tests/unit/studio-*`                                               |
| Figures      | Mannequins, 4 cast characters, imported GLB/VRM characters, 12+ creatures with walk cycles                                                                       | e2e "characters", `tests/unit/studio-cast.test.ts`, `engine-creature-walk.test.ts`              |
| Posing       | Joint angles, drag-to-pose (IK reach), mirror, pose library, typed motion search, pose from a photo                                                              | `engine-drag.test.ts`, `engine-photo-pose.test.ts`, `studio-motions.test.ts`                    |
| Animation    | Keyframes, timeline, eases, graph editor with tangents, beats, preview, lip sync                                                                                 | `studio-animation*.test.ts`, e2e timeline/graph tests                                           |
| Precision    | Floor grid to the horizon, snapping, units (m/cm/ft), measuring tool                                                                                             | e2e "View menu", "measure a distance"                                                           |
| Export       | PNG/JPEG stills, MP4/WebM video, GLB (scene, with animation), STL statues (mm, Z up)                                                                             | `engine-gltf-export.test.ts` (validated by gltf-validator), `statues.test.ts`, e2e export tests |
| Sculpt       | 9 brushes (draw, clay, inflate, smooth, flatten, pinch, grab, paint, mask), X symmetry, pen pressure, undo, finishes, UV unwrap and texture bake, STL/GLB export | `tests/e2e/sculpt.spec.ts`, `sculpt-*.test.ts`                                                  |
| Rigging      | Auto-rig on the server: recognises human / quadruped / two-legged animal and rigs it (Blender weights or bone heat)                                              | `auto-rig.test.ts`, `rig-classify.test.ts`, `server-rig.test.ts`                                |
| Blender jobs | Retopology to quads, renders; FBX/USD only where the server's Blender can (probed)                                                                               | `blender-jobs.test.ts`, `mcp-blender.test.ts`                                                   |
| AI           | MCP server: an AI directs a scene through the studio's own actions                                                                                               | `mcp-server.test.ts`                                                                            |
| UI           | Menu bar with submenus, sections and tear-off panels; shortcuts with a list per workspace; phone, tablet, desktop layouts                                        | e2e "menus", "sculpt keys", nav and a11y suites (axe)                                           |

## 5. Baseline test run

| Check               | Result                                                           | Command / where                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format              | PASS                                                             | `npm run format:check`                                                                                                                                                                     |
| Lint                | PASS                                                             | `npm run lint`                                                                                                                                                                             |
| Types               | PASS                                                             | `npm run typecheck`                                                                                                                                                                        |
| Build               | PASS                                                             | `npm run build` (local and on the server)                                                                                                                                                  |
| Unit tests          | PASS on CI (Node 22, 46 files, about 400 tests); BLOCKED locally | `npm test`. On this PC (Node 24.14) every file fails to load with "Cannot read properties of undefined (reading 'config')", on `main` too; CI's Node 22 runs them.                         |
| E2E + accessibility | PASS on CI (desktop, tablet, phone)                              | `npm run test:e2e`. Locally, with the CPU busy, a few Studio tests time out (export, pose from a photo, workspace switching on tablet) and "render quality High" is flaky; all pass on CI. |
| Security audit      | PASS                                                             | `npm audit --omit=dev --audit-level=high` (dev-only tools carry GHSA-fc5q-39xc-vjpf, which has no fixed version)                                                                           |

## 6. Known problems

- Infant character tears in raised-arm poses; removed from the cast
  (#56) until the weights handle skin pressing on skin.
- Video export is slow on software rendering (about 2.5 min for 2 s at
  640×360 on this PC).
- The server's disk is 97% full (2 GB free); the Ubuntu Blender there
  can't export FBX/USD.
- Local unit tests need Node 22.

## 7. Licensing notes

- All runtime dependencies are permissive (MIT, ISC, Apache-2.0) except
  mediabunny (MPL-2.0: fine to use unmodified; changes to its own files
  would have to be published).
- Blender (GPL-2.0-or-later) is used only as a separate program, run on
  files by the server when an administrator installs it and opts in. No
  Blender code is linked, bundled or shipped, so the GPL doesn't reach
  Zaka 3D's code. Embedding Blender, linking its libraries or shipping
  it with the app would change that and needs a licence review first.

## 8. What this means for the spec

- The spec's Create, Select, Modify and Mesh menus assume an open scene
  graph of objects. The Studio has none today, so **a scene graph is
  the first dependency** (Phase 2 priority 1): objects with transforms,
  parents and meshes in the scene document (a version 3 schema that
  migrates version 2 files, links and autosaves).
- Mesh editing exists only as sculpting, in its own workspace with its
  own mesh. Component editing (vertices, edges, faces) is missing.
- Rendering is real-time WebGL (raster, plus a "High" post-processing
  path); Blender renders exist as a server job. There is no path tracer
  in the browser.
- Workspaces exist as pages, not as saved layouts of dockable panels.
