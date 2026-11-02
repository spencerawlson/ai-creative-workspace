# AI Creative Workspace — Lighting Studio

Light a 3D mannequin the way a studio photographer would. The scene is
real Three.js/WebGL and runs in the browser, on desktop, tablet and phone.

- Lights: directional, spot, point and softbox (area). Each has
  direction, height, distance, intensity, colour temperature
  (2000–9000 K), shadows and softness. Up to 8 per scene.
- Drag light handles in the viewport, or edit them in the inspector.
- Six curated presets with notes: Three-point, Rembrandt, Split,
  Butterfly, Low-key, High-key.
- Male and female mannequins, eight material presets plus custom colour,
  roughness and metalness.
- Six backdrops (shadow catcher or seamless sweep), camera focal length,
  exposure in EV, Filmic/AgX/Neutral tone mapping.
- Undo/redo with a history panel, keyboard shortcuts (press `?`).
- Share links (`?s=`) that reproduce the whole scene; links from the
  M3 pilot still open.
- Autosave in this browser, `.lighting.json` project files, PNG/JPEG
  export up to the device limit (4K and beyond), with optional
  transparent backgrounds.
- `/photography`: the Camera Basics lesson on the same engine.

There are no accounts, backend, or AI features yet. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the designed next steps.

## Develop

Requires Node 22+.

```bash
npm install
npm run dev            # http://localhost:3000
```

| Command             | What it does                                           |
| ------------------- | ------------------------------------------------------ |
| `npm run build`     | Production build                                       |
| `npm test`          | Unit tests (Vitest)                                    |
| `npm run test:e2e`  | E2E + accessibility (Playwright: desktop/tablet/phone) |
| `npm run lint`      | ESLint                                                 |
| `npm run typecheck` | TypeScript                                             |
| `npm run format`    | Prettier                                               |
| `npm run models`    | Rebuild `public/models/*.glb` from `assets/source/`    |

Run `npx playwright install chromium` once before the E2E tests.

## Docs

- [docs/AUDIT.md](docs/AUDIT.md): repository audit and baseline
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): layers, scene model, designs for accounts/AI/multi-studio
- [docs/RELEASE-REPORT.md](docs/RELEASE-REPORT.md): what changed, test results, risks
- [docs/M4-test-plan.md](docs/M4-test-plan.md): real-iPhone test plan (still to run)
- [SCOPE.md](SCOPE.md), [docs/category-roadmap.md](docs/category-roadmap.md): product scope
