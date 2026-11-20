// Ball kids. When a point (or a fault) ends, the dead ball rolls on as its own
// object while the server takes a fresh one; the kid on that side runs out, round
// the net post if the ball is on the other side, crouches, picks it up and runs back
// to their post with it. Balls that fly into the stands are left to the crowd.
import * as THREE from 'three';
import { createBall, copyBall, stepBall } from './ball.js';
import { makePose, POSES } from './human.js';

const RUN_SPEED = 4.4, START_DELAY = 0.35, PICK_TIME = 0.45;

// a running stride for the kids
function runPose(phase, out) {
  const s = Math.sin(phase), c = Math.cos(phase);
  out.lHip = 0.62 * s; out.rHip = -0.62 * s;
  out.lKnee = 0.3 + 0.9 * Math.max(0, -c); out.rKnee = 0.3 + 0.9 * Math.max(0, c);
  out.lShX = -0.6 * s; out.rShX = 0.6 * s;
  out.lElbow = 1.3; out.rElbow = 1.3; out.lShZ = 0.12; out.rShZ = 0.12;
  out.torsoX = 0.28; out.headX = -0.15;
  return out;
}
// bending down for the ball: u 0..1..0 over the pick-up
function pickPose(u, out) {
  Object.assign(out, POSES.crouch);
  out.lShX = 0.9 + 0.6 * u; out.rShX = 0.9 + 0.6 * u;
  out.torsoX = 0.75 + 0.35 * u;
  return out;
}

export function createBallKids(scene, kids, makeBallMesh) {
  // kids: [{ fig, home: [x, z], ry }]
  const K = kids.map((k) => ({ ...k, x: k.home[0], z: k.home[1], state: 'home', ball: null, phase: 0, t: 0, pose: makePose(), facing: k.ry }));
  const balls = []; // { sim, mesh, kid, picked, age }
  const hand = new THREE.Vector3();
  let walls = [];
  // inside the playing area: where a kid may go to fetch
  let bounds = { x: 9.3, zMin: -20.8, zMax: 17 };

  function spawn(state) {
    const sim = createBall();
    copyBall(sim, state);
    sim.walls = walls;
    sim.inPlay = false;
    const mesh = makeBallMesh();
    scene.add(mesh);
    balls.push({ sim, mesh, kid: null, picked: false, age: 0, gone: false });
  }

  const reachable = (b) => Math.abs(b.sim.x) < bounds.x && b.sim.z > bounds.zMin && b.sim.z < bounds.zMax && b.sim.y < 2.5;

  function assign() {
    for (const b of balls) {
      if (b.kid || b.picked || b.gone || b.age < START_DELAY) continue;
      if (!reachable(b)) continue;
      // the free kid nearest the ball, preferring the one on its side of the court
      let best = null, bestD = Infinity;
      for (const k of K) {
        if (k.state !== 'home' && k.state !== 'back') continue;
        if (k.state === 'back' && k.ball) continue;
        const d = Math.hypot(k.x - b.sim.x, k.z - b.sim.z) + (Math.sign(k.home[0]) === Math.sign(b.sim.x) ? 0 : 6);
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best) { best.state = 'run'; best.ball = b; b.kid = best; }
    }
  }

  // move toward (tx, tz), going round the net post rather than through the net
  function moveTo(k, tx, tz, dt) {
    let wx = tx, wz = tz;
    if (Math.sign(tz) !== Math.sign(k.z) && Math.abs(k.x) < Math.abs(k.home[0]) - 0.2) { wx = k.home[0]; wz = k.z; }
    else if (Math.sign(tz) !== Math.sign(k.z)) { wx = k.home[0]; wz = Math.sign(tz) * 0.9; }
    const dx = wx - k.x, dz = wz - k.z, d = Math.hypot(dx, dz);
    if (d < 0.02) return 0;
    const step = Math.min(d, RUN_SPEED * dt);
    k.x += (dx / d) * step;
    k.z += (dz / d) * step;
    k.facing = Math.atan2(dx, dz);
    k.phase += step * 3.4;
    return Math.hypot(tx - k.x, tz - k.z);
  }

  function update(dt) {
    dt = Math.min(dt, 0.05);
    for (const b of balls) {
      b.age += dt;
      if (!b.picked) {
        stepBall(b.sim, dt, null);
        b.mesh.position.set(b.sim.x, b.sim.y, b.sim.z);
        // into the stands, or far away: let it go
        if (!b.kid && (b.age > 12 || Math.abs(b.sim.x) > 30 || Math.abs(b.sim.z) > 40)) b.gone = true;
      }
    }
    assign();
    for (const k of K) {
      const o = k.fig.object3d;
      if (k.state === 'run') {
        const b = k.ball;
        const speed = Math.hypot(b.sim.vx, b.sim.vz);
        const left = moveTo(k, b.sim.x, b.sim.z, dt);
        k.fig.setPose(runPose(k.phase, k.pose));
        if (left < 0.45 && speed < 2.2 && b.sim.y < 0.4) { k.state = 'pick'; k.t = 0; }
        if (!reachable(b)) { b.kid = null; k.ball = null; k.state = 'back'; }
      } else if (k.state === 'pick') {
        k.t += dt;
        const u = Math.sin(Math.min(1, k.t / PICK_TIME) * Math.PI);
        k.fig.setPose(pickPose(u, k.pose));
        if (k.t > PICK_TIME * 0.5 && !k.ball.picked) { k.ball.picked = true; }
        if (k.t >= PICK_TIME) k.state = 'back';
      } else if (k.state === 'back') {
        const left = moveTo(k, k.home[0], k.home[1], dt);
        k.fig.setPose(runPose(k.phase, k.pose));
        if (left < 0.05) {
          k.state = 'home';
          k.facing = k.ry;
          if (k.ball) { k.ball.gone = true; k.ball = null; } // into the pocket
          k.fig.setPose(POSES.crouch);
        }
      }
      o.position.set(k.x, 0, k.z);
      // turn smoothly toward where they are going
      let d = k.facing - o.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      o.rotation.y += d * Math.min(1, dt * 12);
      // a picked ball rides in the kid's hand
      if (k.ball && k.ball.picked) {
        k.fig.leftHand.getWorldPosition(hand);
        k.ball.mesh.position.copy(hand);
      }
    }
    for (let i = balls.length - 1; i >= 0; i--) {
      if (!balls[i].gone) continue;
      scene.remove(balls[i].mesh);
      if (balls[i].kid && balls[i].kid.ball === balls[i]) balls[i].kid.ball = null;
      balls.splice(i, 1);
    }
  }

  return {
    spawn,
    update,
    // the venue's walls (dead balls come off them too) and the area a kid may fetch from
    setVenue(w, b) { walls = w; if (b) bounds = b; },
    // clear the court (a new match)
    reset() {
      for (const b of balls) scene.remove(b.mesh);
      balls.length = 0;
      for (const k of K) {
        k.x = k.home[0]; k.z = k.home[1]; k.state = 'home'; k.ball = null; k.facing = k.ry;
        k.fig.object3d.position.set(k.x, 0, k.z);
        k.fig.object3d.rotation.y = k.ry;
        k.fig.setPose(POSES.crouch);
      }
    },
  };
}

