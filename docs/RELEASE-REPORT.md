# Release Report — Premium Lighting Studio milestone

Date: 2026-11-02 · Branch: `premium-lighting-studio` (local, not pushed)
Base: `origin/main` @ `c18cd3c`

This report covers Steps 1–4 (audit, stabilisation, editor, Lighting
Studio upgrades). Steps 5–7 (accounts, AI, multi-studio) are **designed
only**; see [ARCHITECTURE.md](ARCHITECTURE.md). Nothing here claims they
are built.

## 1. Features implemented

**Stabilisation**

- Resolved the committed merge conflict (`c18cd3c`); the build and
  typecheck pass again. `.gitattributes` stops CRLF churn from recurring.
- `npm audit --omit=dev`: 3 vulnerabilities (2 high) → **0**. Supersedes Dependabot PR #1.
  Dev tooling still has a moderate `minimatch` advisory inside ESLint's
  dependency chain (no non-breaking fix; see Remaining risks).
- ESLint, Prettier, Vitest, Playwright, axe-core; GitHub Actions CI
  (format, lint, typecheck, unit, build, audit, then E2E).
- Security headers: CSP (no third-party origins), nosniff,
  Referrer-Policy (share links don't leak cross-origin),
  Permissions-Policy, frame denial.

**Bugs fixed that predate this work**

- The shadow softness slider had no effect (`PCFSoftShadowMap` ignores
  `shadow.radius`).
- Shared Rembrandt links reproduced the fill at 0.4 instead of 0.35 (v1
  rounding). Old links now restore the exact preset values.
- The canvas didn't follow container resizes (only window resize).
- `maximumScale: 1` blocked page zoom (WCAG 1.4.4).
- Incomplete GPU teardown: the ground, materials and shadow maps were
  never disposed.

**Editor**

- Toolbar: project name, local save status, undo/redo, reset, open/save
  project file, share, export.
- Collapsible tool rail, with Scene hierarchy, Presets and History
  panels.
- Contextual inspector for the selected light, mannequin, camera,
  backdrop or scene.
- Layout: three columns at ≥1024 px. At 768–1023 px the tool panel floats
  over the viewport. On phones the viewport sits on top with tabbed
  panels below.
- Undo/redo (100 steps; a slider or handle drag counts as one step),
  plus a clickable history list.
- Keyboard shortcuts (`?` lists them) and arrow-key orbit and zoom in the
  focused viewport.
- Dark design system: an "ink" neutral scale, one tungsten-amber
  accent, Inter, lucide icons, a single focus ring, reduced-motion
  support.

**Lighting Studio**

- Four light kinds: directional, spot (cone and edge softness), point
  (inverse-square), softbox/area (size). Up to 8 lights; add,
  duplicate, delete and rename them.
- Visual light handles that you can select and drag around the subject.
  A Studio overview camera shows the whole rig.
- All six original presets, with their notes and exact values.
- Mannequin: male/female, 8 material presets (including metals with
  environment reflections), custom colour, roughness and metalness.
- Camera: focal length 18–135 mm, exposure ±3 EV, Filmic/AgX/Neutral
  tone mapping, Full/Face/Studio framing.
- Backdrops: 6 presets, shadow catcher or seamless cyclorama sweep,
  floor-shadow opacity.
- Shadows: per-light toggle and softness that now works, global
  Low/Medium/High quality.
- Export: PNG/JPEG at viewport ×2, 1080p, 4K, square, 4:5 or a custom
  size, clamped to the device's maximum, with optional transparent PNG.
  Light handles are hidden in exports.
- Persistence: autosave in this browser, restore on reload, `.lighting.json`
  project files (validated on open), v2 share links that encode the full
  scene.
- Photography page: unchanged UI, now rendered by the shared engine.

## 2. Files changed

See `git diff --stat c18cd3c..premium-lighting-studio`. The main ones:

- New: `lib/studio/*` (scene model), `lib/engine/StudioEngine.ts`,
  `components/studio/*` (editor), `tests/unit/*`, `tests/e2e/*`,
  `scripts/optimize-models.mjs`, `.github/workflows/ci.yml`, `docs/*`.
- Rewritten: `app/page.tsx` (now a shell), `components/LightingScene.tsx`
  (a compatibility wrapper over the engine).
- Moved: the source scans now live in `assets/source/` (not served);
  compressed copies are served from `public/models/`.

Commit note: the editor and engine work landed as one commit
(`52a2375 "Premium Lighting Studio"`), made in the working tree before
it could be split. Fixes after that are in separate commits on top.

## 3. Tests executed

| Suite         | Command                | Result                                                        |
| ------------- | ---------------------- | ------------------------------------------------------------- |
| Unit (Vitest) | `npm test`             | **61/61 pass**                                                |
| Typecheck     | `npm run typecheck`    | pass                                                          |
| Lint          | `npm run lint`         | pass, 0 warnings                                              |
| Format        | `npm run format:check` | pass                                                          |
| Build         | `npm run build`        | pass                                                          |
| Audit         | `npm audit --omit=dev` | 0 vulnerabilities (dev: moderate `minimatch` via ESLint)      |
| E2E + a11y    | `npm run test:e2e`     | **46 pass, 0 fail, 5 skipped by design** (12.2 min, 1 worker) |

The unit tests cover the presets, Kelvin mapping, light geometry, the
v1/v2 share codecs (including damaged and tampered links), every action
and its rejection cases, untrusted-action validation (the future AI
surface), undo coalescing, autosave against corrupt or throwing storage,
project files, and the handle-drag maths.

The E2E tests (desktop 1440×900, tablet 820×1180 with touch, Pixel 7)
cover load without console errors, presets changing real pixels, share
link to a fresh browser, M3 links, damaged links, undo/redo by button
and keyboard, adding/editing/deleting a light, model switching, autosave
restore, PNG export with verified dimensions, project file round-trip,
the Photography page, no horizontal scroll, mobile inspector routing, axe
WCAG 2.1 A/AA, and keyboard orbit.

Skipped by design: keyboard-only tests on the phone profile (3) and the
phone-only inspector test on desktop and tablet (2).

**Defects the tests found and that were fixed:** selected-row and
active-preset text failed AA contrast; a `role="group"` on a `<ul>` broke
list semantics; startup error notices could expire before a slow device
finished loading the scene (errors now stay until dismissed).

## 4. Remaining risks

1. **Not tested on a real phone.** `docs/M4-test-plan.md` has still not
   been run. Phone-size emulation is not that test.
2. **Triangle count.** The male figure is 481k triangles. Mesh
   simplification was tried and **rejected**: A/B renders showed blotchy
   shading on the brow and cheek planes, the area the Rembrandt lesson
   depends on. A proper mobile LOD needs re-baked normals.
3. **E2E speed.** Headless Chromium renders WebGL in software at about
   1 fps for this scene, so the suite runs with one worker and takes
   about 12 minutes locally. CI runs desktop, tablet and phone as three
   parallel jobs.
4. **Accessibility.** Only the automated axe checks have run. There
   has been no manual screen-reader (VoiceOver/NVDA) pass. Light
   handles can't be reached by keyboard (the inspector sliders are the
   keyboard path).
