// Game core (state machine and fixed-step update) plus the browser boot.
// createGame() has no rendering or DOM in it, so tests can run it headless.
import { WALLS, AI, AUDIO, BALL, CALLS, CONTACT, COURT, DEFAULT_SURFACE, DIVE, POWER, STAMINA, NAMES, SPIN, SURFACES, PLAYER, RALLY, SERVE, SERVE_ANIM, SHOT, SMASH, SWING, VOLLEY } from './config.js';
import { createBall, stepBall, planShot, predictAtPlane, lowerOverNet, copyBall } from './ball.js';
import { createMatch, awardPoint, fault, serveFromRight, inSingles, inServiceBox, lineMargin, serviceMargin, tiredness } from './rules.js';
import { createAI } from './ai.js';
import { createStats, resetStats, loadStats, statRows } from './stats.js';
import { createTournament, nextOpponent, recordResult, levelFor, roundName, bracket, EVENTS } from './tournament.js';
import { createCareerUI } from './careerui.js';

const NO_INPUT = { x: 0, y: 0, drive: false, slice: false, lob: false, challenge: false };
const TOSS_VY = Math.sqrt(2 * BALL.gravity * (SERVE.tossApex - SERVE.tossY0));
const TOSS_APEX_T = TOSS_VY / BALL.gravity; // ideal moment for the second press

function makePlayer(side, speed, fitness = 1) {
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
    stamina: 1, fitness, // stamina 1 fresh to 0 spent; fitness scales how fast it is used
    resting: false, // between points (for the animation)
  };
}

