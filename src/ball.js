// Ball state, fixed-step physics, and shot planning. No rendering here.
import { BALL, COURT, SHOT, netHeightAt } from './config.js';

export function createBall() {
  return {
    x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0,
    spin: 'flat', // 'flat' | 'slice'
    bounces: 0, // since the last hit
    lastHitter: -1, // side index of the last player to hit it
    hitId: 0, // increments on every hit
    inPlay: false, // the rules are watching this ball
    isServe: false, // a serve that has not been returned yet
    visible: false,
  };
}

export function copyBall(out, b) {
  out.x = b.x; out.y = b.y; out.z = b.z;
  out.vx = b.vx; out.vy = b.vy; out.vz = b.vz;
  out.spin = b.spin; out.bounces = b.bounces;
  out.lastHitter = b.lastHitter; out.hitId = b.hitId;
  out.inPlay = b.inPlay; out.visible = b.visible;
  return out;
}

// Advance the ball by dt, in sub-steps. Pushes { type: 'bounce' | 'net', ... } into events.
// The net test uses the crossing point between sub-step positions, so a fast
// ball cannot tunnel through it.
export function stepBall(b, dt, events) {
  const n = Math.max(1, Math.ceil(dt / BALL.maxSubstep - 1e-9));
  const h = dt / n;
  const r = BALL.radius;
  for (let i = 0; i < n; i++) {
    const px = b.x, py = b.y, pz = b.z;
    b.vy -= BALL.gravity * h;
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.z += b.vz * h;

    if (pz !== b.z && (pz > 0) !== (b.z > 0)) {
      const u = pz / (pz - b.z);
      const xn = px + (b.x - px) * u;
      const yn = py + (b.y - py) * u;
      if (Math.abs(xn) <= COURT.postX && yn < netHeightAt(xn) + r * 0.5) {
        // caught by the net: it drops on the hitter's side
        b.x = xn;
        b.y = Math.max(r, yn);
        b.z = pz > 0 ? 0.04 : -0.04;
        b.vx *= 0.1;
        b.vz = 0;
        b.vy = Math.min(b.vy, 0) * 0.3;
        if (events) events.push({ type: 'net', x: xn, y: yn });
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
        b.vy = -b.vy * (b.spin === 'slice' ? BALL.sliceBounce : BALL.bounce);
        b.vx *= BALL.friction;
        b.vz *= BALL.friction;
        b.bounces++;
        if (events) events.push({ type: 'bounce', x: b.x, z: b.z, n: b.bounces });
      }
    }
  }
}

// Shots are planned: pick a landing point, then solve the launch velocity for a
// flight time, lengthening the flight until the ball clears the net by a margin.
// opts: { speed } horizontal m/s, or { time } seconds; { margin } net clearance.
export function planShot(from, tx, tz, opts = {}) {
  const dx = tx - from.x, dz = tz - from.z;
  const dist = Math.hypot(dx, dz);
  const margin = opts.margin ?? SHOT.netMargin;
  const g = BALL.gravity;
  let T = opts.time ?? dist / Math.max(1, opts.speed ?? SHOT.driveSpeed);
  T = Math.max(0.15, T);
  let vy = 0;
  for (let i = 0; i < 80; i++) {
    vy = (BALL.radius - from.y + 0.5 * g * T * T) / T;
    if ((from.z > 0) === (tz > 0)) break; // does not cross the net
    const u = from.z / (from.z - tz);
    const tn = T * u;
    const yn = from.y + vy * tn - 0.5 * g * tn * tn;
    if (yn >= netHeightAt(from.x + dx * u) + margin) break;
    T *= SHOT.flightStretch;
  }
  return { vx: dx / T, vy, vz: dz / T, time: T };
}

const scratch = createBall();

// When and where the ball next reaches the plane z = zPlane, looking ahead up to
// `horizon` seconds. Returns { t, x, y } or null. toward: +1 if the ball must be
// travelling toward +z, -1 toward -z.
export function predictAtPlane(b, zPlane, toward, horizon, out = {}) {
  if ((b.z - zPlane) * toward >= 0) { out.t = 0; out.x = b.x; out.y = b.y; return out; }
  const s = copyBall(scratch, b);
  const dt = BALL.fixedDt;
  for (let t = dt; t <= horizon; t += dt) {
    stepBall(s, dt, null);
    if ((s.z - zPlane) * toward >= 0) { out.t = t; out.x = s.x; out.y = s.y; return out; }
  }
  return null;
}
