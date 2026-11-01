# AI Creative Workspace — Category Roadmap

Status: roadmap + Photography M1 built, Character Design scoped only.
Nothing here claims a category is built before it is.

## Caveat, stated plainly

The real-iPhone M4 test of Lighting Studio has **not been run yet**
(see `docs/M4-test-plan.md`). SCOPE.md said Phase 2 starts only if the
pilot passes. Phase 2 work below is starting **before** that pilot-pass
evidence exists, at Spencer's direction ("All 3" — roadmap, Photography
next, Character Design scope). That does not make the pilot passed.
If the M4 test fails a success criterion — load, unaided demo, share
link, smoothness — fixing that failure outranks starting the next
category, because every category after Photography reuses the same
scene, and a scene problem compounds with each reuse.

This roadmap also supersedes one line in SCOPE.md: SCOPE.md's Phase 2
note said character design would be the one next category. Spencer's
later direction puts Photography & Cinematography next and Character
Design second. The order below follows the later direction.

## Ground rules for every category

- One wedge at a time, in the same brick pattern as Lighting Studio:
  M1 (one real tool, working on a phone), M2 (controls + presets),
  M3 (polish + share), M4 (real-iPhone test).
- A go/no-go gate after each category: real-phone test, then decide
  whether the next category starts. A category is not "done" because
  its code builds; it is done when a non-artist can use it unaided
  on a phone.
- 8 categories = 8 products. This roadmap does not promise all 8 at
  once, and it does not promise a date for the last one. Each entry
  below is a wedge, not a full product.
- Shared constraints, unchanged from the pilot: mobile-first, no
  accounts/Supabase, no AI chat, no monetization, $0 running cost,
  curated notes written once (no LLM technique), no fake simulation
  claims. A tool that teaches must say what it is actually doing.
- Shared assets: the same Three.js scene and the same male/female
  Meshy GLBs (12 MB + 6.8 MB) wherever a category uses a figure. No
  category duplicates the GLBs or rebuilds a second scene.

## The order, one line each

1. **Lighting Studio — DONE (M1–M3 built, M4 plan written, test not
   run).** One page, one mannequin, 3 movable lights, 6 presets,
   URL share links.
2. **Photography & Cinematography — NEXT, M1 built in this brick.**
   Camera, composition, and exposure taught on the same 3D scene.
3. **Character Design — SECOND, scoped only in this brick, no code.**
   A standalone character-building tool, not a scene extension.
4. **Illustration & Painting — not started.** Draw and paint what
   you designed, in 2D, with the same teach-first notes.
5. **3D Modeling & Sculpting — not started.** Shape a figure in 3D,
   from the mannequin outward.
6. **Animation & Storytelling — not started.** Move a figure and
   tell a beat, once a figure exists to move.
7. **Graphic Design & Branding — not started.** Type, layout, and a
   mark, for the work the earlier categories produced.
8. **Creative Idea Development — not started.** Prompts and
   exercises that generate ideas, not finished work — the mentor
   layer, built last because it should point at real tools.

## 1. Lighting Studio — done, test outstanding

Wedge: one page, one mannequin, lights you can move. M1 scene +
mannequin + orbit, M2 three lights + six presets, M3 mobile polish +
URL share links, M4 real-iPhone test plan written.

Reuses: nothing before it — it is the foundation.
Genuinely new: the Three.js scene, the light model, the preset
notes, the share encoding.

Gate: M4 on a real iPhone (demo unaided, Rembrandt in under
2 minutes, share link opens the same setup on a second phone,
smooth orbit). **Not yet run.** Until it passes, this category is
built, not proven.

## 2. Photography & Cinematography — next, M1 built

Wedge: the camera, taught on the figure you already light. Where
Lighting Studio asks "where does the light fall?", this asks "where
do you stand, what do you frame, and how bright is the picture?" It
is the natural next lesson after lighting, because the same setup
looks like a different photograph when the camera moves.

Reuses: the entire Lighting Studio scene, both mannequins, the
light presets, and the bottom-sheet mobile UI pattern. No new GLBs,
no second scene.

Genuinely new in M1: framing presets (Wide / Portrait / Close-up),
a focal-length control (24–85 mm, mapped to field of view), a
toggleable rule-of-thirds overlay, and exposure taught as the
aperture / ISO / shutter triangle, with plain-language notes. The
exposure control brightens or darkens the preview; it is **not** a
real camera sensor simulation, and the page says so. No photo
export is claimed in M1: a scene capture, if added later, must be
labelled as a scene capture, not a photograph.

