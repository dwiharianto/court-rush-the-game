// Headless rules test: runs the real game loop with no rendering, driven by a
// scripted player, and checks serving, faults, scoring, and game changes.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/main.js';
import { BALL, CALLS, COURT, SWING, SURFACES, netHeightAt } from '../src/config.js';
import { createBall, stepBall, planShot, predictAtPlane, copyBall, lowerOverNet } from '../src/ball.js';
import { createMatch, awardPoint, fault, pointLabels, serveFromRight, inSingles, inServiceBox } from '../src/rules.js';
import { createBot, playPoints, seededRng } from './bot.js';
import { cleanName, sanitize, cpuOpponent, randomProfile, CPU_NAMES, PALETTE, DEFAULT_PROFILE } from '../src/profile.js';

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

// ---------------------------------------------------------------- volleys and backhands
// Puts the player at (px, pz) and sends a CPU shot from (fromX, -10) toward (tx, tz).
// Presses `press` when the ball is SWING.ideal seconds from the hitting plane.
function incoming({ px, pz, fromX = 0, tx, tz, speed = 26, press = 'drive', aimY = 0 }) {
  const g = createGame({ rng: seededRng(3), firstServer: 1 });
  g.start();
  g.state = 'rally';
  const p = g.players[0], b = g.ball;
  Object.assign(p, { x: px, z: pz, vx: 0, vz: 0, action: 'ready', actionT: 0, swing: null });
  Object.assign(b, { x: fromX, y: 1.0, z: -10, spin: 'flat', bounces: 0, lastHitter: 1, inPlay: true, isServe: false, visible: true });
  Object.assign(b, planShot(b, tx, tz, { speed }));
  g.events.length = 0;
  const log = [];
  let pressed = false, action = null;
  const pr = {};
  for (let i = 0; i < 120 * 4 && g.state === 'rally'; i++) {
    let inp = { x: 0, y: aimY, drive: false, slice: false, lob: false };
    if (!pressed && b.lastHitter === 1) {
      const hit = predictAtPlane(b, p.z - 0.4, 1, 2, pr);
      if (hit && hit.t <= SWING.ideal) { inp[press] = true; pressed = true; }
    }
    g.step(BALL.fixedDt, inp);
    if (pressed && !action) action = p.action;
    for (const e of g.events) log.push(e);
    g.events.length = 0;
  }
  return { g, log, action };
}

test('a ball taken out of the air near the net is a volley', () => {
  const { log, action } = incoming({ px: -0.8, pz: 4, tx: 0, tz: 10 });
  assert.equal(action, 'fhVolley');
  const hit = log.find((e) => e.type === 'hit' && e.side === 0);
  assert.ok(hit && hit.volley, 'the player volleyed');
  const timing = log.find((e) => e.type === 'timing');
  assert.ok(timing.volley);
  const bounce = log.find((e) => e.type === 'bounce');
  assert.ok(bounce.z < 0 && inSingles(bounce.x, bounce.z, 1), 'the volley lands in the CPU court');
});

test('the same ball from the baseline is a groundstroke, not a volley', () => {
  const { log, action } = incoming({ px: -0.8, pz: 13.5, tx: 0, tz: 10 });
  assert.equal(action, 'forehand');
  const hit = log.find((e) => e.type === 'hit' && e.side === 0);
  assert.ok(hit && !hit.volley);
});

test('a ball on the player\'s left is a backhand, and slice at the net is a drop volley', () => {
  const back = incoming({ px: 0.8, pz: 13.5, tx: 0, tz: 10 });
  assert.equal(back.action, 'backhand');
  const drop = incoming({ px: 0.8, pz: 4, tx: 0, tz: 10, press: 'slice' });
  assert.equal(drop.action, 'bhVolley');
  const bounce = drop.log.find((e) => e.type === 'bounce');
  assert.ok(bounce.z < 0 && bounce.z > -5.5, `drop volley lands short (z ${bounce.z.toFixed(2)})`);
});

