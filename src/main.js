// Game core (state machine and fixed-step update) plus the browser boot.
// createGame() has no rendering or DOM in it, so tests can run it headless.
import { AI, BALL, CONTACT, COURT, NAMES, PLAYER, RALLY, SERVE, SERVE_ANIM, SHOT, SMASH, SWING, VOLLEY } from './config.js';
import { createBall, stepBall, planShot, predictAtPlane, lowerOverNet } from './ball.js';
import { createMatch, awardPoint, fault, serveFromRight, inSingles, inServiceBox } from './rules.js';
import { createAI } from './ai.js';

const NO_INPUT = { x: 0, y: 0, drive: false, slice: false, lob: false };
const TOSS_VY = Math.sqrt(2 * BALL.gravity * (SERVE.tossApex - SERVE.tossY0));
const TOSS_APEX_T = TOSS_VY / BALL.gravity; // ideal moment for the second press

function makePlayer(side, speed) {
  const sign = side === 0 ? 1 : -1; // which half of the court (+z or -z)
  return {
    side, sign, speed,
    right: sign, // world x direction of the player's right hand
    x: 0, z: sign * PLAYER.startZ, vx: 0, vz: 0,
    facing: side === 0 ? Math.PI : 0,
    action: 'ready', actionT: 0,
    swing: null, // { kind, hand, plan, done }
    slide: false, slideT: 0, slideX: 0, slideZ: 0, // a slide in progress and where it started
    chaseT: 0, // seconds spent running near top speed
  };
}

