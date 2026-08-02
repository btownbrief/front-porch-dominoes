/* FRONT PORCH DOMINOES bots. They inspect and compare moves only through
 * engine.js's public API; every candidate they return is engine-legal. */

import { applyMove, isDouble, legalMoves, tilePips } from './engine.js';

export const BOT_PERSONAS = {
  pete: {
    name: 'Porch Swing Pete',
    emoji: '🪑',
    blurb: 'Easygoing. Sheds the heaviest tile he can.',
  },
  neighbor: {
    name: 'The Neighbor',
    emoji: '👀',
    blurb: 'Sharper. Pinches off the numbers you need.',
  },
};

export function chooseMove(state, persona = 'pete') {
  const moves = legalMoves(state);
  if (moves.length <= 1) return moves[0] ?? null;
  const plays = moves.filter((move) => move.type === 'play');
  if (plays.length === 0) return moves[0];
  return persona === 'neighbor' ? neighborMove(state, plays) : peteMove(plays);
}

function peteMove(plays) {
  return plays.reduce((best, move) => {
    const score = tilePips(move.tile) * 10 + (isDouble(move.tile) ? 3 : 0);
    const bestScore = tilePips(best.tile) * 10 + (isDouble(best.tile) ? 3 : 0);
    return score > bestScore ? move : best;
  }, plays[0]);
}

function neighborMove(state, plays) {
  let best = plays[0];
  let bestScore = -Infinity;
  for (const move of plays) {
    const next = applyMove(state, move);
    const replies = legalMoves(next);
    const playableReplies = replies.filter((reply) => reply.type === 'play').length;
    const finishesRound = next.phase !== 'playing';
    const score = (finishesRound ? 100000 : 0)
      - playableReplies * 100
      + tilePips(move.tile) * 4
      + (isDouble(move.tile) ? 2 : 0);
    if (score > bestScore) {
      best = move;
      bestScore = score;
    }
  }
  return best;
}
