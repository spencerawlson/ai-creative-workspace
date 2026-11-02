# Repository Audit — 2026-11-02

Baseline: `origin/main` at `c18cd3c` ("Adding Photography"). Everything
below was checked against the code and git history, not the README.

## 1. Git state

| Finding                                                                                                               | Evidence                                               | Severity                 |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------ |
| Merge commit `c18cd3c` committed **unresolved conflict markers** in `app/page.tsx` and `components/LightingScene.tsx` | `git grep '^<<<<<<<' origin/main` → 6 markers          | P0 — app does not build  |
| `d96f77a` "Last Pull" rewrote 13 files with CRLF line endings; it has **no content changes**                          | `git diff --ignore-cr-at-eol 56422ff d96f77a` is empty | P1 — caused the conflict |
| No `.gitattributes`; `core.autocrlf=true` on the dev machine                                                          | —                                                      | P1 — will recur          |
| Open Dependabot PR #1: `postcss` 8.4.49 → 8.5.23                                                                      | `origin/dependabot/...`                                | P1 — security            |

**Conflict analysis.** The HEAD side of both conflicts is the unchanged
`56422ff` code with CRLF endings. The incoming side (`059bf1c`) is a strict
superset: it adds a Photography link on the home page and two optional
`fov` / `exposure` props to `LightingScene`, which `app/photography/page.tsx`
needs. The correct resolution is the `059bf1c` side, normalised to LF.

## 2. Baseline commands (before any fix)

| Command            | Result                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx tsc --noEmit` | **FAIL** — 6 × TS1185 "Merge conflict marker encountered"                                                                                  |
| `npm run build`    | **FAIL** — webpack syntax error in `app/page.tsx`                                                                                          |
| `npm run lint`     | not configured                                                                                                                             |
| `npm test`         | not configured — no tests exist                                                                                                            |
| `npm audit`        | 3 vulnerabilities: `postcss` ≤8.5.22 (high), `sharp` ≤0.35.5-rc.1 (high, libvips/libheif/librsvg CVEs, optional dep of `next`), 1 moderate |

## 3. Existing features (verified in code)

- Three.js scene, OrbitControls (touch rotate, pinch zoom, pan disabled).
- Two Meshy GLB mannequins (male/female), hot-swapped in place; head height
  computed from geometry so "Face close-up" works on both.
- Three directional lights (key/fill/rim): on/off, azimuth, elevation,
  distance, intensity, colour temperature, softness, cast-shadows.
- Six presets with curated notes: Three-point, Rembrandt, Split, Butterfly,
  Low-key, High-key. "Custom" state after any edit.
- URL share: `?s=` base64url JSON, strict decoding with range validation,
  fallback to default, clipboard copy with `execCommand` fallback, Reset.
- Face close-up / Full body camera views.
- `/photography`: framing presets, focal length → FOV, exposure presets,
  rule-of-thirds overlay. Reuses `LightingScene`.

## 4. Broken or misleading features

| #   | Issue                                                                  | Detail                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | **Shadow softness slider does nothing**                                | Renderer uses `PCFSoftShadowMap`; three r170's `SHADOWMAP_TYPE_PCF_SOFT` shader branch never reads `shadowRadius`. Only `PCFShadowMap`/`VSMShadowMap` honour `light.shadow.radius`. |
| B2  | Resizing only listens to `window.resize`                               | A container resize (panels, orientation on some browsers) leaves a stretched canvas.                                                                                                |
| B3  | README / layout metadata describe M1 ("Lights and presets come in M2") | Stale; README lists files that have changed.                                                                                                                                        |
| B4  | Face view applied before load uses a hard-coded 1.72 head height       | Corrected after load only if the view is still "face". Minor.                                                                                                                       |

## 5. Rendering lifecycle & assets

- Continuous `requestAnimationFrame` loop renders **every frame forever**,
  and re-applies every light every frame, even when nothing changes. This
  drains battery on phones and wastes GPU on desktops.
- Model swap disposes geometry but not the GLB's original materials.
  Teardown does not dispose the ground geometry, `ShadowMaterial`, the skin
  material, or shadow maps of lights (`renderer.dispose()` does not free
  objects still referenced by the scene graph).
- The teardown hook is stashed on the DOM node (`container.__cleanup`),
  which is fragile.
- **GLB weight**: male 11.6 MB / 481k triangles, female 7.1 MB / 294k
  triangles, uncompressed float32 positions + normals, no textures. With
  the key light casting shadows, the male figure is rasterised twice per
  frame (~1M triangles/frame). This is the biggest mobile performance risk.
- No loading indicator and no error UI for a failed GLB fetch (silent).

## 6. Application state

- All state lives in `app/page.tsx` `useState`; there's no scene document
  model, no history, and no single function that mutates the scene. That
  blocks undo/redo, autosave, and AI actions, because each of them
  needs one validated mutation path.
- The share format hard-codes exactly three lights (`l.length !== 3`).

## 7. Accessibility

- Good: `aria-pressed` on toggles, `aria-expanded` on accordions,
  `aria-live` on the preset note, 44px touch targets.
- Gaps: no visible focus styles (Tailwind preflight removes outlines on
  some elements); `maximumScale: 1` blocks pinch-zoom of the page itself
  (WCAG 1.4.4); slider value text is not linked to the input
  (`aria-valuetext`); no keyboard alternative to orbiting the camera.

## 8. Security

- No backend, no secrets, no user content beyond the `s` param. The `s`
  decoder is strict and range-checked — good.
- Missing security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, frame-ancestors).
- Dependency CVEs listed in §2.

## 9. Tooling / tests / CI

- No ESLint, no Prettier, no unit tests, no e2e tests, no CI.
- Mixed line endings in history.

## 10. Proposed architecture

```
lib/studio/          framework-agnostic scene model (pure TS, unit-tested)
  types.ts           SceneDoc: lights[], camera, material, backdrop, model
  actions.ts         typed, validated SceneAction union + reducer
  history.ts         undo/redo with drag coalescing
  share.ts           v2 URL codec (decodes legacy v1 links)
  persistence.ts     local autosave / recovery
lib/engine/
  StudioEngine.ts    imperative Three.js renderer: render-on-demand,
                     light handles, picking, drag, export, full disposal
components/editor/   toolbar, tool rail, hierarchy, inspector, viewport
```

All edits, whether from UI, keyboard, URL, or a future AI assistant,
go through `dispatch(SceneAction)`. Actions are validated and clamped by the
same schema. That gives undo/redo, autosave, and later server-validated AI
actions one choke point. The engine is studio-agnostic so the
Photography and future studios can reuse it.

**Why not a rewrite:** the scene, presets, share codec, and model loading
all work. The refactor extracts them into the structure above and
keeps `LightingScene`'s props API as a compatibility wrapper, so
`/photography` keeps working unchanged.

## 11. Priorities

1. P0: resolve conflicts, restore build. Add `.gitattributes`.
2. P1: dependency CVEs, lint/format/test/CI.
3. P1: fix B1 (softness), render-on-demand, disposal, GLB compression.
4. P2: scene document + actions + history; editor UI; Lighting Studio
   upgrades; e2e tests.
5. Later (designed, not built in this pass): accounts, Postgres, S3, AI.
