/* FRONT PORCH DOMINOES — interface only. All game rules are in engine.js;
 * bot choices are in bot.js. The online room receives the complete state,
 * but this honest UI renders only this phone's private hand. */

import {
  applyMove, createInitialState, getStatus, handPips, isDouble,
  legalMoves, openEnds, tilePips, tileValues,
} from './engine.js';
import { BOT_PERSONAS, chooseMove } from './bot.js';
import { OnlineMatch, clearSession, getName, savedSession } from './rooms.js';
import {
  lbEnabled, fetchTop, submitScore, renamePlayer, monthLabel,
  getName as lbGetName, playerId as lbPlayerId,
} from './leaderboard.js';

const GAME = 'front-porch-dominoes';
const SAVE_KEY = 'front-porch-dominoes-save-v1';
const BOT_SEAT = 1;
const $ = (id) => document.getElementById(id);
const screens = {
  menu: $('menu'), handoff: $('handoff'), game: $('game'),
  roundover: $('roundover'), gameover: $('gameover'),
};

let G = null; // { mode: 'bot' | 'pass' | 'online', state, bot? }
let handRevealed = true;
let botTimer = 0;
let online = null; // { match, myPlayer }
let onlinePushing = false;
let panelIntent = 'host';
let selectedSeats = 2;
let pendingTile = null;
let leaveTimer = 0;
let pollErrors = 0;

const newSeed = () => (Math.random() * 0x7fffffff) | 0;

function show(name) {
  Object.entries(screens).forEach(([key, element]) => element.classList.toggle('hidden', key !== name));
}

function playerName(seat) {
  if (!G) return `Player ${seat + 1}`;
  if (G.mode === 'bot') {
    if (seat === 0) return 'You';
    return BOT_PERSONAS[G.bot]?.name || BOT_PERSONAS.pete.name;
  }
  if (G.mode === 'online') {
    if (online && seat === online.myPlayer) return 'You';
    const occupant = online?.match.seats.find((candidate) => candidate.seat === seat);
    return occupant?.name || `Player ${seat + 1}`;
  }
  return `Player ${seat + 1}`;
}

function localSeat() {
  if (G.mode === 'online') return online.myPlayer;
  if (G.mode === 'bot') return 0;
  return G.state.currentPlayer;
}

function canAct() {
  if (!G || onlinePushing || G.state.phase === 'match-over') return false;
  if (G.mode === 'bot') return G.state.phase === 'playing' && G.state.currentPlayer === 0;
  if (G.mode === 'online') {
    return online.match.status === 'playing' && G.state.currentPlayer === online.myPlayer;
  }
  return handRevealed;
}

function saveLocal() {
  if (!G || G.mode === 'online') return;
  try {
    if (G.state.phase === 'match-over') localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, JSON.stringify(G));
  } catch { /* Storage can be unavailable; the game still works. */ }
}

function loadLocal() {
  try {
    const value = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (value?.state?.version === 1 && value.state.phase !== 'match-over') return value;
  } catch { /* Ignore a stale or damaged save. */ }
  return null;
}

/* --------------------------------------------------------------- dominoes */

const DOTS = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function faceElement(value) {
  const face = document.createElement('span');
  face.className = 'face';
  face.setAttribute('aria-hidden', 'true');
  for (const position of DOTS[value]) {
    const dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.gridRow = String(Math.floor(position / 3) + 1);
    dot.style.gridColumn = String((position % 3) + 1);
    face.appendChild(dot);
  }
  return face;
}

function dominoElement(left, right, { hand = false, double = left === right } = {}) {
  const domino = document.createElement('span');
  domino.className = `domino${double ? ' double' : ''}${hand ? ' hand-domino' : ''}`;
  domino.append(faceElement(left), faceElement(right));
  return domino;
}

function renderChain() {
  const board = $('chainBoard');
  board.replaceChildren();
  const chain = G.state.chain;
  if (chain.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chain-empty';
    empty.textContent = `${playerName(G.state.currentPlayer)} lays the first tile.`;
    board.appendChild(empty);
    return;
  }

  const width = board.clientWidth || window.innerWidth;
  const perRow = Math.max(3, Math.floor((width - 20) / 56));
  for (let start = 0, rowIndex = 0; start < chain.length; start += perRow, rowIndex++) {
    const row = document.createElement('div');
    row.className = `chain-row${rowIndex % 2 ? ' reverse' : ''}`;
    const chunk = chain.slice(start, start + perRow);
    for (const tile of chunk) {
      const cell = document.createElement('div');
      cell.className = 'chain-cell';
      cell.appendChild(dominoElement(tile.left, tile.right, { double: isDouble(tile.id) }));
      row.appendChild(cell);
    }
    board.appendChild(row);
  }
  board.scrollTop = board.scrollHeight;
}

