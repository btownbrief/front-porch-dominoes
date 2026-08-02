# Front Porch Dominoes — agent instructions

Shared brain for any AI agent working in this repo (Codex, Claude Code, etc.).
Read `README.md` first for the rules and architecture. Stephen is
non-technical, so explain consequential changes in plain language.

## What this is

Classic double-six draw dominoes for Btown Games, themed as a Burlington
front porch on a summer evening. Plain static site, **no build step**:
`index.html` + `style.css` + ES modules in `js/`. GitHub Pages deploys it via
`.github/workflows/deploy.yml`. No accounts, analytics, ads, or leaderboard.

## The one non-negotiable

**Every game and scoring rule lives in `js/engine.js` and nowhere else.** The
engine is pure functions over one JSON-serializable state object:
`createInitialState`, `legalMoves`, `applyMove` (returns a NEW state), and
`getStatus`. It imports nothing and never touches the DOM, timers, `Date`, or
`Math.random`; seeded shuffle state stays inside the game state. A match must
survive `JSON.stringify` → `JSON.parse` → resume.

`js/bot.js` chooses only among the engine's public moves. `js/main.js` is UI
only. Hidden hands must stay hidden: online shows only this phone's hand and
rival tile counts; pass-and-play uses a handoff screen before every new hand.

## Online play (the rooms layer)

`js/rooms.js` is the fleet's vendored online-multiplayer client; its canonical
copy lives in `four-in-a-rowboat`, and this repo must copy it verbatim. It
talks to the shared Supabase rooms backend
(`btownbrief.github.io/supabase/rooms-2026-07-30.sql`): a room is a 4-letter
code plus the entire engine state and a version. After a move, the mover pushes
the new state at the version last seen; every other phone polls. Seat index is
engine player index, and host/seat 0 opens a fresh match. If the backend SQL is
not installed, the UI must turn `not_ready` into a friendly message.

`scripts/rooms-shim.mjs` is the verbatim canonical local backend stand-in.
`scripts/test-rooms.mjs` drives the real client, shim referee, and engine
through synchronized two- and three-phone matches. Never edit either vendored
file locally; change the canonical sibling first and re-vendor everywhere.

## Before you finish

Run all of these and report what passed:

```bash
node scripts/test-engine.mjs
node scripts/test-rooms.mjs
node --check js/engine.js
node --check js/bot.js
node --check js/main.js
```

If the UI changed, verify the phone layout or clearly say what could not be
visually playtested. Keep both bots comfortably under 300ms.
