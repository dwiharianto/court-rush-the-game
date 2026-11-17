// Headless rules test: runs the real game loop with no rendering, driven by a
// scripted player, and checks serving, faults, scoring, and game changes.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/main.js';
import { BALL, COURT } from '../src/config.js';
import { createBall, stepBall } from '../src/ball.js';
import { createMatch, awardPoint, fault, pointLabels, serveFromRight, inSingles, inServiceBox } from '../src/rules.js';
import { createBot, playPoints, seededRng } from './bot.js';

// ---------------------------------------------------------------- an independent scorer
// Written separately from rules.js so the game is checked against a second implementation.
function mirror(firstServer = 0) {
  return { p: [0, 0], g: [0, 0], server: firstServer, serveNumber: 1, over: false };
}
function mirrorPoint(m, w) {
  m.serveNumber = 1;
  m.p[w]++;
  if (m.p[w] >= 4 && m.p[w] - m.p[1 - w] >= 2) {
    m.g[w]++;
    m.p = [0, 0];
    m.server = 1 - m.server;
    if (m.g[w] >= 6 && m.g[w] - m.g[1 - w] >= 2) m.over = true;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- unit checks
test('point labels run 0, 15, 30, 40, deuce, advantage, game', () => {
  const m = createMatch();
  const seen = [];
  for (const w of [0, 0, 0, 1, 1, 1, 0, 1, 1]) {
    awardPoint(m, w);
    seen.push(pointLabels(m).join('-'));
  }
  assert.deepEqual(seen, ['15-0', '30-0', '40-0', '40-15', '40-30', '40-40', 'AD-40', '40-40', '40-AD']);
  const r = awardPoint(m, 1);
  assert.equal(r.game, true);
  assert.deepEqual(m.games, [0, 1]);
  assert.deepEqual(m.points, [0, 0]);
  assert.equal(m.server, 1, 'server changes after a game');
});

test('set needs 6 games and a 2-game lead', () => {
  const m = createMatch();
  const winGame = (w) => { for (let i = 0; i < 4; i++) awardPoint(m, w); };
  for (let i = 0; i < 5; i++) { winGame(0); winGame(1); } // 5-5
  winGame(0);
  assert.equal(m.over, false, '6-5 is not a set');
  winGame(1);
  winGame(1);
  assert.equal(m.over, false, '6-7 is not a set');
  winGame(1);
  assert.equal(m.over, true, '6-8 wins');
  assert.equal(m.winner, 1);
});

test('one fault gives a second serve, two lose the point', () => {
  const m = createMatch();
  assert.equal(fault(m), false);
  assert.equal(m.serveNumber, 2);
  assert.equal(fault(m), true);
  awardPoint(m, 1);
  assert.equal(m.serveNumber, 1);
});

test('service boxes are diagonal and swap with the serve side', () => {
  const deep = COURT.serviceLine - 0.5;
  // near player (side 0) serving from the right (+x) must land in the far box at -x
  assert.equal(inServiceBox(-2, -deep, 0, true), true);
  assert.equal(inServiceBox(2, -deep, 0, true), false);
  assert.equal(inServiceBox(2, -deep, 0, false), true);
  assert.equal(inServiceBox(-2, -(COURT.serviceLine + 0.3), 0, true), false, 'past the service line');
  assert.equal(inServiceBox(-2, deep, 0, true), false, 'own side');
  // far player (side 1) serving from its right (-x) lands in the near box at +x
  assert.equal(inServiceBox(2, deep, 1, true), true);
  assert.equal(inServiceBox(-2, deep, 1, true), false);
});

test('singles court bounds', () => {
  assert.equal(inSingles(COURT.singlesHalf, -COURT.halfLength, 1), true, 'lines are in');
  assert.equal(inSingles(COURT.singlesHalf + 0.2, -5, 1), false, 'doubles alley is out');
  assert.equal(inSingles(0, -COURT.halfLength - 0.2, 1), false, 'past the baseline');
  assert.equal(inSingles(0, 5, 1), false, 'own half');
});

test('fast balls cannot tunnel through the net', () => {
  for (const speed of [30, 80, 200]) {
    const b = createBall();
    Object.assign(b, { x: 0, y: 0.5, z: 0.9, vx: 0, vy: 0, vz: -speed });
    const ev = [];
    for (let i = 0; i < 30; i++) stepBall(b, BALL.fixedDt, ev);
    assert.ok(ev.some((e) => e.type === 'net'), `${speed} m/s hits the net`);
    assert.ok(b.z > 0, `${speed} m/s stays on the hitter's side`);
  }
  const over = createBall();
  Object.assign(over, { x: 0, y: 1.3, z: 0.9, vx: 0, vy: 0, vz: -60 });
  const ev = [];
  stepBall(over, BALL.fixedDt, ev);
  assert.equal(ev.some((e) => e.type === 'net'), false, 'a ball above the net passes');
});

test('slice bounces lower than a flat ball', () => {
  const bounce = (spin) => {
    const b = createBall();
    Object.assign(b, { y: 1, vy: -6, vz: -10, spin });
    stepBall(b, 0.3, null);
    return b.vy;
  };
  assert.ok(bounce('slice') < bounce('flat'));
});

// ---------------------------------------------------------------- forced serve errors
function humanServeGame(serveError, passive = false) {
  const rng = seededRng(5);
  const g = createGame({ difficulty: 'normal', rng, firstServer: 0 });
  const bot = createBot('solid', rng);
  bot.forceServeError = serveError;
  bot.passive = passive;
  g.start();
  const log = [];
  for (let i = 0; i < 120 * 120 && log.filter((e) => e.type === 'point').length < 4; i++) {
    g.step(BALL.fixedDt, bot.think(g));
    for (const e of g.events) if (e.type === 'fault' || e.type === 'point' || e.type === 'retoss') log.push(e);
    g.events.length = 0;
  }
  return { g, log };
}

test('a serve hit far too early goes long, a double fault loses the point', () => {
  const { g, log } = humanServeGame(-0.45); // second serves forgive some error, so this is very early
  const faults = log.filter((e) => e.type === 'fault');
  const points = log.filter((e) => e.type === 'point');
  assert.equal(points.length, 4);
  assert.ok(points.every((p) => p.reason === 'doubleFault' && p.winner === 1));
  assert.equal(faults.length, 4, 'one plain fault before each double fault');
  assert.ok(faults.every((f) => f.reason === 'out'));
  assert.deepEqual(g.match.games, [0, 1], 'four double faults lose the game');
  assert.equal(g.match.server, 1, 'serve passes to the CPU');
});

test('a serve hit far too late drops into the net', () => {
  const { log } = humanServeGame(0.25);
  const faults = log.filter((e) => e.type === 'fault');
  assert.ok(faults.length >= 1);
  assert.ok(faults.every((f) => f.reason === 'net'));
});

test('an unhit toss is retaken without a fault', () => {
  const rng = seededRng(9);
  const g = createGame({ rng, firstServer: 0 });
  const bot = createBot('solid', rng);
  bot.passive = true;
  g.start();
  const types = [];
  for (let i = 0; i < 120 * 5; i++) {
    g.step(BALL.fixedDt, bot.think(g));
    for (const e of g.events) types.push(e.type);
    g.events.length = 0;
  }
  assert.ok(types.includes('retoss'));
  assert.equal(types.includes('fault'), false);
  assert.equal(g.match.serveNumber, 1);
});

// ---------------------------------------------------------------- long run with invariants
test('several hundred points of play keep the rules and score consistent', () => {
  for (const [difficulty, profile, seed] of [['easy', 'casual', 11], ['normal', 'solid', 12], ['hard', 'sharp', 13]]) {
    let m = null;
    let lastHit = null; // { side, serve }
    let firstBounce = null;
    let deuces = 0, games = 0;
    const where = () => `${difficulty}/${profile}`;
    const stats = playPoints(createGame, {
      difficulty, profile, seed, points: 300,
      onEvent(e, g) {
        if (e.type === 'matchStart') m = mirror(g.match.server);
        if (!m) m = mirror(g.match.server);
        switch (e.type) {
          case 'serveReady': {
            assert.equal(e.server, m.server, `${where()}: right player serves`);
            assert.equal(e.serveNumber, m.serveNumber, `${where()}: first or second serve`);
            const fromRight = (m.p[0] + m.p[1]) % 2 === 0;
            assert.equal(serveFromRight(g.match), fromRight);
            const s = g.players[m.server];
            assert.equal(s.x * s.right > 0, fromRight, `${where()}: serve side alternates each point`);
            assert.ok(Math.abs(s.z) > COURT.halfLength, `${where()}: server stands behind the baseline`);
            break;
          }
          case 'hit':
            lastHit = { side: e.side, serve: e.kind === 'serve' };
            firstBounce = null;
            break;
          case 'bounce':
            if (e.n === 1 && lastHit) firstBounce = { x: e.x, z: e.z };
            break;
          case 'fault':
            assert.equal(m.serveNumber, 1, `${where()}: a fault on a first serve gives a second`);
            m.serveNumber = 2;
            if (e.reason === 'out' && firstBounce) {
              assert.equal(inServiceBox(firstBounce.x, firstBounce.z, e.server, (m.p[0] + m.p[1]) % 2 === 0), false);
            }
            break;
          case 'point': {
            assert.equal(e.server, m.server);
            if (e.reason === 'doubleFault') {
              assert.equal(m.serveNumber, 2, `${where()}: double fault only on a second serve`);
              assert.equal(e.winner, 1 - e.server);
            } else if (e.reason === 'out' && firstBounce && lastHit && !lastHit.serve) {
              assert.equal(inSingles(firstBounce.x, firstBounce.z, 1 - lastHit.side), false, `${where()}: out means out`);
              assert.equal(e.winner, 1 - lastHit.side, `${where()}: the hitter loses an out ball`);
            } else if (e.reason === 'double') {
              assert.equal(e.winner, lastHit.side, `${where()}: two bounces win for the hitter`);
              if (firstBounce) assert.equal(inSingles(firstBounce.x, firstBounce.z, 1 - lastHit.side), true);
            } else if (e.reason === 'net') {
              assert.equal(e.winner, 1 - lastHit.side);
            } else if (e.reason === 'ace') {
              assert.equal(e.winner, e.server);
            }
            if (m.p[0] >= 3 && m.p[1] >= 3 && m.p[0] === m.p[1]) deuces++;
            const gameDone = mirrorPoint(m, e.winner);
            if (gameDone) games++;
            assert.equal(e.game, gameDone, `${where()}: game flag`);
            assert.deepEqual(g.match.points, m.p, `${where()}: points`);
            assert.deepEqual(g.match.games, m.g, `${where()}: games`);
            assert.equal(g.match.server, m.server, `${where()}: server alternates each game`);
            assert.equal(g.match.over, m.over, `${where()}: set end`);
            assert.equal(e.set, m.over);
            lastHit = null;
            firstBounce = null;
            break;
          }
          case 'matchOver':
            assert.equal(e.winner, m.g[0] > m.g[1] ? 0 : 1);
            m = null;
            break;
          default:
        }
      },
    });
    assert.equal(stats.stuck, false, `${where()}: play never stalls`);
    assert.equal(stats.points, 300);
    assert.ok(games >= 40, `${where()}: games change (${games})`);
    assert.ok(stats.matches >= 1, `${where()}: at least one full set completes`);
    assert.ok(deuces >= 1, `${where()}: deuce comes up`);
    assert.ok(stats.faults >= 1, `${where()}: faults happen`);
    assert.ok(stats.reasons['cpu wins: out'] || stats.reasons['human wins: out'], `${where()}: out balls`);
    assert.ok(stats.human > 0 && stats.cpu > 0, `${where()}: both players win points`);
  }
});
