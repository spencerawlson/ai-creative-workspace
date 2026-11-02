# Lighting Studio — Pilot (M1)

M1 only: a real Three.js/WebGL scene with a procedurally built, stylized
full-body mannequin, one key light with a soft shadow, low ambient light,
and orbit/zoom controls (drag to rotate, pinch to zoom on touch).

Lights and presets come in M2. No backend, no accounts, no database, no LLM.

## Run locally

```bash
cd ~/workspace/ai-creative-workspace
npm install
npm run dev
# open http://localhost:3000
```

Production build:

```bash
npm run build
npm run start
# open http://localhost:3000
```

## Files

- `app/page.tsx` — mobile-first page shell, title, M1 note, hint.
- `app/layout.tsx` — metadata and viewport.
- `components/LightingScene.tsx` — Three.js scene, mannequin, key light, OrbitControls.
- `SCOPE.md` — full pilot scope; M2/M3/M4 are not built yet.
