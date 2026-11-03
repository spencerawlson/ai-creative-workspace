# Architecture

Status: 2026-11-02. Sections marked **Built** exist in this repo and are
tested. Sections marked **Designed** are plans only; there is no code
for them yet.

## 1. Layers (Built)

```
app/                    Next.js routes (/ = Lighting Studio, /photography)
components/studio/      Editor UI: toolbar, tool rail, panels, inspector,
                        dialogs, viewport host, useStudio state hook
components/LightingScene.tsx
                        Compatibility wrapper (M1–M3 props API) used by
                        /photography; renders through the same engine
lib/studio/             Framework-free scene model (pure TS, unit-tested)
  schema.ts             zod SceneDoc + numeric limits. The one validator.
  actions.ts            SceneAction union, reducer, labels, coalescing
  history.ts            Undo/redo over SceneDocs
  presets.ts            Lighting, material, backdrop presets; defaults
  figures.ts            Figure helpers: lookup, labels, ids, free spots
  animation.ts          Keyframes: snapshot, upsert, evaluate (easing,
                        short-way angles), per-channel get/set
  channels.ts           Animated values per figure/light/camera: labels,
                        ranges, rounding (graph editor)
  pose.ts               Mannequin joints, limits, pose presets, mirror
  share.ts              ?s= link codec v2 (reads M3 v1 links)
  persistence.ts        Local autosave + .lighting.json project files
lib/engine/StudioEngine.ts
                        Imperative Three.js renderer: render-on-demand,
                        handles/picking/drag, export, benchmark, disposal
lib/engine/posing.ts    Pose angles -> bone rotations; drag-to-pose
                        solver (damped least squares; unit-tested)
lib/lighting.ts         Six curated presets, Kelvin→RGB, light geometry
scripts/optimize-models.mjs
                        Source scans → rigged, compressed public/models/*.glb
scripts/rig-mannequin.mjs
                        Fits a skeleton to each scan and bakes skin weights
```

**Single mutation path.** All scene changes go through
`dispatch(SceneAction)`, whether they come from the inspector, keyboard,
viewport drags, preset buttons, project files, or a future AI
assistant. An action is checked against `SceneActionSchema`, applied by
a pure reducer, and the result is re-validated against `SceneSchema`.
An invalid action is rejected whole; nothing is half-applied. Undo/redo,
autosave and URL sync all come from that one path.

**Engine contract.** React owns the document; the engine only renders
it. Viewport gestures (select, drag a handle) are reported back as
callbacks and come back in as validated actions. The engine renders on
demand, caches models per URL, token-guards loads, and `dispose()`
frees every GPU resource it created.

**Posing.** The scans have no skeleton, so the model build fits one
(13 bones, world-aligned in the bind pose) and bakes smoothed skin
weights; see the header of `scripts/rig-mannequin.mjs`. A pose is plain
data in the scene (`pose.joints`, degrees relative to the A-pose) and
goes through the same actions, history, autosave and share links as
lighting. The engine turns angles into bone rotations
(`lib/engine/posing.ts`). Taps on the figure hit invisible per-bone
capsules, not the 481k-triangle skinned mesh, and select
`pose:<joint>`. In pose mode, dragging a body part or a joint circle
runs a small damped-least-squares solver over that joint's existing
angles, inside their limits; one drag is one undo step (a "gesture"
commit, sealed on release).

**Figures.** A scene holds 1–4 `figures` (model, x/z on the floor,
rotation, pose). Scenes saved with the older single top-level
`model` + `pose` upgrade on parse; a lone centred figure is shared with
the old link layout. The engine loads each GLB once as a template and
puts `SkeletonUtils` clones on stage, each with its own skeleton,
capsules and overlay but shared geometry and materials. Pose and model
actions carry an optional `figure` (omitted = the first). The UI keeps
an "active figure" that the mannequin and pose controls act on.

**Keyframes.** `scene.animation` holds a length and up to 60 keys. A
key is a snapshot at a time of what moves: each figure's place, turn
and joints, each light's settings, and optionally the camera placement
(orbit position and target, not otherwise saved) and focal length.
`evaluate(scene, t)` interpolates between the keys around `t` (smooth,
linear or step per key; wrapping angles go the short way) and is pure.
Moving the playhead is a history `showTime` command: it replaces what
moves in the current entry without adding an undo step, so unkeyed
edits are dropped, as in Maya. With auto-key on, `useStudio` tags each
commit with the current time; an edit that changes something keys
record is applied and keyed as one undo step. Playback runs in the
timeline component and draws each frame straight to the engine
(`ViewportHandle.preview`), not through React. Share links stay
frame-only: an animation doesn't fit in a URL.

