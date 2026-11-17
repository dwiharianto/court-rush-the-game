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
//   lift             extra hip height (jumps, idle bounce)
//   hipY             explicit hip height, used when plant is false (seated)
import * as THREE from 'three';
import { BODY, ANIM, SERVE_ANIM, SWING } from './config.js';

const POSE_KEYS = [
  'lHip', 'rHip', 'lHipZ', 'rHipZ', 'lKnee', 'rKnee', 'hipsYaw',
  'torsoX', 'torsoY', 'torsoZ', 'headX', 'headY',
  'lShX', 'rShX', 'lShZ', 'rShZ', 'lShY', 'rShY', 'lElbow', 'rElbow',
  'rWristX', 'rWristY', 'rWristZ', 'lift', 'hipY',
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

  setPose(POSES.stand);

  return {
    object3d: root,
    racket,
    leftHand: armL.hand,
    pose: current,
    setPose,
  };
}

// ---------------------------------------------------------------- animation
// A character wraps the rig behind a small interface:
//   object3d                the node to add to the scene
//   setPose(name | null)    hold a named static pose (null returns to animation)
//   update(dt, state)       state = { x, z, vx, vz, facing, action, actionT }
//                           action: 'ready' | 'forehand' | 'backhand' | 'smash' | 'serveReady' | 'toss' | 'serve'
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

const BACKHAND = [
  key(0, {}),
  key(C * 0.55, { ...HIT_STANCE, torsoY: 1.0, torsoX: 0.25, headY: -0.6,
    rShX: 0.2, rShZ: 0.95, rShY: 2.9, rElbow: 1.0, rWristX: -0.5, rWristZ: 0,
    lShX: 0.5, lShZ: 0.3, lShY: 0.3, lElbow: 1.5 }),
  key(C, { ...HIT_STANCE, torsoY: 0.4, torsoX: 0.25, headY: -0.2,
    rShX: 0, rShZ: 1.05, rShY: 2.3, rElbow: 0.15, rWristX: -0.35, rWristZ: 0,
    lShX: 0.1, lShZ: 0.5, lShY: -0.4, lElbow: 0.5 }),
  key(C + 0.11, { ...HIT_STANCE, torsoY: -0.35, torsoX: 0.18, headY: 0.2,
    rShX: 0.2, rShZ: 1.5, rShY: 0.9, rElbow: 0.1, rWristX: -0.1, rWristZ: 0,
    lShX: -0.3, lShZ: 0.9, lShY: -0.9, lElbow: 0.3 }),
  key(S, {}),
];