// ---------------------------------------------------------------- sliding
function runThenRelease(heldAfter, runSeconds = 1.5) {
  const g = createGame({ rng: seededRng(4), firstServer: 1 });
  g.start();
  g.state = 'pointOver'; // free movement, no serve logic
  const p = g.players[0];
  Object.assign(p, { x: -6, z: 13, vx: 0, vz: 0 });
  const log = [];
  const run = { x: 1, y: 0, drive: false, slice: false, lob: false };
  for (let i = 0; i < 120 * runSeconds; i++) { g.timer = 9; g.step(BALL.fixedDt, run); } // sprint to the right
  const startX = p.x;
  g.events.length = 0;
  for (let i = 0; i < 120 * 1.5; i++) {
    g.timer = 9;
    g.step(BALL.fixedDt, heldAfter);
    for (const e of g.events) log.push(e);
    g.events.length = 0;
  }
  return { log, travel: p.x - startX, p };
}

test('only braking out of a long sprint slides; short runs and reversals stop on their feet', () => {
  const short = runThenRelease({ x: 0, y: 0 }, 0.5);
  assert.equal(short.log.some((e) => e.type === 'slide'), false, 'a short run stops without sliding');
  const stop = runThenRelease({ x: 0, y: 0 });
  assert.ok(stop.log.some((e) => e.type === 'slide'), 'braking out of a long sprint starts a slide');
  const end = stop.log.find((e) => e.type === 'slideEnd');
  assert.ok(end && end.x1 - end.x0 > 0.8, `the slide carries the player on (${end && (end.x1 - end.x0).toFixed(2)} m)`);
  assert.equal(stop.p.slide, false, 'the slide ends');
  const back = runThenRelease({ x: -1, y: 0 });
  assert.equal(back.log.some((e) => e.type === 'slide'), false, 'a hard reversal plants and pushes off');
});

// ---------------------------------------------------------------- net cords
// A ball from the near baseline crossing the net at `clear` metres above the tape.
function crossing(clear, x = 0.5, hitId = 1) {
  const b = createBall();
  const from = { x, y: 1, z: 10 };
  const v = planShot(from, x, -9, { speed: 20 });
  lowerOverNet(from, v, clear);
  Object.assign(b, from, { vx: v.vx, vy: v.vy, vz: v.vz, hitId });
  const events = [];
  for (let i = 0; i < 240 && b.z > -11.9; i++) stepBall(b, BALL.fixedDt, events);
  return { b, events };
}

test('balls clipping the tape sometimes trickle over, low ones go into the net', () => {
  assert.equal(crossing(0.2).events.some((e) => e.type === 'net' || e.type === 'netCord'), false, 'clear of the tape');
  const low = crossing(-0.15).events.find((e) => e.type === 'net');
  assert.ok(low && !low.cord, 'well below the tape is the mesh');
  let over = 0, back = 0;
  for (let id = 0; id < 60; id++) {
    const { events, b } = crossing(0.005 - (id % 5) * 0.006, (id % 7) - 3, id);
    if (events.some((e) => e.type === 'netCord')) {
      over++;
      assert.ok(events.some((e) => e.type === 'bounce' && e.z < 0), 'a cord that goes over lands on the far side');
      assert.ok(Math.abs(b.vz) < 20, 'and has lost pace');
    } else if (events.some((e) => e.type === 'net' && e.cord)) back++;
  }
  assert.ok(over > 10 && back > 5, `both outcomes happen (${over} over, ${back} back)`);
});

test('a prediction of a net cord matches what the real ball does', () => {
  for (let id = 0; id < 30; id++) {
    const a = createBall();
    const from = { x: 0.3 * id - 4, y: 1, z: 10 };
    const v = planShot(from, from.x, -9, { speed: 20 });
    lowerOverNet(from, v, 0.01 - (id % 4) * 0.008);
    Object.assign(a, from, { vx: v.vx, vy: v.vy, vz: v.vz, hitId: id });
    const sim = copyBall(createBall(), a);
    const ea = [], es = [];
    for (let i = 0; i < 200; i++) { stepBall(a, BALL.fixedDt, ea); stepBall(sim, BALL.fixedDt, es); }
    assert.deepEqual(es.map((e) => e.type), ea.map((e) => e.type));
  }
});