export function createGame(options = {}) {
  const rng = options.rng || Math.random;
  const levelName = options.difficulty || AI.defaultLevel;
  const level = { ...AI.levels[levelName] };
  const ai = createAI(level, rng);
  const players = [makePlayer(0, PLAYER.speed), makePlayer(1, level.speed)];
  const ball = createBall();
  const events = []; // drained by the view or the test
  const ballEvents = [];
  const plane = {};
  const gauss = () => (rng() + rng() + rng() - 1.5) * 2;
  let input = NO_INPUT;
  let match = createMatch({ gamesToWin: options.gamesToWin ?? NAMES.gamesToWin, firstServer: options.firstServer ?? 0 });
  let serveError = 0; // timing error of the serve in progress
  let cpuServeError = 0;
  let afterPause = 'serve'; // what follows the pointOver pause

  const g = {
    state: 'menu', // menu | serveReady | toss | rally | pointOver | matchOver
    timer: 0,
    time: 0,
    players, ball, events,
    get match() { return match; },
    rallyHits: 0,
    difficulty: levelName,
    level,
    tossApexTime: TOSS_APEX_T,
    start, step,
  };

  // ------------------------------------------------------------ movement
  function drive(p, wx, wz, top, dt) {
    const speed = Math.hypot(p.vx, p.vz);
    p.chaseT = speed >= p.speed * PLAYER.chaseSpeed ? p.chaseT + dt : 0;
    if (!p.slide && p.chaseT >= PLAYER.slideSprintTime) {
      // braking hard out of a long sprint slides; a hard reversal plants and pushes off instead
      const along = (wx * top * p.vx + wz * top * p.vz) / speed;
      if (along < speed * PLAYER.slideTrigger && along > -speed * PLAYER.slideReverseLimit) startSlide(p);
    }
    if (p.slide) {
      p.slideT += dt;
      // pushing back the other way digs in harder than just braking
      const reverse = wx * p.vx + wz * p.vz < 0;
      const ns = Math.max(0, speed - (reverse ? PLAYER.slideDecelReverse : PLAYER.slideDecel) * dt);
      const f = speed > 0 ? ns / speed : 0;
      p.vx *= f; p.vz *= f;
      if (ns <= PLAYER.slideEndSpeed) endSlide(p);
    } else {
      const k = Math.min(1, dt * PLAYER.accel);
      p.vx += (wx * top - p.vx) * k;
      p.vz += (wz * top - p.vz) * k;
    }
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    const d = p.z * p.sign;
    if (Math.abs(p.x) > PLAYER.maxX) { p.x = Math.sign(p.x) * PLAYER.maxX; p.vx = 0; }
    if (d < PLAYER.minZ) { p.z = p.sign * PLAYER.minZ; p.vz = 0; }
    if (d > PLAYER.maxZ) { p.z = p.sign * PLAYER.maxZ; p.vz = 0; }
  }

  function startSlide(p) {
    p.slide = true;
    p.slideT = 0;
    p.slideX = p.x; p.slideZ = p.z;
    events.push({ type: 'slide', side: p.side, x: p.x, z: p.z, speed: Math.hypot(p.vx, p.vz) });
  }

  function endSlide(p, silent = false) {
    if (!p.slide) return;
    p.slide = false;
    if (!silent) events.push({ type: 'slideEnd', side: p.side, x0: p.slideX, z0: p.slideZ, x1: p.x, z1: p.z });
  }

  function topSpeed(p) {
    return p.speed * (p.action === 'ready' ? 1 : PLAYER.swingMoveFactor);
  }

  function setAction(p, action) {
    p.action = action;
    p.actionT = 0;
    p.swing = null;
  }

  // ------------------------------------------------------------ serve
  // World x sign of the side the server stands on.
  function serverSideX() {
    const p = players[match.server];
    return p.right * (serveFromRight(match) ? 1 : -1);
  }

  function holdBall(p) {
    ball.x = p.x - p.right * 0.22;
    ball.y = SERVE.handY;
    ball.z = p.z - p.sign * 0.28;
    ball.vx = ball.vy = ball.vz = 0;
  }

  function setupServe() {
    const server = players[match.server], receiver = players[1 - match.server];
    const sx = serverSideX();
    server.x = sx * SERVE.standX;
    server.z = server.sign * (COURT.halfLength + SERVE.standBehind);
    receiver.x = -sx * SERVE.receiverX;
    receiver.z = receiver.sign * (COURT.halfLength + SERVE.receiverBehind);
    for (const p of players) { p.vx = p.vz = 0; p.chaseT = 0; endSlide(p, true); }
    setAction(server, 'serveReady');
    setAction(receiver, 'ready');
    ball.visible = true;
    ball.inPlay = false;
    ball.isServe = false;
    ball.bounces = 0;
    ball.lastHitter = -1;
    ball.letPending = false;
    holdBall(server);
    g.rallyHits = 0;
    g.state = 'serveReady';
    g.timer = 0;
    events.push({ type: 'serveReady', server: match.server, serveNumber: match.serveNumber });
  }

  function startToss() {
    const p = players[match.server];
    setAction(p, 'toss');
    ball.x = p.x + p.right * SERVE.tossSide;
    ball.y = SERVE.tossY0;
    ball.z = p.z - p.sign * SERVE.tossFront;
    ball.vx = ball.vz = 0;
    ball.vy = TOSS_VY;
    g.state = 'toss';
    g.timer = 0;
    cpuServeError = gauss() * level.serveError;
    events.push({ type: 'toss', server: match.server });
  }

  function startServeSwing(kind) {
    const p = players[match.server];
    serveError = g.timer - TOSS_APEX_T; // negative: early, positive: late
    setAction(p, 'serve');
    p.swing = { kind, hand: 1, plan: null, done: false };
    considerSplit(players[1 - p.side]);
  }

  // Split step: as the opponent starts a swing, a player who is set (in the ready
  // stance, not mid-stroke, sliding or still sprinting into position) hops so they
  // land as the ball is struck, ready to push off either way. Now and then they skip it.
  let looks = (options.seed ?? 77) >>> 0 || 77; // its own random stream: cosmetic, keeps play unchanged
  const lookRng = () => { looks = (Math.imul(looks, 1664525) + 1013904223) >>> 0; return looks / 4294967296; };
  function considerSplit(p) {
    if (p.action !== 'ready' || p.slide) return;
    if (Math.hypot(p.vx, p.vz) > PLAYER.splitMaxSpeed) return;
    if (lookRng() < PLAYER.splitSkip) return;
    events.push({ type: 'split', side: p.side });
  }

  function launchServe(p) {
    const s = p.swing;
    s.done = true;
    const human = p.side === 0;
    const second = match.serveNumber === 2;
    const e = serveError;
    const perfect = Math.abs(e) <= SERVE.perfect;
    const over = Math.max(0, Math.abs(e) - SERVE.perfect) * (second ? SERVE.secondForgive : 1);
    const boxX = -serverSideX(); // the diagonal box
    const aim = human ? input.x : (rng() * 2 - 1) * 0.8;
    const tx = boxX * COURT.singlesHalf / 2 + aim * SERVE.aimX + gauss() * SERVE.scatter * over;
    // too early sends it long, too late drags it down into the net
    const depth = (second ? SERVE.secondDepth : SERVE.depth) + (e < 0 ? over * SERVE.longRate : -over * SERVE.shortRate);
    let speed = human ? (perfect ? SERVE.perfectSpeed : SERVE.speed) : level.serveSpeed * (perfect ? 1.12 : 1);
    if (second) speed *= SERVE.secondFactor;
    if (s.kind === 'slice') speed *= SERVE.sliceFactor;
    const from = { x: ball.x, y: Math.max(1, ball.y), z: ball.z };
    const v = planShot(from, tx, -p.sign * depth, { speed, margin: SERVE.netMargin });
    if (e > 0) v.vy -= over * SERVE.lateDrop;
    ball.y = from.y;
    ball.vx = v.vx; ball.vy = v.vy; ball.vz = v.vz;
    ball.spin = s.kind === 'slice' ? 'slice' : 'flat';
    ball.bounces = 0;
    ball.lastHitter = p.side;
    ball.hitId++;
    ball.inPlay = true;
    ball.isServe = true;
    ball.letPending = false;
    g.rallyHits = 1;
    g.state = 'rally';
    if (human) events.push({ type: 'timing', kind: perfect ? 'perfect' : e < 0 ? 'early' : 'late', error: e, serve: true });
    events.push({ type: 'hit', side: p.side, kind: 'serve', kmh: Math.hypot(v.vx, v.vy, v.vz) * 3.6 });
  }

  // A serve that clips the net and still lands in the box is a let: replayed, no fault.
  function callLet() {
    ball.inPlay = false;
    ball.isServe = false;
    g.state = 'pointOver';
    g.timer = SERVE.faultDelay;
    afterPause = 'serve';
    events.push({ type: 'let', serveNumber: match.serveNumber });
  }

  function serveFault(reason) {
    ball.inPlay = false;
    ball.isServe = false;
    const server = match.server;
    if (fault(match)) { finishPoint(1 - server, 'doubleFault'); return; }
    g.state = 'pointOver';
    g.timer = SERVE.faultDelay;
    afterPause = 'serve';
    events.push({ type: 'fault', server, reason });
  }

  // ------------------------------------------------------------ swings and shots
  function startSwing(p, kind, plan = null) {
    const zPlane = p.z - p.sign * CONTACT.front;
    const pr = ball.visible ? predictAtPlane(ball, zPlane, p.sign, 0.6, plane) : null;
    const bx = pr ? pr.x : ball.x;
    let hand = (bx - p.x) * p.right >= 0 ? 1 : -1; // 1 forehand, -1 backhand
    // a drive at a ball that will arrive high becomes an overhead smash
    const smash = kind === 'smash' || (kind === 'drive' && !plan && pr !== null && pr.y >= SMASH.minHeight);
    if (smash) hand = 1;
    // near the net, a ball that will still be in the air at the hitting plane is volleyed
    const volley = !smash && kind !== 'smash' && ball.inPlay && !ball.isServe && ball.lastHitter !== p.side
      && ball.bounces === 0 && Math.abs(p.z) <= VOLLEY.zoneZ && (!pr || pr.bounces === 0);
    if (smash) p.action = 'smash';
    else if (volley) p.action = hand > 0 ? 'fhVolley' : 'bhVolley';
    else p.action = hand > 0 ? 'forehand' : 'backhand';
    p.actionT = 0;
    p.swing = { kind: smash ? 'smash' : kind, hand, plan, volley, done: false };
    considerSplit(players[1 - p.side]);
    // swinging at the end of a long chase slides into the shot
    if (!p.slide && !smash && p.chaseT >= PLAYER.slideChaseTime) startSlide(p);
  }

  // risky: this shot flies low enough to clip the tape, or find the net
  function launch(p, tx, tz, kind, speed, volley = false, risky = false) {
    const from = { x: ball.x, y: Math.max(SHOT.minContactHeight, ball.y), z: ball.z };
    let opts;
    if (kind === 'lob') opts = { time: SHOT.lobTime };
    else if (kind === 'smash') opts = { speed, margin: SMASH.netMargin };
    else opts = { speed: kind === 'slice' ? speed * SHOT.sliceFactor : speed };
    const v = planShot(from, tx, tz, opts);
    if (risky && kind !== 'lob' && kind !== 'smash') {
      lowerOverNet(from, v, SHOT.netRiskLow + rng() * (SHOT.netRiskHigh - SHOT.netRiskLow));
    }
    ball.y = from.y;
    ball.vx = v.vx; ball.vy = v.vy; ball.vz = v.vz;
    ball.spin = kind === 'slice' ? 'slice' : 'flat';
    ball.bounces = 0;
    ball.lastHitter = p.side;
    ball.hitId++;
    ball.inPlay = true;
    ball.isServe = false;
    ball.visible = true;
    g.rallyHits++;
    events.push({ type: 'hit', side: p.side, kind, volley, kmh: Math.hypot(v.vx, v.vy, v.vz) * 3.6 });
  }

  // Contact happens when the ball reaches the hitting zone during the swing window.
  function tryContact(p) {
    const s = p.swing;
    if (!s || s.done || !ball.inPlay || ball.lastHitter === p.side) return;
    if (ball.isServe && ball.bounces === 0) return; // a serve must bounce first
    if (p.actionT < SWING.windowStart || p.actionT > SWING.windowEnd) return;
    if (ball.z * p.sign <= 0) return; // still on the other side of the net
    const past = (ball.z - (p.z - p.sign * CONTACT.front)) * p.sign;
    if (past < 0 || past > CONTACT.depth) return;
    if (Math.abs(ball.x - p.x) > CONTACT.reachX) return;
    if (ball.y > (s.kind === 'smash' ? SMASH.reachY : CONTACT.reachY)) return;
    s.done = true;
    // a smash needs the ball overhead; if it dropped too low it is just a drive
    const smash = s.kind === 'smash' && ball.y >= SMASH.contactMin;
    const kind = s.kind === 'smash' && !smash ? 'drive' : s.kind;
    const volley = !smash && ball.bounces === 0; // taken out of the air

    if (s.plan) { // CPU shot, already chosen
      let speed = s.plan.speed;
      if (smash) speed *= SMASH.cpuSpeedFactor;
      else if (volley) speed *= VOLLEY.cpuSpeedFactor;
      // stretched, it is likelier to catch the tape
      const risky = !smash && rng() < AI.netRisk + AI.netRiskStretch * (s.plan.stretch || 0);
      launch(p, s.plan.tx, s.plan.tz, kind, speed, volley, risky);
      return;
    }
    // Human shot: direction held at contact aims it, timing decides the quality.
    const e = p.actionT - SWING.ideal; // positive: swung too soon
    const perfect = Math.abs(e) <= SWING.perfect;
    const A = smash ? SMASH : volley ? VOLLEY : SHOT;
    let tx = input.x * A.aimX;
    let depth = kind === 'lob' ? SHOT.lobDepth : A.depthDefault;
    if (input.y > 0.3) depth = A.depthDeep;
    else if (input.y < -0.3) depth = A.depthShort;
    let speed = A.perfectSpeed;
    if (volley && kind === 'slice') { depth = VOLLEY.dropDepth; speed = VOLLEY.dropSpeed / SHOT.sliceFactor; }
    else if (!perfect) speed = smash ? SMASH.speed : volley ? VOLLEY.speed : SHOT.driveSpeed;
    if (!perfect) {
      // early pulls the ball across the body, late pushes it the other way
      tx += -s.hand * p.right * e * SHOT.timingShift;
      depth *= 1 - Math.min(SHOT.maxShort, Math.abs(e) * SHOT.shortRate);
    }
    events.push({ type: 'timing', kind: perfect ? 'perfect' : e > 0 ? 'early' : 'late', error: e, smash, volley });
    // a mistimed shot can fly low and clip the tape
    const risky = !perfect && !smash && rng() < SHOT.netRiskChance * Math.min(1, Math.abs(e) / 0.1);
    launch(p, tx, -p.sign * depth, kind, speed, volley, risky);
  }

  // ------------------------------------------------------------ rules
  function finishPoint(winner, reason) {
    ball.inPlay = false;
    ball.isServe = false;
    const server = match.server;
    const result = awardPoint(match, winner);
    g.state = 'pointOver';
    g.timer = match.over ? RALLY.matchOverDelay : RALLY.pointDelay;
    afterPause = match.over ? 'matchOver' : 'serve';
    events.push({
      type: 'point', winner, reason, server, hitter: ball.lastHitter, rallyHits: g.rallyHits,
      game: result.game, set: result.set,
    });
  }

  function endPoint(winner, reason) {
    if (g.state !== 'rally') return;
    finishPoint(winner, reason);
  }

  function onBallEvent(e) {
    events.push(e);
    if (!ball.inPlay) return;
    const hitter = ball.lastHitter;
    if (ball.isServe) {
      if (e.type === 'net') serveFault('net');
      else if (e.type === 'netCord') ball.letPending = true;
      else if (e.type === 'bounce') {
        if (e.n === 1) {
          if (!inServiceBox(e.x, e.z, hitter, serveFromRight(match))) serveFault('out');
          else if (ball.letPending) callLet();
        } else endPoint(hitter, 'ace');
      }
      return;
    }
    if (e.type === 'net') endPoint(1 - hitter, 'net');
    else if (e.type === 'bounce') {
      if (e.n === 1) {
        if (!inSingles(e.x, e.z, 1 - hitter)) endPoint(1 - hitter, 'out');
      } else endPoint(hitter, 'double');
    }
  }

  // Would a first bounce at (x, z) on the CPU side be good? Used by the CPU to leave balls.
  function cpuBounceGood(x, z, margin) {
    if (z >= 0) return false;
    if (ball.isServe) {
      // judged on the real box, grown by the margin
      const bx = -x * serverSideX();
      return -z <= COURT.serviceLine + margin && bx >= -margin && bx <= COURT.singlesHalf + margin;
    }
    return -z <= COURT.halfLength + margin && Math.abs(x) <= COURT.singlesHalf + margin;
  }

  // ------------------------------------------------------------ step
  function start() {
    match = createMatch({ gamesToWin: options.gamesToWin ?? NAMES.gamesToWin, firstServer: options.firstServer ?? 0 });
    events.push({ type: 'matchStart' });
    setupServe();
  }

  function stepHuman(dt) {
    const human = players[0];
    const press = input.drive ? 'drive' : input.slice ? 'slice' : input.lob ? 'lob' : null;
    const serving = match.server === 0;

    if (g.state === 'serveReady' && serving) {
      // shuffle along the baseline on the correct side of the centre mark
      const sx = serverSideX();
      human.x += input.x * PLAYER.speed * 0.4 * dt;
      const d = Math.max(SERVE.minX, Math.min(SERVE.maxX, human.x * sx));
      human.x = d * sx;
      human.vx = human.vz = 0;
      holdBall(human);
      if (press && g.timer >= SERVE.readyDelay) startToss();
      return;
    }
    if (g.state === 'toss' && serving) {
      human.vx = human.vz = 0;
      if (press && human.action === 'toss') startServeSwing(press);
      return;
    }
    if (human.action === 'serve') { human.vx = human.vz = 0; return; }
    if (g.state === 'rally' && human.action === 'ready' && press) startSwing(human, press);
    if (g.state === 'menu' || g.state === 'matchOver') { drive(human, 0, 0, 0, dt); return; }
    drive(human, input.x, -input.y, topSpeed(human), dt);
  }

  function stepCpu(dt) {
    const cpu = players[1];
    const serving = match.server === 1;
    if (g.state === 'menu' || g.state === 'matchOver') { drive(cpu, 0, 0, 0, dt); return; }
    if (g.state === 'serveReady' || g.state === 'toss') {
      cpu.vx = cpu.vz = 0;
      if (serving) {
        if (g.state === 'serveReady') {
          holdBall(cpu);
          if (g.timer >= SERVE.cpuDelay) startToss();
        } else if (cpu.action === 'toss' && g.timer >= TOSS_APEX_T + cpuServeError) startServeSwing('drive');
      }
      return;
    }
    if (cpu.action === 'serve') { cpu.vx = cpu.vz = 0; return; }
    const d = ai.think(g, cpuBounceGood);
    if (d.swing && cpu.action === 'ready') startSwing(cpu, d.swing.kind, d.swing);
    const dx = d.x - cpu.x, dz = d.z - cpu.z;
    const dist = Math.hypot(dx, dz);
    const top = topSpeed(cpu) * d.speed;
    // brake on a curve that stops on the spot, so it only slides when it has to
    const want = Math.min(top, dist * AI.arrive, Math.sqrt(2 * AI.brake * dist));
    const f = dist > 0.02 ? want / (dist * top || 1) : 0;
    drive(cpu, dx * f, dz * f, top, dt);
  }

  function step(dt, inp) {
    input = inp || NO_INPUT;
    g.time += dt;
    if (g.state === 'serveReady' || g.state === 'toss') g.timer += dt;

    stepHuman(dt);
    stepCpu(dt);

    for (const p of players) {
      if (p.action === 'ready' || p.action === 'serveReady' || p.action === 'toss') { p.actionT += dt; continue; }
      p.actionT += dt;
      if (p.action === 'serve') {
        if (!p.swing.done && p.actionT >= SERVE_ANIM.contact) launchServe(p);
        if (p.actionT >= SERVE_ANIM.swingDuration) setAction(p, 'ready');
      } else if (p.actionT >= SWING.duration) setAction(p, 'ready');
    }

    const held = g.state === 'serveReady';
    if (ball.visible && !held) {
      ballEvents.length = 0;
      stepBall(ball, dt, ballEvents);
      for (const e of ballEvents) onBallEvent(e);
      if (ball.inPlay && (Math.abs(ball.x) > RALLY.outX || Math.abs(ball.z) > RALLY.outZ)) {
        // left the arena: a winner if it already bounced in, otherwise out
        if (ball.bounces >= 1) endPoint(ball.lastHitter, ball.isServe ? 'ace' : 'double');
        else if (ball.isServe) serveFault('out');
        else endPoint(1 - ball.lastHitter, 'out');
      }
    }

    if (g.state === 'toss') {
      // a toss nobody swings at is caught and retaken, with no penalty
      const p = players[match.server];
      if (p.action === 'toss' && ball.vy < 0 && ball.y < SERVE.retossHeight) {
        events.push({ type: 'retoss' });
        setupServe();
      }
    } else if (g.state === 'rally') {
      tryContact(players[0]);
      tryContact(players[1]);
    } else if (g.state === 'pointOver') {
      g.timer -= dt;
      if (g.timer <= 0) {
        if (afterPause === 'matchOver') {
          g.state = 'matchOver';
          ball.visible = false;
          events.push({ type: 'matchOver', winner: match.winner, games: match.games.slice() });
        } else setupServe();
      }
    }
  }

  return g;
}