const SERVE_STANCE = makePose({
  lHip: 0.15, rHip: 0.15, lKnee: 0.25, rKnee: 0.25, lHipZ: 0.14, rHipZ: 0.14,
  torsoX: 0.1, torsoY: -0.35, headY: 0.3,
  rShX: 0.35, rShZ: 0.2, rElbow: 1.0, rWristX: -0.3,
  lShX: 0.6, lShZ: 0.1, lElbow: 0.9,
});
const TROPHY = makePose({
  lHip: 0.35, rHip: 0.35, lKnee: 0.7, rKnee: 0.7, lHipZ: 0.16, rHipZ: 0.16,
  torsoX: -0.12, torsoY: -0.6, headX: -0.45, headY: 0.4,
  rShX: 0, rShZ: 1.55, rShY: -0.25, rElbow: 1.95, rWristX: -0.2,
  lShX: 2.95, lShZ: 0.1, lElbow: 0.05,
});
const T = SERVE_ANIM.tossDuration, SC = SERVE_ANIM.contact;
const TOSS = [
  { t: 0, pose: SERVE_STANCE },
  key(T * 0.5, { lShX: 2.2, lElbow: 0.1, rShX: 0.1, rShZ: 0.9, rShY: -0.6, rElbow: 0.7,
    lHip: 0.25, rHip: 0.25, lKnee: 0.5, rKnee: 0.5 }, SERVE_STANCE),
  { t: T, pose: TROPHY },
];
const SERVE = [
  { t: 0, pose: TROPHY },
  key(SC * 0.55, { rShZ: 1.95, rElbow: 2.35, torsoY: -0.3, torsoX: -0.05, lShX: 1.6, lElbow: 0.6,
    lHip: 0.2, rHip: 0.2, lKnee: 0.4, rKnee: 0.4 }, TROPHY),
  key(SC, { lHip: 0.02, rHip: 0.02, lKnee: 0.05, rKnee: 0.05, lHipZ: 0.1, rHipZ: 0.1, lift: 0.12,
    torsoX: 0.12, torsoY: 0.25, headX: -0.4, headY: 0,
    rShX: 0, rShZ: 2.85, rShY: 0.4, rElbow: 0.05, rWristX: 0.15,
    lShX: 0.5, lShZ: 0.1, lElbow: 1.4 }, TROPHY),
  key(SC + 0.13, { lHip: 0.5, rHip: 0.1, lKnee: 0.6, rKnee: 0.3, lHipZ: 0.15, rHipZ: 0.15,
    torsoX: 0.6, torsoY: 0.8, headX: -0.3, headY: -0.3,
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
  forehand: FOREHAND, backhand: BACKHAND, smash: SMASH, toss: TOSS, serve: SERVE,
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

export function createCharacter(options = {}) {
  const rig = createFigure({ racket: true, ...options });
  const loco = makePose(), run = makePose(), idle = makePose(), clip = makePose(), out = makePose();
  let time = Math.random() * 10;
  let phase = 0;
  let runBlend = 0;
  let yaw = 0;
  let actionBlend = 0;
  let held = null;

  function update(dt, s) {
    time += dt;
    const speed = Math.hypot(s.vx, s.vz);
    const sf = Math.sin(s.facing), cf = Math.cos(s.facing);
    const fwd = s.vx * sf + s.vz * cf; // along the facing direction
    const side = s.vx * cf - s.vz * sf; // toward the figure's left
    const acting = s.action && s.action !== 'ready' && CLIPS[s.action];

    // body turn toward the movement direction; straight back is a backpedal
    let yawTarget = 0, dir = 1;
    if (speed > 0.4 && !acting) {
      if (fwd < 0 && Math.abs(side) < ANIM.backpedalRatio * -fwd) dir = -1;
      else yawTarget = clamp(Math.atan2(side, fwd), -ANIM.maxTurn, ANIM.maxTurn);
    }
    yaw += (yawTarget - yaw) * Math.min(1, dt * ANIM.turnRate);
    runBlend += (clamp(speed / ANIM.runBlendSpeed, 0, 1) - runBlend) * Math.min(1, dt * ANIM.runBlendRate);
    phase += dir * speed * (Math.PI * 2 / ANIM.strideLength) * dt;

    // ready stance with a light bounce (knees flex, hips follow because feet are planted)
    copyPose(idle, READY);
    const b = Math.sin(time * Math.PI * 2 * ANIM.idleHz);
    idle.lKnee += b * 0.07; idle.rKnee += b * 0.07;
    idle.lHip += b * 0.035; idle.rHip += b * 0.035;
    idle.rShX += b * 0.03; idle.lShX += b * 0.03;
    idle.lift = Math.max(0, -b) * 0.012;

    // run cycle
    const sn = Math.sin(phase), cs = Math.cos(phase);
    copyPose(run, READY);
    run.lHip = 0.3 + 0.8 * sn; run.rHip = 0.3 - 0.8 * sn;
    run.lKnee = 0.35 + 0.95 * Math.max(0, cs); run.rKnee = 0.35 + 0.95 * Math.max(0, -cs);
    run.lHipZ = 0.06; run.rHipZ = 0.06;
    run.torsoX = 0.3; run.torsoY = -0.18 * sn - yaw * 0.2;
    run.headY = -yaw * 0.55; run.headX = -0.15;
    run.lShX = 0.15 - 0.7 * sn; run.lElbow = 1.3; run.lShZ = 0.15;
    run.rShX = 0.35 + 0.35 * sn; run.rElbow = 1.2;
    run.lift = 0.035 * Math.abs(sn);
    blendPose(loco, idle, run, runBlend);

    if (held) {
      copyPose(out, NAMED[held] || READY);
    } else if (acting) {
      sampleClip(CLIPS[s.action], s.actionT, clip);
      actionBlend = 1;
      copyPose(out, clip);
      // keep the legs running if the player swings on the move
      const legW = 1 - 0.8 * runBlend;
      for (const k of LEG_KEYS) out[k] = loco[k] + (clip[k] - loco[k]) * legW;
    } else {
      // ease back from the last clip pose into locomotion
      actionBlend = Math.max(0, actionBlend - dt * 8);
      if (actionBlend > 0) blendPose(out, loco, clip, actionBlend);
      else copyPose(out, loco);
    }

    rig.setPose(out);
    rig.object3d.position.set(s.x, 0, s.z);
    rig.object3d.rotation.y = s.facing + yaw;
  }

  const headLocal = new THREE.Vector3();
  return {
    object3d: rig.object3d,
    setPose(name) { held = name; },
    update,
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