test('a serve that clips the net and lands in the box is a let, replayed with no fault', () => {
  let found = null;
  for (let id = 0; id < 80 && !found; id++) {
    const g = createGame({ rng: seededRng(2), firstServer: 0 });
    g.start();
    const fromRight = serveFromRight(g.match);
    const tx = inServiceBox(-2.2, -4.5, 0, fromRight) ? -2.2 : 2.2;
    const b = g.ball;
    const from = { x: -tx * 0.3, y: 2.7, z: 12.2 };
    const v = planShot(from, tx, -4.5, { speed: 22, margin: 0.1 });
    lowerOverNet(from, v, 0.006 - (id % 6) * 0.005);
    Object.assign(b, from, { vx: v.vx, vy: v.vy, vz: v.vz, hitId: id, bounces: 0, lastHitter: 0, inPlay: true, isServe: true, visible: true, letPending: false });
    g.state = 'rally';
    g.events.length = 0;
    const types = [];
    for (let i = 0; i < 240 && g.state === 'rally'; i++) {
      g.step(BALL.fixedDt, null);
      for (const e of g.events) types.push(e.type);
      g.events.length = 0;
    }
    if (types.includes('let')) found = { types, g };
  }
  assert.ok(found, 'some cord serve lands in the box');
  assert.equal(found.types.includes('fault'), false, 'a let is not a fault');
  assert.equal(found.g.match.serveNumber, 1, 'still the first serve');
  assert.deepEqual(found.g.match.points ?? [0, 0], [0, 0], 'no point is played');
});

// ---------------------------------------------------------------- surfaces
test('grass bounces lowest and fastest, clay highest and slowest, hard in between', () => {
  const after = (surface) => {
    const b = createBall();
    b.court = SURFACES[surface];
    Object.assign(b, { y: 1, vy: -6, vz: -20, spin: 'flat' });
    stepBall(b, 0.2, null);
    return { up: b.vy, pace: -b.vz };
  };
  const clay = after('clay'), grass = after('grass'), hard = after('hard');
  assert.ok(grass.up < hard.up && hard.up < clay.up, 'bounce height: grass < hard < clay');
  assert.ok(grass.pace > hard.pace && hard.pace > clay.pace, 'pace kept: grass > hard > clay');
});

test('a game on each surface uses that surface; slides are shortest on hard courts', () => {
  const slide = (surface) => {
    const g = createGame({ rng: seededRng(4), surface, firstServer: 1 });
    assert.equal(g.surface, surface);
    assert.equal(g.ball.court, SURFACES[surface]);
    g.start();
    g.state = 'pointOver';
    const p = g.players[0];
    Object.assign(p, { x: -6, z: 13, vx: 0, vz: 0 });
    for (let i = 0; i < 240; i++) { g.timer = 9; g.step(BALL.fixedDt, { x: 1, y: 0 }); }
    g.events.length = 0;
    let len = 0;
    for (let i = 0; i < 240; i++) {
      g.timer = 9; g.step(BALL.fixedDt, { x: 0, y: 0 });
      for (const e of g.events) if (e.type === 'slideEnd') len = e.x1 - e.x0;
      g.events.length = 0;
    }
    return len;
  };
  const clay = slide('clay'), grass = slide('grass'), hard = slide('hard');
  assert.ok(clay > grass && grass > hard && hard > 0, `slide length clay ${clay.toFixed(2)} > grass ${grass.toFixed(2)} > hard ${hard.toFixed(2)}`);
});

// ---------------------------------------------------------------- player profile
test('player names are cleaned and profiles reject unknown values', () => {
  assert.equal(cleanName('  ace   maker!!  '), 'ACE MAKER');
  assert.equal(cleanName('<b>x</b>'), 'BXB');
  assert.equal(cleanName(''), DEFAULT_PROFILE.name);
  assert.equal(cleanName('A'.repeat(40)).length, 14);
  const p = sanitize({ name: 'k. day', shirt: 0x123456, hairStyle: 'mohawk', headwear: 'cap', skin: PALETTE.skin[0] });
  assert.equal(p.name, 'K. DAY');
  assert.equal(p.shirt, DEFAULT_PROFILE.shirt, 'a colour not on the palette falls back');
  assert.equal(p.hairStyle, DEFAULT_PROFILE.hairStyle);
  assert.equal(p.headwear, 'cap');
  assert.equal(p.skin, PALETTE.skin[0]);
});

