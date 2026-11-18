// Ball state, fixed-step physics, and shot planning. No rendering here.
import { BALL, COURT, SHOT, SURFACES, DEFAULT_SURFACE, netHeightAt } from './config.js';

// A repeatable number in [0, 1) from two values, for outcomes that predictions must reproduce.
function hash01(a, b) {
  let h = Math.imul((a + 1) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(b * 1000), 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function createBall() {
  return {
    x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0,
    spin: 'flat', // 'flat' | 'slice' (slice also bounces low)
    lift: 0, // spin as a lift coefficient: + topspin (dips, kicks up), - backspin (floats, skids)
    bounces: 0, // since the last hit
    lastHitter: -1, // side index of the last player to hit it
    hitId: 0, // increments on every hit
    court: SURFACES[DEFAULT_SURFACE], // bounce physics of the surface it is played on
    inPlay: false, // the rules are watching this ball
    isServe: false, // a serve that has not been returned yet
    visible: false,
  };
}

export function copyBall(out, b) {
  out.x = b.x; out.y = b.y; out.z = b.z;
  out.vx = b.vx; out.vy = b.vy; out.vz = b.vz;
  out.spin = b.spin; out.lift = b.lift; out.bounces = b.bounces;
  out.lastHitter = b.lastHitter; out.hitId = b.hitId; out.court = b.court;
  out.inPlay = b.inPlay; out.visible = b.visible;
  return out;
}

// Advance the ball by dt, in sub-steps. Pushes { type: 'bounce' | 'net', ... } into events.
// The net test uses the crossing point between sub-step positions, so a fast
// ball cannot tunnel through it.
// Air: gravity, drag (slows the ball, more at speed) and the Magnus force from
// spin (topspin pulls the ball down so it dips, backspin holds it up so it floats).
function accelerate(b, h) {
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  const kd = BALL.drag * sp;
  let ax = -kd * b.vx, ay = -BALL.gravity - kd * b.vy, az = -kd * b.vz;
  if (b.lift) {
    const hl = Math.hypot(b.vx, b.vz);
    if (hl > 1e-6) {
      // spin axis: horizontal, across the flight; force = axis x velocity
      const sx = b.vz / hl, sz = -b.vx / hl;
      const k = BALL.magnus * b.lift * sp;
      ax += k * (-sz * b.vy);
      ay += k * (sz * b.vx - sx * b.vz);
      az += k * (sx * b.vy);
    }
  }
  b.vx += ax * h; b.vy += ay * h; b.vz += az * h;
}

export function stepBall(b, dt, events) {
  const n = Math.max(1, Math.ceil(dt / BALL.maxSubstep - 1e-9));
  const h = dt / n;
  const r = BALL.radius;
  for (let i = 0; i < n; i++) {
    const px = b.x, py = b.y, pz = b.z;
    accelerate(b, h);
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.z += b.vz * h;

    if (pz !== b.z && (pz > 0) !== (b.z > 0)) {
      const u = pz / (pz - b.z);
      const xn = px + (b.x - px) * u;
      const yn = py + (b.y - py) * u;
      const top = Math.abs(xn) <= COURT.postX ? netHeightAt(xn) : -1;
      if (yn < top + r) {
        // Touching the net. Low balls go into the mesh. Balls that clip the tape lose
        // most of their pace and pop up: a high clip usually trickles over, a lower
        // one usually falls back. The outcome is fixed by the ball's own state, so
        // a prediction of the flight gets the same answer as the real ball.
        const depth = (top + r - yn) / (r + BALL.cordBelow); // 0 grazing the tape .. 1 full on
        const roll = hash01(b.hitId, xn);
        const over = depth < 1 && roll < 1.15 - 1.1 * depth;
        if (over) {
          b.x = xn;
          b.y = Math.max(yn, top + r * 0.4);
          b.z = pz > 0 ? -0.03 : 0.03;
          b.vz *= 0.3 + 0.4 * (1 - depth);
          b.vx = b.vx * 0.6 + (hash01(b.hitId + 7, xn) - 0.5) * 0.8;
          b.vy = Math.max(0, b.vy) * 0.3 + (0.6 + 2 * depth) * (0.6 + 0.4 * roll);
          if (events) events.push({ type: 'netCord', x: xn, y: yn, over: true });
        } else {
          // caught by the net: it drops on the hitter's side
          b.x = xn;
          b.y = Math.max(r, yn);
          b.z = pz > 0 ? 0.04 : -0.04;
          b.vx *= 0.1;
          b.vz = 0;
          b.vy = Math.min(b.vy, 0) * 0.3;
          if (events) events.push({ type: 'net', x: xn, y: yn, cord: depth < 1 });
        }
      }
    }

    if (b.y < r && b.vy < 0) {
      b.y = r;
      if (-b.vy < BALL.restSpeed) {
        b.vy = 0;
        const k = Math.max(0, 1 - 2.5 * h); // rolling
        b.vx *= k;
        b.vz *= k;
      } else {
        const impact = -b.vy;
        const court = b.court || SURFACES[DEFAULT_SURFACE];
        // spin changes the bounce: topspin kicks up and forward, backspin skids low and slow
        const kick = 1 + BALL.spinKick * Math.max(0, b.lift);
        const grip = Math.min(0.97, court.friction * (1 + BALL.spinGrip * b.lift));
        b.vy = -b.vy * (b.spin === 'slice' ? court.sliceBounce : court.bounce) * kick;
        b.vx *= grip;
        b.vz *= grip;
        b.lift *= 0.6; // the court takes some of the spin off
        b.bounces++;
        if (events) events.push({ type: 'bounce', x: b.x, z: b.z, n: b.bounces, v: impact });
      }
    }
  }
}

// Flies a ball with the real air physics (no net, no bounce) and reports where it
// crosses the net and where it first comes down.
const fly = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lift: 0 };
function flight(from, v, lift, maxT = 4) {
  Object.assign(fly, from, { vx: v.vx, vy: v.vy, vz: v.vz, lift });
  const h = BALL.maxSubstep, r = BALL.radius;
  let cross = null;
  for (let t = 0; t < maxT; t += h) {
    const pz = fly.z, py = fly.y, px = fly.x;
    accelerate(fly, h);
    fly.x += fly.vx * h; fly.y += fly.vy * h; fly.z += fly.vz * h;
    if (!cross && pz !== fly.z && (pz > 0) !== (fly.z > 0)) {
      const u = pz / (pz - fly.z);
      const xn = px + (fly.x - px) * u;
      cross = { t, x: xn, clear: py + (fly.y - py) * u - (Math.abs(xn) <= COURT.postX ? netHeightAt(xn) : 0) };
    }
    if (fly.y <= r && fly.vy < 0) return { x: fly.x, z: fly.z, t, cross };
  }
  return { x: fly.x, z: fly.z, t: maxT, cross };
}

// Shots are planned: pick a landing point, then search for the launch that gets
// there through the real air (drag and spin), slowing the shot until it clears the
// net by the margin.
// opts: { speed } launch m/s, or { time } seconds for a lob; { lift } spin; { margin }.
export function planShot(from, tx, tz, opts = {}) {
  const lift = opts.lift ?? 0;
  const margin = opts.margin ?? SHOT.netMargin;
  const dx = tx - from.x, dz = tz - from.z;
  const D = Math.hypot(dx, dz) || 0.01;
  const ux = dx / D, uz = dz / D;
  const crosses = (from.z > 0) !== (tz > 0);
  const launch = (S, th) => ({ vx: ux * S * Math.cos(th), vy: S * Math.sin(th), vz: uz * S * Math.cos(th) });
  const reach = (S, th) => { const f = flight(from, launch(S, th), lift); return { d: Math.hypot(f.x - from.x, f.z - from.z), f }; };
  // the elevation that lands at D for launch speed S (null if S cannot reach)
  const aim = (S) => {
    let lo = -0.6, hi = 0.75;
    if (reach(S, hi).d < D) return null;
    for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (reach(S, m).d < D) lo = m; else hi = m; }
    return hi;
  };
  if (opts.time) {
    // lob: a high arc taking about the given time; steeper is slower
    let best = null;
    for (let th = 0.55; th <= 1.25; th += 0.05) {
      let lo = 4, hi = 45;
      for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (reach(m, th).d < D) lo = m; else hi = m; }
      const f = reach(hi, th).f;
      if (!best || Math.abs(f.t - opts.time) < Math.abs(best.t - opts.time)) best = { S: hi, th, t: f.t };
    }
    return { ...launch(best.S, best.th), time: best.t };
  }
  let S = Math.max(4, opts.speed ?? SHOT.driveSpeed);
  for (let k = 0; k < 40; k++) {
    const th = aim(S);
    if (th === null) { S *= 1.08; continue; }
    const f = reach(S, th).f;
    if (!crosses || !f.cross || f.cross.clear >= margin) return { ...launch(S, th), time: f.t };
    S *= 0.94; // too flat to clear the net: a slower, higher shot
  }
  const th = aim(S) ?? 0.4;
  return { ...launch(S, th), time: reach(S, th).f.t };
}

