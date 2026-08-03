# Front Porch Dominoes

Classic draw dominoes under the string lights: 28 double-six tiles, hidden
hands, a boneyard, round scoring, and a race to 100. The setting is a summer
evening on a Burlington front porch—lemonade, crickets, and neighborly table
manners. It is a Btown Games production from the
[BTown Brief](https://www.btownbrief.com/).

## Ways to play

- **Porch Swing Pete** — an easy two-player bot who sheds high-pip tiles.
- **The Neighbor** — a sharper bot who looks one reply ahead and closes off
  useful numbers.
- **Pass & play** — 2–4 people sharing one phone, with a private handoff screen
  between turns.
- **Online crew** — 2–4 phones joined by a four-character porch code.

## Rules

Two players receive seven tiles each; three or four players receive five.
Seat 1 opens each new match, then the previous round winner opens the next
round. Play on either open end. With no match, draw until a tile plays or the
boneyard empties; then pass.

The first player to empty a hand scores all pips left in rival hands. If a
round blocks, the unique lowest pip count wins and scores rival pips. A tie for
lowest is a no-score porch stalemate and the opening seat rotates. First to 100
wins the match.

## Architecture

There is no framework, package manager, or build step.

| File | Responsibility |
| --- | --- |
| `js/engine.js` | All deterministic rules and scoring over one plain state object |
| `js/bot.js` | The two personalities, choosing only engine-legal moves |
| `js/main.js` | Rendering, taps, handoffs, local resume, and online flow |
| `js/rooms.js` | Verbatim shared rooms client—never edit locally |
| `js/leaderboard.js` | Monthly leaderboard client (Supabase); vs-bot wins only, no accounts |
| `scripts/rooms-shim.mjs` | Verbatim offline rooms backend used by tests |

The line automatically snakes into alternating rows as it grows; doubles are
drawn perpendicular. Online rivals are rendered as name plus tile count only.

## Verify

```bash
node scripts/test-engine.mjs
node scripts/test-rooms.mjs
node --check js/engine.js
node --check js/bot.js
node --check js/main.js
```
