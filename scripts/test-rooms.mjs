// Online rooms wiring test: real vendored client + local canonical shim,
// including complete two- and three-phone Front Porch Dominoes matches.

import { createRooms } from './rooms-shim.mjs';
import { applyMove, createInitialState, getStatus, legalMoves } from '../js/engine.js';

const GAME = 'front-porch-dominoes';
const stores = new Map();
let currentDevice = 'A';
globalThis.localStorage = {
  getItem: (key) => stores.get(currentDevice)?.get(key) ?? null,
  setItem: (key, value) => stores.get(currentDevice).set(key, String(value)),
  removeItem: (key) => stores.get(currentDevice).delete(key),
};
function device(id) {
  if (!stores.has(id)) stores.set(id, new Map());
  currentDevice = id;
}
for (const id of ['A', 'B', 'C', 'D']) device(id);
device('A');

let passed = 0;
function check(condition, label) {
  if (!condition) {
    console.error(`FAIL — ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ok — ${label}`);
}
async function expectCode(promise, code, label) {
  try { await promise; check(false, `${label} (no error)`); }
  catch (error) { check(error?.code === code, `${label} (got ${error?.code})`); }
}

let randomState = 0x8badf00d;
function randomChoice(items) {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return items[randomState % items.length];
}

async function syncPhones(phones) {
  for (const phone of phones) {
    device(phone.device);
    await phone.match._fetch();
  }
  const truth = JSON.stringify(phones[0].match.state);
  return phones.every((phone) => JSON.stringify(phone.match.state) === truth);
}

async function playSyncedMatch(phones, cap = 1000) {
  let moves = 0;
  let synced = await syncPhones(phones);
  while (!getStatus(phones[0].match.state).over && moves < cap && synced) {
    const truth = phones[0].match.state;
    const mover = phones.find((phone) => phone.match.seat === truth.currentPlayer);
    if (!mover) throw new Error(`No phone for engine seat ${truth.currentPlayer}`);
    device(mover.device);
    await mover.match._fetch();
    const next = applyMove(mover.match.state, randomChoice(legalMoves(mover.match.state)));
    await mover.match.push(next, { over: getStatus(next).over });
    moves++;
    synced = await syncPhones(phones);
  }
  return { moves, synced, finished: getStatus(phones[0].match.state).over };
}

const shim = createRooms();
let backendReady = true;
globalThis.BTOWN_ROOMS_URL = 'http://rooms.test';
globalThis.fetch = async (url, options = {}) => {
  if (!backendReady) return new Response('{}', { status: 404 });
  const match = String(url).match(/\/rest\/v1\/rpc\/(\w+)$/);
  if ((options.method || 'GET') !== 'POST' || !match || !shim.rpcs[match[1]]) {
    return new Response(JSON.stringify({ message: 'not a room rpc' }), { status: 404 });
  }
  try {
    const body = shim.rpcs[match[1]](JSON.parse(options.body || '{}')) ?? {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), {
      status: error.rpc ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

const { OnlineMatch, RoomsError, savedSession } = await import('../js/rooms.js');

console.log('\nGeneric rooms checks');
device('A');
const host = await OnlineMatch.create({
  game: GAME, name: 'Maple A', seats: 2,
  state: createInitialState({ numPlayers: 2, seed: 101 }),
});
check(/^[A-Z2-9]{4}$/.test(host.code) && host.seat === 0 && host.status === 'waiting', 'host creates a room in engine seat 0');
check(savedSession(GAME)?.roomId === host.roomId, 'host session is saved for rejoin');

device('B');
await expectCode(OnlineMatch.join({ game: GAME, code: 'ZZZZ', name: 'X' }), 'not_found', 'bad code is rejected');
await expectCode(OnlineMatch.join({ game: 'crazy-eights', code: host.code, name: 'X' }), 'wrong_game', 'wrong-game code is rejected');
const guest = await OnlineMatch.join({ game: GAME, code: ` ${host.code.toLowerCase()} `, name: 'Maple B' });
check(guest.seat === 1 && guest.status === 'playing', 'final guest joins seat 1 and starts a two-phone room');
check(guest.opponents()[0].name === 'Maple A', 'guest sees the host name');

device('A');
await host._fetch();
check(host.status === 'playing' && host.opponents()[0].name === 'Maple B', 'host poll sees the filled porch');
const stateA = applyMove(host.state, randomChoice(legalMoves(host.state)));
await host.push(stateA, { over: getStatus(stateA).over });
check(host.version === 1, 'host publishes a legal engine move');

device('B');
await guest._fetch();
check(JSON.stringify(guest.state) === JSON.stringify(stateA), 'guest receives the full deterministic state');
const stateB = applyMove(guest.state, randomChoice(legalMoves(guest.state)));
await guest.push(stateB, { over: getStatus(stateB).over });
check(guest.version === 2, 'guest publishes the next engine move');

device('A');
const stale = applyMove(stateA, randomChoice(legalMoves(stateA)));
await expectCode(host.push(stale), 'version_conflict', 'stale push is rejected');
check(host.version === 2 && JSON.stringify(host.state) === JSON.stringify(guest.state), 'version conflict refetches server truth');
check(new RoomsError('offline').code === 'offline', 'rooms errors expose stable codes');

console.log('\nComplete two-phone match');
const twoPhone = await playSyncedMatch([
  { device: 'A', match: host },
  { device: 'B', match: guest },
]);
check(twoPhone.synced, 'two phones stay JSON-identical after every move');
check(twoPhone.finished, `two-phone match reaches 100 in ${twoPhone.moves} more moves`);
check(host.status === 'over', 'room closes when the engine match ends');

device('B');
const beforeRematch = guest.version;
await guest.push(createInitialState({ numPlayers: 2, seed: 202 }));
check(guest.status === 'playing' && guest.version === beforeRematch + 1, 'either phone can start a rematch');
device('A');
const resumed = await OnlineMatch.resume({ game: GAME });
check(resumed.roomId === host.roomId && resumed.seat === 0, 'resume returns to the same engine seat');
await resumed.leave();
check(savedSession(GAME) === null, 'leave clears the local room session');

console.log('\nComplete three-phone match');
device('A');
const host3 = await OnlineMatch.create({
  game: GAME, name: 'North', seats: 3,
  state: createInitialState({ numPlayers: 3, seed: 404 }),
});
device('B');
const guest3b = await OnlineMatch.join({ game: GAME, code: host3.code, name: 'Center' });
check(guest3b.seat === 1 && guest3b.status === 'waiting', 'three-phone room waits after seat 1 joins');
device('C');
const guest3c = await OnlineMatch.join({ game: GAME, code: host3.code, name: 'South' });
check(guest3c.seat === 2 && guest3c.status === 'playing', 'three-phone room starts when seat 2 joins');

const threePhone = await playSyncedMatch([
  { device: 'A', match: host3 },
  { device: 'B', match: guest3b },
  { device: 'C', match: guest3c },
]);
check(threePhone.synced, 'all three phones stay JSON-identical after every move');
check(threePhone.finished, `three-phone match reaches 100 in ${threePhone.moves} moves`);
check(host3.state.numPlayers === 3 && host3.state.hands.length === 3, 'engine seat mapping survives the whole three-phone match');

device('D');
await expectCode(OnlineMatch.join({ game: GAME, code: host3.code, name: 'Too Late' }), 'room_started', 'fourth phone cannot enter a started three-seat room');

backendReady = false;
const freshClient = await import('../js/rooms.js?not-ready');
device('D');
await expectCode(
  freshClient.OnlineMatch.create({ game: GAME, name: 'A', state: {} }),
  'not_ready',
  'missing backend reports not_ready cleanly',
);

console.log(`\nALL ROOMS TESTS PASSED (${passed} checks)`);
process.exit(0);