5. **Area lights** don't cast shadows (a WebGL/three.js limitation);
   the UI says so.
6. **Data stays on this device.** Clearing site data loses the autosave.
   Project files are the backup.
7. **Dev-only advisory:** `minimatch` <11 (moderate ReDoS) via ESLint's
   config loader. It isn't shipped to users and only processes our own
   glob patterns. Clear it when ESLint's chain updates; forcing an
   override would break ESLint.
8. **CSP** allows `'unsafe-inline'` scripts, which Next.js needs
   without nonces. Nonces need middleware that renders every page per
   request, which would make the currently static pages dynamic. Not
   worth it while the app loads no third-party scripts and has no raw
   HTML or eval sinks (checked: no `dangerouslySetInnerHTML`,
   `innerHTML`, `eval` or `new Function` in app code). Revisit when
   accounts or user-generated content arrive.

## 5. Performance findings

Measured with the in-app benchmark (a 4-second continuous 360° orbit,
real `requestAnimationFrame` timings) in headed Chrome on **Intel UHD
integrated graphics**:

| Scene                                             | Avg fps | p95 frame   |
| ------------------------------------------------- | ------- | ----------- |
| Default (3 lights, 1 shadow), 1440×900 @1×        | 30.4    | 33.4 ms     |
| Default, 1440×900 @2×                             | 30.4    | 33.4 ms     |
| Phone-size viewport 412×915 @2.6×                 | 30.4    | 33.3 ms     |
| Heavy (8 lights, 4 shadow casters, High, cyc) @1× | 27.4    | **66.6 ms** |

