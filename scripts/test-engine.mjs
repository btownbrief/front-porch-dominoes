// FRONT PORCH DOMINOES engine tests — plain Node, no framework.
// Run: node scripts/test-engine.mjs

import {
  applyMove, createInitialState, getStatus, handPips, legalMoves,
  openEnds, tilePips, tileValues,
} from '../js/engine.js';
import { chooseMove } from '../js/bot.js';

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { passed++; console.log(`  ok — ${label}`); }
  else { failed++; console.error(`FAIL — ${label}`); }
}

function fixture(numPlayers, overrides = {}) {
  return { ...createInitialState({ numPlayers, seed: 42 }), ...overrides };
}

function allTileIds(state) {
  return [
    ...state.hands.flat(),
    ...state.boneyard,
    ...state.chain.map((tile) => tile.id),
  ];
}

function validState(state) {
  const ids = allTileIds(state);
  if (ids.length !== 28 || new Set(ids).size !== 28) return false;
  if (state.hands.length !== state.numPlayers || state.scores.length !== state.numPlayers) return false;
  if (state.currentPlayer < 0 || state.currentPlayer >= state.numPlayers) return false;
  for (let i = 1; i < state.chain.length; i++) {
    if (state.chain[i - 1].right !== state.chain[i].left) return false;
  }
  return true;
}

console.log('\nDeterministic setup');
{
  const a = createInitialState({ numPlayers: 4, seed: 12345 });
  const b = createInitialState({ numPlayers: 4, seed: 12345 });
  const c = createInitialState({ numPlayers: 4, seed: 54321 });
  check(JSON.stringify(a) === JSON.stringify(b), 'same seed produces an identical four-player deal');
  check(JSON.stringify(a) !== JSON.stringify(c), 'different seeds produce different deals');
  check(a.hands.every((hand) => hand.length === 5), 'three and four players are dealt five tiles');
  const two = createInitialState({ numPlayers: 2, seed: 7 });
  check(two.hands.every((hand) => hand.length === 7), 'two players are dealt seven tiles');
  check(validState(two) && validState(a), 'all 28 unique double-six tiles are accounted for');
  check(two.currentPlayer === 0, 'seat zero opens a fresh match');
}

