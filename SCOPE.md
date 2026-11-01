# AI Creative Workspace — Lighting Studio Pilot (Scope)

Date: 2026-10-31. Status: scoped only, NOT built, no go given yet.
Source: Spencer's MASTER PROMPT — AI CREATIVE WORKSPACE (2026-10-31).

## Verdict in one line
Build the Lighting Studio alone first. If people use it, wrap a platform around it. If they don't, the cost is weeks, not months.

## The wedge
One page, one mannequin, lights you can move. Nothing else in v1.

## IN scope — pilot must do all of these

### 3D scene (real Three.js / WebGL, no fake 2D shading)
- One full-body human mannequin, built procedurally from capsules/spheres with correct human proportions. Stylized, not photorealistic — this is the deliberate mobile-performance trade. No licensed model to clear, no download weight.
- Orbit, zoom, and rotate with touch (one finger rotate, pinch zoom) and mouse.
- Ground plane with a soft shadow catcher, neutral studio backdrop.

### Lights (the actual tool)
- Up to 3 lights: key, fill, rim. Each with: on/off, azimuth, elevation, distance, intensity, colour temperature (2700K–6500K slider, mapped to colour), shadow softness.
- Only the key light casts shadows by default (fill/rim shadows are a toggle) — this is what keeps it running on phones.
- Presets, one tap each: Three-point, Rembrandt, Split, Butterfly, Low-key, High-key.
- A short curated note per preset (2–3 sentences, written once, stored in code): what it is, where the key sits, what to watch for on the face. No LLM chat in the pilot — this avoids hallucinated technique and keeps cost at $0.

### Mobile UI
- Bottom-sheet light controls, preset chips on top, large touch targets, no horizontal scroll.
- Dark canvas (lighting reads correctly on it), simple controls. One theme only in the pilot.
- Share: the whole light setup is encoded in the URL, so a link reproduces the exact setup on someone else's phone. No accounts, no database needed to prove sharing works.

## OUT of scope — deliberately, for the pilot
- The other 7 categories (character, illustration, 3D sculpting, animation, graphic design, photography, idea development).
- User accounts, Supabase, workspace, projects, saved ideas, learning progress.
- AI Mentor chat (replaced by the curated preset notes above).
- Importing users' own 3D models, multiple mannequins, materials/texture editor, animation.
- Collaboration, sharing feeds, dark/light theme toggle, monetization, donations.
- Photorealistic mannequin, bounced-light simulation beyond Three.js defaults, multi-shadow rendering on all lights.

## Tech (pilot only)
- Next.js + Tailwind + Three.js, deployed on Vercel free tier. No Supabase, no LLM, no backend. Cost to run the pilot: $0.
- New repo (name TBD — not decided). Do not build inside ShipItAyiti, Kay Ayiti, Farelune, or IT_Fund.

## Milestones
- M1 — Scene + mannequin + orbit/zoom working on a phone.
- M2 — 3 lights + all controls + 6 presets, each visibly different.
- M3 — Mobile UI polish + URL share links + curated preset notes.
- M4 — Test on a real iPhone: load, orbit, switch presets, share a link, open it on another phone and see the same setup.

## Pilot success criteria (decide go / no-go on Phase 2 from these)
- You can demo it on your phone with no explanation and a non-artist can recreate Rembrandt lighting in under 2 minutes.
- A shared link opens on another phone showing the same light setup.
- It stays smooth on a phone (no stutter when orbiting with all 3 lights on).

## What Phase 2 would add ONLY if the pilot passes
- Accounts + workspace (Supabase), then the AI Mentor chat, then one next category — character design, since it pairs directly with lighting — not all seven at once.

## Open decisions (Spencer's, not assumed)
- Project name and domain (none chosen).
- Mannequin style: stylized (pilot default) vs realistic (later, desktop-first).
- Business model: free, subscription, or donation — explicitly undecided, same question as Road to CISSP.
- Whether this starts before or after ShipItAyiti goes live Monday (ShipItAyiti is the current priority).
