// Code-built human figure: hips, torso, neck, head, hair, two-segment arms and
// legs, shoes, and an optional racket in the right hand.
//
// The rig is driven by a flat "pose" object of joint angles (radians). The
// figure faces +z in its own space; its right hand is on the -x side.
//
// Pose keys (all optional, default 0):
//   lHip, rHip       hip flexion, positive swings the thigh forward
//   lHipZ, rHipZ     hip abduction, positive moves the leg outward
//   lKnee, rKnee     knee flexion, positive folds the shin back
//   hipsYaw          pelvis turn about the vertical axis
//   torsoX/Y/Z       torso lean forward, twist (positive turns to its left), side lean
//   headX, headY     nod and turn
//   lShX, rShX       shoulder flexion, positive raises the arm forward
//   lShZ, rShZ       shoulder abduction, positive raises the arm out to the side
//   lShY, rShY       horizontal sweep of a raised arm, positive is forward
//   lElbow, rElbow   elbow flexion
//   rWristX/Y/Z      racket orientation relative to the forearm
//   lGrip            0..1, how far the left hand moves onto the racket handle
//                    (two-handed backhand, volley preparation); solved by IK
//   lift             extra hip height (jumps, idle bounce)
//   hipY             explicit hip height, used when plant is false (seated)
import * as THREE from 'three';
import { BODY, ANIM, SERVE_ANIM, SWING } from './config.js';

const POSE_KEYS = [
  'lHip', 'rHip', 'lHipZ', 'rHipZ', 'lKnee', 'rKnee', 'hipsYaw',
  'torsoX', 'torsoY', 'torsoZ', 'headX', 'headY',
  'lShX', 'rShX', 'lShZ', 'rShZ', 'lShY', 'rShY', 'lElbow', 'rElbow',
  'rWristX', 'rWristY', 'rWristZ', 'lGrip', 'lift', 'hipY',
];

export function makePose(values = {}) {
  const p = {};
  for (const k of POSE_KEYS) p[k] = values[k] || 0;
  return p;
}

// out = a + (b - a) * t for every joint. Missing keys count as 0.
export function blendPose(out, a, b, t) {
  for (const k of POSE_KEYS) {
    const av = a[k] || 0;
    out[k] = av + ((b[k] || 0) - av) * t;
  }
  return out;
}

export function copyPose(out, a) {
  for (const k of POSE_KEYS) out[k] = a[k] || 0;
  return out;
}

// Static poses used by the arena extras.
export const POSES = {
  stand: makePose({ lShZ: 0.1, rShZ: 0.1, lElbow: 0.15, rElbow: 0.15 }),
  seated: makePose({
    lHip: 1.5, rHip: 1.5, lKnee: 1.5, rKnee: 1.5, lHipZ: 0.08, rHipZ: 0.08,
    lShX: 0.55, rShX: 0.55, lElbow: 0.75, rElbow: 0.75, torsoX: 0.05, hipY: 0.1,
  }),
  seatedWatch: makePose({
    lHip: 1.45, rHip: 1.45, lKnee: 1.45, rKnee: 1.45, lHipZ: 0.12, rHipZ: 0.12,
    lShX: 0.7, rShX: 0.7, lElbow: 0.5, rElbow: 0.5, torsoX: 0.3, hipY: 0.1,
  }),
  crouch: makePose({
    lHip: 1.95, rHip: 1.95, lKnee: 2.45, rKnee: 2.45, lHipZ: 0.2, rHipZ: 0.2,
    torsoX: 0.75, headX: -0.5, lShX: 0.9, rShX: 0.9, lElbow: 0.4, rElbow: 0.4,
  }),
  lineJudge: makePose({
    lHip: 0.5, rHip: 0.5, lKnee: 0.55, rKnee: 0.55, lHipZ: 0.14, rHipZ: 0.14,
    torsoX: 0.4, headX: -0.3, lShX: 0.62, rShX: 0.62, lElbow: 0.12, rElbow: 0.12,
  }),
  operator: makePose({ lShX: 1.1, rShX: 1.1, lElbow: 0.9, rElbow: 0.9, torsoX: 0.12, lShZ: 0.1, rShZ: 0.1 }),
};

function limb(len, rTop, rBot, mat, seg = 10) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

// Surface of revolution from [radius, y] pairs (ascending y), for muscle-shaped limbs.
function lathe(profile, mat, scaleZ = 1, seg = 12, doubleSided = false) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  let material = mat;
  if (doubleSided) { material = mat.clone(); material.side = THREE.DoubleSide; }
  const m = new THREE.Mesh(g, material);
  m.scale.z = scaleZ;
  m.castShadow = true;
  return m;
}

// where the left hand holds the handle in a two-handed grip, racket space
const GRIP_POINT = new THREE.Vector3(0, -0.105, 0);
const clampUnit = (v) => Math.max(-1, Math.min(1, v));
const ik = {
  s: new THREE.Vector3(), t: new THREE.Vector3(), d: new THREE.Vector3(), pole: new THREE.Vector3(),
  u: new THREE.Vector3(), e: new THREE.Vector3(), f: new THREE.Vector3(),
  x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(),
  m: new THREE.Matrix4(), q: new THREE.Quaternion(), qp: new THREE.Quaternion(),
};

