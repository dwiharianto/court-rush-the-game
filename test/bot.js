// Scripted player for headless runs. It reads the game state like a person
// would (with a reaction delay and imperfect timing) and produces the same
// input object the keyboard does.
import { BALL, CONTACT, SMASH, SWING } from '../src/config.js';
import { createBall, copyBall, stepBall, predictAtPlane } from '../src/ball.js';

export const PROFILES = {
  // timing: spread of swing timing in seconds; smart: how often it aims away
  // from the CPU; reaction: seconds before it moves to a new ball
  casual: { timing: 0.085, smart: 0.35, reaction: 0.38, serveTiming: 0.11 },
  solid: { timing: 0.05, smart: 0.75, reaction: 0.27, serveTiming: 0.07 },
  sharp: { timing: 0.028, smart: 1.0, reaction: 0.2, serveTiming: 0.04 },
};

export function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const sim = createBall();
const ev = [];
const plane = {};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Where the bot wants to meet the ball: the descent to waist height after the bounce.
function meetPoint(ball) {
  copyBall(sim, ball);
  let bounced = ball.bounces > 0;
  let found = null;
  for (let t = 0; t < 5; t += BALL.fixedDt) {
    const prevVy = sim.vy;
    ev.length = 0;
    stepBall(sim, BALL.fixedDt, ev);
    for (const e of ev) {
      if (e.type === 'net') return null;
      if (e.type === 'bounce') {
        if (bounced) return found;
        bounced = true;
      }
    }
    if (!bounced) continue;
    if (sim.z > 16) return { x: sim.x, z: sim.z };
    if (prevVy > 0 && sim.vy <= 0) { found = { x: sim.x, z: sim.z }; if (sim.y <= 1.05) return found; }
    if (sim.vy < 0 && sim.y <= 1.05) return { x: sim.x, z: sim.z };
  }
  return found;
}

export function createBot(profile, rng) {
  const P = typeof profile === 'string' ? PROFILES[profile] : profile;
  const gauss = () => (rng() + rng() + rng() - 1.5) * 2;
  const inp = { x: 0, y: 0, drive: false, slice: false, lob: false };
  let seenHit = -1, reactAt = 0, meet = null, stand = 0;
  let timingError = 0, aimX = 0, aimY = 0, serveAt = 0, serveAim = 0;
  // test hooks: force the next serve timing error (seconds), or never swing
  const bot = { forceServeError: null, passive: false, think };

  function think(g) {
    const h = g.players[0], cpu = g.players[1], b = g.ball;
    inp.x = 0; inp.y = 0; inp.drive = false; inp.slice = false; inp.lob = false;
    const serving = g.match.server === 0;

    if (g.state === 'serveReady') {
      if (serving && g.timer > 0.6) {
        inp.drive = true;
        const err = bot.forceServeError !== null ? bot.forceServeError : gauss() * P.serveTiming;
        serveAt = g.tossApexTime + err;
        serveAim = (rng() * 2 - 1) * 0.8;
      }
      return inp;
    }
    if (g.state === 'toss') {
      if (serving) {
        inp.x = serveAim;
        if (h.action === 'toss' && g.timer >= serveAt && !bot.passive) inp.drive = true;
      }
      return inp;
    }
    if (g.state !== 'rally') return inp;

    if (b.inPlay && b.lastHitter === 1) {
      if (b.hitId !== seenHit) {
        seenHit = b.hitId;
        reactAt = g.time + P.reaction;
        meet = null;
        timingError = gauss() * P.timing;
        const away = cpu.x > 0.5 ? -1 : cpu.x < -0.5 ? 1 : (rng() < 0.5 ? -1 : 1);
        aimX = rng() < P.smart ? away : Math.floor(rng() * 3) - 1;
        aimY = rng() < 0.25 ? 1 : 0;
      }
      if (g.time >= reactAt) {
        if (!meet) {
          meet = meetPoint(b);
          if (meet) stand = Math.abs(meet.x - 0.7 - h.x) <= Math.abs(meet.x + 0.7 - h.x) + 0.3 ? meet.x - 0.7 : meet.x + 0.7;
        }
        if (meet) {
          inp.x = clamp((stand - h.x) * 4, -1, 1);
          inp.y = clamp((h.z - (meet.z + CONTACT.front)) * 4, -1, 1);
        }
      }
      if (h.action === 'ready' && !bot.passive && !(b.isServe && b.bounces === 0)) {
        const pr = predictAtPlane(b, h.z - CONTACT.front, 1, 0.5, plane);
        if (pr && pr.t <= SWING.ideal + timingError && Math.abs(pr.x - h.x) <= CONTACT.reachX
          && pr.y <= (pr.y >= SMASH.minHeight ? SMASH.reachY : CONTACT.reachY)) inp.drive = true;
      }
      if (h.action !== 'ready') { inp.x = aimX; inp.y = aimY; } // direction held at contact aims the shot
    } else {
      // recover to the middle of the baseline
      inp.x = clamp((0 - h.x) * 2, -1, 1);
      inp.y = clamp((h.z - 12.6) * 2, -1, 1);
    }
    return inp;
  }

  return bot;
}

// Play points until `points` are done or a match limit is hit. Returns stats.
export function playPoints(createGame, { difficulty, profile, seed = 1, points = 300, surface, onEvent = null, onStep = null }) {
  const rng = seededRng(seed);
  const stats = {
    points: 0, human: 0, cpu: 0, rallyHits: 0, matches: 0, humanMatches: 0,
    reasons: {}, faults: 0, timing: { perfect: 0, early: 0, late: 0 }, simSeconds: 0, stuck: false,
  };
  while (stats.points < points && !stats.stuck) {
    const g = createGame({ difficulty, rng, surface });
    const bot = createBot(profile, rng);
    g.start();
    let steps = 0, lastActivity = 0;
    while (g.state !== 'matchOver' && stats.points < points) {
      if (onStep) onStep(g, bot);
      g.step(BALL.fixedDt, bot.think(g));
      steps++;
      for (const e of g.events) {
        if (onEvent) onEvent(e, g, bot);
        if (e.type === 'hit' || e.type === 'serveReady') lastActivity = steps;
        if (e.type === 'fault') stats.faults++;
        else if (e.type === 'timing') stats.timing[e.kind]++;
        else if (e.type === 'point') {
          stats.points++;
          stats[e.winner === 0 ? 'human' : 'cpu']++;
          stats.rallyHits += e.rallyHits;
          const k = `${e.winner === 0 ? 'human' : 'cpu'} wins: ${e.reason}`;
          stats.reasons[k] = (stats.reasons[k] || 0) + 1;
        }
      }
      g.events.length = 0;
      if (steps - lastActivity > 120 * 30) { stats.stuck = true; break; } // 30 seconds with nothing happening
    }
    stats.simSeconds += g.time;
    if (g.state === 'matchOver') { stats.matches++; if (g.match.winner === 0) stats.humanMatches++; }
  }
  return stats;
}
