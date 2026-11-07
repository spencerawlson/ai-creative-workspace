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
  motions.ts            Built-in poses and moves; floor contact, travel
  motionSearch.ts       Typed search: stems, synonyms, typos, options
  share.ts              ?s= link codec v2 (reads M3 v1 links)
  persistence.ts        Local autosave + .lighting.json project files
lib/engine/StudioEngine.ts
                        Imperative Three.js renderer: render-on-demand,
                        handles/picking/drag, export, benchmark, disposal
lib/engine/posing.ts    Pose angles -> bone rotations; drag-to-pose
                        solver (damped least squares; unit-tested)
lib/engine/humanoid.ts  Standard humanoid skeleton: matches any rig's
                        bones by name or VRM map, per-bone corrections
lib/studio/characters.ts
                        Imported characters (GLB/VRM) kept on the device
                        in IndexedDB; file checks
scripts/make-test-character.mjs
                        Builds tests/fixtures/test-character.glb from code
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
(45 bones: body, feet, thumbs and three per finger; world-aligned in
the bind pose) and bakes smoothed skin
weights; see the header of `scripts/rig-mannequin.mjs`. A pose is plain
data in the scene (`pose.joints`, degrees relative to the A-pose) and
goes through the same actions, history, autosave and share links as
lighting. The engine turns angles into bone rotations
(`lib/engine/posing.ts`). Taps on the figure hit invisible per-bone
capsules, not the 481k-triangle skinned mesh, and select
`pose:<joint>`. Some of the scan's fingers are fused, so the rig finds
the thumb as the piece that separates from the hand first and cuts the
four fingers at the webs between fingertips, seen in the palm's plane;
`rig.palm` in the GLB gives each hand's frame (palm normal, thumb
direction) for the finger rotations. Version 1 GLBs (13 bones) still
pose, without feet and fingers; model URLs carry `?v=` so browsers
fetch rebuilt rigs. In pose mode, dragging a body part or a joint circle
runs a small damped-least-squares solver over that joint's existing
angles, inside their limits; one drag is one undo step (a "gesture"
commit, sealed on release).

**Standard skeleton.** Poses and moves are defined once, on the
mannequin, so they can drive any human character
(`lib/engine/humanoid.ts`). A skeleton's bones are matched to the
mannequin's joints by name (the mannequin's own, VRM/VRoid, Mixamo,
Blender Rigify/MPFB and Unreal styles; fingers numbered from the hand
outwards). Each matched bone gets a fixed correction from its rest
pose, `bone.quaternion = pre · q · post`, where q is the mannequin's
rotation for that joint: `post` lines the bone's rest frame up with the
mannequin's (a T-pose arm is first turned onto the A-pose arm), `pre`
undoes the same for its real parent. Parents cancel, so each joint is
independent and drags still set one joint at a time. Bones with no
joint (chest, collarbones, head, toes) keep their rest rotation. The
mannequin's own corrections are identity and the engine skips them.
`HUMANOID_NAME` gives each joint's standard (VRM 1.0) bone name, for
import and export. The unit tests pose a T-pose, Mixamo-named skeleton
with random rest rotations and extra bones, and check every joint lands
where the mannequin's does.