function buildRacket(frameColor, gripColor) {
  const g = new THREE.Group();
  const gripMat = new THREE.MeshStandardMaterial({ color: gripColor, roughness: 0.9 });
  const frameMat = new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.35, metalness: 0.2 });
  const handle = limb(0.2, 0.016, 0.018, gripMat, 8);
  handle.position.y = 0.05; // hand holds it a little up from the butt
  g.add(handle);
  // throat: two struts from the handle to the head
  for (const s of [-1, 1]) {
    const strut = limb(0.16, 0.008, 0.008, frameMat, 6);
    strut.position.set(0, -0.15, 0);
    strut.rotation.z = s * 0.32;
    g.add(strut);
  }
  const headY = -0.445;
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.011, 8, 28), frameMat);
  frame.scale.set(1, 1.32, 1);
  frame.position.y = headY;
  frame.castShadow = true;
  g.add(frame);
  // strings: a grid drawn on a transparent canvas
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(245,245,235,0.95)';
  ctx.lineWidth = 2;
  for (let i = 6; i < 128; i += 10) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const strings = new THREE.Mesh(
    new THREE.CircleGeometry(0.122, 24),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
  );
  strings.scale.set(1, 1.32, 1);
  strings.position.y = headY;
  g.add(strings);
  g.userData.headY = headY;
  return g;
}

const DEFAULTS = {
  shirt: 0x2f9e58,
  shorts: 0x2452a6,
  skin: 0xd9a37c,
  hair: 0x2a1d14,
  shoes: 0xf2f2f2,
  socks: 0xffffff,
  trousers: false, // colour the whole leg with the shorts colour
  longSleeves: false,
  racket: false,
  racketColor: 0x1d1f24,
  gripColor: 0xf0f0f0,
  scale: 1,
};

