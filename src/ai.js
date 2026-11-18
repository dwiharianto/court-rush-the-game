// CPU opponent (side 1, far half). It predicts the incoming ball by simulating
// the real ball physics, runs to the interception point, leaves balls that are
// going out, and picks a target mostly away from the player with some error.
// Its weaknesses are all difficulty settings: reaction time, movement and
// recovery speed, reach, and errors that grow when it is stretched.
import { AI, BALL, CONTACT, COURT, SMASH, SWING, VOLLEY } from './config.js';
import { createBall, copyBall, stepBall, predictAtPlane } from './ball.js';

const sim = createBall();
const simEvents = [];
const plane = {};
let lastBounceZ = 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createAI(level, rng = Math.random) {
  let seenHit = -1;
  let reactAt = 0;
  let plan = null; // { leave, smash, volley, approach, x, y, z, standX, standZ, run, pace }
  let atNet = false; // followed an attacking shot in; recovers to the net, volleys
  const out = { x: 0, z: -AI.recoverZ, speed: 1, swing: null };
  const gauss = () => (rng() + rng() + rng() - 1.5) * 2; // roughly unit variance

  // Simulate the ball forward to find where the CPU should meet it.
  function predict(ball, validBounce, cpu) {
    copyBall(sim, ball);
    sim.isServe = ball.isServe;
    const dt = BALL.fixedDt;
    let bounced = ball.bounces > 0;
    let found = null;
    let apex = sim.y;
    let overhead = null; // a lob the CPU can take out of the air
    let bounceZ = -COURT.halfLength;
    lastBounceZ = bounceZ;
    let volley = null; // at the net: a ball it can take out of the air at hitting height
    const canVolley = atNet && !ball.isServe;
    for (let t = 0; t < 6; t += dt) {
      const prevVy = sim.vy, prevY = sim.y;
      simEvents.length = 0;
      stepBall(sim, dt, simEvents);
      apex = Math.max(apex, sim.y);
      if (!bounced && !overhead && !ball.isServe && apex >= SMASH.cpuLobApex && sim.vy < 0 && prevY > SMASH.cpuHeight
        && sim.y <= SMASH.cpuHeight && sim.z < -AI.minZ && sim.z > -AI.maxZ) {
        const run = Math.hypot(sim.x + AI.sideOffset - cpu.x, sim.z - CONTACT.front - cpu.z);
        if (run / level.speed + SMASH.cpuTimeMargin + level.reaction <= t) {
          overhead = { leave: false, smash: true, x: sim.x, y: sim.y, z: sim.z };
        }
      }
      // at the net: the first point of the flight it can reach in time, at volley height
      if (canVolley && !bounced && !volley && !overhead && sim.z < -AI.volleyNetGap && sim.z > -VOLLEY.zoneZ
        && sim.y >= AI.volleyMinY && sim.y <= AI.volleyMaxY) {
        const reach = Math.max(0, Math.abs(sim.x - cpu.x) - AI.sideOffset);
        const run = Math.hypot(reach, sim.z - CONTACT.front - cpu.z);
        if (run / level.speed + AI.volleyTimeMargin <= t) volley = { leave: false, volley: true, x: sim.x, y: sim.y, z: sim.z };
      }
      for (const e of simEvents) {
        if (e.type === 'net') return { leave: true };
        if (e.type === 'bounce') {
          if (!bounced) {
            bounced = true;
            if (!validBounce(e.x, e.z, AI.leaveMargin)) return { leave: true };
            bounceZ = e.z;
            lastBounceZ = bounceZ;
            if (overhead) return overhead;
            if (volley) return volley;
          } else {
            return found || { leave: false, x: sim.x, y: 0.4, z: Math.max(sim.z, -AI.maxZ) };
          }
        }
      }
      if (!bounced) continue;
      if (sim.z < -AI.maxZ + CONTACT.front) return { leave: false, x: sim.x, y: sim.y, z: sim.z };
      // the apex after the bounce is the fallback; prefer the descent to hitting height
      if (prevVy > 0 && sim.vy <= 0) {
        found = { leave: false, x: sim.x, y: sim.y, z: sim.z };
        if (sim.y <= AI.hitHeight) return found;
      }
      if (sim.vy < 0 && sim.y <= AI.hitHeight) return { leave: false, x: sim.x, y: sim.y, z: sim.z };
    }
    return found || volley || { leave: true };
  }

  // 0 when the CPU is set and comfortable, 1 when fully stretched: it ran far,
  // is still moving at contact, or the incoming ball is fast.
  function stretchNow(cpu) {
    const moving = Math.hypot(cpu.vx, cpu.vz) / level.speed;
    const ran = Math.min(1, plan.run / AI.stretchRun);
    return clamp(0.25 * moving + 0.4 * ran + 0.5 * plan.pace, 0, 1); // momentum means it is often still moving: that alone counts less
  }

  function chooseShot(g, stretch) {
    const human = g.players[0];
    let tx;
    if (rng() < level.awayChance) tx = (human.x > 0 ? -1 : 1) * AI.aimX;
    else tx = (rng() * 2 - 1) * AI.aimX;
    let tz = AI.depthMin + rng() * (AI.depthMax - AI.depthMin);
    const spread = level.errorSize * (1 + level.pressure * stretch);
    tx += gauss() * spread;
    tz += gauss() * spread * 0.9;
    const fatigue = Math.max(0, g.rallyHits - AI.fatigueStart) * AI.fatigueRate; // long rallies wear it down
    if (rng() < level.errorRate + level.pressureMiss * stretch + fatigue) {
      // a clear miss: long, or wide past a sideline
      if (rng() < 0.5) tz = COURT.halfLength + AI.longMiss * (0.5 + rng());
      else tx = (tx >= 0 ? 1 : -1) * (COURT.singlesHalf + AI.wideMiss * (0.5 + rng()));
    }
    let kind = 'drive';
    if (human.z < AI.lobNetZ && rng() < AI.lobChance) kind = 'lob';
    else if (rng() < AI.sliceChance) kind = 'slice';
    return { kind, tx, tz, speed: level.shotSpeed, stretch };
  }

  // Called every game step. Returns where to run, how fast (fraction of top
  // speed), and whether to start a swing.
  // validBounce(x, z, margin) says whether the ball's first bounce would be good.
  function think(g, validBounce) {
    const cpu = g.players[1], ball = g.ball;
    out.swing = null;
    out.x = 0;
    out.z = -AI.recoverZ;
    out.speed = level.recover;
    if (g.state !== 'rally' || !ball.inPlay) { atNet = false; plan = null; return out; }
    if (atNet) { out.z = -AI.netZ; out.x = clamp(ball.x * 0.35, -2, 2); }
    if (ball.lastHitter !== 0) {
      // the CPU just hit: follow an approach shot in to the net
      if (plan && plan.approach) { atNet = true; plan.approach = false; out.z = -AI.netZ; out.speed = 1; }
      return out;
    }

    if (ball.hitId !== seenHit) {
      seenHit = ball.hitId;
      reactAt = g.time + level.reaction;
      plan = null;
    }
    if (g.time < reactAt) return out; // has not read the shot yet, keeps recovering
    if (!plan) {
      plan = predict(ball, validBounce, cpu);
      plan.bounceZ = lastBounceZ;
      if (!plan.leave) {
        // set up beside the ball: forehand is on the CPU's -x side
        const fx = plan.x + AI.sideOffset, bx = plan.x - AI.sideOffset;
        plan.standX = plan.smash || Math.abs(fx - cpu.x) - AI.forehandBias <= Math.abs(bx - cpu.x) ? fx : bx;
        plan.standZ = plan.z - CONTACT.front;
        plan.run = Math.hypot(plan.standX - cpu.x, plan.standZ - cpu.z);
        const pace = Math.hypot(ball.vx, ball.vz);
        plan.pace = clamp((pace - AI.stretchPaceMin) / (AI.stretchPaceMax - AI.stretchPaceMin), 0, 1);
        // a short ball it can attack: sometimes it follows the shot to the net
        // a short ball invites an approach; it sometimes comes in behind a deep one too
        const short = -plan.bounceZ <= AI.approachZ;
        plan.approach = !atNet && !plan.smash && rng() < level.netRush * (short ? 1 : AI.deepRushFactor);
      }
    }
    if (plan.leave) { out.x = cpu.x; out.z = cpu.z; return out; }
    out.speed = 1;
    out.x = clamp(plan.standX, -AI.maxX, AI.maxX);
    out.z = clamp(plan.standZ, -AI.maxZ, -AI.minZ);

    if (cpu.action === 'ready') {
      const pr = predictAtPlane(ball, cpu.z + CONTACT.front, -1, SWING.ideal + 0.02, plane);
      const high = pr && pr.y >= SMASH.minHeight;
      if (pr && pr.t <= SWING.ideal && Math.abs(pr.x - cpu.x) <= level.reach && pr.y <= (high ? SMASH.reachY : CONTACT.reachY)) {
        out.swing = chooseShot(g, stretchNow(cpu));
        if (high) out.swing.kind = 'smash';
      }
    }
    return out;
  }

  return { think, level };
}
