# Real-iPhone Test Plan (I-K-O 3D)

Status: prepared, NOT run. This is a plan for Spencer to run on a real
iPhone. Phone-width screenshots in a desktop browser, and the automated
phone-sized browser tests, are NOT this test and must not be presented
as one.

Updated November 2026 for pose from a photo, faces, lip sync and
direction beats (steps 11–19). Steps 1–10 are the original lighting
checks, with outdated caveats corrected.

Pilot success criteria (from SCOPE.md):

- You can demo it on your phone with no explanation, and a non-artist
  can recreate Rembrandt lighting in under 2 minutes.
- A shared link opens on another phone showing the same setup.
- It stays smooth on a phone (no stutter when orbiting with all
  3 lights on).

## Before you start

### Get it on the phone

The app already runs on the home server: on the same Wi-Fi as the
server, open **http://192.168.1.46:3000/studio** in Safari. That covers
every step except the second-phone half of step 8, which needs a
second phone on the same Wi-Fi (a phone on another network can't reach
the home server; a public deployment would be needed for that).

### Things to have on the phone

- **A photo of a person standing**, full body, for step 11 (take one,
  or save one from the web).
- **A short voice recording**, for step 13: record yourself saying a
  sentence or two in Voice Memos and save it to Files (Share › Save to
  Files).
- **A character with a face**, for steps 12–14: a VRM or GLB with face
  shapes. The simplest is the repository's test character,
  `tests/fixtures/test-character.glb` (small, with a smile, a blink and
  an "A" mouth shape): AirDrop or email it to yourself and save it to
  Files. A VRoid character you made works too, and looks much better.

## How to record results

For each step below: do it, write Pass or Fail, and take a screenshot
of anything that fails or looks wrong. A step passes only if the
"Pass looks like" line is true on a real iPhone — not in a desktop
browser, not in a simulator.

### Part 1: lighting, layout, sharing

| #   | Step                                  | What to do                                                                                                                                                         | Pass looks like                                                                                                                                                                                                                                     | Pass / Fail + screenshot |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | Load                                  | Open the URL on your iPhone, on Wi-Fi. Time how long until the mannequin appears.                                                                                  | A loading message, then the mannequin with its ground shadow and the controls below. Note the time.                                                                                                                                                 |                          |
| 2   | Demo with no explanation              | Hand the phone to someone who has never seen it. Say nothing except "try it".                                                                                      | They can rotate the figure and tap a preset without being told how.                                                                                                                                                                                 |                          |
| 3   | Recreate Rembrandt in under 2 minutes | As a non-artist: tap the Rembrandt preset chip, then tap Face close-up, then drag to orbit until you see the shadow side of the face. Time it from the preset tap. | Under 2 minutes, and you can see a small lit triangle on the shadow cheek, bounded by the nose shadow. From the default close-up it reads faintly; orbiting to the shadow side is part of the step.                                                 |                          |
| 4   | Switch mannequins                     | Tap Female mannequin, then Male mannequin.                                                                                                                         | Each figure swaps in place, same lights and preset, no blank canvas stuck, no duplicate figures. The first switch to Female downloads that model (1.9 MB), so a short loading message is expected.                                                  |                          |
| 5   | Face close-up / Full body             | Tap Face close-up, orbit and pinch, then tap Full body.                                                                                                            | Face fills the canvas, you can still orbit and zoom from the close-up, and Full body returns to the whole figure.                                                                                                                                   |                          |
| 6   | Pinch zoom + orbit                    | One finger drag to rotate, two-finger pinch to zoom in and out.                                                                                                    | Smooth rotate and zoom, no page scrolling or page zoom fighting the canvas, figure never lost off-screen (zoom back out if it is).                                                                                                                  |                          |
| 7   | All 6 presets                         | Tap each: Three-point, Rembrandt, Split, Butterfly, Low-key, High-key.                                                                                             | Each looks visibly different, and the note card matches the preset you tapped. Low-key stays dark, High-key stays bright.                                                                                                                           |                          |
| 8   | Share link, second phone              | On phone 1, set a distinctive setup (e.g. Low-key, the female figure, a pose), tap Copy link, send it to phone 2 (same Wi-Fi), open it there.                      | Phone 2 shows the same lights, figure and pose. An imported character shows as the mannequin on phone 2 (characters stay on the phone that imported them); that's expected. The page may show the default setup for a moment before the shared one. |                          |
| 9   | Smoothness + load                     | With all 3 lights on, orbit continuously for 20 seconds. Then, if you can, reload on cellular data (not Wi-Fi) and note the load time.                             | No stutter or freezing while orbiting. Cellular load time recorded, even if it is slow. (On cellular the home server isn't reachable unless it's exposed to the internet; skip that half if not.)                                                   |                          |
| 10  | Landscape and the notch               | Turn the phone on its side, both ways round. Open the panels from a tab, then turn back upright.                                                                   | The panels fold to a bar and the 3D view fills the height. No button or text sits under the notch or the home bar on either side. Upright again, the phone layout comes back.                                                                       |                          |

