# I-K-O 3D

(The repository is still called ai-creative-workspace.)

Light a 3D mannequin the way a studio photographer would. The scene is
real Three.js/WebGL and runs in the browser, on desktop, tablet and phone.

- Lights: directional, spot, point and softbox (area). Each has
  direction, height, distance, intensity, colour temperature
  (2000–9000 K), shadows and softness. Up to 8 per scene.
- Drag light handles in the viewport, or edit them in the inspector.
- Six curated presets with notes: Three-point, Rembrandt, Split,
  Butterfly, Low-key, High-key.
- Up to four figures in a scene, male or female, each placed, turned
  and posed on its own: add, duplicate, remove, or drag one across the
  floor. Eight material presets plus custom colour, roughness and
  metalness.
- Pose the mannequin: head, torso, shoulders, elbows, wrists, hips,
  knees, ankles, and every finger and thumb joint, each with named
  movements (raise, bend, curl, point, twist…) and anatomical limits;
  hand shapes (Relaxed, Fist, Point, Open) in one tap. Seven pose presets (Hand raised, Hand to chin,
  Hand on hip…), mirror, and tap a body part to jump to its controls.
  Or pose directly in the viewport with a mouse or a finger: drag a
  body part, or a joint circle of the Maya-style skeleton overlay;
  grabbing a palm lifts the whole arm, grabbing a finger curls it.
- Type a pose or a move instead of building it: a built-in library of
  over 60 (walk, run, jog, jump, kick, punch, throw, catch, wave, clap,
  eat, drink, sit, sit down, kneel, squat, bow, dance, stretch, pick up,
  push, pull, climb, laugh, cry…). Search understands other words and
  word forms ("sprint", "having dinner", "eating"), forgives typos
  ("walkng"), and reads "left", "3 times", "slowly", "in place",
  "backwards" and how long ("walk for 10 seconds", "dance 1 minute", or
  the Seconds box). A pose applies at once; a move becomes ordinary
  keyframes from the current time on that figure (one undo step) and
  plays. Feet stay on the floor (figures move up and down to sit,
  kneel or jump), and walks travel the way the figure faces in whole
  strides, staying in the studio: a walk too long for the room ahead
  goes round a circle. Lying down, crawling and swimming
  aren't possible yet: figures can't be tipped over.
- Keyframe animation of figures, lights and the camera: a timeline with
  play/pause, scrubbing, keys you can drag to retime, Maya-style
  auto-key, loop and length; a full-window preview (V); and a graph
  editor (G) showing every animated value as a curve, where you drag a
  key's point to change it, choose smooth, linear, stepped or spline
  (Maya-style auto tangents) interpolation per key, and tilt Bézier
  tangent handles, broken or unified; Flat and Reset act on every curve
  shown as one undo step. Animations are
  kept in autosave, project files and share links (compressed; a very
  long animation is shared as its current frame), and export as an MP4
  or WebM video, rendered frame by frame in the browser, optionally with
  a sound file from your device (cut to the animation's length).
- Six backdrops (shadow catcher or seamless sweep), camera focal length,
  exposure in EV, Filmic/AgX/Neutral tone mapping.
- Undo/redo with a history panel, keyboard shortcuts (press `?`).
- Share links (`?s=`) that reproduce the whole scene; links from the
  M3 pilot still open.
- Autosave in this browser, `.lighting.json` project files, PNG/JPEG
  export up to the device limit (4K and beyond), with optional
  transparent backgrounds.
- Characters: import your own GLB or VRM character (VRoid, Mixamo,
  Blender, Unreal rigs) from the figure's panel. It takes every pose,
  typed move and keyframe the mannequin does, keeps its own look, and
  stays on your device; share links show the mannequin to others.
- Render quality and lens look: Scene settings › Render quality picks
  Fast or High on each device (High adds ambient occlusion; computers
  start on High, phones on Fast). The Camera panel's lens look adds
  depth of field (an f-stop, focused on the figure's head), bloom,
  vignette and film grain, saved with the scene and its links.
- Faces: on a character with face shapes (VRM, VRoid, ARKit
  blendshapes, visemes) or eye bones, Pose › Face sets where the eyes
  look, expressions (happy, angry, sad, relaxed, surprised), blinks and
  winks, and mouth shapes (A, I, U, E, O). They key, ease and share
  like any joint; body poses and moves leave the face as it is.
- Pose from a photo: Pose › From photo finds the body in a picture on
  your device (MediaPipe, loaded once, about 20 MB; the photo is not
  uploaded), shows what it found over the photo, and poses the figure
  in one undoable step. Parts the photo doesn't show clearly, fingers
  and the face stay as they are.
- On phones, the panels below the view are a bottom sheet: tap the
  handle or swipe down to fold them to a slim bar and give the 3D view
  the screen. Turned on its side, a phone keeps this layout with the
  sheet folded, and nothing sits under the notch or the home bar.
- `/photography`: the Camera Basics lesson on the same engine.

There are no accounts or backend. The one machine-learning feature,
pose from a photo, runs entirely in the browser. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the designed next steps.

## Develop

Requires Node 22+.

```bash
npm install
npm run dev            # http://localhost:3000
```

| Command             | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `npm run build`     | Production build                                          |
| `npm test`          | Unit tests (Vitest)                                       |
| `npm run test:e2e`  | E2E + accessibility (Playwright: desktop/tablet/phone)    |
| `npm run lint`      | ESLint                                                    |
| `npm run typecheck` | TypeScript                                                |
| `npm run format`    | Prettier                                                  |
| `npm run models`    | Rig + rebuild `public/models/*.glb` from `assets/source/` |

Run `npx playwright install chromium` once before the E2E tests.

## Docs

- [docs/AUDIT.md](docs/AUDIT.md): repository audit and baseline
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): layers, scene model, designs for accounts/AI/multi-studio
- [docs/RELEASE-REPORT.md](docs/RELEASE-REPORT.md): what changed, test results, risks
- [docs/M4-test-plan.md](docs/M4-test-plan.md): real-iPhone test plan (still to run)
- [SCOPE.md](SCOPE.md), [docs/category-roadmap.md](docs/category-roadmap.md): product scope