// ---------------------------------------------------------------- browser boot
async function boot() {
  const THREE = await import('three');
  const { RENDER } = await import('./config.js');
  const { pointLabels, gameCall } = await import('./rules.js');
  const { createWorld } = await import('./scene.js');
  const { createHud } = await import('./hud.js');
  const { createCharacter } = await import('./human.js');
  const { createInput } = await import('./input.js');
  const { createAudio } = await import('./audio.js');

  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const world = createWorld();
  const hud = createHud();
  const input = createInput();
  const audio = createAudio();
  let game = createGame();
  const views = [createCharacter(NAMES.playerKit), createCharacter(NAMES.cpuKit)];
  world.scene.add(views[0].object3d, views[1].object3d);
  const shortName = (side) => (side === 0 ? NAMES.player : NAMES.cpu).split(' ').pop();
  let matchTime = 0;
  let clockRunning = false;

  const showScore = () => {
    const m = game.match;
    hud.setScore({ games: m.games, points: pointLabels(m), server: m.server });
  };
  showScore();

  hud.onPlay((difficulty) => {
    audio.unlock();
    game = createGame({ difficulty });
    game.start();
    matchTime = 0;
    clockRunning = true;
    world.setSpeed(0);
    input.clear();
    hud.hideMenu();
    window.courtRush.game = game;
  });

  // Pause: button, P or Esc, and automatically when the tab or window loses focus.
  let paused = false;
  const inMatch = () => game.state !== 'menu' && game.state !== 'matchOver';
  function pause() {
    if (paused || !inMatch()) return;
    paused = true;
    input.clear();
    audio.pause();
    const m = game.match;
    const labels = pointLabels(m);
    hud.showPause(`${NAMES.player} ${m.games[0]} : ${m.games[1]} ${NAMES.cpu}   (${labels[0]} : ${labels[1]})`);
  }
  function resume() {
    if (!paused) return;
    paused = false;
    input.clear();
    audio.resume();
    hud.hidePause();
  }
  hud.onPause(pause);
  hud.onResume(resume);
  hud.onQuit(() => {
    paused = false;
    audio.resume();
    hud.hidePause();
    hud.hideMessage();
    game = createGame();
    clockRunning = false;
    matchTime = 0;
    world.setSpeed(0);
    showScore();
    hud.showMenu();
    window.courtRush.game = game;
  });
  // sound on or off: M, or the button on the pause screen; remembered on this device
  let muted = false;
  try { muted = localStorage.getItem('courtRush.muted') === '1'; } catch { /* storage blocked */ }
  function setMuted(m) {
    muted = m;
    audio.setMuted(m);
    hud.setSound(!m);
    try { localStorage.setItem('courtRush.muted', m ? '1' : '0'); } catch { /* storage blocked */ }
  }
  setMuted(muted);
  hud.onSound(() => setMuted(!muted));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') { setMuted(!muted); return; }
    if (e.code !== 'KeyP' && e.code !== 'Escape') return;
    e.preventDefault();
    if (paused) resume(); else pause();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);

  // The crowd: applause sized to the point. Clean winners and long rallies get more;
  // your own errors get only a little, and only after a long rally.
  function crowdReact(e) {
    const rally = Math.min(1, e.rallyHits / 12);
    const clean = e.reason === 'ace' || e.reason === 'double';
    const game = e.game ? 0.15 : 0;
    if (e.winner === 0) {
      if (clean && (rally > 0.5 || e.game)) audio.react('roar', 0.5 + 0.5 * rally);
      else audio.react('applause', (clean ? 0.45 : 0.3) + 0.45 * rally + game);
    } else if (clean) {
      audio.react('applause', 0.25 + 0.5 * rally + game);
    } else if (rally > 0.4 || game) {
      audio.react('applause', 0.15 + 0.35 * rally + game);
    }
  }

  const REASON = { out: 'OUT', net: 'NET', double: 'WINNER', ace: 'ACE', doubleFault: 'DOUBLE FAULT' };

  function handleEvents() {
    for (const e of game.events) {
      switch (e.type) {
        case 'hit':
          world.setSpeed(e.kmh);
          audio.play('strike', {
            kind: e.volley ? 'volley' : e.kind === 'drive' || e.kind === 'lob' ? 'hit' : e.kind,
            power: e.kmh / 140, x: game.players[e.side].x, z: game.players[e.side].z,
          });
          break;
        case 'timing':
          hud.showTiming(e.kind, e.smash ? 'SMASH' : e.volley ? 'VOLLEY' : '');
          break;
        case 'split':
          views[e.side].splitStep();
          break;
        case 'slide':
          audio.play('slide', { speed: e.speed, x: e.x, z: e.z });
          break;
        case 'slideEnd':
          world.addSlideTrail(e.x0, e.z0, e.x1, e.z1);
          break;
        case 'bounce':
          world.addBounceMark(e.x, e.z);
          audio.play('bounce', { speed: e.v, x: e.x, z: e.z });
          break;
        case 'net':
          audio.play(e.cord ? 'cord' : 'net', { x: e.x, z: 0 });
          break;
        case 'netCord':
          audio.play('cord', { x: e.x, z: 0 });
          hud.showCall('NET CORD');
          break;
        case 'let':
          hud.showMessage('LET', e.serveNumber === 1 ? 'FIRST SERVE' : 'SECOND SERVE', 1.2);
          break;
        case 'serveReady':
          showScore();
          break;
        case 'fault':
          hud.showMessage('FAULT', 'SECOND SERVE', 1.2);
          break;
        case 'point': {
          showScore();
          const m = game.match;
          let sub;
          if (e.set) sub = `GAME, SET AND MATCH ${shortName(e.winner)}`;
          else if (e.game) sub = `GAME ${shortName(e.winner)}`;
          else {
            const call = gameCall(m);
            if (call.call === 'deuce') sub = 'DEUCE';
            else if (call.call === 'advantage') sub = `ADVANTAGE ${shortName(call.side)}`;
            else {
              const labels = pointLabels(m);
              sub = `${labels[m.server]} : ${labels[1 - m.server]}`;
            }
          }
          hud.showMessage(REASON[e.reason] || 'POINT', sub, 1.6);
          if (!e.set) crowdReact(e);
          break;
        }
        case 'matchOver': {
          clockRunning = false;
          const won = e.winner === 0;
          hud.hideMessage();
          hud.showMenu({
            headline: won ? 'YOU WIN' : 'YOU LOSE',
            detail: `${NAMES.player} ${e.games[0]} : ${e.games[1]} ${NAMES.cpu}`,
            button: 'Play again',
          });
          if (won) audio.react('ovation');
          else audio.react('applause', 1);
          break;
        }
        default:
      }
    }
    game.events.length = 0;
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    world.resize(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  const frameInput = { x: 0, y: 0, drive: false, slice: false, lob: false };
  let last = performance.now();
  let acc = 0;
  let dustClock = 0;

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (paused) {
      renderer.render(world.scene, world.camera);
      requestAnimationFrame(frame);
      return;
    }
    acc += dt;
    const m = input.move();
    frameInput.x = m.x;
    frameInput.y = m.y;
    let first = true;
    while (acc >= BALL.fixedDt) {
      // button presses are edges: only the first step of a frame sees them
      frameInput.drive = first && input.consume('drive');
      frameInput.slice = first && input.consume('slice');
      frameInput.lob = first && input.consume('lob');
      game.step(BALL.fixedDt, frameInput);
      first = false;
      acc -= BALL.fixedDt;
    }
    handleEvents();
    if (clockRunning) matchTime += dt;
    views[0].update(dt, game.players[0]);
    views[1].update(dt, game.players[1]);
    world.updateBall(game.ball, dt);
    // clay dust kicked up ahead of a sliding foot
    dustClock += dt;
    for (const p of game.players) {
      if (!p.slide) continue;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp < 0.5) continue;
      const ux = p.vx / sp, uz = p.vz / sp;
      const every = 1 / (18 + sp * 6);
      for (let n = 0; n < 3 && dustClock >= every; n++) {
        world.slideDust(p.x + ux * 0.35, p.z + uz * 0.35, ux * sp * 0.3, uz * sp * 0.3, Math.min(1, sp / 6));
        dustClock -= every;
      }
    }
    if (dustClock > 0.2) dustClock = 0.2;
    world.updateFx(dt);
    // the crowd settles as a player gets ready to serve and stays quiet through the rally
    const st = game.state;
    audio.setCrowd(st === 'serveReady' || st === 'toss' || st === 'rally' ? 'hush' : 'chatter');
    audio.update(dt);
    world.setClock(matchTime);
    world.updateCamera(dt, game.players[0].x);
    renderer.render(world.scene, world.camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.courtRush = { world, hud, renderer, game, audio, views };
}

if (typeof document !== 'undefined') boot();