### Part 2: characters, photo, faces, sound, beats

| #   | Step                          | What to do                                                                                                                                                                                          | Pass looks like                                                                                                                                                                                                                                                         | Pass / Fail + screenshot |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 11  | Pose from a photo             | Pose › From photo, pick the photo of a person. Time how long until the dialog shows what it found. Tap Apply, then Undo.                                                                            | Dots and lines drawn over the body in the photo, then the figure takes roughly that pose; Undo puts it back in one step. The first time, the body finder downloads (about 20 MB): note how long. A second photo is much quicker.                                        |                          |
| 12  | Import a character and a face | Tap the figure, then in its panel import the character file from Files. Then Pose › Face: move Happy, and Look sideways.                                                                            | The character replaces the mannequin and takes its pose. Only the face controls its file has are shown, and they visibly change its face.                                                                                                                               |                          |
| 13  | Lip sync                      | Still on Pose › Face, with the playhead at 0: Lip sync › From a sound, pick your voice recording. Then tap Play. **Turn the ringer switch off silent first** (on silent, Safari may play no sound). | It reads the sound in a few seconds and lists it. On Play you hear your voice and the mouth opens and closes with it (with the test character only its "A" shape moves). Pausing stops the sound. A blue strip on the Animate tab's timeline shows where the speech is. |                          |
| 14  | Lip sync in a video           | Animate › Export video. Check the Sound line, then export a short 720p video and play it from Files or Photos.                                                                                      | The dialog already lists your recording as the sound. The video plays with your voice, in step with the mouth.                                                                                                                                                          |                          |
| 15  | Direction beats               | Pose › Direct. Type: `turn left`, `face the camera — finds us`, `pause 1 s`, `wave twice`, one per line. Then add a line `fly to the moon`.                                                         | Each line shows how it was read ("Turn to its left", "Face the camera · finds us", "Hold 1 s", "Wave (2×)"). The "fly to the moon" line turns red and Direct is greyed out.                                                                                             |                          |
| 16  | Direct and the markers        | Delete the red line, tap Direct. Let it play, then on the Animate tab tap the green markers on the timeline.                                                                                        | The beats play one after another: turn, face you, hold, wave. Green markers sit at the top of the timeline; tapping one jumps there. Undo removes the beats and their markers in one step. (The markers are small: note if they're hard to tap.)                        |                          |
| 17  | Reload keeps it               | Reload the page.                                                                                                                                                                                    | The character, the lip sync (and its sound when you press Play) and the beat markers are all still there.                                                                                                                                                               |                          |
| 18  | 3D file                       | Export › 3D file, with animation on. Save it to Files.                                                                                                                                              | A `.glb` file is saved and its size shown. (Opening it needs a 3D app; skip that on the phone.)                                                                                                                                                                         |                          |
| 19  | Smoothness with a character   | With the character on, a lip-sync track and beats, play the animation and orbit at the same time.                                                                                                   | Plays without long freezes. Some slowdown with a detailed character is a finding to record, not a surprise.                                                                                                                                                             |                          |

## Pre-test notes — things likely to feel rough, read before testing

Found by reading the code and the build, not by testing on a real
phone. They are what to watch for, not failures.

1. **Downloads.** The male mannequin is 3.1 MB and the female 1.9 MB;
   fine on Wi-Fi. The pose-from-photo body finder is about 20 MB and
   loads only the first time you use it, then stays cached.
2. **Sound on iPhone.** Safari only lets a page start sound from a tap,
   and the silent switch can mute web audio. The app starts sound from
   the Play tap; if you hear nothing, check the silent switch before
   recording a failure.
3. **Lip sync reads vowels, not words.** The mouth opens with the
   loudness and shapes A, I, U, E, O; consonants show as it closing.
   U and O are sometimes swapped. With the test character only the A
   shape exists, so only "open and close" shows.
4. **Rembrandt from the default close-up reads faintly.** The default
   camera sits on the key side, so the shadow cheek is turned away;
   orbiting to it is part of step 3.
5. **Page pinch-zoom is disabled by design.** Pinch goes to the 3D
   view's zoom, not Safari's page zoom.
6. **Render quality.** Phones start on Fast (Scene settings › Render
   quality). Switching to High adds ambient occlusion and may stutter
   on older phones; note it if you try.
7. **No offline use.** Without the network the page and models can't
   load.

## After the test

Phase 2 (accounts and a workspace, then the AI mentor, then the next
category) starts ONLY if the three success criteria at the top pass.
If any step fails, that step, its screenshot and what you recorded are
the next work item.

## Build state when this plan was updated (not a phone test)

- Automated tests pass in desktop, tablet- and phone-sized browsers
  (Playwright), including pose from a photo, characters, faces, lip
  sync and direction beats. Those are simulations, not this test.
- Models as served: `public/models/mannequin-male.glb` 3.1 MB,
  `public/models/mannequin-female.glb` 1.9 MB; body finder
  `public/mediapipe/pose_landmarker_full.task` 9.4 MB plus its wasm.
