# Character Design — Scope (no build yet)

Status: scoped only, NO code in this brick. Spencer approves the
direction before any Character Design code is written. This is a
standalone tool, not a Lighting Studio extension.

## The wedge, in one paragraph

Build a character, not just light one. Start from a mannequin and
change the few things that make a figure read as a person: overall
proportions (tall, short, broad, slight), silhouette (the shape
the figure makes against the background), posture (standing,
leaning, confident, tired), and a small set of readable features
(head shape, brow, jaw — the same features that make a lighting
setup read on a face). The tool teaches character the way Lighting
Studio teaches light: one control at a time, a short curated note
per choice, and a result you can see immediately on the figure.

## What it is not

- Not a character generator that finishes a character for you.
  The user makes the choices; the tool shows them.
- Not a 3D modeller. It does not sculpt arbitrary geometry — that
  is the later 3D Modeling & Sculpting category.
- Not a Lighting Studio panel. Lighting controls stay in Lighting
  Studio; this tool has its own page, its own controls, and its own
  test. Sharing a character, if added, is its own share format —
  it must not silently change the lighting share format.
- Not an AI chat. Notes are written once, curated, and stored in
  code — the same discipline as the lighting preset notes.

## What it reuses vs what is new

Reuses:

- The mannequins as starting figures (male and female Meshy GLBs,
  already in `public/`, not duplicated).
- The Three.js scene and orbit/zoom controls as a viewer.
- The lighting scene as a viewer option: a character should be
  viewable under a lighting preset, so the user can check that
  their character still reads in shadow — but lighting controls
  themselves are not rebuilt here.
- The mobile pattern: preset chips on top, bottom-sheet controls,
  large touch targets, no horizontal scroll, curated notes under
  the canvas.

Genuinely new:

- Character state: proportions, silhouette, posture, and feature
  choices, as data — not as free-form mesh editing.
- Character presets: a small set of readable starting characters
  (for example: hero, elder, trickster — final names and values
  to confirm with Spencer before M1, not invented as final here).
- The hard technical question, stated before any code: can the
  Meshy GLBs be adjusted in those dimensions at runtime (bone or
  morph-style scaling of parts), or does a character change need a
  new model? M1 must answer this with a real test on the actual
  GLBs before committing to a control set. If the GLBs cannot be
  adjusted in a useful way, the honest M1 fallback is a
  proportion/silhouette/posture system on a parametric figure
  (the same kind of figure Lighting Studio started with), with
  the Meshy figures kept as reference — that decision is Spencer's,
  on evidence, not a guess in this doc.
- Character notes: short, curated, written once — what a
  proportion change does to how a character reads, what a posture
  says, what to watch for (for example: a silhouette that reads
  clearly at small size).

## Milestones (same pattern as Lighting Studio)

- M1 — One starting figure, a small set of character controls
  that visibly change it, orbit/zoom, and a note per control.
  First answer the GLB-adjustment question above, on the real
  models, before locking the control set. No presets yet, no
  share yet.
- M2 — Character presets (a small set, each visibly different),
  all controls, and curated notes per preset. A character that
  reads differently in silhouette, not just in a slider value.
- M3 — Mobile polish + share: a link that reproduces the same
  character on another phone (character state in the link, in the
  same spirit as the lighting share links — lights, if included,
  are a separate part of the link, not conflated with character).
- M4 — Real-iPhone test: a non-artist builds two visibly
  different characters from the same starting figure, unaided,
  on a phone, and can say what each choice changed about the
  character.

## Go / no-go gate

The category passes only if: a non-artist, handed a phone with no
explanation, builds two characters that look like different people
— not two slider tweaks of the same figure — and can say in plain
language what made them different. If M1 shows the GLBs cannot be
adjusted usefully, the gate also covers the fallback decision
(parametric figure vs new models) — that decision is made on the
M1 evidence, not deferred to M2.

## Open decisions (Spencer's, not assumed)

- The final character preset list and their values.
- The GLB-adjustment answer (see above) and, if needed, the
  parametric-figure fallback.
- Whether a character share link also carries a lighting setup,
  or character only.
- Whether Character Design shares a page with Lighting Studio or
  stays a separate page (this scope recommends separate, so each
  tool has its own test — but the navigation between them is
  Spencer's call).
- Nothing here authorises accounts, AI chat, monetization, or
  model import. Those remain out of scope.