console.log('\nTile helpers and legal placement');
{
  check(JSON.stringify(tileValues('2-6')) === '[2,6]' && tilePips('2-6') === 8, 'tile values and pip totals are public helpers');
  const state = fixture(2, {
    hands: [['0-2', '5-6', '3-4'], ['0-0']],
    boneyard: ['0-1', '0-3', '0-4', '0-5', '0-6', '1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '2-2', '2-3', '2-4', '2-5', '2-6', '3-3', '3-5', '3-6', '4-4', '4-5', '4-6', '5-5', '6-6'],
    chain: [{ id: '2-5', left: 2, right: 5 }],
    currentPlayer: 0,
  });
  const moves = legalMoves(state);
  check(moves.some((move) => move.tile === '0-2' && move.side === 'left'), 'a matching tile can play on the left end');
  check(moves.some((move) => move.tile === '5-6' && move.side === 'right'), 'a matching tile can play on the right end');
  check(!moves.some((move) => move.tile === '3-4'), 'a tile matching neither end is not legal');
  const left = applyMove(state, { type: 'play', tile: '0-2', side: 'left' });
  check(openEnds(left).left === 0 && openEnds(left).right === 5, 'left play is oriented into a readable chain');
  check(state.hands[0].length === 3 && state.chain.length === 1, 'applyMove never mutates its input state');
}

console.log('\nTurn rotation at every crew size');
for (const numPlayers of [2, 3, 4]) {
  let state = createInitialState({ numPlayers, seed: 90 + numPlayers });
  state = applyMove(state, legalMoves(state)[0]);
  check(state.currentPlayer === 1, `${numPlayers}-player turn advances from seat 0 to seat 1`);
  for (let expected = 2; expected <= numPlayers; expected++) {
    while (state.currentPlayer === expected - 1 && state.phase === 'playing') {
      state = applyMove(state, legalMoves(state)[0]);
    }
    check(state.phase !== 'playing' || state.currentPlayer === expected % numPlayers,
      `${numPlayers}-player rotation advances seat ${expected - 1}`);
  }
}

console.log('\nDraw, pass, and blocked-round rules');
{
  let state = fixture(2, {
    hands: [['0-0'], ['3-3']],
    boneyard: ['1-4', '2-3'],
    chain: [{ id: '2-5', left: 2, right: 5 }],
    currentPlayer: 0,
  });
  check(JSON.stringify(legalMoves(state)) === JSON.stringify([{ type: 'draw' }]), 'a stuck player must draw while the boneyard has tiles');
  state = applyMove(state, { type: 'draw' });
  check(state.currentPlayer === 0 && state.hands[0].includes('2-3'), 'drawing keeps the turn and adds the hidden tile');
  check(legalMoves(state).some((move) => move.type === 'play' && move.tile === '2-3'), 'drawing stops as soon as the new tile can play');

  let blocked = fixture(3, {
    hands: [['0-0'], ['0-1'], ['6-6']],
    boneyard: [],
    chain: [{ id: '2-5', left: 2, right: 5 }],
    currentPlayer: 0,
    roundStarter: 0,
  });
  for (let i = 0; i < 3; i++) blocked = applyMove(blocked, { type: 'pass' });
  check(blocked.phase === 'round-over' && blocked.roundResult.reason === 'blocked', 'a full lap of passes blocks the round');
  check(blocked.roundResult.winner === 0, 'lowest pip count takes a blocked round');
  check(blocked.scores[0] === 13, 'blocked winner scores all rival pips');
}

console.log('\nRound scoring and the race to 100');
{
  const readyToWin = fixture(2, {
    scores: [0, 0],
    hands: [['1-2'], ['6-6']],
    boneyard: ['0-0', '0-2', '0-3', '0-4', '0-5', '0-6', '1-1', '1-3', '1-4', '1-5', '1-6', '2-2', '2-3', '2-4', '2-5', '2-6', '3-3', '3-4', '3-5', '3-6', '4-4', '4-5', '4-6', '5-5', '5-6'],
    chain: [{ id: '0-1', left: 0, right: 1 }],
    currentPlayer: 0,
  });
  let state = applyMove(readyToWin, { type: 'play', tile: '1-2', side: 'right' });
  check(state.phase === 'round-over' && state.scores[0] === 12, 'emptying a hand wins and scores every rival pip');
  check(JSON.stringify(legalMoves(state)) === JSON.stringify([{ type: 'next-round' }]), 'round winner can deal the next round');
  const beforeScore = state.scores[0];
  const next = applyMove(state, { type: 'next-round' });
  check(next.round === 2 && next.phase === 'playing' && next.scores[0] === beforeScore, 'next round keeps the match score and deals a fresh set');
  check(validState(next), 'next-round deal still conserves all 28 tiles');

  const atNinety = { ...readyToWin, scores: [90, 0] };
  const match = applyMove(atNinety, { type: 'play', tile: '1-2', side: 'right' });
  check(getStatus(match).over && match.matchWinner === 0 && match.scores[0] === 102, 'first player to at least 100 wins the match');
  check(legalMoves(match).length === 0, 'no moves are legal after the match ends');
}

console.log('\nSerialization and bot speed');
{
  let state = createInitialState({ numPlayers: 3, seed: 808 });
  for (let i = 0; i < 40 && !getStatus(state).over; i++) {
    state = JSON.parse(JSON.stringify(state));
    state = applyMove(state, legalMoves(state)[0]);
  }
  const thawed = JSON.parse(JSON.stringify(state));
  check(JSON.stringify(legalMoves(thawed)) === JSON.stringify(legalMoves(state)), 'JSON stringify/parse resumes with identical legal moves');

  const sample = createInitialState({ numPlayers: 2, seed: 99 });
  const started = performance.now();
  for (let i = 0; i < 1000; i++) chooseMove(sample, i % 2 ? 'neighbor' : 'pete');
  const elapsed = performance.now() - started;
  check(elapsed < 300, `1,000 bot choices finish under 300ms (${elapsed.toFixed(1)}ms)`);
}

console.log('\nRandom-legal-move soak');
let randomState = 0xdecafbad;
function randomChoice(items) {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return items[randomState % items.length];
}
let completed = 0;
for (let game = 0; game < 240; game++) {
  const numPlayers = 2 + (game % 3);
  let state = createInitialState({ numPlayers, seed: game + 1 });
  let moves = 0;
  while (!getStatus(state).over && moves < 1800) {
    if (!validState(state)) break;
    const old = JSON.stringify(state);
    state = applyMove(state, randomChoice(legalMoves(state)));
    if (JSON.stringify(JSON.parse(old)) !== old) break;
    moves++;
  }
  if (getStatus(state).over && validState(state)) completed++;
}
check(completed === 240, `240/240 random matches finish without an illegal state (got ${completed})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
