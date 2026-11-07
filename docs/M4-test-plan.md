# M4 — Real-iPhone Test Plan (Lighting Studio)

Status: prepared, NOT run. This is a plan for Spencer to run on a real
iPhone. Phone-width screenshots in a desktop browser are NOT this test
and must not be presented as one.

Pilot success criteria (from SCOPE.md):

- You can demo it on your phone with no explanation, and a non-artist
  can recreate Rembrandt lighting in under 2 minutes.
- A shared link opens on another phone showing the same light setup.
- It stays smooth on a phone (no stutter when orbiting with all
  3 lights on).

## Before you start: get it on a phone-reachable URL

This app is not deployed yet, and deployment needs Spencer's own
account, so no one has deployed it for you. Recommended route:

### Recommended: Vercel (free tier, matches SCOPE.md)

1. In your own browser, sign in to Vercel.
2. Add New → Project → Import Git Repository →
   `spencerawlson/ai-creative-workspace` (private).
3. Framework should detect as Next.js. Leave build settings as-is
   (`npm run build`, output is the standard Next.js build).
4. Deploy, then open the Vercel URL on your iPhone and tap Open the studio (or go straight to `<url>/studio`).
5. This is the only route that tests share links properly, because
   a second phone needs the same public URL.

### Fallback only: local network (for load/orbit checks, NOT share links)

1. On a computer on the same Wi-Fi, run the production build
   (`npm run build && npm run start`) — not `npm run dev`.
2. On the iPhone, open `http://<that computer's LAN IP>:3000/studio`.
3. This works for orbit, presets, and smoothness, but a second phone
   on a different network cannot open your links, so it cannot
   prove the share-link criterion. Use Vercel for that step.

## How to record results

For each step below: do it, write Pass or Fail, and take a screenshot
of anything that fails or looks wrong. A step passes only if the
"Pass looks like" line is true on a real iPhone — not in a desktop
browser, not in a simulator.

| #   | Step                                  | What to do                                                                                                                                                         | Pass looks like                                                                                                                                                                                                                                                                                                                                                        | Pass / Fail + screenshot |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | Load                                  | Open the deployed URL on your iPhone, on Wi-Fi first. Time how long until the mannequin appears.                                                                   | Mannequin appears, ground shadow visible, controls below the canvas. Note the time — see the audit below about GLB size.                                                                                                                                                                                                                                               |                          |
| 2   | Demo with no explanation              | Hand the phone to someone who has never seen it. Say nothing except "try it".                                                                                      | They can rotate the figure and tap a preset without being told how.                                                                                                                                                                                                                                                                                                    |                          |
| 3   | Recreate Rembrandt in under 2 minutes | As a non-artist: tap the Rembrandt preset chip, then tap Face close-up, then drag to orbit until you see the shadow side of the face. Time it from the preset tap. | Under 2 minutes, and you can see a small lit triangle on the shadow cheek, bounded by the nose shadow. See the caveat below — from the default close-up camera it reads faintly; orbiting to the shadow side is part of the step.                                                                                                                                      |                          |
| 4   | Switch mannequins                     | Tap Female mannequin, then Male mannequin.                                                                                                                         | Each figure swaps in place, same lights and preset, no blank canvas stuck, no duplicate figures. Note: the first switch to Female downloads that model, so it may take a moment — that pause is expected, a stuck blank canvas is not.                                                                                                                                 |                          |
| 5   | Face close-up / Full body             | Tap Face close-up, orbit and pinch, then tap Full body.                                                                                                            | Face fills the canvas, you can still orbit and zoom from the close-up, and Full body returns to the whole figure.                                                                                                                                                                                                                                                      |                          |
| 6   | Pinch zoom + orbit                    | One finger drag to rotate, two-finger pinch to zoom in and out.                                                                                                    | Smooth rotate and zoom, no page scrolling or page zoom fighting the canvas, figure never lost off-screen (zoom back out if it is).                                                                                                                                                                                                                                     |                          |
| 7   | All 6 presets                         | Tap each: Three-point, Rembrandt, Split, Butterfly, Low-key, High-key.                                                                                             | Each looks visibly different, and the note card under the canvas matches the preset you tapped. Low-key stays dark, High-key stays bright.                                                                                                                                                                                                                             |                          |
| 8   | Share link, second phone              | On phone 1, set a distinctive setup (e.g. Low-key, or a custom light move), tap Copy link, send it to phone 2, open it there.                                      | Phone 2 shows the same preset and the same lights. KNOWN CAVEAT: the link restores lights only and always opens on the male mannequin, even if you copied it while viewing the female. That is current behaviour, not a test failure — but record it if it surprises you. Also note: the page may flash the default setup for a frame before the shared setup appears. |                          |
| 9   | Smoothness + load                     | With all 3 lights on, orbit continuously for 20 seconds. Then, if you can, reload on cellular data (not Wi-Fi) and note the load time.                             | No stutter or freezing while orbiting. Cellular load time recorded, even if it is slow — slow is a finding, not a surprise (see audit).                                                                                                                                                                                                                                |                          |
| 10  | Landscape and the notch               | Turn the phone on its side, both ways round. Open the panels from a tab, then turn back upright.                                                                   | The panels fold to a bar and the 3D view fills the height. No button or text sits under the notch or the home bar on either side. Upright again, the phone layout comes back.                                                                                                                                                                                          |                          |

