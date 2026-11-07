# I-K-O 3D — Landing page implementation plan

Status: plan only, NOT built, no go given yet.
Date: 2026-11-06. App state this plan is written against: main `e2ea833`
(PR #20 pose-from-photo; app named I-K-O 3D since 2026-11-06).

## The gap

Today `/` drops every visitor straight into the studio
(`app/page.tsx` renders `<LightingStudio />`). There is no front door:
nothing that says what I-K-O 3D is, shows the art, or gives a first-time
visitor a reason to stay. `/photography` is the only other route.

## The art (already in hand)

- Portrait: `D6F8D870-...photo-....jpg`, 1206×1206, square, finished
  stylised portrait (young man, three-quarter view, black line art with
  grey tones). Hero art.
- Process video: `fa7a5960....mp4`, 480×480, 8.2 s, H.264 — the same
  portrait being drawn, construction lines through to final shading.
  Candidate for a "how it was drawn" moment on the page (Spencer to
  confirm — see Decisions).

Both files are Spencer's own art. No licensed or third-party imagery.

## Decision 1 — where the landing page lives (blocks the build)

- **A (recommended): `/` becomes the landing page, studio moves to
  `/studio`.** The front door is actually the front door. Cost: share
  links today are `/?s=...` on the root, and M3 links must keep
  opening. So the landing page must redirect `/?s=...` to
  `/studio?s=...` (server-side, before render) and the studio must
  keep reading `?s=` exactly as it does now. `/photography` is
  untouched.
- **B: landing page at a new route (e.g. `/welcome`), `/` stays the
  studio.** Zero breakage, but nobody lands on it unless linked — it
  needs a link from the studio header, and the domain root stays the
  tool, not the front door.
- **C: separate marketing site (new repo / Vercel project).** Most
  separation, most cost, no reason to do it now — the app is one
  Next.js project with no backend.

## Sections (draft — copy to be written/approved by Spencer)

1. **Hero** — portrait, "I-K-O 3D", one line on what it is ("Light,
   pose and animate 3D characters in the browser"), CTA "Open the
   studio" (+ secondary "Learn the camera" → `/photography`).
2. **What you can do** — one row per real feature, nothing invented:
   studio lights + 6 presets; pose by dragging, by typing a move, or
   from a photo; keyframe animation + MP4/WebM export; import your
   own GLB/VRM character; faces (expressions, blinks, mouth shapes);
   render quality / lens look; share links that reproduce the scene.
3. **How it was drawn** (only if the video is in) — the 8 s process
   clip, muted autoplay loop, captioned as the drawing process, not
   as app output.
4. **Plain facts footer** — no accounts, runs entirely in the browser,
   free. No pricing, no signup, no claims the app can't back up.

## Design

- Dark, matching the studio (`#09090c`, `colorScheme: dark`) — not a
  light marketing theme. The black-and-white portrait sits on dark.
- Mobile-first, same as the studio: single column, no horizontal
  scroll, thumb-friendly CTA. Reuse the studio's Inter font and the
  I-K-O logo from `public/brand/`.
- Metadata: title "I-K-O 3D", description from the hero line, OG
  image = the portrait.

## Asset prep

- Portrait → WebP/AVIF at responsive widths + the JPG as fallback,
  under `public/landing/`. 1206 px is enough for the hero at web
  sizes; do not claim a higher resolution than the file has.
- Video → keep the 480 px source as the loop (line art upscales
  cleanly; test a 1080 px upscale before committing to it), muted,
  autoplay, loop, `playsInline`, poster = final frame. No audio.
- Both files land in the repo via the normal push route — they are
  small (149 KB + 492 KB).

## Build steps

1. Route + redirect (decision A): new landing route at `/`, studio
   moved to `/studio`, `?s=` redirect, header link studio ↔ landing.
2. Landing component + copy (Spencer approves the hero line first).
3. Assets into `public/landing/` + responsive image/video markup.
4. Metadata / OG.
5. Tests: unit test for the `?s=` redirect; Playwright E2E
   desktop/tablet/phone + a11y, same as the studio suite.
6. `npm run build`, `typecheck`, `lint`, `npm test` green.
7. Push via `~/workspace/bin/gh_sync_creative.py` (full-tree sync —
   verify the remote tree before and after) after Spencer's go.
   Confirm Vercel auto-deploys from main; verify live on the URL he
   uses before calling it done.

## Decisions needed from Spencer

1. Route: A, B, or C above.
2. Process video on the page, or just the portrait?
3. Copy: does he write the hero line, or does Everest draft it for
   his approval?
4. Is the portrait the hero alone, or is more showcase art coming?

## Out of scope

- No accounts, no pricing, no monetization, no signup.
- No changes to the studio itself except the route move and the
  header link back to the landing page.
- M4 real-iPhone test (`docs/M4-test-plan.md`) is still Spencer's
  step and still pending — the landing page must not claim the pilot
  passed. It describes what the app does today.
- The design-bible placeholder replacement (Anima) is a different
  repo and a different job; this portrait is I-K-O 3D art, not Anima
  art.