Milestones (same pattern): M1 scene + camera wedge (this brick);
M2 more camera controls + framing presets + curated notes; M3
polish + share (camera setup in the link, alongside lights);
M4 real-iPhone test.

Gate: a non-artist frames a portrait, a wide shot, and a close-up
unaided on a phone, and can say in plain language what changing
aperture, ISO, or shutter does to brightness. If the M4 Lighting
test has failed by then, that failure is fixed first.

## 3. Character Design — second, scoped only

Wedge: build a character, not just light one. Where Lighting and
Photography work on a finished figure, Character Design asks who
the figure is: proportions, silhouette, posture, and the few
features that make a figure read as a person rather than a
mannequin. Full scope in `docs/character-design-scope.md`.

Why second, not first: it is a second standalone tool, not a scene
extension. Photography extends the existing scene in one step —
same figure, new question. Character Design needs its own
questions, its own controls, and its own test, and building it
first would have meant two unfinished tools instead of one proven
wedge plus one extension. It comes second so the platform has one
extension that proves reuse, then one tool that proves it can stand
alone.

Reuses: the mannequins as starting figures, the lighting scene as
a viewer, the preset-note pattern.
Genuinely new: character controls (proportions, posture, features),
character presets, and its own notes. No code in this brick.

Gate: a non-artist builds two visibly different characters from
the same starting figure, unaided, on a phone. See the scope doc
for its M1/M2/M3 and its own gate.

## 4. Illustration & Painting — not started

Wedge: draw and paint in 2D, with the same teach-first discipline.
A blank canvas plus a small set of brushes and a colour discipline,
where every tool ships with a short note on what it is for — not a
full painting app, and not a generator that finishes the drawing.

Reuses: the character and lighting work as reference (a figure to
draw from), the preset-note pattern, the mobile bottom-sheet UI.
Genuinely new: a 2D canvas, brushes, layers in the simplest useful
form, and colour controls.

Gate: a non-artist completes a simple illustration unaided on a
phone and can name what each brush was for.

## 5. 3D Modeling & Sculpting — not started

Wedge: shape a figure in 3D, starting from the mannequin and
pushing/pulling form, rather than importing a finished model.
This is the hardest category on a phone, so its wedge must be
small: a few sculpting moves that visibly change the figure, not
a desktop modeller squeezed onto a screen.

Reuses: the mannequin, the Three.js scene, the orbit/zoom controls.
Genuinely new: sculpting interaction (touch-driven form changes),
undo, and a way to keep the result.

Gate: a non-artist changes a figure's proportions or silhouette
visibly, unaided, without breaking the figure.

## 6. Animation & Storytelling — not started

Wedge: move a figure and tell one beat. A short pose sequence —
not a full animation suite — where a character moves from one pose
to another and the result reads as an action or a feeling. It
comes after Character Design and 3D Modeling because it needs a
figure worth moving.

Reuses: the figure, the scene, the camera from Photography.
Genuinely new: pose keyframes in their simplest form, playback,
and story-beat notes (what a beat is, why a hold matters).

Gate: a non-artist makes a figure perform one readable action
unaided on a phone.

## 7. Graphic Design & Branding — not started

Wedge: type, layout, and a mark for the work the earlier categories
produced. A poster or a cover built from a figure, a title, and a
small set of layout rules — not a desktop design suite.

Reuses: figures and images from earlier categories as content,
the note pattern.
Genuinely new: type controls, layout grids, colour rules, and
export of a layout (labelled as a layout, not as a print file
until print is actually supported).

Gate: a non-artist lays out a readable poster unaided on a phone.

## 8. Creative Idea Development — not started

Wedge: prompts and exercises that generate ideas, not finished
work. This is the mentor layer from the original master prompt,
built last on purpose: it should point at the real tools above
("light this character", "frame this scene") instead of giving
generic advice in a vacuum.

Reuses: everything — every exercise ends in a real tool.
Genuinely new: exercise sets, a simple way to keep an idea, and
the curated mentor notes (still written once, still no LLM chat
in the wedge).

Gate: a non-artist starts from an exercise and ends with a piece
of work in another category, unaided, on a phone. If the exercises
do not lead to work, the category has failed its own premise.

## What is NOT in this roadmap

Accounts, Supabase, workspace, projects, saved ideas, learning
progress, AI Mentor chat, model import, collaboration, feeds,
monetization — all remain out of scope until a category passes its
gate and Spencer explicitly starts that phase. Nothing in this
roadmap re-opens them by implication.
