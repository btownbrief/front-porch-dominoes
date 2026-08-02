/* FRONT PORCH DOMINOES — pure rules only.
 *
 * The complete draw-dominoes match lives in one plain JSON state object.
 * There is no DOM, clock, or Math.random here. Shuffles use a seeded RNG
 * threaded through state, so the same seed produces the same match on every
 * phone and JSON.stringify -> parse -> resume is safe.
 *
 * Public moves:
 *   { type: 'play', tile: '2-5', side: 'left' | 'right' | 'start' }
 *   { type: 'draw' }
 *   { type: 'pass' }
 *   { type: 'next-round' }
 */

export const SCORE_LIMIT = 100;

export function tileValues(tile) {
  return String(tile).split('-').map(Number);
}

export function tilePips(tile) {
  const [a, b] = tileValues(tile);
  return a + b;
}

export function handPips(hand) {
  return hand.reduce((sum, tile) => sum + tilePips(tile), 0);
}

export function isDouble(tile) {
  const [a, b] = tileValues(tile);
  return a === b;
}

export function openEnds(state) {
  if (state.chain.length === 0) return { left: null, right: null };
  return {
    left: state.chain[0].left,
    right: state.chain[state.chain.length - 1].right,
  };
}

function fullSet() {
  const tiles = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) tiles.push(`${a}-${b}`);
  }
  return tiles;
}

function rngNext(s) {
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: s };
}