export function createGame(options = {}) {
  const rng = options.rng || Math.random;
  // a named level, or (in a career) settings worked out from the opponent's rating
  const levelName = options.level ? 'custom' : options.difficulty || AI.defaultLevel;
  const level = { ...(options.level || AI.levels[levelName]) };
  const ai = createAI(level, rng);
  const stats = createStats();
  const players = [makePlayer(0, PLAYER.speed), makePlayer(1, level.speed, level.fitness ?? 1)];
  const surfaceName = SURFACES[options.surface] ? options.surface : DEFAULT_SURFACE;
  const court = SURFACES[surfaceName];
  const ball = createBall();
  ball.court = court;
  ball.walls = WALLS[options.venue] || WALLS.stadium;
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
    stats,
    start, step,
  };

  // ------------------------------------------------------------ movement
  function drive(p, wx, wz, top, dt) {
    const speed = Math.hypot(p.vx, p.vz);
    p.chaseT = speed >= p.speed * PLAYER.chaseSpeed ? p.chaseT + dt : 0;
    if (!p.slide && p.chaseT >= court.slideSprint) {
      // braking hard out of a long sprint slides; a hard reversal plants and pushes off instead
      const along = (wx * top * p.vx + wz * top * p.vz) / speed;
      if (along < speed * PLAYER.slideTrigger && along > -speed * PLAYER.slideReverseLimit) startSlide(p);
    }
    if (p.slide) {
      p.slideT += dt;
      // pushing back the other way digs in harder than just braking
      const reverse = wx * p.vx + wz * p.vz < 0;
      const ns = Math.max(0, speed - (reverse ? PLAYER.slideDecelReverse : court.slideDecel) * dt);
      const f = speed > 0 ? ns / speed : 0;
      p.vx *= f; p.vz *= f;
      if (ns <= PLAYER.slideEndSpeed) endSlide(p);
    } else {
      // Momentum: speeding up is limited (and gets harder near top speed), braking is
      // quicker, and turning at speed takes grip, so changes of direction carry over.
      let dx = wx * top - p.vx, dz = wz * top - p.vz;
      if (speed > 0.3) {
        const ux = p.vx / speed, uz = p.vz / speed;
        let along = dx * ux + dz * uz;
        let ax = dx - along * ux, az = dz - along * uz;
        const push = PLAYER.accelRun * (1 - PLAYER.accelFade * Math.min(1, speed / p.speed)) * (1 - STAMINA.accelLoss * tiredness(p));
        along = Math.max(-PLAYER.brake * dt, Math.min(push * dt, along));
        const across = Math.hypot(ax, az), turnMax = PLAYER.turnGrip * dt;
        if (across > turnMax) { ax *= turnMax / across; az *= turnMax / across; }
        dx = along * ux + ax; dz = along * uz + az;
      } else {
        const d = Math.hypot(dx, dz), max = PLAYER.accelStart * dt;
        if (d > max) { dx *= max / d; dz *= max / d; }
      }
      p.vx += dx;
      p.vz += dz;
      // planting to push off back the other way at speed: the shoe grips (and squeaks, on a hard court)
      p.plantCool = Math.max(0, (p.plantCool || 0) - dt);
      const reversing = wx * p.vx + wz * p.vz < -0.5 * speed * Math.hypot(wx, wz);
      if (speed > PLAYER.plantSpeed && reversing && p.plantCool === 0) {
        p.plantCool = PLAYER.plantGap;
        events.push({ type: 'plant', side: p.side, x: p.x, z: p.z, speed });
      }
    }
    moveWithin(p, dt);
  }

  function moveWithin(p, dt) {
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    const d = p.z * p.sign;
    if (Math.abs(p.x) > PLAYER.maxX) { p.x = Math.sign(p.x) * PLAYER.maxX; p.vx = 0; }
    if (d < PLAYER.minZ) { p.z = p.sign * PLAYER.minZ; p.vz = 0; }
    if (d > PLAYER.maxZ) { p.z = p.sign * PLAYER.maxZ; p.vz = 0; }
  }

  // A dive carries the player sideways through the air, then slides them along the
  // ground to a stop; there is no steering until they are back on their feet.
  const diving = (p) => !!(p.swing && p.swing.dive);
  function diveMove(p, dt) {
    const air = p.actionT < DIVE.flight;
    const sp = Math.hypot(p.vx, p.vz);
    if (!air && !p.swing.landed) {
      p.swing.landed = true;
      p.swing.x0 = p.x; p.swing.z0 = p.z;
      events.push({ type: 'diveLand', side: p.side, x: p.x, z: p.z, speed: sp });
    }
    const ns = Math.max(0, sp - (air ? DIVE.airDrag : DIVE.slideDecel[surfaceName] ?? 8) * dt);
    const f = sp > 0 ? ns / sp : 0;
    p.vx *= f; p.vz *= f;
    if (p.swing.landed && ns === 0 && !p.swing.stopped) {
      p.swing.stopped = true;
      events.push({ type: 'slideEnd', side: p.side, x0: p.swing.x0, z0: p.swing.z0, x1: p.x, z1: p.z });
    }
    moveWithin(p, dt);
    p.chaseT = 0;
  }

  // ------------------------------------------------------------ stamina
  function tire(p, amount) { p.stamina = Math.max(0, p.stamina - amount * p.fitness); }
  function rest(p, amount) { p.stamina = Math.min(1, p.stamina + amount); }
  function updateStamina(p, dt) {
    const pause = g.state === 'pointOver' || g.state === 'serveReady' || g.state === 'toss' || g.state === 'review';
    p.resting = g.state === 'pointOver' && p.action === 'ready';
    if (pause) { rest(p, STAMINA.restPause * dt); return; }
    if (g.state !== 'rally') return;
    const v = Math.hypot(p.vx, p.vz) / p.speed;
    if (v < 0.2) rest(p, STAMINA.restRally * dt);
    else tire(p, STAMINA.run * v * v * dt);
  }

  function startSlide(p) {
    tire(p, STAMINA.slide);
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
    return p.speed * (p.action === 'ready' ? (p.charge ? POWER.chargeMove : 1) : PLAYER.swingMoveFactor) * (1 - STAMINA.speedLoss * tiredness(p));
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
    ball.x = p.x + p.right * SERVE.handSide;
    ball.y = SERVE.handY;
    ball.z = p.z - p.sign * SERVE.handFront;
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
    call = null;
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

  // After contact the server lands on the front foot inside the court and carries on a step.
  function serveFollow(p, dt) {
    p.vx = 0;
    p.vz = 0;
    if (!p.swing || !p.swing.done) return;
    const u = (p.actionT - SERVE_ANIM.contact) / SERVE_ANIM.landTime;
    if (u >= 1) return;
    p.vz = -p.sign * SERVE_ANIM.landSpeed * (1 - u);
    p.z += p.vz * dt;
  }

  function startServeSwing(kind, power = null) {
    const p = players[match.server];
    serveError = g.timer - TOSS_APEX_T; // negative: early, positive: late
    setAction(p, 'serve');
    p.swing = { kind, hand: 1, plan: null, done: false, power };
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
    speed *= 1 - STAMINA.shotLoss * tiredness(p);
    tire(p, STAMINA.serve);
    const pw = s.power;
    let wildX = 0, wildZ = 0;
    if (pw !== null && pw !== undefined) {
      speed *= POWER.serve[0] + POWER.serve[1] * pw;
      const wild = pw * pw * (perfect ? POWER.calm : 1);
      wildX = gauss() * POWER.serveScatter * wild;
      wildZ = gauss() * POWER.serveDepth * wild;
    }
    const from = { x: ball.x, y: Math.max(1, ball.y), z: ball.z };
    const lift = s.kind === 'slice' ? SPIN.serveSlice : second ? SPIN.secondServe : SPIN.serve;
    const v = planShot(from, tx + wildX, -p.sign * (depth + wildZ), { speed, margin: SERVE.netMargin, lift });
    if (e > 0) v.vy -= over * SERVE.lateDrop;
    ball.y = from.y;
    ball.vx = v.vx; ball.vy = v.vy; ball.vz = v.vz;
    ball.spin = s.kind === 'slice' ? 'slice' : 'flat';
    ball.lift = lift;
    ball.bounces = 0;
    ball.lastHitter = p.side;
    ball.hitId++;
    ball.inPlay = true;
    ball.isServe = true;
    ball.letPending = false;
    g.rallyHits = 1;
    g.state = 'rally';
    if (human) events.push({ type: 'timing', kind: perfect ? 'perfect' : e < 0 ? 'early' : 'late', error: e, serve: true });
    if (!second) stats.firstServes[p.side]++;
    stats.fastestServe[p.side] = Math.max(stats.fastestServe[p.side], Math.hypot(v.vx, v.vy, v.vz) * 3.6);
    events.push({ type: 'hit', side: p.side, kind: 'serve', kmh: Math.hypot(v.vx, v.vy, v.vz) * 3.6 });
  }

  // A serve that clips the net and still lands in the box is a let: replayed, no fault.
  function callLet() {
    if (match.serveNumber === 1) stats.firstServes[match.server]--;
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
    if (match.serveNumber === 1) stats.firstFaults[server]++;
    if (fault(match)) { finishPoint(1 - server, 'doubleFault', reason); return; }
    g.state = 'pointOver';
    g.timer = SERVE.faultDelay;
    afterPause = 'serve';
    events.push({ type: 'fault', server, reason });
  }

  // ------------------------------------------------------------ swings and shots
  function startSwing(p, kind, plan = null, power = null) {
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
    // a ball about to pass just beyond reach: dive for it (the CPU decides in its plan)
    const away = pr ? Math.abs(bx - p.x) : 0;
    const dive = !smash && pr !== null && pr.t <= DIVE.lead && pr.y <= DIVE.maxHeight && away <= DIVE.maxStart
      && (plan ? !!plan.dive : away > DIVE.from);
    if (smash) p.action = 'smash';
    else if (dive) p.action = hand > 0 ? 'diveF' : 'diveB';
    else if (volley) p.action = hand > 0 ? 'fhVolley' : 'bhVolley';
    else p.action = hand > 0 ? 'forehand' : 'backhand';
    p.actionT = 0;
    // where the ball should be at contact, for the animation to shape the stroke
    const contactH = pr ? pr.y : 1.0, contactSide = pr ? Math.abs(bx - p.x) : 0.75;
    p.swing = { kind: smash ? 'smash' : kind, hand, plan, volley, done: false, contactH, contactSide, dive, power };
    considerSplit(players[1 - p.side]);
    if (dive) {
      endSlide(p, true);
      const dir = Math.sign(bx - p.x) || 1;
      p.vx = dir * Math.max(DIVE.lunge, p.vx * dir);
      p.vz *= 0.4;
      tire(p, STAMINA.dive);
      stats.dives[p.side]++;
      events.push({ type: 'dive', side: p.side, x: p.x, z: p.z, dir });
      return;
    }
    // swinging at the end of a long chase slides into the shot
    if (!p.slide && !smash && p.chaseT >= court.slideChase) startSlide(p);
  }

  // risky: this shot flies low enough to clip the tape, or find the net
  function launch(p, tx, tz, kind, speed, volley = false, risky = false) {
    const tired = tiredness(p);
    speed *= 1 - STAMINA.shotLoss * tired;
    tx += gauss() * STAMINA.scatter * tired * (p.side === 0 ? 1 : 0.5); // the CPU's own errors grow too (ai.js)
    tire(p, speed >= SHOT.driveSpeed ? STAMINA.power : STAMINA.hit);
    // a shot played under pressure: diving, sliding, at full stretch, or a CPU plan it was stretched for
    const sw = p.swing;
    p.lastShotForced = !!(p.slide || (sw && (sw.dive || sw.contactSide > 1.2 || (sw.plan && sw.plan.stretch > 0.6))));
    const from = { x: ball.x, y: Math.max(SHOT.minContactHeight, ball.y), z: ball.z };
    // spin by shot: drives are topspin, slices and drop shots backspin, smashes flat
    const lift = kind === 'lob' ? SPIN.lob : kind === 'smash' ? SPIN.smash : kind === 'slice' ? SPIN.slice
      : volley ? SPIN.volley : SPIN.drive * (speed >= SHOT.perfectSpeed ? 1.2 : 1);
    let opts;
    if (kind === 'lob') opts = { time: SHOT.lobTime, lift };
    else if (kind === 'smash') opts = { speed, margin: SMASH.netMargin, lift };
    else opts = { speed: kind === 'slice' ? speed * SHOT.sliceFactor : speed, lift };
    const v = planShot(from, tx, tz, opts);
    if (risky && kind !== 'lob' && kind !== 'smash') {
      lowerOverNet(from, v, SHOT.netRiskLow + rng() * (SHOT.netRiskHigh - SHOT.netRiskLow), lift);
    }
    ball.y = from.y;
    ball.vx = v.vx; ball.vy = v.vy; ball.vz = v.vz;
    ball.spin = kind === 'slice' ? 'slice' : 'flat';
    ball.lift = lift;
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
    if (Math.abs(ball.x - p.x) > (s.dive ? DIVE.reachX : CONTACT.reachX)) return;
    if (ball.y > (s.kind === 'smash' ? SMASH.reachY : s.dive ? DIVE.maxHeight + 0.3 : CONTACT.reachY)) return;
    s.done = true;
    if (s.dive) { diveShot(p, s); return; }
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
    // power: faster, but the errors spread (less so when perfectly timed)
    const pw = s.power ?? POWER.tap;
    const touch = kind === 'lob' || (volley && kind === 'slice');
    let wild = 0;
    if (!touch) {
      const f = volley ? POWER.volley : POWER.shot;
      speed *= f[0] + f[1] * pw;
      wild = pw * pw * (perfect ? POWER.calm : 1);
      tx += gauss() * POWER.scatter * wild;
      depth += gauss() * POWER.depthSpread * wild;
    }
    events.push({ type: 'timing', kind: perfect ? 'perfect' : e > 0 ? 'early' : 'late', error: e, smash, volley, power: pw });
    // a mistimed shot can fly low and clip the tape
    const risky = !smash && ((!perfect && rng() < SHOT.netRiskChance * Math.min(1, Math.abs(e) / 0.1)) || rng() < POWER.netRisk * wild);
    launch(p, tx, -p.sign * depth, kind, speed, volley, risky);
  }

  // A diving shot: weak, short and scattered, but the ball comes back.
  function diveShot(p, s) {
    const volley = ball.bounces === 0;
    const kind = s.kind === 'smash' ? 'drive' : s.kind;
    let tx, depth;
    if (s.plan) { tx = s.plan.tx; depth = Math.abs(s.plan.tz); }
    else {
      tx = input.x * SHOT.aimX;
      depth = kind === 'lob' ? SHOT.lobDepth : SHOT.depthDefault;
      const e = p.actionT - SWING.ideal;
      events.push({ type: 'timing', kind: Math.abs(e) <= SWING.perfect ? 'perfect' : e > 0 ? 'early' : 'late', error: e, dive: true });
    }
    tx += gauss() * DIVE.scatter;
    depth = Math.abs(depth) * DIVE.depth;
    const speed = (s.plan ? s.plan.speed : SHOT.driveSpeed) * DIVE.speedFactor;
    launch(p, tx, -p.sign * depth, kind, speed, volley, rng() < DIVE.netRisk);
  }

  // ------------------------------------------------------------ rules
  // serveReason: on a double fault, whether the second serve went 'out' or into the 'net'
  function finishPoint(winner, reason, serveReason = null) {
    ball.inPlay = false;
    ball.isServe = false;
    const server = match.server;
    countPoint(winner, reason, server);
    const result = awardPoint(match, winner);
    if (result.game) for (const p of players) rest(p, STAMINA.changeover);
    g.state = 'pointOver';
    g.timer = match.over ? RALLY.matchOverDelay : RALLY.pointDelay;
    afterPause = match.over ? 'matchOver' : 'serve';
    events.push({
      type: 'point', winner, reason, serveReason, server, hitter: ball.lastHitter, rallyHits: g.rallyHits,
      game: result.game, set: result.set,
    });
  }

  // the statistics of a finished point (before the score moves on); a player within
  // NET_ZONE metres of the net when it ends played it at the net
  const NET_ZONE = 6;
  function countPoint(winner, reason, server) {
    const receiver = 1 - server, hitter = ball.lastHitter;
    const P = match.points, second = match.serveNumber === 2;
    stats.points[winner]++;
    stats.longestRally = Math.max(stats.longestRally, g.rallyHits);
    if (second) { stats.secondPlayed[server]++; if (winner === server) stats.secondWon[server]++; }
    else if (reason !== 'doubleFault' && winner === server) stats.firstWon[server]++;
    // a break point: the receiver wins the game by winning this point
    if (P[receiver] >= 3 && P[receiver] > P[server]) { stats.bpChances[receiver]++; if (winner === receiver) stats.bpWon[receiver]++; }
    if (reason === 'ace') stats.aces[server]++;
    else if (reason === 'doubleFault') stats.doubleFaults[server]++;
    else if (reason === 'double') stats.winners[hitter]++;
    else if ((reason === 'out' || reason === 'net') && hitter >= 0) {
      if (players[hitter].lastShotForced) stats.forced[hitter]++; else stats.unforced[hitter]++;
    }
    for (const p of players) {
      if (Math.abs(p.z) < NET_ZONE) { stats.netPlayed[p.side]++; if (winner === p.side) stats.netWon[p.side]++; }
    }
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
      if (e.type === 'wall') { if (ball.bounces >= 1) endPoint(hitter, 'ace'); else serveFault('out'); return; }
      if (e.type === 'net') serveFault('net');
      else if (e.type === 'netCord') ball.letPending = true;
      else if (e.type === 'bounce') {
        if (e.n === 1) {
          const truth = inServiceBox(e.x, e.z, hitter, serveFromRight(match));
          if (!judge(truth, serviceMargin(e.x, e.z, hitter, serveFromRight(match)), e, true)) { serveFault('out'); closeOutCall(); }
          else if (ball.letPending) callLet();
        } else endPoint(hitter, 'ace');
      }
      return;
    }
    if (e.type === 'wall') {
      // into a fence or wall: out if it had not bounced, a winner if it bounced in first
      if (ball.bounces >= 1) endPoint(hitter, 'double');
      else endPoint(1 - hitter, 'out');
      return;
    }
    if (e.type === 'net') endPoint(1 - hitter, 'net');
    else if (e.type === 'bounce') {
      if (e.n === 1) {
        const truth = inSingles(e.x, e.z, 1 - hitter);
        if (!judge(truth, lineMargin(e.x, e.z, 1 - hitter), e, false)) { endPoint(1 - hitter, 'out'); closeOutCall(); }
      } else endPoint(hitter, 'double');
    }
  }

  // ------------------------------------------------------------ line calls and challenges
  // A close ball can be called wrong. The latest close call is kept so it can be
  // challenged: an 'out' that stopped play by the player who hit it, in the pause
  // after; a ball called good by the player it was hit to, straight away (play stops).
  let call = null;
  const challenges = [CALLS.challenges, CALLS.challenges];
  g.challenges = challenges;
  function judge(truth, lm, e, serve) {
    const near = Math.abs(lm.margin) < CALLS.close;
    let called = truth;
    if (near && rng() < CALLS.missRate * (1 - Math.abs(lm.margin) / CALLS.close)) called = !truth;
    // every call can be challenged; only close ones can be wrong
    call = {
      serve, truth, called, near, margin: lm.margin, line: lm.line, x: e.x, z: e.z, hitter: ball.lastHitter,
      at: g.time, snapshot: JSON.stringify({ match, stats }), challenger: called ? 1 - ball.lastHitter : ball.lastHitter,
      challenged: false, cpuAt: null,
    };
    if (near && call.challenger === 1 && challenges[1] > 0) {
      // the CPU challenges most wrong calls against it, and the odd correct one
      const wrong = truth !== called;
      if (rng() < (wrong ? CALLS.cpuWrong : CALLS.cpuHopeful)) call.cpuAt = g.time + (called ? 0.35 : 0.8);
    }
    return called;
  }
  // an 'out' call against the human: leave time to challenge it
  function closeOutCall() {
    if (call && call.near && !call.called && call.challenger === 0 && challenges[0] > 0) g.timer = Math.max(g.timer, CALLS.window + 0.6);
  }
  function canChallenge(side) {
    const c = call;
    if (!c || c.challenged || c.challenger !== side || challenges[side] <= 0) return false;
    if (g.time - c.at > CALLS.window + (c.called ? 0 : 0.6)) return false;
    if (c.called) return (g.state === 'rally' || g.state === 'pointOver') && (g.state !== 'rally' || ball.lastHitter === c.hitter);
    return g.state === 'pointOver';
  }
  g.canChallenge = canChallenge;
  // why a challenge is not possible now (for the message when one is attempted)
  function challengeDenied(side) {
    const c = call;
    if (challenges[side] <= 0) return 'none left';
    if (!c || c.challenged || c.challenger !== side) return 'nothing';
    return 'late';
  }
  // a close call the player may want to challenge (the button is shown for these)
  g.challengeHint = (side) => canChallenge(side) && call.near;
  function challenge(side) {
    call.challenged = true;
    g.state = 'review';
    g.timer = CALLS.reviewTime;
    ball.inPlay = false;
    for (const p of players) { endSlide(p, true); }
    events.push({ type: 'challenge', side, x: call.x, z: call.z, margin: call.margin, line: call.line, serve: call.serve, called: call.called, left: challenges[side] });
  }
  function resolveChallenge() {
    const c = call, side = c.challenger;
    const overturned = c.truth !== c.called;
    if (!overturned) challenges[side]--;
    const countChallenge = () => { stats.challenges[side]++; if (overturned) stats.challengesWon[side]++; };
    events.push({ type: 'challengeResult', side, overturned, inside: c.truth, margin: c.margin, line: c.line, left: challenges[side] });
    const restore = () => { const o = JSON.parse(c.snapshot); Object.assign(match, o.match); loadStats(stats, o.stats); };
    for (const p of players) setAction(p, 'ready');
    if (!c.called) { // an 'out' that ended the point
      g.state = 'pointOver';
      g.timer = CALLS.afterReview;
      if (overturned) { // the ball was good: replay the point
        restore();
        afterPause = 'serve';
        events.push({ type: 'replay', serve: c.serve, serveNumber: match.serveNumber });
      }
      countChallenge();
      return;
    }
    // a ball called good: if it was out, the challenger wins it; if not, loses the point
    restore();
    countChallenge();
    ball.isServe = c.serve;
    ball.lastHitter = c.hitter;
    if (overturned && c.serve) serveFault('out');
    else finishPoint(overturned ? side : 1 - side, overturned ? 'out' : 'challenge');
    g.timer = Math.max(g.timer, CALLS.afterReview);
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
    challenges[0] = challenges[1] = CALLS.challenges;
    for (const p of players) p.stamina = 1;
    resetStats(stats);
    call = null;
    setupServe();
  }

  // power from how long a shot key was held (a tap is POWER.tap)
  const powerOf = (t) => POWER.tap + (1 - POWER.tap) * Math.max(0, Math.min(1, (t - POWER.minHold) / (POWER.full - POWER.minHold)));
  g.powerOf = powerOf;

  function stepHuman(dt) {
    const human = players[0];
    const press = input.drive ? 'drive' : input.slice ? 'slice' : input.lob ? 'lob' : null;
    const serving = match.server === 0;
    // which shot keys are held (scripted input has none: every press is a tap)
    const held = input.held || null;
    const charge = human.charge;
    if (charge) charge.t += dt;

    if (g.state === 'serveReady' && serving) {
      // shuffle along the baseline on the correct side of the centre mark
      const sx = serverSideX();
      human.x += input.x * PLAYER.speed * 0.4 * dt;
      const d = Math.max(SERVE.minX, Math.min(SERVE.maxX, human.x * sx));
      human.x = d * sx;
      human.vx = human.vz = 0;
      holdBall(human);
      if (press && g.timer >= SERVE.readyDelay) {
        startToss();
        // held through the toss, the serve is charged and struck on release
        human.charge = held && held[press] ? { kind: press, t: 0, serve: true } : null;
      }
      return;
    }
    if (g.state === 'toss' && serving) {
      human.vx = human.vz = 0;
      if (charge && charge.serve && human.action === 'toss') {
        if (!held[charge.kind]) {
          human.charge = null;
          if (charge.t >= POWER.minHold) startServeSwing(charge.kind, powerOf(charge.t));
          // a quick tap just tosses; the next press hits
        }
        return;
      }
      if (press && human.action === 'toss') startServeSwing(press, POWER.tap);
      return;
    }
    if (charge && charge.serve) human.charge = null;
    if (human.action === 'serve') { serveFollow(human, dt); return; }
    if (diving(human)) { human.charge = null; diveMove(human, dt); return; }
    if (human.charge) {
      // charging a shot: it is played when the key is let go
      if (g.state !== 'rally' || human.action !== 'ready') human.charge = null;
      else if (!held || !held[charge.kind] || charge.t >= POWER.maxHold) {
        human.charge = null;
        startSwing(human, charge.kind, null, powerOf(charge.t));
      }
    } else if (g.state === 'rally' && human.action === 'ready' && press) {
      if (held && held[press]) human.charge = { kind: press, t: 0, hand: (ball.x - human.x) * human.right >= 0 ? 1 : -1 };
      else startSwing(human, press, null, POWER.tap);
    }
    if (human.charge) human.charge.hand = (ball.x - human.x) * human.right >= 0 ? 1 : -1;
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
    if (cpu.action === 'serve') { serveFollow(cpu, dt); return; }
    if (diving(cpu)) { diveMove(cpu, dt); return; }
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
    for (const p of players) {
      updateStamina(p, dt);
      if (g.state === 'rally') stats.distance[p.side] += Math.hypot(p.vx, p.vz) * dt;
    }
    if (g.state === 'review') {
      for (const p of players) drive(p, 0, 0, 0, dt);
      g.timer -= dt;
      if (g.timer <= 0) resolveChallenge();
      return;
    }
    if (input.challenge) {
      if (canChallenge(0)) { challenge(0); return; }
      events.push({ type: 'challengeDenied', side: 0, reason: challengeDenied(0) });
    }
    if (call && call.cpuAt !== null && g.time >= call.cpuAt) {
      call.cpuAt = null;
      if (canChallenge(1)) { challenge(1); return; }
    }
    if (g.state === 'serveReady' || g.state === 'toss') g.timer += dt;

    stepHuman(dt);
    stepCpu(dt);

    for (const p of players) {
      if (p.action === 'ready' || p.action === 'serveReady' || p.action === 'toss') { p.actionT += dt; continue; }
      p.actionT += dt;
      if (p.action === 'serve') {
        if (!p.swing.done && p.actionT >= SERVE_ANIM.contact) launchServe(p);
        if (p.actionT >= SERVE_ANIM.swingDuration) setAction(p, 'ready');
      } else if (p.actionT >= (diving(p) ? DIVE.duration : SWING.duration)) setAction(p, 'ready');
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

  g.surface = surfaceName;
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
  if (import.meta.env.DEV) window.__world = world; // for checking the scene from the browser console
  const hud = createHud();
  const input = createInput();
  hud.onChallenge(() => input.press('challenge'));
  const audio = createAudio();
  let game = createGame();
  const { loadProfile, saveProfile, sanitize, kitFor, cpuOpponent, randomProfile } = await import('./profile.js');

  // The player's look and name come from the customisation panel; the CPU gets an
  // invented name and a non-clashing look for each match.
  let me = loadProfile();
  let cpu = cpuOpponent(me);
  // MakeHuman bodies (see rig.js); if they cannot load, the code-built figures stand in
  const { loadBodies, getBody, loadKit, getKit } = await import('./body.js');
  let bodiesReady = false, kitReady = false;
  try { await loadBodies(); bodiesReady = true; } catch (err) { console.warn('Player bodies did not load:', err); }
  try { await loadKit(); kitReady = true; } catch (err) { console.warn('Player kit did not load:', err); }
  const look = (p, racketColor) => ({
    ...kitFor(p, racketColor),
    body: bodiesReady ? getBody(p.build) : null,
    kit: bodiesReady && kitReady ? getKit(p.build) : null,
  });
  const views = [createCharacter(look(me)), createCharacter(look(cpu, 0xb3261e))];
  world.scene.add(views[0].object3d, views[1].object3d);
  // the ball kids get the players' bodies and real clothes too, in ball-kid kit, kid-sized
  if (bodiesReady) {
    const { createBodyRig } = await import('./rig.js');
    const KID_SKIN = [0xe0ac85, 0x8d5a3b, 0xf1c9a5, 0xb98058, 0xd9a37c, 0x5e3b27];
    const KID_HAIR = [0x2a1d14, 0x5a3a22, 0x1a1512, 0x9a6a3a, 0x2a1d14, 0xd8b56e];
    world.upgradeBallKids((i) => {
      const build = i % 2 ? 'female' : 'male';
      try {
        const rig = createBodyRig(getBody(build), {
          skin: KID_SKIN[i], hair: KID_HAIR[i], hairStyle: build === 'female' ? 'long' : 'short', headwear: 'none',
          shirt: 0xe8792f, shorts: 0x1c2333, shoes: 0xf4f4f4, socks: 0xffffff, wristbands: false,
          kit: kitReady ? getKit(build) : null,
        });
        if (rig.racket) rig.racket.visible = false;
        rig.object3d.scale.setScalar(0.8);
        return rig;
      } catch (err) { console.warn('Ball kid body failed:', err); return null; }
    });
  }
  // the spectators: the same bodies, simplified, loaded in the background (blocks until then)
  if (bodiesReady) {
    Promise.all([import('./body.js'), import('./rig.js')])
      .then(([b, r]) => b.loadCrowdBodies().then((bodies) => world.setCrowdBodies(bodies, r.createBodyRig)))
      .catch((err) => console.warn('Spectator bodies did not load:', err));
  }
  function rebuildView(side, kit) {
    world.scene.remove(views[side].object3d);
    views[side].object3d.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    views[side] = createCharacter(kit);
    world.scene.add(views[side].object3d);
    window.courtRush && (window.courtRush.views = views);
  }
  const nameOf = (side) => (side === 0 ? me.name : cpu.name);
  const shortName = (side) => nameOf(side).split(' ').pop();
  hud.setProfile(me);
  hud.setNames(me.name, cpu.name);
  function changeMe(p) {
    me = sanitize(p);
    saveProfile(me);
    rebuildView(0, look(me));
    hud.setNames(me.name, cpu.name);
  }
  hud.onCustomChange(changeMe);
  hud.onRandomise(() => { const p = { ...randomProfile(), name: me.name }; hud.setProfile(p); changeMe(p); });
  hud.onCustomOpen((open) => world.setShowroom(open));
  let matchTime = 0;
  let clockRunning = false;

  const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const statsData = () => ({
    names: [shortName(0), shortName(1)], rows: statRows(game.stats),
    longestRally: game.stats.longestRally, time: clock(matchTime),
  });
  const showScore = () => {
    const m = game.match;
    hud.setScore({ games: m.games, points: pointLabels(m), server: m.server });
  };
  showScore();

  // court surface: previewed in the menu, remembered on this device
  function applySurface(name) {
    world.setSurface(name);
    audio.setSurface(name);
    try { localStorage.setItem('courtRush.surface', name); } catch { /* storage blocked */ }
  }
  hud.onSurface(applySurface);
  // venue: the stadium or the country club, also remembered
  function applyVenue(name) {
    world.setVenue(name);
    audio.setVenue(name);
    try { localStorage.setItem('courtRush.venue', name); } catch { /* storage blocked */ }
  }
  hud.onVenue(applyVenue);
  let savedVenue = null;
  try { savedVenue = localStorage.getItem('courtRush.venue'); } catch { /* storage blocked */ }
  hud.setVenue(savedVenue === 'club' ? 'club' : 'stadium');
  // the rally on the next court at the club, heard faintly
  world.onAmbientHit((x, z) => audio.distantHit(x, z));
  let savedSurface = null;
  try { savedSurface = localStorage.getItem('courtRush.surface'); } catch { /* storage blocked */ }
  hud.setSurface(SURFACES[savedSurface] ? savedSurface : DEFAULT_SURFACE);

  // ---- tournaments: the draw is kept on this device, so it can be resumed
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
  };
  let tour = store.get('courtRush.tournament');
  if (tour && !Array.isArray(tour.rounds)) tour = null;
  let matchMode = 'exhibition';
  const saveTour = () => store.set('courtRush.tournament', tour);
  const hashName = (t) => { let h = 2166136261; for (const c of t) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const seeded = (seed) => { let x = seed || 1; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; };
  const live = () => tour && tour.status === 'playing';
  // the menu for the chosen mode: the draw, the next match on the button, the court behind
  function refreshMenu() {
    const c = hud.choices();
    store.set('courtRush.choices', { mode: c.mode, eventId: c.eventId, length: c.length });
    if (c.mode === 'career') {
      hud.showBracket(null);
      const s = career.summary();
      const up = career.upcoming();
      hud.setTournamentState({ active: false, label: !s ? 'Start a career' : up ? `Career: play ${up.round.toLowerCase()} v ${up.opponent.name}` : 'Open career' });
      hud.setFoot(s ? `${s.retired ? 'Retired' : `Age ${s.age}`} · ${s.stage === 'junior' ? 'Junior' : 'World'} ${s.rank ? `#${s.rank}` : 'unranked'} · season ${s.season}, week ${Math.min(s.week, 12)}` : 'From junior to pro');
      hud.setTitle('CAREER', s ? (s.stage === 'junior' ? 'JUNIORS' : 'PRO TOUR') : 'NEW');
      world.setTourName(up ? up.event.name : 'COURT RUSH CAREER');
      // preview the next court
      showCourt(up ? up.surface : 'clay', up ? up.venue : 'club');
      return;
    }
    hud.setFoot(`First to ${c.length} games, win by 2`);
    showCourt(null, c.venue);
    if (c.mode !== 'tournament') {
      hud.showBracket(null);
      hud.setTournamentState({ active: false, label: 'Play' });
      applySurface(c.surface);
      hud.setTitle(NAMES.tour, 'EXHIBITION');
      world.setTourName(NAMES.tour);
      return;
    }
    const shown = tour && (live() || tour.eventId === c.eventId) ? tour : null;
    const event = EVENTS.find((e) => e.id === (shown ? shown.eventId : c.eventId));
    applySurface(event.surface);
    world.setTourName(event.name);
    if (shown) {
      hud.showBracket(bracket(shown), shown.name);
      const opp = nextOpponent(shown);
      hud.setTournamentState({ active: live(), label: live() ? `Play ${roundName(shown).toLowerCase()} v ${opp.name}` : 'New tournament' });
      hud.setTitle(shown.name, live() ? roundName(shown) : shown.status === 'won' ? 'CHAMPION' : 'DRAW');
    } else {
      hud.showBracket(null);
      hud.setTournamentState({ active: false, label: 'Start tournament' });
      hud.setTitle(event.name, 'QUARTER-FINAL');
    }
  }
  // a court and venue for one match or preview, without changing the saved choices
  function showCourt(surface, venue) {
    if (surface) { world.setSurface(surface); audio.setSurface(surface); }
    if (venue) { world.setVenue(venue); audio.setVenue(venue); }
  }
  // ---- career mode: the hub lives in careerui.js; matches are played here
  const career = createCareerUI(document, {
    getProfile: () => me,
    onClose: () => { hud.showMenu(); refreshMenu(); },
    onPlayMatch: (m) => startMatch({
      mode: 'career', level: m.level, surface: m.surface, venue: m.venue, gamesToWin: m.gamesToWin,
      cpu: { ...cpuOpponent(me, seeded(hashName(m.opponent.name))), build: me.build, name: m.opponent.name },
      title: m.event.name, round: m.round,
    }),
  });
  hud.onMode(refreshMenu);
  hud.onAbandon(() => { tour = null; saveTour(); refreshMenu(); });
  hud.setChoices(store.get('courtRush.choices') || {});
  refreshMenu();

  hud.onPlay((c) => {
    audio.unlock();
    if (c.mode === 'career') { hud.hideMenu(); career.open(); return; }
    let difficulty = c.level, surface = c.surface, gamesToWin = c.length;
    let title = NAMES.tour, round = 'EXHIBITION', cpuNext;
    if (c.mode === 'tournament') {
      if (!live()) {
        tour = createTournament({ eventId: c.eventId, difficulty: c.level, gamesToWin: c.length, playerName: me.name, seed: Date.now() });
        saveTour();
      }
      const opp = nextOpponent(tour);
      difficulty = levelFor(tour);
      surface = tour.surface;
      gamesToWin = tour.gamesToWin;
      cpuNext = { ...cpuOpponent(me, seeded(hashName(opp.name))), name: opp.name }; // each entrant keeps their look
      title = tour.name;
      round = roundName(tour);
    } else {
      cpuNext = cpuOpponent(me); // a new opponent each match
    }
    applySurface(surface);
    startMatch({ mode: c.mode, difficulty, surface, gamesToWin, cpu: cpuNext, title, round });
  });
  // the round of the match in play (tournament or career), for the commentary
  let currentRound = null;
  function startMatch({ mode, difficulty, level, surface, venue, gamesToWin, cpu: next, title, round }) {
    audio.unlock();
    matchMode = mode;
    currentRound = mode === 'exhibition' ? null : round;
    cpu = next;
    hud.setTitle(title, round);
    world.setTourName(title);
    showCourt(surface, venue);
    game = createGame({ difficulty, level, surface, gamesToWin, venue: venue || world.venue });
    world.clearDeadBalls();
    wasLive = false;
    rebuildView(1, look(cpu, 0xb3261e));
    hud.setNames(me.name, cpu.name);
    game.start();
    hud.setChallenges(game.challenges);
    hud.hideReview();
    matchTime = 0;
    clockRunning = true;
    world.setSpeed(0);
    input.clear();
    hud.hideMenu();
    window.courtRush.game = game;
  }

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
    hud.showPause(`${me.name} ${m.games[0]} : ${m.games[1]} ${cpu.name}   (${labels[0]} : ${labels[1]})`, statsData());
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
    if (matchMode === 'career' && game.state !== 'matchOver') career.recordResult(false, null, true);
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
    refreshMenu();
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
  // commentary on or off: V, or the pause screen; remembered on this device
  let commentaryOn = true;
  try { commentaryOn = localStorage.getItem('courtRush.commentary') !== '0'; } catch { /* storage blocked */ }
  function setCommentary(on) {
    commentaryOn = on;
    audio.setCommentary(on);
    hud.setCommentary(on);
    try { localStorage.setItem('courtRush.commentary', on ? '1' : '0'); } catch { /* storage blocked */ }
  }
  setCommentary(commentaryOn);
  hud.onCommentary(() => setCommentary(!commentaryOn));
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return; // typing a name
    if (e.code === 'KeyM') { setMuted(!muted); return; }
    if (e.code === 'KeyV') { setCommentary(!commentaryOn); hud.showCall(commentaryOn ? 'COMMENTARY ON' : 'COMMENTARY OFF'); return; }
    if (e.code !== 'KeyP' && e.code !== 'Escape') return;
    e.preventDefault();
    if (paused) resume(); else pause();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);

  // The crowd: applause sized to the point. Clean winners and long rallies get more;
  // your own errors get only a little, and only after a long rally.
  // the stands react with the sound: clapping, and on their feet for the big ones
  function react(kind, i = 0.5) {
    audio.react(kind, i);
    world.cheer(kind === 'ovation' ? 1 : kind === 'roar' ? 0.65 + 0.35 * i : Math.min(0.6, i * 0.75));
  }
  function crowdReact(e) {
    const rally = Math.min(1, e.rallyHits / 12);
    const clean = e.reason === 'ace' || e.reason === 'double';
    const game = e.game ? 0.15 : 0;
    if (e.winner === 0) {
      if (clean && (rally > 0.5 || e.game)) react('roar', 0.5 + 0.5 * rally);
      else react('applause', (clean ? 0.45 : 0.3) + 0.45 * rally + game);
    } else if (clean) {
      react('applause', 0.25 + 0.5 * rally + game);
    } else if (rally > 0.4 || game) {
      react('applause', 0.15 + 0.35 * rally + game);
    }
  }

  // Players grunt now and then: often on serves, smashes and big forehands, rarely on touch shots.
  function maybeGrunt(e) {
    const C = AUDIO.gruntChance;
    let chance;
    if (e.kind === 'serve' || e.kind === 'smash') chance = C[e.kind];
    else if (e.volley) chance = C.volley;
    else if (e.kind === 'slice' || e.kind === 'lob') chance = C[e.kind];
    else chance = e.kmh >= 100 ? C.power : C.hit;
    if (Math.random() >= chance) return;
    const p = game.players[e.side];
    audio.play('effort', { side: e.side, power: e.kmh / 140, x: p.x, z: p.z });
  }

  // ---- commentary: a two-person booth. The play-by-play voice calls the moment and
  // the analyst follows up; they talk between points and fall silent when play
  // resumes. Each moment has a chance, so it does not talk on every point.
  const say = (cat, chance = 1, delay = 1.0) => (Math.random() < chance ? audio.commentate(cat, { delay }) : false);
  const talk = (cat, chance = 1, delay = 1.0) => (Math.random() < chance ? (audio.converse(cat, { delay }) || audio.commentate(cat, { delay })) : false);
  const lastHit = [null, null];
  let lastBounce = null, saidTired = [-1, -1], bpOpen = false, streak = { side: -1, n: 0 }, fillerSaid = false, openPending = false;
  const gamesPlayed = () => game.match.games[0] + game.match.games[1];
  function openMatch() {
    const round = ['QUARTER-FINAL', 'SEMI-FINAL', 'FINAL'].includes(currentRound) ? currentRound : null;
    const surface = game.surface;
    audio.sequence([round ? `intro.${round}` : 'intro.generic', Math.random() < 0.6 ? `preview.${surface}` : 'preview.generic', 'start'], { delay: 1.0, force: true });
  }
  // before each point: match point, break point, deuce, a tired player
  function previewPoint() {
    const m = game.match, s = m.server, r = 1 - s, P = m.points, G = m.games, toWin = m.gamesToWin;
    const winsGame = (a) => P[a] >= 3 && P[a] > P[1 - a];
    const winsMatch = (a) => winsGame(a) && G[a] + 1 >= toWin && G[a] + 1 - G[1 - a] >= 2;
    bpOpen = winsGame(r);
    fillerSaid = false;
    if (winsMatch(0) || winsMatch(1)) {
      const final = currentRound === 'FINAL';
      if (talk(final ? 'championshipPoint' : 'matchPoint', 0.9, 0.4)) return;
    } else if (bpOpen) { if (talk('breakPoint', 0.6, 0.4)) return; }
    else if (P[0] >= 3 && P[0] === P[1]) { if (talk('deuce', 0.35, 0.4)) return; }
    for (const side of [0, 1]) {
      if (game.players[side].stamina < 0.3 && saidTired[side] !== gamesPlayed()) {
        saidTired[side] = gamesPlayed();
        if (talk('tired', 0.5, 0.4)) return;
      }
    }
  }
  // a game just finished: the break, a run of games, or the score
  function commentGame(e) {
    streak = streak.side === e.winner ? { side: e.winner, n: streak.n + 1 } : { side: e.winner, n: 1 };
    if (e.winner !== e.server && talk('break', 0.85)) return true;
    if (streak.n === 3 && talk('momentum', 0.8)) return true;
    if (Math.random() < 0.45) {
      const [a, b] = game.match.games, hi = Math.max(a, b), lo = Math.min(a, b);
      const names = hi === lo ? [`score.all.${hi}`, 'react.level'] : [`score.${hi}-${lo}`, hi - lo >= 3 ? 'react.big' : 'react.close'];
      return audio.sequence(names, { delay: 1.1 });
    }
    return false;
  }
  function commentPoint(e) {
    if (e.set) return; // the match is over: matchOver has the last word
    if (e.game && commentGame(e)) return;
    if (bpOpen && e.winner === e.server && !e.game && talk('breakSaved', 0.7)) return;
    const long = e.rallyHits >= 12;
    const hit = e.hitter >= 0 ? lastHit[e.hitter] : null;
    switch (e.reason) {
      case 'ace': talk('ace', 0.6, 0.6); break;
      case 'doubleFault': talk('doubleFault', 0.6); break;
      case 'double':
        if (long) talk('longRally', 0.85);
        else if (hit && hit.kind === 'smash') talk('smashWinner', 0.6);
        else if (hit && hit.volley) talk('volleyWinner', 0.5);
        else talk('winner', 0.4);
        break;
      case 'out': case 'net': {
        if (long) { talk('longRally', 0.8); break; }
        let cat = 'netError';
        if (e.reason === 'out' && lastBounce) cat = lineMargin(lastBounce.x, lastBounce.z, 1 - e.hitter).line === 'base' ? 'longError' : 'wideError';
        if (!talk(cat, 0.3)) talk('unforced', 0.1);
        break;
      }
      default:
    }
  }
  // a quiet spell while a server waits: a little chat
  function idleChat() {
    if (openPending && audio.commentaryReady) {
      openPending = false;
      // only at the very start; a match already under way just carries on
      if (gamesPlayed() === 0 && game.match.points[0] + game.match.points[1] === 0) { openMatch(); fillerSaid = true; }
      return;
    }
    if (fillerSaid || audio.commentaryBusy || game.state !== 'serveReady' || game.timer < 3.5) return;
    fillerSaid = true;
    if (Math.random() < 0.6) talk(Math.random() < 0.35 ? `filler.${game.surface}` : 'filler', 1, 0.2);
  }

  const REASON = { out: 'OUT', net: 'NET', double: 'WINNER', ace: 'ACE', doubleFault: 'DOUBLE FAULT', challenge: 'CALL STANDS' };

  function handleEvents() {
    for (const e of game.events) {
      switch (e.type) {
        case 'hit':
          lastHit[e.side] = e;
          if (e.kind === 'serve') audio.hush(); // play is on: finish the sentence, then quiet
          if (e.kind === 'serve' && e.kmh >= 185) say('bigServe', 0.3, 0.5);
          world.setSpeed(e.kmh);
          audio.play('strike', {
            kind: e.volley ? 'volley' : e.kind === 'drive' || e.kind === 'lob' ? 'hit' : e.kind,
            power: e.kmh / 140, x: game.players[e.side].x, z: game.players[e.side].z,
          });
          maybeGrunt(e);
          break;
        case 'timing':
          hud.showTiming(e.kind, e.smash ? 'SMASH' : e.volley ? 'VOLLEY' : '');
          break;
        case 'split':
          views[e.side].splitStep();
          break;
        case 'plant':
          audio.play('plant', { speed: e.speed, x: e.x, z: e.z });
          break;
        case 'slide':
          audio.play('slide', { speed: e.speed, x: e.x, z: e.z });
          break;
        case 'slideEnd':
          world.addSlideTrail(e.x0, e.z0, e.x1, e.z1);
          break;
        case 'dive':
          audio.play('effort', { side: e.side, power: 1.1, x: e.x, z: e.z });
          say('dive', 0.7, 0.25);
          break;
        case 'diveLand':
          audio.play('slide', { speed: e.speed + 2, x: e.x, z: e.z });
          break;
        case 'wall':
          audio.play('wall', { speed: e.v, kind: e.kind, x: e.x, z: e.z });
          break;
        case 'bounce':
          if (e.n === 1) lastBounce = e;
          world.addBounceMark(e.x, e.z);
          audio.play('bounce', { speed: e.v, x: e.x, z: e.z });
          break;
        case 'net':
          audio.play(e.cord ? 'cord' : 'net', { x: e.x, z: 0 });
          break;
        case 'challenge':
          talk('challenge', 0.7, 0.4);
          hud.showMessage('CHALLENGE', shortName(e.side), 1.4);
          hud.showReview({ margin: e.margin, line: e.line, surfaceColor: SURFACES[game.surface].court });
          react('applause', 0.15);
          break;
        case 'challengeDenied':
          hud.showCall(e.reason === 'none left' ? 'NO CHALLENGES LEFT' : e.reason === 'late' ? 'TOO LATE TO CHALLENGE' : 'NO CALL TO CHALLENGE');
          break;
        case 'challengeResult':
          hud.reviewVerdict(e.inside, e.margin);
          hud.setChallenges(game.challenges);
          hud.showMessage(e.overturned ? 'CALL OVERTURNED' : 'CALL STANDS', e.inside ? 'BALL IN' : 'BALL OUT', 1.8);
          if (e.overturned) { audio.call('Correction!'); react('applause', 0.45); }
          talk(e.overturned ? 'overturned' : 'stands', 0.7, 1.2);
          break;
        case 'replay':
          showScore();
          hud.showMessage('REPLAY THE POINT', e.serveNumber === 2 ? 'SECOND SERVE' : 'FIRST SERVE', 1.6);
          break;
        case 'netCord':
          audio.play('cord', { x: e.x, z: 0 });
          hud.showCall('NET CORD');
          say('netCord', 0.6, 0.35);
          break;
        case 'let':
          audio.call('Let!');
          hud.showMessage('LET', e.serveNumber === 1 ? 'FIRST SERVE' : 'SECOND SERVE', 1.2);
          break;
        case 'matchStart':
          saidTired = [-1, -1]; streak = { side: -1, n: 0 };
          openPending = true; // the opening, as soon as the voices are ready
          break;
        case 'serveReady':
          showScore();
          // a ball kid feeds the server a ball for each new point
          if (e.serveNumber === 1) { const sv = game.players[e.server]; world.feedServer(sv.x, sv.z); }
          if (e.serveNumber === 1) previewPoint();
          break;
        case 'fault':
          hud.showMessage('FAULT', 'SECOND SERVE', 1.2);
          if (e.reason === 'out') audio.call('Fault!');
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
          if (e.reason === 'out') audio.call('Out!');
          else if (e.reason === 'doubleFault' && e.serveReason === 'out') audio.call('Fault!');
          if (!e.set) crowdReact(e);
          commentPoint(e);
          break;
        }
        case 'matchOver': {
          clockRunning = false;
          audio.converse('matchWon', { delay: 0.8, force: true }) || audio.commentate('matchWon', { delay: 0.8, force: true });
          const won = e.winner === 0;
          hud.hideMessage();
          const score = `${me.name} ${e.games[0]} : ${e.games[1]} ${cpu.name}`;
          if (matchMode === 'career') {
            const r = career.recordResult(won, e.games);
            hud.showMenu({
              headline: r && r.champion ? 'CHAMPION!' : won ? 'YOU WIN' : 'YOU LOSE',
              detail: r ? `${score} | ${r.champion ? `${r.event.name} winner` : won ? `into the ${(r.next || 'next round').toLowerCase()}` : `out in the ${r.round.toLowerCase()}`}` : score,
              button: 'Continue career',
              stats: statsData(),
            });
            refreshMenu();
            hud.setTournamentState({ active: false, label: 'Continue career' });
          } else if (matchMode === 'tournament' && live()) {
            const round = roundName(tour);
            recordResult(tour, won, e.games);
            saveTour();
            const champion = tour.status === 'won';
            hud.showMenu({
              headline: champion ? 'CHAMPION!' : won ? 'YOU WIN' : 'YOU LOSE',
              detail: champion ? `${tour.name} winner | ${score}` : won ? `${score} | into the ${roundName(tour).toLowerCase()}` : `${score} | out in the ${round.toLowerCase()}`,
              button: 'Play again',
              stats: statsData(),
            });
            refreshMenu();
          } else {
            hud.showMenu({
              headline: won ? 'YOU WIN' : 'YOU LOSE',
              detail: score,
              button: 'Play again',
              stats: statsData(),
            });
          }
          if (won) react('ovation');
          else react('applause', 1);
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

  const frameInput = { x: 0, y: 0, drive: false, slice: false, lob: false, challenge: false, held: null };
  let last = performance.now();
  let acc = 0;
  let dustClock = 0;
  let shownChallenge = false;
  let shownStamina = [-1, -1];
  let shownPower = null;
  // render interpolation: positions one physics step back, blended toward the latest
  const prevP = [{ x: 0, z: 0 }, { x: 0, z: 0 }], drawP = [{}, {}];
  const prevBall = { x: 0, y: 0, z: 0 }, drawBall = {};
  function snapshot() {
    game.players.forEach((p, i) => { prevP[i].x = p.x; prevP[i].z = p.z; });
    prevBall.x = game.ball.x; prevBall.y = game.ball.y; prevBall.z = game.ball.z;
  }
  function between(cur, prev, a, out) {
    Object.assign(out, cur);
    const dx = cur.x - prev.x, dz = cur.z - prev.z, dy = (cur.y ?? 0) - (prev.y ?? 0);
    if (dx * dx + dy * dy + dz * dz > 1) return out; // a jump (new serve, new point): no smearing
    out.x = prev.x + dx * a;
    out.z = prev.z + dz * a;
    if (cur.y !== undefined) out.y = prev.y + dy * a;
    return out;
  }

  // ---- landing marker: where the CPU's shot will bounce, worked out once per shot by
  // running the same physics ahead (net cords included), shown on the player's side
  let markerOn = true;
  try { markerOn = localStorage.getItem('courtRush.marker') !== '0'; } catch { /* storage blocked */ }
  function setMarker(on) {
    markerOn = on;
    hud.setMarker(on);
    try { localStorage.setItem('courtRush.marker', on ? '1' : '0'); } catch { /* storage blocked */ }
  }
  setMarker(markerOn);
  hud.onMarker(() => setMarker(!markerOn));
  const ghost = createBall(), ghostEvents = [];
  let simClock = 0, markerHit = -1, markerAt = null;
  function predictBounce(b) {
    copyBall(ghost, b);
    for (let t = 0; t < 4; t += BALL.fixedDt) {
      ghostEvents.length = 0;
      stepBall(ghost, BALL.fixedDt, ghostEvents);
      if (ghostEvents.some((e) => e.type === 'wall')) return null; // dead before it bounces
      const bounce = ghostEvents.find((e) => e.type === 'bounce');
      if (bounce) return { x: bounce.x, z: bounce.z, at: simClock + t + BALL.fixedDt };
    }
    return null;
  }
  function updateMarker(dt) {
    const b = game.ball;
    const live = markerOn && b.inPlay && b.visible && b.lastHitter === 1 && b.bounces === 0;
    if (live && markerHit !== b.hitId) { markerHit = b.hitId; markerAt = predictBounce(b); }
    const show = live && markerAt && markerAt.z > 0; // only balls coming to your side
    world.setLandingMarker(show ? { x: markerAt.x, z: markerAt.z, remaining: markerAt.at - simClock } : null, dt);
  }

  let wasLive = false;
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
    if (acc >= BALL.fixedDt) snapshot();
    while (acc >= BALL.fixedDt) {
      if (!first) snapshot();
      // button presses are edges: only the first step of a frame sees them
      frameInput.drive = first && input.consume('drive');
      frameInput.slice = first && input.consume('slice');
      frameInput.lob = first && input.consume('lob');
      frameInput.challenge = first && input.consume('challenge');
      frameInput.held = input.held();
      game.step(BALL.fixedDt, frameInput);
      simClock += BALL.fixedDt;
      first = false;
      acc -= BALL.fixedDt;
    }
    handleEvents();
    if (clockRunning) matchTime += dt;
    // draw between the last two physics steps, so motion is smooth at any frame rate
    const alpha = acc / BALL.fixedDt;
    views[0].update(dt, between(game.players[0], prevP[0], alpha, drawP[0]));
    views[1].update(dt, between(game.players[1], prevP[1], alpha, drawP[1]));
    // when a point (or a fault) ends, that ball becomes a dead ball for the ball kids
    // to fetch; the next serve uses a fresh one
    const live = game.state === 'serveReady' || game.state === 'toss' || game.state === 'rally';
    if (wasLive && !live && game.ball.visible && game.state !== 'menu') world.spawnDeadBall(game.ball);
    wasLive = live;
    between(game.ball, prevBall, alpha, drawBall);
    if (!live) drawBall.visible = false;
    world.updateBall(drawBall, dt);
    updateMarker(dt);
    // clay dust kicked up ahead of a sliding foot
    dustClock += dt;
    for (const p of game.players) {
      if (!p.slide && !(p.swing && p.swing.dive && p.swing.landed)) continue;
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
    idleChat(); // the opening, and a little chat while a server waits
    const ch = game.players[0].charge;
    const pw = ch ? game.powerOf(ch.t) : null;
    if (pw !== shownPower) { shownPower = pw; hud.setPower(pw); }
    const sa = game.players[0].stamina, sb = game.players[1].stamina;
    if (Math.abs(sa - shownStamina[0]) > 0.005 || Math.abs(sb - shownStamina[1]) > 0.005) { shownStamina = [sa, sb]; hud.setStamina(sa, sb); }
    const canCh = game.challengeHint(0);
    if (canCh !== shownChallenge) { shownChallenge = canCh; hud.setChallengeAvailable(canCh, game.challenges[0]); }
    audio.update(dt);
    world.setClock(matchTime);
    world.updateCamera(dt, game.players[0].x, game.players[0].z);
    renderer.render(world.scene, world.camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.courtRush = { world, hud, renderer, game, audio, views };
}

if (typeof document !== 'undefined') boot();