function sortedHand(hand) {
  return hand.slice().sort((a, b) => {
    const av = tileValues(a);
    const bv = tileValues(b);
    return (av[0] - bv[0]) || (av[1] - bv[1]);
  });
}

function renderHand() {
  const handEl = $('hand');
  handEl.replaceChildren();
  const seat = localSeat();
  const tiles = sortedHand(G.state.hands[seat]);
  const moves = legalMoves(G.state);
  const playable = new Set(moves.filter((move) => move.type === 'play').map((move) => move.tile));
  const enabled = canAct() && G.state.phase === 'playing';

  $('handLabel').textContent = G.mode === 'pass' ? `${playerName(seat).toUpperCase()}’S HAND` : 'YOUR HAND';
  $('handPips').textContent = `${tiles.length} tiles · ${handPips(tiles)} pips`;
  for (const tile of tiles) {
    const [a, b] = tileValues(tile);
    const button = document.createElement('button');
    button.className = `hand-tile${playable.has(tile) && enabled ? ' playable' : ''}`;
    button.dataset.tile = tile;
    button.disabled = !enabled;
    button.setAttribute('aria-label', `${a} ${b} domino${playable.has(tile) ? ', playable' : ''}`);
    button.appendChild(dominoElement(a, b, { hand: true }));
    const pips = document.createElement('span');
    pips.className = 'tile-pips';
    pips.textContent = `${a} · ${b}`;
    button.appendChild(pips);
    button.addEventListener('click', () => selectTile(tile, button));
    handEl.appendChild(button);
  }
}

