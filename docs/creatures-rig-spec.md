# I-K-O Creatures — Rig Spec

Rigged + walk-cycled versions of the 12 Meshy animal creatures, built
2026-11-15 in `assets/creatures/rigged/` and slimmed into
`public/creatures/` (see `creatures.json` for file sizes).

## Conventions (all species)

- **Coordinate frame:** Blender space, Z up. Figures face Blender **−Y**
  (= glTF +Z), figure's left is **+X**. Same convention as the human
  cast rig (`scripts/rig-mannequin.mjs`).
- **Bind pose:** all bones world-aligned with identity rotation
  (local X as close as possible to world +X, so a rotation about a
  bone's local X swings a limb forward/back).
- **Skin:** one mesh, one skin, top-4 vertex weights, joint-blended and
  neighbour-smoothed. Max visible-scale edge stretch on a 25° test
  rotation is listed per species below (≤ ~3 is clean; the lion
  reference is ~2–4; nothing above 6.1, and renders show no tearing).
- **Walk clip:** every GLB has exactly one animation, named **`"walk"`**,
  **24 frames @ 24 fps = 1.0 s**, frame 24 duplicates frame 0, so it
  loops seamlessly. Play it looped; the studio's walk command should
  just play the clip (no speed retiming needed — 1 s per stride for
  every species).
- **Slimming:** dedup → prune → quantize → meshopt (medium), same
  extensions as the human cast (`EXT_meshopt_compression`,
  `KHR_mesh_quantization`). Skeleton, skin and the `"walk"` clip are
  preserved and verified per file.
- **Standing height** is the `heightMeters` value in
  `public/creatures/creatures.json` (the height the engine scales the
  creature to). It is NOT the raw mesh height; keep it when wiring.

## Bone naming

Suffixes: `FL` front-left, `FR` front-right, `BL` back-left,
`BR` back-right, `L`/`R` left/right. `legX` = upper leg,
`legXLower` = lower leg, `footX` = foot. `armX` / `armXLower` /
`handX` for forelimbs on bipeds/rat. `wingX` / `wingXLower` for the
bird. `tail1`/`tail2` (`tail3` on the rat) run base → tip.
`trunk1`/`trunk2` are elephant-only.

## Quadrupeds — lion, tiger, cat, dog-standing, dog-side, hippo, rhino, elephant

Hierarchy:

```
root
└─ spine
   ├─ chest
   │  ├─ neck → head
   │  ├─ legFL → legFLLower → footFL
   │  └─ legFR → legFRLower → footFR
   ├─ legBL → legBLLower → footBL
   ├─ legBR → legBRLower → footBR
   ├─ tail1 → tail2
   └─ (elephant only) trunk1 → trunk2   (parent: head)
```

19 bones (21 for the elephant). Gait: **walk, diagonal pairs** —
FL + BR step together (phase 0.00), FR + BL half a cycle later
(phase 0.50). Upper leg swings ±22° (front) / ±20° (hind); lower
leg folds up to 26°/30°; foot counter-rotates; spine bobs 3° at 2×
frequency, head nods, tail sways.
**Elephant: lateral-sequence walk** — FL + BL together (0.00),
FR + BR together (0.50) (same-side legs step together), trunk
sways with the stride.

> 2026-11-15 walk fix: the original phase table used gait shorthand
> (FL 0.00, RH 0.25, RF 0.50, LH 0.75) — a 4-beat walk whose RH/RF/LH
> keys name no bone, so only legFL was ever keyed and the other three
> legs were frozen. The table now uses bone suffixes with diagonal-pair
> phases (see `rig_animals.py` PHASE_QUAD / PHASE_ELEPHANT); the
> biped/rat/bird branches were already correct (signed sampling proves
> L/R opposite phase) and were not changed.

| species      | height (m) | walk        | worst limb stretch | notes                                                              |
| ------------ | ---------- | ----------- | ------------------ | ------------------------------------------------------------------ |
| lion         | 1.1        | walk, 1.0 s | legBL 4.1          | reference case; hind legs staggered in bind pose                   |
| tiger        | 1.0        | walk, 1.0 s | legBL 3.0          | front paws were fused in the source; separated by connectivity     |
| cat          | 0.4        | walk, 1.0 s | legBL 2.8          | front legs close together; small armpit crease at p6/p18, accepted |
| dog-standing | 0.6        | walk, 1.0 s | legBL 3.3          |                                                                    |
| dog-side     | 0.6        | walk, 1.0 s | legBL 4.7          | hind legs worst (2 edges >4×); renders clean                       |
| hippo        | 1.4        | walk, 1.0 s | legBR 2.2          | short stubby legs                                                  |
| rhino        | 1.6        | walk, 1.0 s | legBR 2.7          |                                                                    |
| elephant     | 2.5        | walk, 1.0 s | legBR 3.3          | lateral-sequence gait; trunk1/trunk2 bones                         |

## Bipeds — gorilla, monkey

Hierarchy:

```
root
└─ pelvis
   ├─ spine → neck → head
   ├─ legL → legLLower → footL
   ├─ legR → legRLower → footR
   ├─ armL → armLLower → handL
   └─ armR → armRLower → handR
```

17 bones. Gait: **bipedal walk, legs alternate** (L 0.00, R 0.50),
arms swing opposite their leg (±14°), knees fold up to 32°,
gorilla leans 10° forward, monkey 5°. Arms hang at the sides in
bind pose (not spread).

| species | height (m) | walk        | worst limb stretch | notes                                                                               |
| ------- | ---------- | ----------- | ------------------ | ----------------------------------------------------------------------------------- |
| gorilla | 1.6        | walk, 1.0 s | legL 6.1           | legs worst of the set (13 edges >4×) but renders show no tearing; arms clean (≤2.9) |
| monkey  | 0.8        | walk, 1.0 s | armR 2.8           | clean all round                                                                     |

## Rat (rearing upright)

Hierarchy:

```
root
└─ pelvis
   ├─ spine → neck → head
   ├─ legL → legLLower → footL
   ├─ legR → legRLower → footR
   ├─ armL → armLLower → handL   (small front paws, held at chest)
   ├─ armR → armRLower → handR
   └─ tail1 → tail2 → tail3
```

20 bones. Gait: **bipedal hind-leg walk** (L 0.00, R 0.50, ±26°),
small arms swing opposite, tail waves in a 3-bone S. The hind feet
are long flat "skis"; the foot bone runs to the foot's front edge
and counter-rotates 0.9× so the foot stays flat (a 0.5 factor drove
the toe below the ground).

| species | height (m) | walk        | worst limb stretch | notes                                                                                                   |
| ------- | ---------- | ----------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| rat     | 0.25       | walk, 1.0 s | legL 4.2           | feet + tail tip are one welded mass at ground level in the source; feet found with a thin (0.05 H) slab |

## Bird

Hierarchy:

```
root
└─ spine
   ├─ neck → head
   ├─ tail1
   ├─ legL → legLLower → footL
   ├─ legR → legRLower → footR
   ├─ wingL → wingLLower
   └─ wingR → wingRLower
```

15 bones. Gait: **stepping walk, legs alternate** (L 0.00, R 0.50,
±24°), intertarsal joint folds the foot forward, wings held folded
with a slight ±5–7° sway. The wings are folded against the body, so
`wingXLower` carries almost no vertices (upper wing does the work);
the walk is leg-driven.

| species | height (m) | walk        | worst limb stretch | notes                                                |
| ------- | ---------- | ----------- | ------------------ | ---------------------------------------------------- |
| bird    | 0.35       | walk, 1.0 s | wingR 3.8          | legs 2.8–3.0; feet splay wide (toes span full width) |

## Defects (Meshy source inspection)

No torn geometry, extra/missing digits, or fused-blob defects were
found on any of the 12 at render resolution, except where noted
below. Inspection: side + front renders of every species, plus the
walk-phase renders (which exercise every joint).

- **lion** — clean; mane intact after decimation.
- **tiger** — front paws fused together in the source mesh (one wide
  ground cluster); they are topologically separate tubes, so the rig
  separates them — no mesh edit needed.
- **cat** — clean; whiskers are thin spikes and survived the 60k
  decimation (visible in renders).
- **dog-standing / dog-side** — clean.
- **hippo / rhino** — clean; rhino horn intact.
- **elephant** — clean; trunk and tusks intact.
- **gorilla / monkey** — clean; hands show fingers (no extra digits
  counted as a defect — fingers are present and distinct in the
  walk renders).
- **rat** — clean; long S-curved tail intact, hind feet with toes.
- **bird** — clean; beak and splayed-toe feet intact.

## Files

- Rigged (pre-slim) GLBs + per-species joint data:
  `assets/creatures/rigged/<species>.glb`,
  `assets/creatures/rigged/<species>.joints.json`. The rigged GLBs
  are local intermediates (gitignored); the `.joints.json` rig data
  is committed — the stride test in
  `tests/unit/studio-creature-walk.test.ts` recomputes each stride
  from it.
- Served (slimmed) GLBs: `public/creatures/<species>.glb`
  (60,000 tris each, 418–468 KB) + `public/creatures/creatures.json`
- Renders: `renders-walk/<species>_rest.png`,
  `renders-walk/<species>_walk_p0.png` / `_p6.png` / `_p12.png` /
  `_p18.png` (four stride phases), `renders-walk/<species>_posed.png`
  (hero pose, distinct from rest), plus
  `renders-walk/inspect_<species>_side.png` / `_front.png` for
  bird, gorilla, monkey, rat.
- Rigging scripts: `../iko-cast-repair/rig-work/rig_animals.py`
  (Blender), `../iko-cast-repair/rig-work/render_walk.py`,
  `../iko-cast-repair/rig-work/verify_glb.mjs`,
  `scripts/slim-animals.mjs` (this repo).
- **Do not re-slim the served files with the static-mesh Collapse
  pipeline** — it destroys the skeleton. Use
  `scripts/slim-animals.mjs`.

## Re-skinned 2026-11-16 (bone heat)

The skin weights of ten creatures were replaced with bone-heat weights
by `scripts/reskin-cast.mjs` (skeleton, bind pose and `"walk"` clip
kept). Measured by playing the clip at 12 phases and counting visible
tears (edges growing more than 2× and by more than 1% of the height),
worst phase, torn area per 1 m of height:

| species      | before (cm²) | after (cm²) | kept     |
| ------------ | ------------ | ----------- | -------- |
| rat          | 935          | 101         | re-skin  |
| gorilla      | 300          | 62          | re-skin  |
| lion         | 152          | 1.6         | re-skin  |
| elephant     | 128          | 31          | re-skin  |
| tiger        | 85           | 23          | re-skin  |
| hippo        | 50           | 38          | re-skin  |
| dog-side     | 45           | 7           | re-skin  |
| cat          | 23           | 4           | re-skin  |
| dog-standing | 22           | 10          | re-skin  |
| monkey       | 10           | 0           | re-skin  |
| bird         | 51           | 151         | original |
| rhino        | 26           | 30          | original |

The bird keeps its original weights: its legs sit right under the round
belly, so bone heat pulls the belly into a lump at each step. The rat's
tail tip, fused to a hind foot in the source, no longer drags the foot.
