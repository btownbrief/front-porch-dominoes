# Front Porch Dominoes — build report

## What shipped

- Complete 2–4 player double-six draw-dominoes engine with seeded shuffles,
  forced boneyard draws, passes, blocked rounds, pip scoring, continuing rounds,
  and a first-to-100 match.
- Porch Swing Pete and The Neighbor, both choosing engine-legal moves only.
- Bot, 2–4 player pass-and-play, and 2–4 phone online crew modes.
- Hidden-hand rendering: online rivals are name + tile count only; shared-phone
  games use a handoff screen before each turn and fresh round.
- Phone-first chain layout that snakes through alternating rows; doubles render
  crosswise.
- Local resume, online rejoin/rematch/leave handling, responsive porch theme,
  manifest, SVG/PNG icons, fleet footer, README, and canonical agent guidance.

## Sensible house calls

- Seat 0 opens a fresh match, as required by the shared rooms seat mapping. The
  previous round's winner opens the next round.
- A unique low pip count wins a blocked round and scores all rival pips. If low
  pip counts tie, nobody scores and the opening seat rotates.
- The UI uses the name as a playful porch reference only; it contains no Front
  Porch Forum logo, trade dress, or claim of affiliation.

## Verification notes

- Required engine tests, rooms tests, and syntax checks all passed.
- The random soak completed 240 full matches (80 each at 2, 3, and 4 players).
- The rooms test played full synchronized two- and three-phone matches through
  the real vendored client and local referee shim.
- `index.html` has 61 unique IDs, no duplicate IDs, and every DOM target used by
  `main.js` exists.
- `icon-180.png` is a valid 180×180 RGBA PNG.
- No interactive browser playtest was run; responsive behavior and the 390px
  rules were verified by static layout inspection and automated code-path tests.

## Full required command output

### `node scripts/test-engine.mjs`

```text
Deterministic setup
  ok — same seed produces an identical four-player deal
  ok — different seeds produce different deals
  ok — three and four players are dealt five tiles
  ok — two players are dealt seven tiles
  ok — all 28 unique double-six tiles are accounted for
  ok — seat zero opens a fresh match

Tile helpers and legal placement
  ok — tile values and pip totals are public helpers
  ok — a matching tile can play on the left end
  ok — a matching tile can play on the right end
  ok — a tile matching neither end is not legal
  ok — left play is oriented into a readable chain
  ok — applyMove never mutates its input state

Turn rotation at every crew size
  ok — 2-player turn advances from seat 0 to seat 1
  ok — 2-player rotation advances seat 1
  ok — 3-player turn advances from seat 0 to seat 1
  ok — 3-player rotation advances seat 1
  ok — 3-player rotation advances seat 2
  ok — 4-player turn advances from seat 0 to seat 1
  ok — 4-player rotation advances seat 1
  ok — 4-player rotation advances seat 2
  ok — 4-player rotation advances seat 3

Draw, pass, and blocked-round rules
  ok — a stuck player must draw while the boneyard has tiles
  ok — drawing keeps the turn and adds the hidden tile
  ok — drawing stops as soon as the new tile can play
  ok — a full lap of passes blocks the round
  ok — lowest pip count takes a blocked round
  ok — blocked winner scores all rival pips

Round scoring and the race to 100
  ok — emptying a hand wins and scores every rival pip
  ok — round winner can deal the next round
  ok — next round keeps the match score and deals a fresh set
  ok — next-round deal still conserves all 28 tiles
  ok — first player to at least 100 wins the match
  ok — no moves are legal after the match ends

Serialization and bot speed
  ok — JSON stringify/parse resumes with identical legal moves
  ok — 1,000 bot choices finish under 300ms (13.9ms)

Random-legal-move soak
  ok — 240/240 random matches finish without an illegal state (got 240)

36 passed, 0 failed
```

### `node scripts/test-rooms.mjs`

```text
Generic rooms checks
  ok — host creates a room in engine seat 0
  ok — host session is saved for rejoin
  ok — bad code is rejected (got not_found)
  ok — wrong-game code is rejected (got wrong_game)
  ok — final guest joins seat 1 and starts a two-phone room
  ok — guest sees the host name
  ok — host poll sees the filled porch
  ok — host publishes a legal engine move
  ok — guest receives the full deterministic state
  ok — guest publishes the next engine move
  ok — stale push is rejected (got version_conflict)
  ok — version conflict refetches server truth
  ok — rooms errors expose stable codes

Complete two-phone match
  ok — two phones stay JSON-identical after every move
  ok — two-phone match reaches 100 in 302 more moves
  ok — room closes when the engine match ends
  ok — either phone can start a rematch
  ok — resume returns to the same engine seat
  ok — leave clears the local room session

Complete three-phone match
  ok — three-phone room waits after seat 1 joins
  ok — three-phone room starts when seat 2 joins
  ok — all three phones stay JSON-identical after every move
  ok — three-phone match reaches 100 in 46 moves
  ok — engine seat mapping survives the whole three-phone match
  ok — fourth phone cannot enter a started three-seat room (got room_started)
  ok — missing backend reports not_ready cleanly (got not_ready)

ALL ROOMS TESTS PASSED (26 checks)
```

### Syntax checks

```text
node --check js/engine.js
node --check js/bot.js
node --check js/main.js
node --check scripts/generate-icon.mjs
node --check scripts/test-engine.mjs
node --check scripts/test-rooms.mjs

(all exited 0 with no output)
```
