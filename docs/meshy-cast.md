# Making the built-in cast with Meshy

The cast is a few ready-made characters that come with the app, so
people can light, pose, animate and direct real characters without
importing their own. They are made once, on your computer, with
[Meshy](https://www.meshy.ai)'s API, and then served by the app like the
mannequins. The app itself never talks to Meshy and holds no key.

Each character costs about **35 credits**: a draft model from its
description (20), its textures (10) and a skeleton (5). Meshy's API
needs a paid plan; the free plan can't create API keys.

Meshy characters have no face shapes, so faces and lip sync don't move
on them. They pose, take typed moves, keyframes and direction beats like
any character.

## Before the first run

1. **Check Meshy's terms** for who owns models made through the API,
   and that you may ship them in the app. Don't publish the cast until
   that's clear.
2. **Make an API key** in Meshy's developer settings. Give it a monthly
   credit limit (for example 200 credits) so a mistake can't run up a
   bill.
3. **Save the key on this computer**, encrypted for your Windows account
   (it's typed into a hidden prompt, never shown or stored in plain
   text):

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/meshy-save-key.ps1
   ```

4. **Choose the characters** in `assets/cast/cast.spec.json`: an `id`
   (lowercase, dashes), a `name` shown in the app, a `prompt` describing
   the whole figure, and optionally `heightMeters`. Three suggestions are
   there to replace. Describe a whole body standing straight with the
   arms slightly away from the sides, a neutral expression and a plain
   background: that gives the skeleton step what it needs. Don't
   describe a real person.

## Making it

```powershell
# What would run and what it costs (spends nothing, needs no key):
powershell -ExecutionPolicy Bypass -File scripts/meshy-cast.ps1 --dry-run

# Make everyone in the spec:
powershell -ExecutionPolicy Bypass -File scripts/meshy-cast.ps1

# Or one at a time (a good first test):
powershell -ExecutionPolicy Bypass -File scripts/meshy-cast.ps1 --only dancer
```

Each character takes a few minutes. The script prints each step as it
goes. It is safe to stop and run again: tasks already paid for are
picked up, never bought twice. Changing a character's description makes
that character again from scratch (and costs again).

If a step fails, Meshy refunds it and the next run tries that step
afresh. Meshy keeps results for about 3 days, so finish a run within
that time.

## Afterwards

- `assets/cast/source/` holds Meshy's downloads (not committed: large).
- `public/cast/` holds the slimmed copies the app serves (textures at
  1024 px, compressed geometry) and `cast.json`, the list the app reads.
- `assets/cast/state.json` records each character's Meshy tasks,
  credits and date: commit it with the cast, as the record of where each
  character came from.

Look at each character in the studio (Figure › Character › Cast) before
committing: pose it, try a typed move, check the hands. If one looks
wrong, change its description and run again for that one.
`npm run cast -- --optimize-only` re-slims the downloads without
calling Meshy.