function shuffle(items, rngState) {
  const shuffled = items.slice();
  let rng = rngState;
  for (let i = shuffled.length - 1; i > 0; i--) {
    const next = rngNext(rng);
    rng = next.state;
    const j = Math.floor(next.value * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return { shuffled, rng };
}

function deal(numPlayers, rngState) {
  const mixed = shuffle(fullSet(), rngState);
  const handSize = numPlayers === 2 ? 7 : 5;
  const hands = Array.from({ length: numPlayers }, (_, player) =>
    mixed.shuffled.slice(player * handSize, (player + 1) * handSize));
  return {
    hands,
    boneyard: mixed.shuffled.slice(numPlayers * handSize),
    rng: mixed.rng,
  };
}

export function createInitialState(options = {}) {
  const numPlayers = options.numPlayers ?? 2;
  if (!Number.isInteger(numPlayers) || numPlayers < 2 || numPlayers > 4) {
    throw new Error('numPlayers must be 2, 3, or 4');
  }
  const seed = (options.seed ?? 1) | 0;
  const round = deal(numPlayers, seed);
  return {
    version: 1,
    seed,
    rng: round.rng,
    numPlayers,
    scoreLimit: SCORE_LIMIT,
    scores: Array(numPlayers).fill(0),
    round: 1,
    roundStarter: 0,
    currentPlayer: 0,
    phase: 'playing',
    hands: round.hands,
    boneyard: round.boneyard,
    chain: [],
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    lastAction: null,
  };
}

function orientedTile(tile, side, end) {
  const [a, b] = tileValues(tile);
  if (side === 'start') return { id: tile, left: a, right: b };
  if (side === 'left') {
    if (b === end) return { id: tile, left: a, right: b };
    if (a === end) return { id: tile, left: b, right: a };
  }
  if (side === 'right') {
    if (a === end) return { id: tile, left: a, right: b };
    if (b === end) return { id: tile, left: b, right: a };
  }
  return null;
}

function playableMoves(state, hand) {
  if (state.chain.length === 0) {
    return hand.map((tile) => ({ type: 'play', tile, side: 'start' }));
  }
  const ends = openEnds(state);
  const moves = [];
  for (const tile of hand) {
    if (orientedTile(tile, 'left', ends.left)) moves.push({ type: 'play', tile, side: 'left' });
    if (orientedTile(tile, 'right', ends.right)) moves.push({ type: 'play', tile, side: 'right' });
  }
  return moves;
}

export function legalMoves(state) {
  if (state.phase === 'match-over') return [];
  if (state.phase === 'round-over') return [{ type: 'next-round' }];

  const plays = playableMoves(state, state.hands[state.currentPlayer]);
  if (plays.length > 0) return plays;
  if (state.boneyard.length > 0) return [{ type: 'draw' }];
  return [{ type: 'pass' }];
}

function sameMove(a, b) {
  return a.type === b.type && a.tile === b.tile && a.side === b.side;
}

export function applyMove(state, move) {
  if (!legalMoves(state).some((candidate) => sameMove(candidate, move))) {
    throw new Error(`Illegal move: ${JSON.stringify(move)}`);
  }
  if (move.type === 'play') return applyPlay(state, move);
  if (move.type === 'draw') return applyDraw(state);
  if (move.type === 'pass') return applyPass(state);
  return startNextRound(state);
}

function applyPlay(state, move) {
  const player = state.currentPlayer;
  const hand = state.hands[player];
  const index = hand.indexOf(move.tile);
  const newHand = hand.slice(0, index).concat(hand.slice(index + 1));
  const hands = state.hands.map((candidate, seat) => seat === player ? newHand : candidate);
  const ends = openEnds(state);
  const placed = orientedTile(
    move.tile,
    move.side,
    move.side === 'left' ? ends.left : ends.right,
  );
  const chain = move.side === 'left'
    ? [placed, ...state.chain]
    : [...state.chain, placed];
  const next = {
    ...state,
    hands,
    chain,
    currentPlayer: (player + 1) % state.numPlayers,
    consecutivePasses: 0,
    lastAction: { player, type: 'play', tile: move.tile, side: move.side },
  };
  return newHand.length === 0 ? finishRound(next, [player], 'out') : next;
}

function applyDraw(state) {
  const player = state.currentPlayer;
  const tile = state.boneyard[state.boneyard.length - 1];
  return {
    ...state,
    hands: state.hands.map((hand, seat) => seat === player ? hand.concat(tile) : hand),
    boneyard: state.boneyard.slice(0, -1),
    consecutivePasses: 0,
    lastAction: { player, type: 'draw' },
  };
}

function applyPass(state) {
  const player = state.currentPlayer;
  const consecutivePasses = state.consecutivePasses + 1;
  const next = {
    ...state,
    currentPlayer: (player + 1) % state.numPlayers,
    consecutivePasses,
    lastAction: { player, type: 'pass' },
  };
  if (consecutivePasses < state.numPlayers) return next;

  const pipCounts = state.hands.map(handPips);
  const lowest = Math.min(...pipCounts);
  const winners = [];
  pipCounts.forEach((count, seat) => { if (count === lowest) winners.push(seat); });
  return finishRound(next, winners, 'blocked');
}

function finishRound(state, winners, reason) {
  const pipCounts = state.hands.map(handPips);
  const winner = winners.length === 1 ? winners[0] : null;
  const points = winner === null
    ? 0
    : pipCounts.reduce((sum, count, seat) => seat === winner ? sum : sum + count, 0);
  const scores = state.scores.map((score, seat) => seat === winner ? score + points : score);
  const matchWinner = winner !== null && scores[winner] >= state.scoreLimit ? winner : null;
  const nextStarter = winner ?? ((state.roundStarter + 1) % state.numPlayers);
  return {
    ...state,
    scores,
    currentPlayer: nextStarter,
    phase: matchWinner === null ? 'round-over' : 'match-over',
    roundResult: { winner, winners, reason, points, pipCounts },
    matchWinner,
  };
}

function startNextRound(state) {
  const nextStarter = state.currentPlayer;
  const dealt = deal(state.numPlayers, state.rng);
  return {
    ...state,
    rng: dealt.rng,
    round: state.round + 1,
    roundStarter: nextStarter,
    currentPlayer: nextStarter,
    phase: 'playing',
    hands: dealt.hands,
    boneyard: dealt.boneyard,
    chain: [],
    consecutivePasses: 0,
    roundResult: null,
    lastAction: { player: nextStarter, type: 'new-round' },
  };
}

export function getStatus(state) {
  return {
    status: state.phase,
    over: state.phase === 'match-over',
    roundOver: state.phase === 'round-over',
    winner: state.phase === 'match-over' ? state.matchWinner : state.roundResult?.winner ?? null,
    winners: state.roundResult?.winners ?? [],
    reason: state.roundResult?.reason ?? null,
  };
}