## Pre-test audit — things likely to feel rough, read before testing

These were found by reading the code and the build output, not by
testing on a real phone. They are not presented as failures — they
are what to watch for, so a slow load or a faint triangle is not a
surprise.

1. **The models are large — this is the biggest risk.** First-load
   JavaScript is only 109 kB, but the male GLB is 12 MB and the
   female GLB is 6.8 MB, served separately. That breaks the scope's
   original "no download weight" assumption for a procedural
   mannequin. On Wi-Fi it should be fine; on cellular, first load
   (and the first Female switch) will take noticeably longer.
2. **No loading indicator.** While a GLB is downloading, the canvas
   shows no spinner or progress — it just stays blank (first load)
   or keeps the previous figure (on switch). If the screen looks
   stuck, wait for the download before calling it a failure, and
   record how long you waited.
3. **Rembrandt from the default close-up reads faintly.** The Face
   close-up button keeps your current orbit direction, and the
   default camera sits on the key side, so the shadow cheek is
   turned away. The triangle reads clearly from the shadow-side
   3/4 view. Orbiting to the shadow side is part of step 3, not a
   workaround for a broken face.
4. **Share links restore lights only.** They do not restore the
   mannequin choice (always male on open), and the page is
   statically prerendered, so a shared link may flash the default
   setup for one frame before the shared setup appears.
5. **Page pinch-zoom is disabled by design.** The viewport sets
   maximum scale 1, and the canvas uses touch-none, so pinch gestures
   go to the 3D orbit/zoom controls, not to Safari page zoom. If
   you try to pinch the page itself, nothing will happen — that is
   intended. What matters is that canvas pinch zoom works (step 6).
6. **Three lights + soft shadows on a phone.** The scene uses
   antialiasing, pixel ratio capped at 2, 1024 shadow maps, and
   PCF soft shadows, with key shadows on by default and fill/rim
   shadows as toggles. That should run on a modern iPhone, but an
   older phone, or Low Power Mode, may stutter — step 9 is where
   that shows up. Turning fill/rim shadows on is a good stress
   test, not a normal-use requirement.
7. **No offline fallback.** If the phone loses network, the page
   and the models cannot load. That is expected for this pilot —
   it is not an offline app.

## After the test: go / no-go on Phase 2

Phase 2 (accounts + workspace, then AI Mentor, then one next
category — character design) starts ONLY if the pilot passes the
three success criteria at the top. If any criterion fails, the
failing step, its screenshot, and the time/behaviour you recorded
above are the next work item — not a new category.

## Build state at plan time (not a phone test)

- `tsc --noEmit`: clean.
- `npm run build`: passes. First Load JS 109 kB (page route).
- GLBs as served: male `public/meshy-body.glb` 12 MB,
  female `public/meshy-body-female.glb` 6.8 MB.
- No app behaviour was changed for this brick. No deployment was
  made — deployment is Spencer's step above.