test('the CPU opponent has an invented name and never wears the player\'s shirt colour', () => {
  const rng = seededRng(12);
  for (let i = 0; i < 200; i++) {
    const me = randomProfile(rng);
    const cpu = cpuOpponent(me, rng);
    assert.ok(CPU_NAMES.includes(cpu.name), `${cpu.name} comes from the invented list`);
    assert.notEqual(cpu.shirt, me.shirt);
  }
});

// ---------------------------------------------------------------- split step
test('players split-step only when set, not on every shot', () => {
  let splits = 0, swings = 0, bad = 0;
  playPoints(createGame, {
    difficulty: 'normal', profile: 'solid', seed: 21, points: 120,
    onEvent(e, g) {
      if (e.type === 'hit') swings++;
      if (e.type !== 'split') return;
      splits++;
      const p = g.players[e.side];
      // checked right after the step that emitted it, so allow for one step of movement
      if (p.action !== 'ready' || p.slide || Math.hypot(p.vx, p.vz) > 2.2 + 0.6) bad++;
    },
  });
  assert.equal(bad, 0, 'nobody split-steps mid-stroke, mid-slide or at a sprint');
  assert.ok(splits > swings * 0.3, `split steps still happen often (${splits} for ${swings} shots)`);
  assert.ok(splits < swings * 0.95, `but not on every shot (${splits} for ${swings} shots)`);
});

// ---------------------------------------------------------------- long run with invariants
test('several hundred points of play keep the rules and score consistent', () => {
  // with a perfect line judge, so every call can be checked against the rules
  const saved = { ...CALLS };
  CALLS.missRate = 0; CALLS.cpuHopeful = 0;
  let totalFaults = 0;
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
    assert.ok(games >= 30, `${where()}: games change (${games})`);
    assert.ok(stats.matches >= 1, `${where()}: at least one full set completes`);
    assert.ok(deuces >= 1, `${where()}: deuce comes up`);
    totalFaults += stats.faults; // the sharp bot can go a whole run without one
    assert.ok(stats.reasons['cpu wins: out'] || stats.reasons['human wins: out'], `${where()}: out balls`);
    assert.ok(stats.human > 0 && stats.cpu > 0, `${where()}: both players win points`);
  }
  assert.ok(totalFaults >= 1, 'faults happen');
  Object.assign(CALLS, saved);
});

test('line judge errors and challenges keep the score consistent', () => {
  // a very fallible line judge and a CPU that challenges every wrong call against it
  const saved = { ...CALLS };
  Object.assign(CALLS, { close: 0.4, missRate: 0.9, cpuWrong: 1, cpuHopeful: 0.2 });
  try {
    let atStart = null, open = null, results = 0, overturned = 0, replays = 0;
    let lost = 0, game = null;
    const stats = playPoints(createGame, {
      difficulty: 'normal', profile: 'solid', seed: 21, points: 250,
      onStep(g) { game = g; },
      onEvent(e, g) {
        if (e.type === 'serveReady') atStart = { points: g.match.points.slice(), games: g.match.games.slice(), serveNumber: g.match.serveNumber };
        if (e.type === 'challenge') { assert.equal(open, null, 'one review at a time'); assert.equal(e.side, 1, 'only the CPU challenges here'); open = e; }
        if (e.type === 'challengeResult') {
          assert.ok(open, 'a verdict follows a challenge');
          open = null; results++;
          if (e.overturned) overturned++; else lost++;
          assert.equal(e.inside, e.margin >= 0, 'the verdict matches the ball mark');
          assert.equal(g.challenges[1], Math.max(0, 3 - lost), 'only unsuccessful challenges are used up');
        }
        if (e.type === 'replay') {
          replays++;
          assert.deepEqual(g.match.points, atStart.points, 'a replayed point restores the score');
          assert.deepEqual(g.match.games, atStart.games);
        }
        if (e.type === 'matchStart') lost = 0;
      },
    });
    assert.equal(stats.stuck, false, 'play never stalls');
    assert.ok(results >= 3, `challenges happen (${results})`);
    assert.ok(overturned >= 1, 'some calls are overturned');
    assert.ok(game.challenges[1] >= 0);
    void replays;
  } finally { Object.assign(CALLS, saved); }
});

