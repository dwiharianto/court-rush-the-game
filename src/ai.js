// CPU opponent (side 1, far half). It predicts the incoming ball by simulating
// the real ball physics, runs to the interception point, leaves balls that are
// going out, and picks a target mostly away from the player with some error.
// Its weaknesses are all difficulty settings: reaction time, movement and
// recovery speed, reach, and errors that grow when it is stretched.
import { AI, BALL, CONTACT, COURT, SMASH, SWING } from './config.js';
import { createBall, copyBall, stepBall, predictAtPlane } from './ball.js';

const sim = createBall();
const simEvents = [];
const plane = {};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createAI(level, rng = Math.random) {
  let seenHit = -1;
  let reactAt = 0;
  let plan = null; // { leave, smash, x, y, z, standX, standZ, run, pace }
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
      for (const e of simEvents) {
        if (e.type === 'net') return { leave: true };
        if (e.type === 'bounce') {
          if (!bounced) {
            bounced = true;
            if (!validBounce(e.x, e.z, AI.leaveMargin)) return { leave: true };
            if (overhead) return overhead;
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
    return found || { leave: true };
  }

  // 0 when the CPU is set and comfortable, 1 when fully stretched: it ran far,
  // is still moving at contact, or the incoming ball is fast.
  function stretchNow(cpu) {
    const moving = Math.hypot(cpu.vx, cpu.vz) / level.speed;
    const ran = Math.min(1, plan.run / AI.stretchRun);
    return clamp(0.45 * moving + 0.4 * ran + 0.5 * plan.pace, 0, 1);
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
    if (g.state !== 'rally' || !ball.inPlay || ball.lastHitter !== 0) return out;

    if (ball.hitId !== seenHit) {
      seenHit = ball.hitId;
      reactAt = g.time + level.reaction;
      plan = null;
    }
    if (g.time < reactAt) return out; // has not read the shot yet, keeps recovering
    if (!plan) {
      plan = predict(ball, validBounce, cpu);
      if (!plan.leave) {
        // set up beside the ball: forehand is on the CPU's -x side
        const fx = plan.x + AI.sideOffset, bx = plan.x - AI.sideOffset;
        plan.standX = plan.smash || Math.abs(fx - cpu.x) - AI.forehandBias <= Math.abs(bx - cpu.x) ? fx : bx;
        plan.standZ = plan.z - CONTACT.front;
        plan.run = Math.hypot(plan.standX - cpu.x, plan.standZ - cpu.z);
        const pace = Math.hypot(ball.vx, ball.vz);
        plan.pace = clamp((pace - AI.stretchPaceMin) / (AI.stretchPaceMax - AI.stretchPaceMin), 0, 1);
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
