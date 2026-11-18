// Tournaments: an 8-player knockout draw (quarter-finals, semi-finals, final) at one of
// three invented events, one per surface. The player meets invented CPU opponents;
// the other matches in the draw are simulated from the players' ratings.
// Pure logic and plain data, so a tournament can be saved and resumed.
import { CPU_NAMES } from './profile.js';

export const EVENTS = [
  { id: 'porto', name: 'PORTO VELANO OPEN', surface: 'clay' },
  { id: 'ashbridge', name: 'ASHBRIDGE LAWN CHAMPIONSHIPS', surface: 'grass' },
  { id: 'harbour', name: 'HARBOUR CITY MASTERS', surface: 'hard' },
];
export const ROUNDS = ['QUARTER-FINAL', 'SEMI-FINAL', 'FINAL'];
const LEVELS = ['easy', 'normal', 'hard'];
const SIZE = 8;

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// A new draw. The player is unseeded; seeds 1 and 2 sit at opposite ends.
export function createTournament({ eventId, difficulty, gamesToWin, playerName, seed = Date.now() }) {
  const event = EVENTS.find((e) => e.id === eventId) || EVENTS[0];
  const rng = rngFrom(seed);
  const names = CPU_NAMES.filter((n) => n !== playerName).sort(() => rng() - 0.5).slice(0, SIZE - 1);
  // CPU entries by seed: higher seeds are stronger
  const cpus = names.map((name, i) => ({ name, seed: i + 1, rating: 0.82 - i * 0.07 + rng() * 0.05, cpu: true }));
  const slots = new Array(SIZE).fill(null);
  slots[0] = cpus[0]; // seed 1, top
  slots[SIZE - 1] = cpus[1]; // seed 2, bottom
  const free = [1, 2, 3, 4, 5, 6].sort(() => rng() - 0.5);
  const youAt = free.pop();
  slots[youAt] = { name: playerName, seed: 0, rating: 0.6, cpu: false };
  cpus.slice(2).forEach((c, i) => { slots[free[i]] = c; });
  return {
    eventId: event.id, name: event.name, surface: event.surface,
    difficulty, gamesToWin, seed,
    entrants: slots,
    // rounds[r] lists that round's matches: { a, b, winner, score } by entrant index
    rounds: [[0, 1, 2, 3].map((i) => ({ a: 2 * i, b: 2 * i + 1, winner: -1, score: '' }))],
    round: 0,
    status: 'playing', // 'playing' | 'won' | 'lost'
  };
}

const you = (t) => t.entrants.findIndex((e) => !e.cpu);
const playerMatch = (t) => t.rounds[t.round].find((m) => m.a === you(t) || m.b === you(t));

// The opponent in the current round, or null when the tournament is over.
export function nextOpponent(t) {
  if (t.status !== 'playing') return null;
  const m = playerMatch(t);
  return t.entrants[m.a === you(t) ? m.b : m.a];
}

// The CPU level for the current round: the final is one step harder.
export function levelFor(t) {
  const i = LEVELS.indexOf(t.difficulty);
  return t.round === ROUNDS.length - 1 ? LEVELS[Math.min(LEVELS.length - 1, i + 1)] : t.difficulty;
}

export const roundName = (t) => ROUNDS[Math.min(t.round, ROUNDS.length - 1)];

// a simulated scoreline, winner first
function scoreline(rng, toWin) {
  const loser = Math.floor(rng() * (toWin - 1));
  if (rng() < 0.18) return `${toWin + 1}-${toWin - 1}`;
  return `${toWin}-${loser}`;
}

function simulate(t, m, rng) {
  const A = t.entrants[m.a], B = t.entrants[m.b];
  const pA = 0.5 + (A.rating - B.rating) * 1.4;
  m.winner = rng() < Math.max(0.1, Math.min(0.9, pA)) ? m.a : m.b;
  m.score = scoreline(rng, t.gamesToWin);
}

function advance(t, rng) {
  const done = t.rounds[t.round];
  if (t.round === ROUNDS.length - 1) return;
  const next = [];
  for (let i = 0; i < done.length; i += 2) next.push({ a: done[i].winner, b: done[i + 1].winner, winner: -1, score: '' });
  t.rounds.push(next);
  t.round++;
}

// The player's match is over: record it, play out the rest of the round, move on.
// games: [player games, opponent games]
export function recordResult(t, won, games) {
  if (t.status !== 'playing') return t;
  const rng = rngFrom(t.seed + 7919 * (t.round + 1));
  const me = you(t);
  const m = playerMatch(t);
  m.winner = won ? me : (m.a === me ? m.b : m.a);
  m.score = `${Math.max(...games)}-${Math.min(...games)}`;
  for (const o of t.rounds[t.round]) if (o !== m) simulate(t, o, rng);
  if (!won) {
    t.status = 'lost';
    // finish the draw so the bracket shows who went on to win
    while (t.round < ROUNDS.length - 1) {
      advance(t, rng);
      for (const o of t.rounds[t.round]) simulate(t, o, rng);
    }
    return t;
  }
  if (t.round === ROUNDS.length - 1) { t.status = 'won'; return t; }
  advance(t, rng);
  return t;
}

// The bracket for display: per round, its matches as name pairs and results.
export function bracket(t) {
  return ROUNDS.map((title, r) => ({
    title,
    current: t.status === 'playing' && r === t.round,
    matches: (t.rounds[r] || []).map((m) => ({
      a: t.entrants[m.a], b: t.entrants[m.b], winner: m.winner === -1 ? null : m.winner === m.a ? 'a' : 'b', score: m.score,
    })),
  }));
}