function selectTile(tile, button) {
  if (!canAct()) return;
  const fits = legalMoves(G.state).filter((move) => move.type === 'play' && move.tile === tile);
  if (fits.length === 0) {
    button.animate(
      [{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
      { duration: 180 },
    );
    $('narration').textContent = 'That one doesn’t meet either open end.';
    return;
  }
  if (fits.length === 1 || fits[0].side === 'start') {
    commitMove(fits[0]);
    return;
  }
  pendingTile = tile;
  $('sidePicker').classList.remove('hidden');
}

/* ---------------------------------------------------------------- render */

function renderScores(target = $('scoreboard'), resultStyle = false) {
  target.replaceChildren();
  G.state.scores.forEach((score, seat) => {
    const chip = document.createElement(resultStyle ? 'div' : 'div');
    chip.className = resultStyle
      ? 'result-score'
      : `score-chip${G.state.currentPlayer === seat && G.state.phase === 'playing' ? ' active' : ''}`;
    const name = document.createElement('span');
    name.textContent = playerName(seat);
    const points = document.createElement('b');
    points.textContent = String(score);
    chip.append(name, points);
    target.appendChild(chip);
  });
}

function renderOpponents() {
  const area = $('opponents');
  area.replaceChildren();
  const mine = localSeat();
  for (let seat = 0; seat < G.state.numPlayers; seat++) {
    if (seat === mine) continue;
    const chip = document.createElement('div');
    chip.className = `opp-chip${G.state.currentPlayer === seat ? ' active' : ''}`;
    const name = document.createElement('span');
    name.textContent = playerName(seat);
    const count = document.createElement('b');
    count.textContent = `${G.state.hands[seat].length} tiles`;
    chip.append(name, count);
    area.appendChild(chip);
  }
}

function actionLine() {
  const action = G.state.lastAction;
  if (!action) return 'Lemonade poured. The porch is ready.';
  if (action.type === 'play') return `${playerName(action.player)} played ${action.tile.replace('-', '–')}.`;
  if (action.type === 'draw') return `${playerName(action.player)} drew from the boneyard.`;
  if (action.type === 'pass') return `${playerName(action.player)} had to pass.`;
  return `Round ${G.state.round} is dealt.`;
}

function renderGame() {
  $('roundLabel').textContent = `ROUND ${G.state.round}`;
  renderScores();
  renderOpponents();
  renderChain();
  renderHand();

  const moves = legalMoves(G.state);
  const mayDraw = canAct() && moves.some((move) => move.type === 'draw');
  const mayPass = canAct() && moves.some((move) => move.type === 'pass');
  $('drawBtn').disabled = !mayDraw;
  $('drawBtn').classList.toggle('ready', mayDraw);
  $('passGameBtn').classList.toggle('hidden', !mayPass);
  $('boneCount').textContent = `${G.state.boneyard.length} in the boneyard`;
  $('narration').textContent = actionLine();

  if (canAct()) {
    if (moves.some((move) => move.type === 'play')) $('turnNotice').textContent = 'YOUR TURN · MATCH AN OPEN END';
    else if (mayDraw) $('turnNotice').textContent = 'NO MATCH · DRAW FROM THE BONEYARD';
    else $('turnNotice').textContent = 'NOTHING FITS · PASS THE TURN';
  } else {
    $('turnNotice').textContent = `${playerName(G.state.currentPlayer).toUpperCase()} IS THINKING…`;
  }
}

function showHandoff(player) {
  handRevealed = false;
  $('handoffTitle').textContent = `Pass the phone to ${playerName(player)}`;
  $('handoffLine').textContent = `Only ${playerName(player)} should tap below. No peeking—it’s a small town.`;
  show('handoff');
}

function showRoundOver() {
  const result = G.state.roundResult;
  const title = $('roundTitle');
  const line = $('roundLine');
  if (result.winner === null) {
    title.textContent = 'A PORCH STALEMATE';
    line.textContent = 'Lowest pips were tied, so nobody scores. Fresh tiles, fresh lemonade.';
  } else if (result.reason === 'blocked') {
    title.textContent = `${playerName(result.winner).toUpperCase()} TAKES THE BLOCK`;
    line.textContent = `${result.pipCounts[result.winner]} pips was the lightest hand. Add ${result.points} points to the porch ledger.`;
  } else {
    title.textContent = `${playerName(result.winner).toUpperCase()} GOES OUT`;
    line.textContent = `Every rival pip counts: ${result.points} points this round.`;
  }
  renderScores($('roundScores'), true);
  const dealer = G.state.currentPlayer;
  const allowed = G.mode !== 'online' || dealer === online.myPlayer;
  $('nextRoundBtn').disabled = !allowed;
  $('nextRoundBtn').textContent = allowed
    ? 'DEAL THE NEXT ROUND'
    : `${playerName(dealer).toUpperCase()} DEALS NEXT`;
  show('roundover');
}

function showGameOver() {
  const winner = G.state.matchWinner;
  $('againBtn').classList.remove('hidden');
  $('gameoverTitle').textContent = winner === localSeat() ? 'YOU OWN THE PORCH!' : `${playerName(winner).toUpperCase()} WINS!`;
  $('gameoverLine').textContent = `${G.state.scores[winner]} points before the string lights blinked out. A proper Burlington finish.`;
  renderScores($('finalScores'), true);
  saveLocal();
  show('gameover');
  // Vs-bot matches only: submit exactly once per match (lbSubmitted resets
  // whenever a game starts or resumes). Losses show the standings read-only.
  if (G.mode === 'bot' && !lbSubmitted) {
    lbSubmitted = true;
    updateLeaderboard(winner === 0 ? botWinScore() : 0);
  }
}

function presentState(previousPlayer = null) {
  const status = getStatus(G.state);
  if (status.over) {
    showGameOver();
    return;
  }
  if (status.roundOver) {
    showRoundOver();
    return;
  }
  if (G.mode === 'pass' && previousPlayer !== null && previousPlayer !== G.state.currentPlayer) {
    showHandoff(G.state.currentPlayer);
    return;
  }
  show('game');
  renderGame();
  scheduleBot();
}

/* -------------------------------------------------------------- gameplay */

function startGame(mode, numPlayers, bot = 'pete') {
  clearTimeout(botTimer);
  online = null;
  onlinePushing = false;
  pendingTile = null;
  G = { mode, bot, state: createInitialState({ numPlayers, seed: newSeed() }) };
  lbSubmitted = false;
  resetLbPanel();
  saveLocal();
  if (mode === 'pass') showHandoff(0);
  else presentState();
}

function commitMove(move, { system = false } = {}) {
  if (!G || (!system && !canAct())) return;
  const previousPlayer = G.state.currentPlayer;
  let next;
  try { next = applyMove(G.state, move); }
  catch { return; }
  G.state = next;
  pendingTile = null;
  $('sidePicker').classList.add('hidden');

  if (G.mode === 'online') {
    onlinePushing = true;
    presentState(previousPlayer);
    pushOnline(next, previousPlayer);
    return;
  }
  saveLocal();
  if (G.mode === 'pass' && move.type === 'next-round') {
    showHandoff(G.state.currentPlayer);
    return;
  }
  presentState(previousPlayer);
}

function scheduleBot() {
  clearTimeout(botTimer);
  if (!G || G.mode !== 'bot' || G.state.phase !== 'playing' || G.state.currentPlayer !== BOT_SEAT) return;
  botTimer = setTimeout(() => {
    if (!G || G.mode !== 'bot' || G.state.currentPlayer !== BOT_SEAT) return;
    const move = chooseMove(G.state, G.bot);
    if (move) commitMove(move, { system: true });
  }, G.bot === 'neighbor' ? 620 : 780);
}

$('drawBtn').addEventListener('click', () => commitMove({ type: 'draw' }));
$('passGameBtn').addEventListener('click', () => commitMove({ type: 'pass' }));
$('playLeft').addEventListener('click', () => {
  if (pendingTile) commitMove({ type: 'play', tile: pendingTile, side: 'left' });
});
$('playRight').addEventListener('click', () => {
  if (pendingTile) commitMove({ type: 'play', tile: pendingTile, side: 'right' });
});
$('cancelSide').addEventListener('click', () => {
  pendingTile = null;
  $('sidePicker').classList.add('hidden');
});
$('handoffBtn').addEventListener('click', () => {
  handRevealed = true;
  show('game');
  renderGame();
});
$('nextRoundBtn').addEventListener('click', () => {
  if (G.mode === 'online' && G.state.currentPlayer !== online.myPlayer) return;
  commitMove({ type: 'next-round' }, { system: G.mode !== 'online' });
});
$('helpBtn').addEventListener('click', () => $('rulesPanel').classList.remove('hidden'));
$('closeRules').addEventListener('click', () => $('rulesPanel').classList.add('hidden'));

/* ------------------------------------------------------------------ menu */

document.querySelectorAll('.bot-choice').forEach((button) => {
  button.addEventListener('click', () => startGame('bot', 2, button.dataset.bot));
});
$('passBtn').addEventListener('click', () => $('countRow').classList.toggle('hidden'));
document.querySelectorAll('.count-btn').forEach((button) => {
  button.addEventListener('click', () => startGame('pass', Number(button.dataset.n)));
});
$('resumeBtn').addEventListener('click', () => {
  const saved = loadLocal();
  if (!saved) return refreshMenu();
  G = saved;
  lbSubmitted = false; // a resumed match hasn't been submitted yet
  resetLbPanel();
  handRevealed = G.mode !== 'pass';
  if (G.mode === 'pass' && G.state.phase === 'playing') showHandoff(G.state.currentPlayer);
  else presentState();
});

function refreshMenu() {
  $('resumeBtn').classList.toggle('hidden', !loadLocal());
  refreshRejoin();
}

function resetLeaveButton(button) {
  clearTimeout(leaveTimer);
  if (!button) return;
  if (button.dataset.oldText) button.textContent = button.dataset.oldText;
  button.dataset.oldText = '';
  button.dataset.armed = '';
}

function goMenu(button) {
  if (online) {
    if (!button || button.dataset.armed !== '1') {
      if (button) {
        button.dataset.armed = '1';
        button.dataset.oldText = button.textContent;
        button.textContent = 'LEAVE?';
        leaveTimer = setTimeout(() => resetLeaveButton(button), 2500);
      }
      return;
    }
    const match = online.match;
    online = null;
    onlinePushing = false;
    match.leave();
    resetLeaveButton(button);
  }
  clearTimeout(botTimer);
  show('menu');
  refreshMenu();
}

$('homeBtn').addEventListener('click', () => goMenu($('homeBtn')));
$('roundMenuBtn').addEventListener('click', () => goMenu($('roundMenuBtn')));
$('menuBtn').addEventListener('click', () => goMenu($('menuBtn')));
$('againBtn').addEventListener('click', () => {
  if (G.mode === 'online') onlineRematch();
  else startGame(G.mode, G.state.numPlayers, G.bot);
});

/* ----------------------------------------------------------- online play */

const onlinePanel = $('onlinePanel');
const opName = $('opName');
const opCode = $('opCode');
const opError = $('opError');
const lobby = $('lobby');

$('hostBtn').addEventListener('click', () => openPanel('host'));
$('joinBtn').addEventListener('click', () => openPanel('join'));
$('opCancel').addEventListener('click', () => onlinePanel.classList.add('hidden'));
$('opGo').addEventListener('click', onlineGo);
$('lobbyCancel').addEventListener('click', cancelLobby);
$('rejoinBtn').addEventListener('click', rejoinCrew);
opCode.addEventListener('input', () => {
  opCode.value = opCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
[opName, opCode].forEach((input) => input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') onlineGo();
}));
document.querySelectorAll('.seat-btn').forEach((button) => {
  button.addEventListener('click', () => {
    selectedSeats = Number(button.dataset.seats);
    document.querySelectorAll('.seat-btn').forEach((choice) => {
      const active = choice === button;
      choice.classList.toggle('selected', active);
      choice.setAttribute('aria-pressed', String(active));
    });
  });
});

function openPanel(intent) {
  panelIntent = intent;
  $('opTitle').textContent = intent === 'host' ? 'START A CREW' : 'JOIN A CREW';
  $('opGo').textContent = intent === 'host' ? 'GET A CODE' : 'PULL UP A CHAIR';
  $('opSeatsWrap').classList.toggle('hidden', intent !== 'host');
  $('opCodeWrap').classList.toggle('hidden', intent === 'host');
  opError.classList.add('hidden');
  opName.value = opName.value || getName();
  onlinePanel.classList.remove('hidden');
  (intent === 'join' && opName.value ? opCode : opName).focus();
}

const ONLINE_ERRORS = {
  not_found: 'No porch has that code. Check it and try again.',
  room_full: 'Every chair on that porch is taken.',
  room_started: 'That crew already started the match.',
  not_ready: 'Online play isn’t switched on yet—check back soon.',
  offline: 'Can’t reach the porch. Check your connection.',
};

function friendlyError(error) {
  if (error?.code === 'wrong_game') return 'That code belongs to another Btown game.';
  return ONLINE_ERRORS[error?.code] || 'The porch lights flickered. Please try again.';
}

async function onlineGo() {
  const go = $('opGo');
  if (go.disabled) return;
  const name = opName.value.trim();
  if (!name) {
    opError.textContent = 'Every porch player needs a name.';
    opError.classList.remove('hidden');
    opName.focus();
    return;
  }
  go.disabled = true;
  opError.classList.add('hidden');
  try {
    let match;
    if (panelIntent === 'host') {
      match = await OnlineMatch.create({
        game: GAME,
        name,
        seats: selectedSeats,
        state: createInitialState({ numPlayers: selectedSeats, seed: newSeed() }),
      });
    } else {
      if (opCode.value.trim().length !== 4) throw Object.assign(new Error('code'), { code: 'short_code' });
      match = await OnlineMatch.join({ game: GAME, code: opCode.value, name });
    }
    onlinePanel.classList.add('hidden');
    if (match.status === 'waiting') openLobby(match);
    else enterOnlineGame(match);
  } catch (error) {
    opError.textContent = error?.code === 'short_code' ? 'The porch code has 4 characters.' : friendlyError(error);
    opError.classList.remove('hidden');
  } finally {
    go.disabled = false;
  }
}

function renderLobby(match) {
  $('lobbyCode').textContent = match.code;
  const names = $('lobbyNames');
  names.replaceChildren();
  const total = match.state?.numPlayers || selectedSeats;
  for (let seat = 0; seat < total; seat++) {
    const occupant = match.seats.find((candidate) => candidate.seat === seat);
    const item = document.createElement('li');
    item.textContent = occupant ? `${occupant.name} · Chair ${seat + 1}` : `Waiting for chair ${seat + 1}…`;
    names.appendChild(item);
  }
}

function openLobby(match) {
  if (lobby._match && lobby._match !== match) lobby._match.stop();
  lobby._match = match;
  renderLobby(match);
  lobby.classList.remove('hidden');
  match.start({
    onStatus: (status) => {
      if (status === 'playing') {
        lobby.classList.add('hidden');
        enterOnlineGame(match);
      } else if (status === 'over') {
        $('lobbyHint').textContent = 'Someone stepped away. Call it off and start a new crew.';
      }
    },
    onPresence: () => renderLobby(match),
    onError: () => {},
  });
}

function cancelLobby() {
  const match = lobby._match;
  if (match) match.leave();
  lobby._match = null;
  lobby.classList.add('hidden');
  refreshRejoin();
}

async function rejoinCrew() {
  const button = $('rejoinBtn');
  button.disabled = true;
  try {
    const match = await OnlineMatch.resume({ game: GAME });
    if (match.status === 'waiting') openLobby(match);
    else enterOnlineGame(match);
  } catch (error) {
    if (['not_found', 'not_seated', 'room_started'].includes(error?.code)) clearSession(GAME);
    refreshRejoin();
  } finally {
    button.disabled = false;
  }
}

function refreshRejoin() {
  const saved = savedSession(GAME);
  $('rejoinBtn').classList.toggle('hidden', !saved);
  if (saved) $('rejoinBtn').textContent = `↩ REJOIN YOUR PORCH (${saved.code})`;
}

function enterOnlineGame(match) {
  clearTimeout(botTimer);
  online = { match, myPlayer: match.seat };
  onlinePushing = false;
  pollErrors = 0;
  G = { mode: 'online', state: match.state };
  lbSubmitted = false;
  resetLbPanel();
  handRevealed = true;
  lobby.classList.add('hidden');
  presentState();
  match.start({
    onState: (state) => {
      if (!online || online.match !== match) return;
      G.state = state;
      onlinePushing = false;
      presentState();
    },
    onStatus: (status) => {
      if (status === 'over' && G.state.phase !== 'match-over') showDeparture();
    },
    onPresence: (opponents) => {
      pollErrors = 0;
      const departed = opponents.find((opponent) => opponent.left);
      if (departed && G.state.phase !== 'match-over') showDeparture(departed.name);
      else if (!screens.game.classList.contains('hidden')) renderOpponents();
    },
    onError: (error) => {
      pollErrors++;
      if (error?.code === 'not_found') {
        clearSession(GAME);
        online = null;
        show('menu');
        refreshMenu();
      } else if (pollErrors >= 3 && !screens.game.classList.contains('hidden')) {
        $('narration').textContent = 'Choppy connection—the porch is holding your seat…';
      }
    },
  });
  if (match.status === 'over' && G.state.phase !== 'match-over') showDeparture();
}

async function pushOnline(nextState, previousPlayer) {
  const match = online?.match;
  if (!match) return;
  try {
    await match.push(nextState, { over: getStatus(nextState).over });
    if (!online || online.match !== match) return;
    onlinePushing = false;
    G.state = match.state;
    presentState(previousPlayer);
  } catch (error) {
    if (!online || online.match !== match) return;
    onlinePushing = false;
    G.state = match.state;
    presentState();
    if (error?.code !== 'version_conflict' && !screens.game.classList.contains('hidden')) {
      $('narration').textContent = 'That move didn’t reach the porch. Please try again.';
    }
  }
}

function showDeparture(name = 'A crew member') {
  $('gameoverTitle').textContent = 'A CHAIR WENT EMPTY';
  $('gameoverLine').textContent = `${name} stepped away, so this online match is over.`;
  $('finalScores').replaceChildren();
  $('againBtn').classList.add('hidden');
  resetLbPanel();
  show('gameover');
}

async function onlineRematch() {
  if (!online || onlinePushing) return;
  $('againBtn').disabled = true;
  const fresh = createInitialState({ numPlayers: G.state.numPlayers, seed: newSeed() });
  G.state = fresh;
  onlinePushing = true;
  show('game');
  renderGame();
  await pushOnline(fresh, null);
  $('againBtn').disabled = false;
}

/* ------------------------------------------------------------- leaderboard */
// Monthly board for vs-bot wins only. Score = point margin at 100
// (your points minus the bot's), clamped to 1..999, +1000 for beating
// The Neighbor so any Neighbor win outranks any Pete win.

const lbBox = $('lb');
const lbList = $('lbList');
const lbStatusEl = $('lbStatus');
const lbForm = $('lbForm');
const lbNameInput = $('lbNameInput');
const lbThisBtn = $('lbThisBtn');
const lbLastBtn = $('lbLastBtn');
const lbRenameBtn = $('lbRenameBtn');
let lbMonthOffset = 0;
let lbSubmitted = false;

if (lbEnabled()) {
  lbThisBtn.textContent = `🏆 ${monthLabel(0)}`;
  lbLastBtn.textContent = monthLabel(-1);
}

function resetLbPanel() {
  lbBox.classList.add('hidden');
  lbForm.classList.add('hidden');
  lbForm.dataset.pendingScore = '';
}

function botWinScore() {
  const margin = Math.max(1, Math.min(999, G.state.scores[0] - G.state.scores[BOT_SEAT]));
  return G.bot === 'neighbor' ? 1000 + margin : margin;
}

// s >= 1000 means a Neighbor win (margin = s - 1000); otherwise a Pete win
function lbScoreLabel(s) {
  return s >= 1000 ? `👀 +${s - 1000} pts` : `🪑 +${s} pts`;
}

// score > 0 submits a fresh win; score 0 just shows the standings read-only
async function updateLeaderboard(score) {
  if (!lbEnabled()) return;
  lbBox.classList.remove('hidden');
  if (score > 0 && !lbGetName()) {
    // first win with no saved name: hold the score until they pick one
    lbForm.classList.remove('hidden');
    lbRenameBtn.classList.add('hidden');
    lbStatusEl.textContent = 'Pick a name to join the monthly leaderboard!';
    lbList.replaceChildren();
    lbForm.dataset.pendingScore = String(score);
    return;
  }
  if (score > 0) {
    try { await submitScore(score); } catch { /* offline — still show the board */ }
  }
  renderLbBoard();
}

async function renderLbBoard() {
  lbForm.classList.add('hidden');
  lbRenameBtn.classList.remove('hidden');
  lbStatusEl.textContent = 'Loading…';
  try {
    const rows = await fetchTop(lbMonthOffset);
    const me = lbPlayerId();
    lbList.replaceChildren();
    rows.slice(0, 10).forEach((r, i) => {
      const li = document.createElement('li');
      if (r.player_id === me) li.className = 'me';
      const medal = ['🥇', '🥈', '🥉'][i];
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = medal || `${i + 1}.`;
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = r.name;
      const sc = document.createElement('span');
      sc.className = 'sc';
      sc.textContent = lbScoreLabel(r.score);
      li.append(rank, nm, sc);
      lbList.appendChild(li);
    });
    const myRank = rows.findIndex((r) => r.player_id === me);
    lbStatusEl.textContent = rows.length === 0
      ? 'No scores yet this month — be the first!'
      : myRank >= 0 ? `You're #${myRank + 1} of ${rows.length} this month` : '';
  } catch {
    lbStatusEl.textContent = 'Leaderboard unavailable (offline?)';
  }
}

$('lbSaveBtn').addEventListener('click', async () => {
  const name = lbNameInput.value.trim();
  if (!name) { lbNameInput.focus(); return; }
  const pending = Number(lbForm.dataset.pendingScore || 0);
  lbForm.dataset.pendingScore = '';
  try {
    await renamePlayer(name); // saves locally + renames any existing rows
    if (pending > 0) await submitScore(pending);
  } catch { /* offline — the name is still saved locally */ }
  renderLbBoard();
});
lbNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') $('lbSaveBtn').click();
});
lbRenameBtn.addEventListener('click', () => {
  lbNameInput.value = lbGetName();
  lbForm.classList.remove('hidden');
  lbRenameBtn.classList.add('hidden');
  lbNameInput.focus();
});
lbThisBtn.addEventListener('click', () => {
  lbMonthOffset = 0;
  lbThisBtn.classList.add('sel');
  lbLastBtn.classList.remove('sel');
  renderLbBoard();
});
lbLastBtn.addEventListener('click', () => {
  lbMonthOffset = -1;
  lbLastBtn.classList.add('sel');
  lbThisBtn.classList.remove('sel');
  renderLbBoard();
});

window.addEventListener('resize', () => {
  if (G && !screens.game.classList.contains('hidden')) renderChain();
});

refreshMenu();
show('menu');