// Re-aim a planned shot so it crosses the net at `clearance` metres above the tape
// (negative goes into the net), by changing only its launch angle. Only for shots
// already passing fairly low; returns false and leaves the shot alone otherwise.
export function lowerOverNet(from, v, clearance, lift = 0) {
  if ((from.z > 0) === (from.z + v.vz > 0) || v.vz === 0) return false;
  let f = flight(from, v, lift);
  if (!f.cross || f.cross.t <= 0.05 || Math.abs(f.cross.x) > COURT.postX) return false;
  if (f.cross.clear > SHOT.netRiskWindow) return false;
  for (let i = 0; i < 4 && f.cross; i++) { // a few corrections: drag and spin bend the line
    v.vy += (clearance - f.cross.clear) / f.cross.t;
    f = flight(from, v, lift);
  }
  return true;
}

const scratch = createBall();

// When and where the ball next reaches the plane z = zPlane, looking ahead up to
// `horizon` seconds. Returns { t, x, y } or null. toward: +1 if the ball must be
// travelling toward +z, -1 toward -z.
export function predictAtPlane(b, zPlane, toward, horizon, out = {}) {
  if ((b.z - zPlane) * toward >= 0) { out.t = 0; out.x = b.x; out.y = b.y; out.bounces = b.bounces; return out; }
  const s = copyBall(scratch, b);
  const dt = BALL.fixedDt;
  for (let t = dt; t <= horizon; t += dt) {
    stepBall(s, dt, null);
    if ((s.z - zPlane) * toward >= 0) { out.t = t; out.x = s.x; out.y = s.y; out.bounces = s.bounces; return out; }
  }
  return null;
}