## 2. Persistent workspace (Designed — not built)

What exists today is local only: autosave in `localStorage` and
downloadable project files. Accounts are the next step, built as the
minimum below rather than everything at once.

**Stack:** Postgres (Neon or Supabase) behind Next.js route handlers;
Auth.js with email magic links plus OAuth; S3-compatible storage (R2 or
S3) for exported images and future uploaded assets.

```sql
users(id uuid pk, email citext unique, created_at)
projects(id uuid pk, owner_id uuid fk users, studio text, name text,
         scene jsonb not null, scene_version int, updated_at, deleted_at)
project_revisions(id bigserial pk, project_id fk, scene jsonb,
                  label text, created_at)      -- history, capped per project
assets(id uuid pk, owner_id fk, project_id fk null, kind text,
       storage_key text, bytes int, sha256 text, created_at)
ai_usage(id bigserial pk, user_id fk, feature text, input_tokens int,
         output_tokens int, cost_micros bigint, created_at)
```

- **Ownership:** every query is scoped by `owner_id = session.user.id`
  in the data layer, not in individual routes. If Supabase is chosen,
  add Postgres RLS as a second line of defence.
- **Validation:** the server parses `scene` with the same
  `SceneSchema` from `lib/studio/schema.ts` before writing. The client
  is never trusted.
- **Autosave:** debounced `PUT /api/projects/:id` with an
  `If-Match: <updated_at>` header. A conflict returns 409 and the UI
  offers "keep mine / take theirs". A revision is written on explicit
  save and at most every 5 minutes during autosave.
- **Assets:** the server issues presigned PUT URLs with a size limit,
  content type, and a per-user key prefix. Buckets are private;
  reads go through short-lived signed GETs.
- **Templates:** projects with `owner_id = null` and `is_template`,
  readable by everyone and copied on use.

## 3. AI Lighting Assistant & Mentor (Designed — not built)

The rule: **the model proposes, the app disposes.**

1. The client sends `{ projectId, message, scene }` to
   `POST /api/ai/lighting`. The provider key lives only in server env.
2. The server checks the session, a rate limit (per user, e.g. 20 per
   10 min, in Postgres or Upstash), a monthly token budget from
   `ai_usage`, and input size. It then calls the model with tool
   definitions generated from `SceneActionSchema`, and only those
   (`applyPreset`, `updateLight`, `addLight`, ...). There's no free-form
   code, URLs, or other tools.
3. The server validates each returned action with `SceneActionSchema`
   and dry-runs it with `applyAction` against the submitted scene.
   Invalid actions are dropped and reported. It records usage.
4. The client shows the proposal with `describeAction` labels
   ("Key: direction, height"), plus a live preview from rendering the
   dry-run scene. **Apply** dispatches the actions as one undoable
   history entry; **Discard** does nothing.
5. The Mentor uses the same endpoint in a read-only mode with no tools.
   It explains the current setup and grounds its answers in the curated
   preset notes.

Failure handling: timeouts and provider errors return a typed error,
which the UI shows. The scene is never touched on failure.

## 4. Multi-studio (Designed — partly in place)

Already reusable: `StudioEngine` (Photography uses it today),
`history.ts`, the persistence and share patterns, and the UI primitives
in `components/studio/ui.tsx`.

The interfaces to extract when the second studio needs them, and not
before:

```ts
interface StudioDefinition<Doc, Action> {
  id: "lighting" | "photography" | "character" | ...;
  schema: ZodType<Doc>;           // document validation
  actionSchema: ZodType<Action>;  // also the AI tool surface
  reduce(doc: Doc, a: Action): Result<Doc>;
  describe(doc: Doc, a: Action): string;
  defaultDoc(): Doc;
  encodeShare?(doc: Doc): string; decodeShare?(s: string): Doc | null;
}
```

`projects.studio` plus `scene_version` let each studio migrate its own
documents. Order of work: Lighting goes to production first, then
Photography moves onto `SceneDoc` (camera presets as actions), then
Character Design.