An empty `requestAnimationFrame` loop on the same browser ran at 30 Hz,
so the first three rows are **at the browser's frame cap**, not GPU-bound.
Only the heavy scene drops frames. That is the guidance the inspector
gives ("one or two shadow casters on phones").

- **Model weight:** 18.6 MB → 4.55 MB (meshopt compression plus
  quantisation, visually identical in A/B renders). Models are cached
  in memory, so switching back is instant, and they get a 7-day HTTP
  cache.
- **Render on demand:** verified by counting WebGL draw calls. Idle
  after load or a preset change: 0 draws over 3 s. After an orbit
  drag, rendering stops about 2 s after release on the Intel GPU (the
  damping tail). Before, the M3 code rendered and re-applied every
  light 60 times a second, forever.
- **Adaptive resolution:** drops to 1× while moving if frames exceed
  25 ms, and restores full resolution for the still frame.
- **Bundle:** first load 157 kB JS (M3 was 110 kB; +zod, icons, editor UI). Three.js and the engine load as a
  separate chunk after first paint.

## 6. Production readiness

| Area                                   | Status                                                                |
| -------------------------------------- | --------------------------------------------------------------------- |
| Build, typecheck, lint, unit tests, CI | Ready                                                                 |
| Dependency security, headers           | Ready                                                                 |
| Core journeys (E2E, three viewports)   | Ready: 46/46 applicable tests pass                                    |
| Accessibility                          | Automated checks pass; manual screen-reader pass outstanding          |
| Real-device performance                | Desktop integrated GPU measured; **real phone not measured**          |
| Deployment                             | Static-compatible Next.js app; Vercel per M4 plan. Not deployed by me |

**Verdict:** ready for a staging deploy and the real-iPhone M4 test.
**Not yet** ready to call production-quality for phones until M4 has
been run.

## 7. Next recommended milestone

1. **Run M4 on a real iPhone** against a Vercel preview, and record
   benchmark numbers from the Scene inspector.
2. If phones struggle: build a mobile LOD (simplify, then re-bake
   normals from the high-poly scan) and automatic shadow-quality
   downgrade by device tier.
3. **Accounts and persistence (Step 5),** minimum version: Auth.js,
   Postgres `projects` and `project_revisions`, server-side `SceneSchema`
   validation, and an `If-Match` autosave, as designed in ARCHITECTURE.md §2.
4. **AI Lighting Assistant (Step 6):** a server-side tool-calling
   endpoint whose tools are generated from `SceneActionSchema`, with
   preview-then-apply as a single undo step, rate limits and usage
   accounting (ARCHITECTURE.md §3).

## Addendum (same day): keyboard handles and mannequin posing

Built after this report, on branch `mannequin-posing`:

- **Light handles by keyboard:** `L` / `Shift+L` select a light; with
  the viewport focused, the arrow keys move it and changes are
  announced. This closes the keyboard part of risk 4.
- **Posing:** both mannequins are rigged (13 bones, fitted per scan) and
  can be posed by joint (head, torso, shoulders, elbows, wrists, hips,
  knees) or with seven presets. Tap a body part to open its controls.
  Poses are validated, undoable, autosaved and travel in share links.
  Models grow from 4.55 to 4.86 MB.
- **Known limits:** extreme shoulder angles stretch the armpit (it's
  linear blend skinning on a fused scan, smoothed but not perfect).
  Fingers and ankles are not posable. Body parts can pass through each
  other: there is no collision.