test('match statistics add up', () => {
  // the first complete match
  const reasons = {};
  let s = null, last = null;
  const st = playPoints(createGame, {
    difficulty: 'normal', profile: 'solid', seed: 31, points: 200,
    onEvent(e, game) {
      if (s) return;
      // a point replayed after a challenge is taken back, stats and all
      if (e.type === 'replay') { reasons[last]--; return; }
      if (e.type !== 'point') return;
      last = e.reason;
      reasons[e.reason] = (reasons[e.reason] || 0) + 1;
      if (e.set) s = JSON.parse(JSON.stringify(game.stats));
    },
  });
  assert.ok(s, 'a match was completed');
  const total = Object.values(reasons).reduce((a, b) => a + b, 0);
  assert.ok(st.points > 0);
  assert.equal(s.points[0] + s.points[1], total, 'points won add up to points played this match');
  assert.equal(s.aces[0] + s.aces[1], reasons.ace || 0, 'aces');
  assert.equal(s.doubleFaults[0] + s.doubleFaults[1], reasons.doubleFault || 0, 'double faults');
  assert.equal(s.winners[0] + s.winners[1], reasons.double || 0, 'winners');
  const errors = (reasons.out || 0) + (reasons.net || 0);
  assert.equal(s.unforced[0] + s.unforced[1] + s.forced[0] + s.forced[1], errors, 'every out or net ball is an error');
  for (const i of [0, 1]) {
    assert.ok(s.firstFaults[i] <= s.firstServes[i], 'first serve faults within first serves');
    assert.ok(s.firstWon[i] <= s.firstServes[i] - s.firstFaults[i]);
    assert.ok(s.secondWon[i] <= s.secondPlayed[i]);
    assert.ok(s.bpWon[i] <= s.bpChances[i]);
    assert.ok(s.distance[i] > 0, 'both players run');
  }
  assert.ok(s.fastestServe[0] > 100 && s.fastestServe[1] > 100, 'serve speeds recorded');
  assert.ok(s.longestRally >= 2);
});

test('tournaments: a draw of eight, three rounds, a champion', async () => {
  const { createTournament, nextOpponent, recordResult, levelFor, roundName, bracket } = await import('../src/tournament.js');
  for (const seed of [1, 2, 3, 4]) {
    const t = createTournament({ eventId: 'ashbridge', difficulty: 'normal', gamesToWin: 3, playerName: 'L. MARLOW', seed });
    assert.equal(t.surface, 'grass');
    assert.equal(new Set(t.entrants.map((e) => e.name)).size, 8, 'eight different players');
    assert.equal(t.entrants.filter((e) => !e.cpu).length, 1, 'the player is in the draw once');
    // win every match
    const seen = new Set();
    for (let r = 0; r < 3; r++) {
      assert.equal(roundName(t), ['QUARTER-FINAL', 'SEMI-FINAL', 'FINAL'][r]);
      assert.equal(levelFor(t), r === 2 ? 'hard' : 'normal', 'the final is a level up');
      const opp = nextOpponent(t);
      assert.ok(opp && opp.cpu && !seen.has(opp.name), 'a new CPU opponent each round');
      seen.add(opp.name);
      recordResult(t, true, [3, 1]);
    }
    assert.equal(t.status, 'won');
    assert.equal(nextOpponent(t), null);
    const b = bracket(t);
    assert.deepEqual(b.map((r) => r.matches.length), [4, 2, 1]);
    assert.ok(b.every((r) => r.matches.every((m) => m.winner)), 'every match has a result');
    // lose in the semi-final: the draw is still played out
    const u = createTournament({ eventId: 'porto', difficulty: 'easy', gamesToWin: 6, playerName: 'L. MARLOW', seed: seed + 10 });
    recordResult(u, true, [6, 2]);
    recordResult(u, false, [4, 6]);
    assert.equal(u.status, 'lost');
    assert.ok(bracket(u)[2].matches[0].winner, 'the final was simulated');
    assert.deepEqual(JSON.parse(JSON.stringify(u)), u, 'a tournament is plain data (saved and resumed)');
  }
});
