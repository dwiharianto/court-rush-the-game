// Game core (state machine and fixed-step update) plus the browser boot.
// createGame() has no rendering or DOM in it, so tests can run it headless.
import { AI, BALL, CONTACT, COURT, NAMES, PLAYER, RALLY, SERVE, SERVE_ANIM, SHOT, SMASH, SWING, VOLLEY } from './config.js';
import { createBall, stepBall, planShot, predictAtPlane } from './ball.js';
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
    const k = Math.min(1, dt * PLAYER.accel);
    p.vx += (wx * top - p.vx) * k;
    p.vz += (wz * top - p.vz) * k;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    const d = p.z * p.sign;
    if (Math.abs(p.x) > PLAYER.maxX) { p.x = Math.sign(p.x) * PLAYER.maxX; p.vx = 0; }
    if (d < PLAYER.minZ) { p.z = p.sign * PLAYER.minZ; p.vz = 0; }
    if (d > PLAYER.maxZ) { p.z = p.sign * PLAYER.maxZ; p.vz = 0; }
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
    for (const p of players) { p.vx = p.vz = 0; }
    setAction(server, 'serveReady');
    setAction(receiver, 'ready');
    ball.visible = true;
    ball.inPlay = false;
    ball.isServe = false;
    ball.bounces = 0;
    ball.lastHitter = -1;
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
    g.rallyHits = 1;
    g.state = 'rally';
    if (human) events.push({ type: 'timing', kind: perfect ? 'perfect' : e < 0 ? 'early' : 'late', error: e, serve: true });
    events.push({ type: 'hit', side: p.side, kind: 'serve', kmh: Math.hypot(v.vx, v.vy, v.vz) * 3.6 });
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
  }

  function launch(p, tx, tz, kind, speed, volley = false) {
    const from = { x: ball.x, y: Math.max(SHOT.minContactHeight, ball.y), z: ball.z };
    let opts;
    if (kind === 'lob') opts = { time: SHOT.lobTime };
    else if (kind === 'smash') opts = { speed, margin: SMASH.netMargin };
    else opts = { speed: kind === 'slice' ? speed * SHOT.sliceFactor : speed };
    const v = planShot(from, tx, tz, opts);
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
      launch(p, s.plan.tx, s.plan.tz, kind, speed, volley);
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
    launch(p, tx, -p.sign * depth, kind, speed, volley);
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
      else if (e.type === 'bounce') {
        if (e.n === 1) {
          if (!inServiceBox(e.x, e.z, hitter, serveFromRight(match))) serveFault('out');
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
    const want = Math.min(top, dist * AI.arrive);
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
    const m = game.match;
    const labels = pointLabels(m);
    hud.showPause(`${NAMES.player} ${m.games[0]} : ${m.games[1]} ${NAMES.cpu}   (${labels[0]} : ${labels[1]})`);
  }
  function resume() {
    if (!paused) return;
    paused = false;
    input.clear();
    hud.hidePause();
  }
  hud.onPause(pause);
  hud.onResume(resume);
  hud.onQuit(() => {
    paused = false;
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
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyP' && e.code !== 'Escape') return;
    e.preventDefault();
    if (paused) resume(); else pause();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);

  const REASON = { out: 'OUT', net: 'NET', double: 'WINNER', ace: 'ACE', doubleFault: 'DOUBLE FAULT' };

  function handleEvents() {
    for (const e of game.events) {
      switch (e.type) {
        case 'hit':
          world.setSpeed(e.kmh);
          audio.play(e.kind === 'smash' || e.kind === 'serve' ? 'smash' : e.kind === 'slice' ? 'slice' : 'hit');
          break;
        case 'timing':
          hud.showTiming(e.kind, e.smash ? 'SMASH' : e.volley ? 'VOLLEY' : '');
          if (e.kind === 'perfect') audio.play('perfect');
          break;
        case 'bounce':
          world.addBounceMark(e.x, e.z);
          audio.play('bounce');
          break;
        case 'net':
          audio.play('net');
          break;
        case 'serveReady':
          showScore();
          break;
        case 'fault':
          hud.showMessage('FAULT', 'SECOND SERVE', 1.2);
          audio.play('fault');
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
          audio.play(e.winner === 0 ? 'pointWon' : 'pointLost');
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
          audio.play(won ? 'matchWon' : 'matchLost');
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
    world.setClock(matchTime);
    world.updateCamera(dt, game.players[0].x);
    renderer.render(world.scene, world.camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.courtRush = { world, hud, renderer, game, audio, views };
}

if (typeof document !== 'undefined') boot();