**Characters.** A figure can show an imported character
(`figure.character`, an id) instead of its mannequin; `model` stays as
the stand-in wherever the character's file isn't available. Files are
GLB or VRM, checked (`lib/studio/characters.ts`) and kept in IndexedDB
on the device, never uploaded; the page shows them through object URLs
(`useCharacters`), which the engine loads like a mannequin. The engine
finds the skeleton from the VRM bone map or by bone names, turns the
character to face +Z (VRM 0.x faces -Z), keeps its own materials,
measures limb ends from end bones (or extends the last bone) and the
palms from the knuckles, and poses it through the reference directions
(`referenceDirections`, the male scan's averaged left and right) and
per-bone corrections. Each bone's alignment starts from its parent's
and swings the least that lines up its own direction; a hand also
lines up its palm, so palms-down T-poses curl their fingers the right
way. Tap capsules, joint dots and bone lines are placed in each bone's
own frame. A file with no human skeleton, or one that won't load,
reports why and its figures show the mannequin. Share links carry the
character ids (`ch`), so a reload on the same device keeps them and
anyone else sees the mannequin in the same pose.

**Rendering.** Two paths (`lib/engine/post.ts`). Fast is the plain
`renderer.render`. When the device's quality is High (ambient
occlusion) or the scene's lens look is on (`camera.aperture` f-stop,
`bloom`, `vignette`, `grain`), frames go through an `EffectComposer`:
4× MSAA half-float render, GTAO, Bokeh depth of field focused on the
active figure's head, UnrealBloom, `OutputPass` (tone mapping), then a
vignette/grain pass; effects that are off are skipped. Editing overlays
(light handles, joint dots, bone lines) are on layer 1 and drawn after
the composite, plain; a depth-only pass first keeps handles behind the
figure hidden. The composite tone-maps the backdrop colour too, so it
clears to `untoneMap(colour)` (`lib/engine/tonemap.ts`, three's ACES,
AgX and Neutral curves inverted by Newton's method) and looks the same
on both paths. Shadow maps update once per frame, not per effect.
Transparent PNG exports take the plain path. Quality is a device
preference (`useRenderQuality`, localStorage), not part of the scene;
if the effects can't be set up, the plain path stands in.

**Faces.** The pose has four face "joints" after the body's
(`FACE_JOINT_IDS`: eyes turn/raise in degrees; expression, eyelids and
mouth in percent), so keys, easing, the graph editor, undo and links
handle them like any other; old poses load with a neutral face. They
drive no standard-skeleton bone (`BODY_JOINT_IDS` do), and body pose
presets and moves keep the current face (`keepFace`).
`lib/engine/face.ts` maps them onto a character: expressions from the
VRM file's own definitions (1.0 `expressions`, 0.x
`blendShapeMaster`, whose binds name a mesh), else by face-shape name
(VRoid `Fcl_*`, ARKit, VRChat/Oculus visemes, plain names), as weighted
morph-target binds; blink falls back to both winks. Eye bones come from
the VRM humanoid or by name under the neck, and turn as
`pre · look · post` in the figure's frame, so they follow the head.
Without eye bones, VRM look shapes stand in. The inspector shows only
the controls a character's file has (`onCharacterFace`); the mannequin
has no face, and says so.

**Pose from a photo.** Pose › From photo finds the body on the device
with MediaPipe Pose Landmarker (Apache-2.0, `@mediapipe/tasks-vision`
pinned): its WebAssembly runtime is copied from `node_modules` into
`public/mediapipe/wasm` before `dev` and `build`
(`scripts/copy-mediapipe.mjs`, git-ignored); the model
(`pose_landmarker_full.task`, 9.4 MB) is committed. Nothing loads from
another origin (the CSP allows none) and the photo is never uploaded.
`components/studio/poseDetector.ts` loads it on first use (CPU
delegate, so no second WebGL context) and returns 33 landmarks, both
3D (metres) and on the image. `lib/engine/photoPose.ts` turns them into
joint angles: each body part's direction in the hips' frame (limbs
take their direction across the photo from the image and only length
and depth sign from 3D; the trunk and head use the 3D points), then a
Levenberg–Marquardt fit per chain (torso, head, each arm with wrist,
each leg with ankle) through the same `jointQuaternion` as posing,
within joint limits, from several starts. Two corrections came from
measurement: MediaPipe's landmarks sit on the body's surface, so parts
are lined up with how it _sees_ the mannequin at rest (`SEEN`, renders
with a level camera), applied to each figure's own rig; and depth
counts for a quarter of across-the-photo, with a soft penalty on an
arm swung forward over the top (raised arms read that way from the
front). Parts it can't see clearly keep their angles; fingers and the
face are never changed. The dialog draws what was found over the
photo before one undoable `updateJoints`. Regression data:
`tests/fixtures/photo-landmarks.json` (MediaPipe output for
public-domain photos and mannequin renders; landmarks only).

**3D file export.** Export › 3D file writes a glTF binary with three's
`GLTFExporter` (`lib/engine/gltfExport.ts`, loaded on demand). Each
figure is cloned with its skeleton (`SkeletonUtils.clone`) at its world
place; the studio's helpers under its bones (`pose-dot`,
`pose-dot-ring`, `pose-pick`) are removed, and the clone's geometry is
copied to plain float attributes, so no `KHR_mesh_quantization` is
needed (the meshopt-compressed models load quantized). With the
animation, `StudioEngine.exportGltf` passes a `seek` that runs
`evaluate` and `update`, the same path as playback, and every bone,
figure root and face mesh is sampled at `EXPORT_FPS` (30), the live
objects paired with their clones by traversal order; tracks whose
values never change are dropped, and the scene is restored afterwards.
The camera (animated if keyed) and the directional, spot and point
lights (`KHR_lights_punctual`, aimed down −z with the target as a
child) are optional; area lights have no glTF form and are counted
out. Tested with Khronos's `gltf-validator` (unit and E2E).

