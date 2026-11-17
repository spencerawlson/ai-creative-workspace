# Auto-rig: recognise the body, rig it to suit

`node scripts/auto-rig.mjs in.glb out.glb` rigs an unrigged model (a
Meshy download, a sculpture, any GLB standing on +Y) the right way for
its body. The shape alone decides; nothing is asked.

## Recognising the body (`lib/rig/classify.mjs`)

Two measures, checked on the app's 18 built-in models
(`tests/unit/rig-classify.test.ts`), whichever way a model faces:

- **Feet**: separate patches of the model on the floor (its lowest 4%),
  each with at least a tenth of the floor contact. A tail tip resting
  on the floor (the rat's) is too small to count.
- **Stance**: height over the longest horizontal extent (PCA). Upright
  figures are taller than long (1.2–1.8 counting an A-pose's arm span);
  animals on legs are longer than tall (0.5–0.8).

| feet | stance | kind         | examples                                |
| ---- | ------ | ------------ | --------------------------------------- |
| 4+   | any    | quadruped    | lion, tiger, cat, dogs, hippo, elephant |
| 2–3  | ≥ 1    | upright      | humans, apes                            |
| 2–3  | < 1    | biped-animal | bird, rat up on its hind legs           |
| else |        | other        | nothing to walk on: refused             |

Upright figures are humans or apes. **Where the hands hang** tells them
apart:

- A human's hands, in an A-pose, are above the hips, by 0.03–0.19 of the
  height (all 12 human models, served and original).
- An ape's long arms bring its hands to the hips or below (−0.02 to
  0.00, all 4 ape models).
- Within 0.015 of the hips, or an arm 0.36 of the height long (no
  human's is over 0.32), means an ape (`tests/unit/auto-rig.test.ts`).
- Arm reach from the shoulder was tried first and failed on one mesh,
  where the arm parts from the torso low down.

All 17 Meshy originals are recognised and rigged correctly by
`scripts/auto-rig.mjs`.

## The rigs

- **Human** (`scripts/rig-character.mjs`): the app's 45-bone human
  skeleton, so every studio pose works. Body from `rig-mannequin`,
  shoulders made symmetric, fingers from `scripts/rig-hands.mjs`.
  Hands with no separate fingers (fists, mittens) are rigged without
  finger bones and stay whole.
- **Quadruped** (`scripts/rig-animal.mjs`, `fitQuadruped`): root, spine,
  chest, neck, head, four legs of three bones, and a two-bone tail,
  named as the built-in animals' (`docs/creatures-rig-spec.md`).
  - The head end is the bulkier end; a tail is thin.
  - Front and back, left and right come from the four feet.
  - The body runs between hips and shoulders at the middle of the
    torso, between the belly and the back.
  - Each leg follows its own centre line up from its foot.
- **Two-legged animal** (`fitBiped`): root, pelvis, spine, neck, head,
  two legs of three bones, arms, and a tail.
  - The pelvis sits where the legs meet.
  - Arms only where they hang clear of the body, with a gap in a
    side-to-side slice and, below the chest, further out than the feet.
    Folded wings and paws held to the chest stay with the body.
  - A tail if something reaches out behind.

Weights are Blender's automatic weights along each fitted bone, or bone
heat without Blender. Animals get a one-second **walk** named `walk`, as
the app plays:

- **Quadrupeds:** diagonal pairs.
- **Bipeds:** alternate legs, arms opposite. Short legs take smaller
  steps.

## Measured on the Meshy originals

Worst tear while walking (12 phases; edges stretched more than 2× and
by more than 1% of the height), cm² per metre of height. Automatic,
with the hand-made Blender rigs for comparison:

| animal   | auto | hand-made |
| -------- | ---- | --------- |
| cat      | 0    | 0         |
| dog (2)  | 0    | 0         |
| tiger    | 0    | 0         |
| rhino    | 2    | 8         |
| hippo    | 5    | 3         |
| elephant | 18   | 0         |
| lion     | 20   | 25        |
| gorilla  | 0    | 7         |
| monkey   | 0    | 0         |
| rat      | 0    | 23        |
| bird     | 7    | 0         |

The elephant's tail hangs straight down where the fitter expects one
reaching back: the main thing left to improve.