export function createFigure(options = {}) {
  const o = { ...DEFAULTS, ...options };
  const B = BODY;
  const std = (color, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });
  const mat = {
    skin: std(o.skin, 0.65), shirt: std(o.shirt, 0.85), shorts: std(o.shorts, 0.85),
    shoes: std(o.shoes, 0.55), sole: std(0x2a2c30, 0.8), hair: std(o.hair, 0.95), socks: std(o.socks, 0.9),
    eye: std(0x1c1410, 0.4),
  };
  const legSkin = o.trousers ? mat.shorts : mat.skin;
  const armSkin = o.longSleeves ? mat.shirt : mat.skin;
  const ball = (r, material, x, y, z, sx = 1, sy = 1, sz = 1, seg = 12) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4)), material);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    return m;
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(o.scale);
  root.add(body);

  // pelvis
  const hips = new THREE.Group();
  body.add(hips);
  hips.add(ball(0.13, mat.shorts, 0, -0.01, -0.005, 1.38, 1.0, 0.98, 14));
  hips.add(ball(0.08, mat.shorts, 0.07, -0.045, -0.03, 1, 1, 0.95)); // glutes
  hips.add(ball(0.08, mat.shorts, -0.07, -0.045, -0.03, 1, 1, 0.95));

  // torso in two segments so lean and twist spread along the spine
  const torso = new THREE.Group();
  torso.position.y = B.torsoBase;
  hips.add(torso);
  torso.add(lathe([[0.158, -0.07], [0.15, 0.02], [0.142, 0.1], [0.15, 0.2], [0.16, 0.26]], mat.shirt, 0.7, 16));
  const chest = new THREE.Group();
  chest.position.y = B.chestY;
  torso.add(chest);
  const cy = B.shoulderY - B.chestY; // shoulder height inside the chest
  chest.add(lathe([[0.15, -0.04], [0.172, 0.06], [0.187, 0.15], [0.186, cy - 0.04], [0.165, cy + 0.02],
    [0.11, cy + 0.06], [0.06, cy + 0.085], [0.05, cy + 0.1]], mat.shirt, 0.68, 18));
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.054, 0.12, 10), mat.skin);
  neck.position.y = cy + 0.11;
  neck.castShadow = true;
  chest.add(neck);

  // head: skull, jaw, nose, ears, eyes, hair
  const head = new THREE.Group();
  head.position.y = cy + 0.1;
  chest.add(head);
  const hr = B.headRadius;
  head.add(ball(hr * 0.93, mat.skin, 0, hr + 0.012, 0, 0.9, 1.08, 1.0, 16)); // skull
  head.add(ball(0.072, mat.skin, 0, hr - 0.05, 0.022, 0.98, 1.0, 0.95)); // jaw
  head.add(ball(0.018, mat.skin, 0, hr - 0.004, 0.105, 0.8, 1.4, 1.0, 8)); // nose
  for (const s of [-1, 1]) {
    head.add(ball(0.024, mat.skin, s * 0.095, hr + 0.004, -0.005, 0.5, 1.2, 0.9, 8)); // ear
    head.add(ball(0.011, mat.eye, s * 0.037, hr + 0.022, 0.091, 1.3, 0.8, 0.6, 6)); // eye
  }
  const hair = new THREE.Mesh(new THREE.SphereGeometry(hr * 0.93 + 0.012, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), mat.hair);
  hair.scale.set(0.93, 1.1, 1.03);
  hair.position.set(0, hr + 0.014, -0.004);
  hair.rotation.x = -0.62;
  hair.castShadow = true;
  head.add(hair);

  // arms
  function buildArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * B.shoulderHalfWidth, cy, 0);
    shoulder.rotation.order = 'YXZ'; // abduct, then flex, then sweep
    chest.add(shoulder);
    shoulder.add(ball(0.066, mat.shirt, 0, 0, 0, 1, 1, 1)); // deltoid under the sleeve
    const sleeveLen = o.longSleeves ? B.upperArm : 0.15;
    shoulder.add(lathe([[0.064, -sleeveLen], [0.063, -0.06], [0.064, 0]], mat.shirt, 1, 12));
    shoulder.add(lathe([[0.04, -B.upperArm], [0.046, -0.2], [0.053, -0.1], [0.054, -0.02]], armSkin, 1, 12));
    const elbow = new THREE.Group();
    elbow.position.y = -B.upperArm;
    shoulder.add(elbow);
    elbow.add(ball(0.041, armSkin, 0, 0, 0));
    elbow.add(lathe([[0.029, -B.foreArm], [0.036, -0.18], [0.046, -0.07], [0.041, 0]], armSkin, 1, 12));
    const hand = ball(0.04, mat.skin, 0, -B.foreArm - 0.035, 0, 0.72, 1.2, 0.95, 10);
    elbow.add(hand);
    return { shoulder, elbow, hand };
  }
  const armL = buildArm(1);
  const armR = buildArm(-1);

  let racket = null;
  if (o.racket) {
    racket = buildRacket(o.racketColor, o.gripColor);
    racket.position.y = -B.foreArm - 0.035;
    armR.elbow.add(racket);
  }

  // legs
  function buildLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * B.hipHalfWidth, -B.hipJointDrop, 0);
    hips.add(hip);
    hip.add(lathe([[0.058, -B.thigh], [0.066, -0.36], [0.084, -0.2], [0.094, -0.07], [0.09, 0]], legSkin, 1, 14));
    if (!o.trousers) {
      // loose shorts leg down to mid thigh
      hip.add(lathe([[0.108, -0.25], [0.104, -0.12], [0.098, 0.02]], mat.shorts, 1, 14, true));
    }
    const knee = new THREE.Group();
    knee.position.y = -B.thigh;
    hip.add(knee);
    knee.add(ball(0.059, legSkin, 0, 0, 0.004));
    knee.add(lathe([[0.037, -B.shin], [0.04, -0.36], [0.055, -0.24], [0.064, -0.13], [0.054, 0]], legSkin, 1, 14));
    knee.add(ball(0.05, legSkin, 0, -0.15, -0.022, 0.9, 1.5, 0.9)); // calf
    if (!o.trousers) knee.add(lathe([[0.043, -B.shin], [0.043, -B.shin + 0.1]], mat.socks, 1, 12));
    const foot = new THREE.Group();
    foot.position.y = -B.shin;
    knee.add(foot);
    const fh = B.footHeight;
    foot.add(ball(0.055, mat.shoes, 0, -fh + 0.055, 0.075, 0.95, 0.85, 2.5, 12)); // upper
    foot.add(ball(0.05, mat.shoes, 0, -fh + 0.06, -0.02, 0.95, 1.0, 1.1, 10)); // heel
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.022, 0.285), mat.sole);
    sole.position.set(0, -fh + 0.011, 0.065);
    sole.castShadow = true;
    foot.add(sole);
    return { hip, knee, foot };
  }
  const legL = buildLeg(1);
  const legR = buildLeg(-1);

  // How far the ankle sits below the hip joint for the given leg angles.
  function legDrop(flex, abduct, knee) {
    const cz = Math.cos(abduct);
    const cf = Math.cos(flex);
    return B.thigh * cz * cf + B.shin * (Math.cos(knee) * cz * cf + Math.sin(knee) * Math.sin(flex));
  }

  const current = makePose();

  // plant: derive hip height from the leg angles so the lower foot stays on the ground.
  function setPose(pose, { plant = true } = {}) {
    const p = copyPose(current, pose);
    legL.hip.rotation.set(-p.lHip, 0, p.lHipZ);
    legR.hip.rotation.set(-p.rHip, 0, -p.rHipZ);
    legL.knee.rotation.x = p.lKnee;
    legR.knee.rotation.x = p.rKnee;
    legL.foot.rotation.x = p.lHip - p.lKnee; // keep the sole level
    legR.foot.rotation.x = p.rHip - p.rKnee;

    if (plant) {
      const drop = Math.max(legDrop(p.lHip, p.lHipZ, p.lKnee), legDrop(p.rHip, p.rHipZ, p.rKnee));
      hips.position.y = drop + B.footHeight + B.hipJointDrop + p.lift;
    } else {
      hips.position.y = p.hipY + p.lift;
    }
    hips.rotation.y = p.hipsYaw;
    torso.rotation.set(p.torsoX * 0.5, p.torsoY * 0.5, p.torsoZ * 0.5);
    chest.rotation.set(p.torsoX * 0.5, p.torsoY * 0.5, p.torsoZ * 0.5);
    head.rotation.set(p.headX, p.headY, 0);

    armL.shoulder.rotation.set(-p.lShX, -p.lShY, p.lShZ);
    armR.shoulder.rotation.set(-p.rShX, p.rShY, -p.rShZ);
    armL.elbow.rotation.x = -p.lElbow;
    armR.elbow.rotation.x = -p.rElbow;
    if (racket) racket.rotation.set(p.rWristX, p.rWristY, p.rWristZ);
  }

  // Two-bone IK: put the left hand on the racket handle, blended by weight w.
  // Call after the pose and the root transform are set.
  const L1 = B.upperArm, L2 = B.foreArm + 0.035;
  function applyGrip(w) {
    if (!racket || w <= 0.001) return;
    root.updateMatrixWorld(true);
    armL.shoulder.getWorldPosition(ik.s);
    ik.t.copy(GRIP_POINT).applyMatrix4(racket.matrixWorld);
    ik.d.subVectors(ik.t, ik.s);
    const len = ik.d.length() || 1;
    ik.d.divideScalar(len);
    const d = Math.min(Math.max(len, 0.08), (L1 + L2) * 0.999);
    const inner = Math.acos(clampUnit((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2)));
    const a = Math.acos(clampUnit((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
    // the elbow points down, out to the figure's left and a little back
    ik.pole.set(0.55, -1, -0.25).transformDirection(root.matrixWorld);
    ik.pole.addScaledVector(ik.d, -ik.pole.dot(ik.d)).normalize();
    ik.u.copy(ik.d).multiplyScalar(Math.cos(a)).addScaledVector(ik.pole, Math.sin(a)); // upper arm
    ik.e.copy(ik.s).addScaledVector(ik.u, L1);
    ik.f.subVectors(ik.t, ik.e).normalize(); // forearm
    ik.y.copy(ik.u).negate();
    ik.z.copy(ik.f).addScaledVector(ik.u, -ik.f.dot(ik.u));
    if (ik.z.lengthSq() < 1e-8) ik.z.copy(ik.pole).negate();
    ik.z.normalize();
    ik.x.crossVectors(ik.y, ik.z);
    ik.m.makeBasis(ik.x, ik.y, ik.z);
    ik.q.setFromRotationMatrix(ik.m);
    armL.shoulder.parent.getWorldQuaternion(ik.qp).invert();
    ik.q.premultiply(ik.qp);
    armL.shoulder.quaternion.slerp(ik.q, w);
    const bend = -(Math.PI - inner);
    armL.elbow.rotation.x += (bend - armL.elbow.rotation.x) * w;
  }

  setPose(POSES.stand);

  return {
    object3d: root,
    racket,
    leftHand: armL.hand,
    pose: current,
    setPose,
    applyGrip,
  };
}

// ---------------------------------------------------------------- animation
// A character wraps the rig behind a small interface:
//   object3d                the node to add to the scene
//   setPose(name | null)    hold a named static pose (null returns to animation)
//   update(dt, state)       state = { x, z, vx, vz, facing, action, actionT }
//                           action: 'ready' | 'forehand' | 'backhand' | 'fhVolley' | 'bhVolley' | 'smash'
//                                   | 'serveReady' | 'toss' | 'serve'
//                           actionT: seconds since the action started
// A rigged .glb with animation clips can implement the same three members
// (map action names to clips, actionT to clip time) and drop in unchanged.

const LEG_KEYS = ['lHip', 'rHip', 'lHipZ', 'rHipZ', 'lKnee', 'rKnee', 'lift'];

const READY = makePose({
  lHip: 0.5, rHip: 0.5, lKnee: 0.85, rKnee: 0.85, lHipZ: 0.2, rHipZ: 0.2,
  torsoX: 0.32, headX: -0.22,
  rShX: 0.4, rShZ: 0.22, rElbow: 1.3, rWristX: -0.55, rWristZ: -0.35,
  lShX: 0.45, lShZ: 0.2, lElbow: 1.25,
});
const key = (t, over, base = READY) => ({ t, pose: makePose({ ...base, ...over }) });

const HIT_STANCE = { lHip: 0.45, rHip: 0.45, lKnee: 0.75, rKnee: 0.75, lHipZ: 0.32, rHipZ: 0.32 };
const S = SWING.duration, C = SWING.ideal;

const FOREHAND = [
  key(0, {}),
  key(C * 0.55, { ...HIT_STANCE, torsoY: -0.8, torsoX: 0.22, headY: 0.5,
    rShX: 0.1, rShZ: 1.15, rShY: -0.6, rElbow: 0.55, rWristX: 0.5, rWristZ: 0,
    lShX: 0.2, lShZ: 1.0, lShY: 0.9, lElbow: 0.3 }),
  key(C, { ...HIT_STANCE, torsoY: -0.05, torsoX: 0.25,
    rShX: 0, rShZ: 1.1, rShY: 0.75, rElbow: 0.3, rWristX: 0.75, rWristZ: 0,
    lShX: 0.3, lShZ: 0.7, lShY: 0.2, lElbow: 0.8 }),
  key(C + 0.11, { ...HIT_STANCE, torsoY: 0.85, torsoX: 0.2, headY: -0.3,
    rShX: 0.5, rShZ: 1.45, rShY: 2.0, rElbow: 1.5, rWristX: 0.2, rWristZ: 0,
    lShX: 0.4, lShZ: 0.4, lElbow: 1.3 }),
  key(S, {}),
];

// two-handed: the left hand rides on the handle (lGrip), shoulders coil to the left
const BACKHAND = [
  key(0, {}),
  key(C * 0.55, { ...HIT_STANCE, hipsYaw: 0.7, torsoY: 1.2, torsoX: 0.25, headY: -1.25,
    rShX: 0.3, rShZ: -0.1, rShY: 0.55, rElbow: 0.9, rWristX: -1.5, rWristZ: 0, lGrip: 1 }),
  key(C, { ...HIT_STANCE, hipsYaw: 0.2, torsoY: 0.0, torsoX: 0.25, headY: -0.2,
    rShX: 0.7, rShZ: -0.1, rShY: 0.95, rElbow: 0.2, rWristX: -1.35, rWristZ: 0, lGrip: 1 }),
  key(C + 0.12, { ...HIT_STANCE, hipsYaw: -0.35, torsoY: -0.9, torsoX: 0.15, headY: 0.4,
    rShX: 1.45, rShZ: 1.0, rShY: 0.1, rElbow: 2.2, rWristX: -0.9, rWristZ: 0, lGrip: 1 }),
  key(S, {}),
];

// Volleys: short punch, no big backswing, racket head kept above the wrist.
const VOLLEY_STANCE = { lHip: 0.55, rHip: 0.55, lKnee: 0.95, rKnee: 0.95, lHipZ: 0.3, rHipZ: 0.3, torsoX: 0.35 };
const FH_VOLLEY = [
  key(0, {}),
  key(C * 0.6, { ...VOLLEY_STANCE, hipsYaw: -0.3, torsoY: -0.5, headY: 0.4,
    rShX: 0.55, rShZ: 0.6, rShY: -0.3, rElbow: 1.4, rWristX: -1.7, rWristZ: 0.3,
    lShX: 0.7, lShZ: 0.4, lElbow: 1.0 }),
  key(C, { ...VOLLEY_STANCE, hipsYaw: -0.15, torsoY: -0.2, headY: 0.2,
    rShX: 0.85, rShZ: 0.45, rShY: 0.1, rElbow: 0.9, rWristX: -1.5, rWristZ: 0.2,
    lShX: 0.6, lShZ: 0.5, lElbow: 1.1 }),
  key(C + 0.1, { ...VOLLEY_STANCE, hipsYaw: -0.1, torsoY: 0, headY: 0.1,
    rShX: 1.0, rShZ: 0.35, rShY: 0.35, rElbow: 0.75, rWristX: -1.4, rWristZ: 0.1,
    lShX: 0.5, lShZ: 0.5, lElbow: 1.1 }),
  key(S, {}),
];
const BH_VOLLEY = [
  key(0, {}),
  key(C * 0.6, { ...VOLLEY_STANCE, hipsYaw: 0.4, torsoY: 0.6, headY: -0.5,
    rShX: 0.6, rShZ: -0.2, rShY: 0.7, rElbow: 1.4, rWristX: -1.7, rWristZ: -0.3, lGrip: 0.85 }),
  key(C, { ...VOLLEY_STANCE, hipsYaw: 0.25, torsoY: 0.3, headY: -0.3,
    rShX: 0.75, rShZ: 0.1, rShY: 0.9, rElbow: 0.6, rWristX: -1.5, rWristZ: -0.3,
    lShX: 0.3, lShZ: 1.0, lShY: 0.6, lElbow: 0.6 }),
  key(C + 0.1, { ...VOLLEY_STANCE, hipsYaw: 0.2, torsoY: 0.2, headY: -0.2,
    rShX: 0.7, rShZ: 0.3, rShY: 1.0, rElbow: 0.4, rWristX: -1.4, rWristZ: -0.2,
    lShX: 0.2, lShZ: 1.2, lShY: 0.8, lElbow: 0.5 }),
  key(S, {}),
];

// Serve: a side-on stance. The pelvis turns about 70 degrees away from the net
// (hipsYaw), so with the feet apart the front foot points toward the net post and
// the back foot sits behind, roughly parallel to the baseline. The head turns back
// to the court.
const SERVE_STANCE = makePose({
  hipsYaw: -1.15, torsoY: 0.15, torsoX: 0.1, headY: 0.95,
  lHip: 0.12, rHip: -0.05, lHipZ: 0.3, rHipZ: 0.32, lKnee: 0.2, rKnee: 0.22,
  lShX: 0.65, lShZ: 0.1, lElbow: 0.75, // ball held out in front of the front hip
  rShX: 0.55, rShY: 0.45, rShZ: 0.1, rElbow: 0.9, rWristX: -0.7, // racket pointing ahead
});
// Trophy: tossing arm straight up, racket arm cocked, knees bent, back arched.
const TROPHY = makePose({
  hipsYaw: -1.3, torsoY: -0.2, torsoX: -0.15, torsoZ: 0.25, headX: -0.5, headY: 0.6,
  lHip: 0.45, rHip: 0.25, lHipZ: 0.3, rHipZ: 0.32, lKnee: 0.85, rKnee: 0.8,
  lShX: 2.9, lShZ: 0.25, lElbow: 0.05,
  // with the upper arm out to the side, rShX turns it about its own axis: here the
  // forearm stands up and the racket points to the sky behind the head
  rShX: 1.5, rShZ: 1.6, rShY: -0.5, rElbow: 1.9, rWristX: 0.7,
});
const T = SERVE_ANIM.tossDuration, SC = SERVE_ANIM.contact;
const TOSS = [
  { t: 0, pose: SERVE_STANCE },
  // arms part together: the ball goes up, the racket swings down and back
  key(T * 0.5, { lShX: 1.8, lShZ: 0.15, lElbow: 0.1,
    rShX: -0.3, rShZ: 0.7, rShY: -0.2, rElbow: 0.45, rWristX: -0.2,
    lHip: 0.3, rHip: 0.12, lKnee: 0.45, rKnee: 0.45, hipsYaw: -1.25, torsoY: -0.05, headX: -0.25, headY: 0.8 }, SERVE_STANCE),
  { t: T, pose: TROPHY },
];
const SERVE = [
  { t: 0, pose: TROPHY },
  // racket drop behind the back as the legs start to drive
  key(SC * 0.55, { rShX: -1.5, rShZ: 1.9, rElbow: 2.4, rShY: -0.3, torsoY: -0.1, hipsYaw: -1.0, torsoZ: 0.15,
    lShX: 1.8, lElbow: 0.8, lHip: 0.25, rHip: 0.15, lKnee: 0.4, rKnee: 0.4 }, TROPHY),
  // contact: airborne, arm fully extended overhead, hips and chest uncoiled toward the net
  key(SC, { hipsYaw: -0.35, torsoY: 0.9, torsoX: 0.3, torsoZ: -0.2, headX: -0.5, headY: 0.2,
    lHip: 0.05, rHip: 0.02, lHipZ: 0.1, rHipZ: 0.1, lKnee: 0.06, rKnee: 0.1, lift: 0.26,
    rShX: 0.2, rShZ: 3.1, rShY: 0.3, rElbow: 0.05, rWristX: 0.2,
    lShX: 0.5, lShZ: 0.1, lElbow: 1.5 }, TROPHY),
  // follow-through: land on the front foot inside the court, back leg kicking up behind
  key(SC + 0.13, { hipsYaw: 0.3, torsoY: 0.5, torsoX: 0.6, torsoZ: 0, headX: -0.2, headY: -0.2,
    lHip: 0.5, lKnee: 0.6, lHipZ: 0.12, rHip: -0.7, rKnee: 1.2, rHipZ: 0.1, lift: 0,
    rShX: 0.7, rShZ: 0.5, rShY: 1.9, rElbow: 0.4, rWristX: 0.3,
    lShX: 0.3, lShZ: 0.2, lElbow: 1.4 }, TROPHY),
  key(SERVE_ANIM.swingDuration, {}),
];

// overhead: the serve swing entered from the ready stance
const SMASH = [
  key(0, {}),
  { t: C * 0.55, pose: SERVE[1].pose },
  { t: C, pose: SERVE[2].pose },
  { t: C + 0.13, pose: SERVE[3].pose },
  key(S, {}),
];

const CLIPS = {
  forehand: FOREHAND, backhand: BACKHAND, fhVolley: FH_VOLLEY, bhVolley: BH_VOLLEY,
  smash: SMASH, toss: TOSS, serve: SERVE,
  serveReady: [{ t: 0, pose: SERVE_STANCE }],
};
const NAMED = { ...POSES, ready: READY, trophy: TROPHY, serveStance: SERVE_STANCE };

function sampleClip(keys, t, out) {
  if (t <= keys[0].t) return copyPose(out, keys[0].pose);
  const last = keys[keys.length - 1];
  if (t >= last.t) return copyPose(out, last.pose);
  let i = 1;
  while (keys[i].t < t) i++;
  const a = keys[i - 1], b = keys[i];
  let u = (t - a.t) / (b.t - a.t);
  if (i === 1) u = u * u; // ease out of the start pose
  else if (i === keys.length - 1) u = 1 - (1 - u) * (1 - u); // settle into the end pose
  return blendPose(out, a.pose, b.pose, u);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Slide poses, for a slide toward the figure's left (+x local). Mirrored for the right.
// Lateral: the outside leg slides out straight, the inside knee folds deep.
const SLIDE_SIDE = makePose({
  lHip: 0.2, lHipZ: 0.85, lKnee: 0.12,
  rHip: 0.95, rHipZ: 0.05, rKnee: 1.75,
  hipsYaw: 0.25, torsoX: 0.45, torsoY: 0.1, torsoZ: 0.35, headX: -0.25, headY: -0.3,
  rShX: 0.5, rShZ: 0.55, rElbow: 1.2, rWristX: -0.5, rWristZ: -0.3,
  lShX: 0.35, lShZ: 1.15, lElbow: 0.4,
});
// Forward: front leg slides ahead nearly straight, back knee drops toward the clay.
const SLIDE_FWD = makePose({
  lHip: 1.15, lHipZ: 0.12, lKnee: 0.2,
  rHip: -0.1, rHipZ: 0.12, rKnee: 1.8,
  torsoX: 0.25, headX: -0.1,
  rShX: 0.45, rShZ: 0.5, rElbow: 1.2, rWristX: -0.5, rWristZ: -0.3,
  lShX: 0.6, lShZ: 0.75, lElbow: 0.6,
});
const MIRROR_PAIRS = [['lHip', 'rHip'], ['lHipZ', 'rHipZ'], ['lKnee', 'rKnee']];
const MIRROR_FLIP = ['hipsYaw', 'torsoY', 'torsoZ', 'headY'];

// out = pose mirrored left to right, legs only plus the twist and lean keys
function mirrorLegs(out, pose) {
  copyPose(out, pose);
  for (const [l, r] of MIRROR_PAIRS) { out[l] = pose[r]; out[r] = pose[l]; }
  for (const k of MIRROR_FLIP) out[k] = -pose[k];
  return out;
}

const smooth = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, dt * rate);

export function createCharacter(options = {}) {
  const rig = createFigure({ racket: true, ...options });
  const loco = makePose(), run = makePose(), idle = makePose(), shuffle = makePose(), clip = makePose(), out = makePose();
  const slidePose = makePose(), tmp = makePose();
  let time = Math.random() * 10;
  let phase = 0, shufflePhase = 0;
  let runBlend = 0, shuffleBlend = 0, slideBlend = 0;
  let yaw = 0;
  let actionBlend = 0;
  let held = null;
  let lastFwd = 0, lastSide = 0, accFwd = 0, accSide = 0;
  let wasSliding = false, slideSide = 1, slideLateral = 1;
  let turnedRun = false; // turned around to chase a ball going over or past
  let splitT = 99;

  function update(dt, s) {
    time += dt;
    const speed = Math.hypot(s.vx, s.vz);
    const sf = Math.sin(s.facing), cf = Math.cos(s.facing);
    const fwd = s.vx * sf + s.vz * cf; // along the facing direction (toward the net)
    const side = s.vx * cf - s.vz * sf; // toward the figure's left
    const acting = s.action && s.action !== 'ready' && CLIPS[s.action];
    const sliding = !!s.slide;

    // smoothed acceleration, for leaning into a sprint and back when braking
    if (dt > 0) {
      accFwd = smooth(accFwd, (fwd - lastFwd) / dt, 8, dt);
      accSide = smooth(accSide, (side - lastSide) / dt, 8, dt);
    }
    lastFwd = fwd; lastSide = side;

    // a slow sideways move is a side shuffle facing the net; faster ones turn and run
    const lateral = speed > 0.3 ? Math.abs(side) / speed : 0;
    const wantShuffle = !sliding && !acting && speed > 0.3 && speed < ANIM.shuffleMax && lateral > 0.7 ? 1 : 0;
    shuffleBlend = smooth(shuffleBlend, wantShuffle, 7, dt);

    // a slide locks its direction when it starts
    if (sliding && !wasSliding) {
      slideSide = side >= 0 ? 1 : -1;
      slideLateral = clamp((lateral - 0.35) / 0.4, 0, 1);
    }
    wasSliding = sliding;
    slideBlend = smooth(slideBlend, sliding ? 1 : 0, sliding ? 16 : 6, dt);

    // Body turn toward the movement direction. A short, slow retreat is a backpedal
    // facing the net; a real chase backwards turns around and runs, over the
    // shoulder on the side the ball is going, and turns back to face the net to hit.
    let yawTarget = 0, dir = 1;
    const backwards = fwd < 0 && Math.abs(side) < ANIM.backpedalRatio * -fwd;
    if (acting || speed < ANIM.turnedRunEnd) turnedRun = false;
    else if (backwards && speed > ANIM.backpedalMaxSpeed) turnedRun = true;
    if (speed > 0.4 && !acting && !sliding && wantShuffle === 0) {
      if (backwards && !turnedRun) dir = -1;
      else {
        yawTarget = Math.atan2(side, fwd);
        // stay on the side of the turn already taken instead of spinning through the front
        if (yawTarget - yaw > Math.PI) yawTarget -= 2 * Math.PI;
        else if (yaw - yawTarget > Math.PI) yawTarget += 2 * Math.PI;
      }
    }
    const rate = acting ? ANIM.turnRate * 1.9 : sliding ? ANIM.turnRate * 1.6 : ANIM.turnRate;
    yaw = smooth(yaw, yawTarget, rate, dt);
    if (yaw > 2 * Math.PI) yaw -= 2 * Math.PI;
    else if (yaw < -2 * Math.PI) yaw += 2 * Math.PI;
    const look = clamp(yaw, -1.75, 1.75); // how far the head and shoulders can follow
    runBlend = smooth(runBlend, clamp(speed / ANIM.runBlendSpeed, 0, 1) * (1 - shuffleBlend), ANIM.runBlendRate, dt);

    // stride grows with speed, so cadence stays lively at low speed
    const stride = ANIM.strideBase + (ANIM.strideLength - ANIM.strideBase) * clamp(speed / 6.2, 0, 1);
    phase += dir * speed * (Math.PI * 2 / stride) * dt;
    shufflePhase += Math.abs(side) * (Math.PI * 2 / ANIM.shuffleStride) * dt;

    // ready stance: light bounce and a slow weight shift
    copyPose(idle, READY);
    const b = Math.sin(time * Math.PI * 2 * ANIM.idleHz);
    const sway = Math.sin(time * 0.9);
    idle.lKnee += b * 0.07; idle.rKnee += b * 0.07;
    idle.lHip += b * 0.035; idle.rHip += b * 0.035;
    idle.rShX += b * 0.03; idle.lShX += b * 0.03;
    idle.torsoZ = sway * 0.04; idle.hipsYaw = sway * 0.05; idle.headY = -sway * 0.05;
    idle.lift = Math.max(0, -b) * 0.012;

    // split step: a small hop as the opponent strikes, landing with bent knees
    splitT += dt;
    if (splitT < ANIM.splitTime) {
      const u = splitT / ANIM.splitTime;
      const hop = u < 0.5 ? Math.sin(u * 2 * Math.PI) : 0;
      const land = u >= 0.45 ? Math.sin((u - 0.45) / 0.55 * Math.PI) : 0;
      idle.lift += Math.max(0, hop) * 0.07;
      idle.lHipZ += 0.12 * land; idle.rHipZ += 0.12 * land;
      idle.lKnee += 0.35 * land; idle.rKnee += 0.35 * land;
      idle.lHip += 0.17 * land; idle.rHip += 0.17 * land;
    }

    // run cycle: hips and shoulders counter-rotate, arms pump, knees drive
    const k = clamp(speed / 6.2, 0, 1);
    const sn = Math.sin(phase);
    const hipAmp = 0.3 + 0.32 * k, kneeAmp = 0.7 + 0.9 * k, armAmp = 0.35 + 0.45 * k;
    copyPose(run, READY);
    run.lHip = 0.3 + hipAmp * sn; run.rHip = 0.3 - hipAmp * sn;
    // the knee folds after push-off and through the swing, then straightens to land
    const kl = Math.cos(phase + Math.PI / 4), kr = Math.cos(phase + Math.PI + Math.PI / 4);
    run.lKnee = 0.35 + kneeAmp * Math.pow(Math.max(0, kl), 1.2);
    run.rKnee = 0.35 + kneeAmp * Math.pow(Math.max(0, kr), 1.2);
    run.lHipZ = 0.05; run.rHipZ = 0.05;
    run.hipsYaw = -0.2 * sn * k;
    run.torsoY = 0.32 * sn * k - look * 0.15;
    // lean forward with speed and acceleration, back when braking, into the turn sideways
    run.torsoX = 0.2 + 0.18 * k + clamp(accFwd * 0.03, -0.3, 0.2);
    run.torsoZ = clamp(-accSide * 0.025, -0.25, 0.25);
    // running away from the net, the head turns to keep an eye on the ball
    run.headY = clamp(-run.hipsYaw - run.torsoY - look * 0.5, -1.1, 1.1); run.headX = -0.18 - 0.1 * k;
    run.lShX = 0.2 - armAmp * sn; run.lShZ = 0.14; run.lElbow = 1.35 - 0.3 * sn;
    run.rShX = 0.35 + armAmp * 0.65 * sn; run.rShZ = 0.2; run.rElbow = 1.25 + 0.2 * sn;
    run.lift = (0.015 + 0.04 * k) * Math.abs(sn);

    // side shuffle: legs open and close, body stays square to the net
    const ss = Math.sin(shufflePhase);
    copyPose(shuffle, READY);
    shuffle.lHipZ = 0.24 + 0.2 * ss; shuffle.rHipZ = 0.24 - 0.2 * ss;
    shuffle.lKnee = 0.95 + 0.15 * Math.max(0, -ss); shuffle.rKnee = 0.95 + 0.15 * Math.max(0, ss);
    shuffle.lHip = 0.55; shuffle.rHip = 0.55;
    shuffle.torsoX = 0.35; shuffle.torsoZ = clamp(-side * 0.03, -0.12, 0.12);
    shuffle.lift = 0.035 * Math.abs(Math.sin(shufflePhase * 2));

    blendPose(loco, idle, run, runBlend);
    if (shuffleBlend > 0.001) blendPose(loco, loco, shuffle, shuffleBlend);

    // slide: lateral and forward flavours, mirrored to the slide side
    if (slideBlend > 0.001) {
      blendPose(tmp, SLIDE_FWD, SLIDE_SIDE, slideLateral);
      if (slideSide < 0) mirrorLegs(slidePose, tmp);
      else copyPose(slidePose, tmp);
      if (slideSide < 0) { // the arms are not mirrored: keep the racket arm where it is
        for (const key of ['lShX', 'lShZ', 'lElbow', 'rShX', 'rShZ', 'rElbow', 'rWristX', 'rWristZ']) slidePose[key] = tmp[key];
        slidePose.lShZ = 0.55; slidePose.rShZ = 1.0; slidePose.rElbow = 0.7; // balance arm swaps over
      }
      blendPose(loco, loco, slidePose, slideBlend);
    }

    if (held) {
      copyPose(out, NAMED[held] || READY);
    } else if (acting) {
      sampleClip(CLIPS[s.action], s.actionT, clip);
      actionBlend = 1;
      copyPose(out, clip);
      // legs keep running, or sliding, if the player swings on the move
      const legW = (1 - 0.8 * runBlend) * (1 - slideBlend);
      for (const key of LEG_KEYS) out[key] = loco[key] + (clip[key] - loco[key]) * legW;
    } else {
      // ease back from the last clip pose into locomotion
      actionBlend = Math.max(0, actionBlend - dt * 8);
      if (actionBlend > 0) blendPose(out, loco, clip, actionBlend);
      else copyPose(out, loco);
    }

    rig.setPose(out);
    rig.object3d.position.set(s.x, 0, s.z);
    rig.object3d.rotation.y = s.facing + yaw;
    rig.applyGrip(out.lGrip);
  }

  const headLocal = new THREE.Vector3();
  return {
    object3d: rig.object3d,
    setPose(name) { held = name; },
    update,
    splitStep() { splitT = 0; },
    // world position of the racket head centre (for effects)
    getRacketHead(target) {
      headLocal.set(0, rig.racket.userData.headY, 0);
      return target.copy(headLocal).applyMatrix4(rig.racket.matrixWorld);
    },
    getLeftHand(target) {
      return rig.leftHand.getWorldPosition(target);
    },
  };
}