**Lip sync.** `lib/studio/lipSync.ts` reads a sound on the device
(Web Audio decodes it; nothing is uploaded) into `SPEECH_FPS` (20)
frames of the five mouth shapes. It mixes to mono, low-passes and
decimates to about 11 kHz, then per 30 ms window: loudness, relative to
the recording's own quiet (10th percentile + 6 dB, at most 40 dB under
its loud 95th) and loud parts, sets how open the mouth is; hisses
(many zero crossings) and formants no vowel has count as consonants,
about a third as open; and on vowels the first two formants, peaks of
an order-10 LPC envelope (pre-emphasis 0.8, a 30 Hz lag window against
high voices' harmonics), are compared with each vowel's on a log scale,
after scaling the references to the speaker (median formants, clamped
0.85–1.3). The mouth opens fast and closes a little slower. Settings
were chosen against a formant synthesiser (unit tests) and checked on
two Windows voices: 8 of 10 test words each got the right shape; the
rounded U and O are the usual mix-up. A track (`scene.speech`:
figure, start, name, sound id, mouth as base64) is laid over what's
shown by `withSpeech` (the viewport at the playhead, playback, video,
glTF), never written into the figure, so keyframes keep their own
mouth. The sound is kept in IndexedDB (`lib/studio/sounds.ts`, 24 at
most, oldest dropped) and played with the timeline
(`components/studio/speechAudio.ts`); videos take a mix of them.
Share links carry the mouth and the sound's id, not the sound.

**Figures.** A scene holds 1–4 `figures` (model, x/z on the floor, y
up/down, rotation, pose). Scenes saved with the older single top-level
`model` + `pose` upgrade on parse; a lone centred figure is shared with
the old link layout. The engine loads each GLB once as a template and
puts `SkeletonUtils` clones on stage, each with its own skeleton,
capsules and overlay but shared geometry and materials. Pose and model
actions carry an optional `figure` (omitted = the first). The UI keeps
an "active figure" that the mannequin and pose controls act on.

**Keyframes.** `scene.animation` holds a length and up to 120 keys. A
key is a snapshot at a time of what moves: each figure's place, turn
and joints, each light's settings, and optionally the camera placement
(orbit position and target, not otherwise saved) and focal length.
`evaluate(scene, t)` interpolates between the keys around `t` (smooth,
linear, step or spline per key; wrapping angles go the short way) and
is pure. Spline keys take their slope from the neighbouring keys that
record the same value (monotone, Fritsch–Carlson), so a curve passes
smoothly through each key without overshooting it.
Moving the playhead is a history `showTime` command: it replaces what
moves in the current entry without adding an undo step, so unkeyed
edits are dropped, as in Maya. With auto-key on, `useStudio` tags each
commit with the current time; an edit that changes something keys
record is applied and keyed as one undo step. Playback runs in the
timeline component and draws each frame straight to the engine
(`ViewportHandle.preview`), not through React. Each value follows its
own cubic Hermite curve between keys; with no graph-editor tangents
that is exactly the key's ease, and every result is clamped to the
channel's range.

**Motion library.** `lib/studio/motions.ts` is plain data: each pose
or move lists, per frame, only the joints that differ from a relaxed
stance; one-sided ones are written for the right and mirrored.
`planMotion` lays a move out from a figure's placement: cycles,
whole-stride travel along its facing direction (fewer cycles, or on
the spot, when the room ends; it stops 1.5 m in front of centre, short
of the camera), and a `y` from a two-segment leg model so the lowest
foot, knee or seat touches the floor. The `applyMotion` action writes
the frames as spline keys on that one figure over the move's span,
replacing only that figure's keys there; a pose is an ordinary edit
(auto-key keys it). `motionSearch.ts` normalises and stems what is
typed, matches names and other words (prefix for the word being
typed; edit distance only when nothing matches exactly) and turns
"left", "N times", "slowly", "in place", "backwards" into options.

**Animated links.** A link for a scene with keys holds the animation
too, as positional rows, deflate-raw compressed with the browser's
`CompressionStream` and prefixed `z`. Links stay under 8,000 characters
(servers refuse long request lines); longer animations are shared as
their frame. Decoding stops past 256 KB inflated and ends in full
schema validation, like every link.

**Video export.** `components/studio/recordVideo.ts` puts the engine in
capture mode (fixed canvas size, handles hidden, render loop paused),
evaluates each frame and encodes it with WebCodecs at an exact
timestamp; mediabunny (MPL-2.0, loaded on demand) writes MP4 (H.264)
or WebM (VP9/VP8), whichever the browser can really encode.
MediaRecorder was tried first and dropped frames while its encoder
started up.

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
