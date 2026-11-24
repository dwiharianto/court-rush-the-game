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
//   lAnkle, rAnkle   ankle, positive points the toes down (heel lifts); 0 keeps the sole level
//   hipsYaw          pelvis turn about the vertical axis
//   hipsRoll         whole-body roll about the forward axis, positive toward its right (dives)
//   torsoX/Y/Z       torso lean forward, twist (positive turns to its left), side lean
//   headX, headY     nod and turn
//   lShX, rShX       shoulder flexion, positive raises the arm forward
//   lShZ, rShZ       shoulder abduction, positive raises the arm out to the side
//   lShY, rShY       horizontal sweep of a raised arm, positive is forward
//   lElbow, rElbow   elbow flexion
//   rWristX/Y/Z      racket orientation relative to the forearm
//   lThroat          0..1, the left hand on the racket's throat rather than the handle
//   lGrip            0..1, how far the left hand moves onto the racket handle
//                    (two-handed backhand, volley preparation); solved by IK
//   rkX/Y/Z, rkW     racket direction in the chest's frame, and how far to turn the
//                    hand to it (captured strokes; 0 leaves the racket to the wrist keys)
//   lift             extra hip height (jumps, idle bounce)
//   groundW, clearance  0..1: place the body by its lowest point, clearance metres above
//                    the court, instead of by the feet (dives, lying, kneeling)
//   hipY             explicit hip height, used when plant is false (seated)
import * as THREE from 'three';
import { BODY, ANIM, SERVE_ANIM, SWING, SERVE as SERVE_CFG, DIVE as DIVE_CFG } from './config.js';
import { createBodyRig } from './rig.js';
import { tiredness } from './rules.js';
import MOCAP from './assets/mocap.js';
import CAPTURE from './assets/strokes.js';

const POSE_KEYS = [
  'lHip', 'rHip', 'lHipZ', 'rHipZ', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle', 'hipsYaw', 'hipsRoll',
  'torsoX', 'torsoY', 'torsoZ', 'headX', 'headY',
  'lShX', 'rShX', 'lShZ', 'rShZ', 'lShY', 'rShY', 'lElbow', 'rElbow',
  'rWristX', 'rWristY', 'rWristZ', 'lGrip', 'lift', 'hipY',
  'rkX', 'rkY', 'rkZ', 'rkW', 'groundW', 'clearance', 'lThroat',
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
  // a ball kid at the back of the court: standing straight, hands behind the back
  kidStand: makePose({ lShX: -0.28, rShX: -0.28, lShZ: 0.06, rShZ: 0.06, lElbow: 1.05, rElbow: 1.05, lHipZ: 0.06, rHipZ: 0.06 }),
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
export const GRIP_POINT = new THREE.Vector3(0, -0.105, 0);
export const THROAT_POINT = new THREE.Vector3(0, -0.25, 0); // where the free hand rests in the ready position
const clampUnit = (v) => Math.max(-1, Math.min(1, v));
const ik = {
  s: new THREE.Vector3(), t: new THREE.Vector3(), d: new THREE.Vector3(), pole: new THREE.Vector3(),
  u: new THREE.Vector3(), e: new THREE.Vector3(), f: new THREE.Vector3(),
  x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(),
  m: new THREE.Matrix4(), q: new THREE.Quaternion(), qp: new THREE.Quaternion(),
};

// A modern racket, made here: a beam swept round the head and down two throat arms
// (deeper than it is wide, as today's frames are), a gloss finish, a bumper guard over
// the top, a 16 x 19 string bed with a dampener, and an octagonal handle with an
// overgrip wound round it and a butt cap. It hangs from the hand along -y, the strings
// in the xy plane; the head's centre is at headY.
function sweepBeam(path, closed, halfW, halfD, prof = 14) {
  const ring = [];
  for (let k = 0; k < prof; k++) {
    const a = (k / prof) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    ring.push([halfW * Math.sign(c) * Math.abs(c) ** 0.55, halfD * Math.sign(s) * Math.abs(s) ** 0.55]); // a rounded box
  }
  const n = path.length, pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    for (const [w, d] of ring) pos.push(path[i][0] + ty * w, path[i][1] - tx * w, d);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    for (let k = 0; k < prof; k++) {
      const k2 = (k + 1) % prof;
      idx.push(i * prof + k, j * prof + k, i * prof + k2, i * prof + k2, j * prof + k, j * prof + k2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const RACKET = { headY: -0.445, a: 0.126, b: 0.162, squareness: 0.82, beamW: 0.0068, beamD: 0.0125 };
const headPoint = (t, grow = 0) => { // t: 0..1 round the head from its top (the tip)
  const R = RACKET, th = Math.PI * 2 * t, c = Math.sin(th), s = -Math.cos(th), p = R.squareness;
  return [(R.a + grow) * Math.sign(c) * Math.abs(c) ** p, R.headY + (R.b + grow) * Math.sign(s) * Math.abs(s) ** p];
};
let stringTex = null, gripTex = null;
function racketTextures() {
  if (stringTex || typeof document === 'undefined') return;
  // strings: 16 mains and 19 crosses, with a little shading where they weave
  let c = document.createElement('canvas');
  c.width = 256; c.height = 320;
  let g = c.getContext('2d');
  g.clearRect(0, 0, 256, 320);
  for (let i = 0; i < 16; i++) { const x = (i + 0.5) * 16; g.fillStyle = 'rgba(238,236,226,1)'; g.fillRect(x - 1.6, 0, 3.2, 320); }
  for (let j = 0; j < 19; j++) { const y = (j + 0.5) * (320 / 19); g.fillStyle = 'rgba(226,224,214,1)'; g.fillRect(0, y - 1.5, 256, 3); }
  for (let i = 0; i < 16; i++) for (let j = 0; j < 19; j++) { // a darker knot at each crossing
    g.fillStyle = (i + j) % 2 ? 'rgba(170,168,160,1)' : 'rgba(205,203,195,1)';
    g.fillRect((i + 0.5) * 16 - 1.6, (j + 0.5) * (320 / 19) - 1.5, 3.2, 3);
  }
  stringTex = new THREE.CanvasTexture(c);
  stringTex.colorSpace = THREE.SRGBColorSpace;
  stringTex.anisotropy = 4;
  // overgrip: a pale wrap wound at an angle, with a thin overlap line
  c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 256);
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
  for (let y = -64; y < 320; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(64, y + 28); g.stroke(); }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(Math.random() * 64, Math.random() * 256, 2, 2); }
  gripTex = new THREE.CanvasTexture(c);
  gripTex.colorSpace = THREE.SRGBColorSpace;
  gripTex.wrapS = gripTex.wrapT = THREE.RepeatWrapping;
}
export function buildRacket(frameColor, gripColor) {
  racketTextures();
  const R = RACKET;
  const g = new THREE.Group();
  const frameMat = new THREE.MeshPhysicalMaterial({ color: frameColor, roughness: 0.38, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.18 });
  const accent = new THREE.Color(frameColor).getHSL({ h: 0, s: 0, l: 0 }).l < 0.25 ? 0xd8f23a : 0x16181c;
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 });
  const add = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; g.add(m); return m; };

  // the head: one beam all the way round
  const loop = [];
  for (let i = 0; i < 96; i++) loop.push(headPoint(i / 96));
  add(sweepBeam(loop, true, R.beamW, R.beamD), frameMat);
  // bumper guard over the tip, and a thin accent line along the inside of the frame
  const bump = [];
  for (let i = -18; i <= 18; i++) bump.push(headPoint(i / 96, R.beamW + 0.002));
  add(sweepBeam(bump, false, 0.0024, R.beamD * 0.9, 10), trimMat, false);
  const line = [];
  for (let i = 0; i < 96; i++) line.push(headPoint(i / 96, -R.beamW - 0.0004));
  add(sweepBeam(line, true, 0.0006, R.beamD * 0.35, 8), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 }), false);

  // the open throat: two arms from the shaft, curving out to meet the head
  const shaftTop = -0.2, meet = 0.425; // where on the head the arms join (fraction round from the tip)
  for (const side of [-1, 1]) {
    const end = headPoint(side > 0 ? meet : 1 - meet), arm = [];
    for (let i = 0; i <= 20; i++) {
      const u = i / 20, v = u * u * (3 - 2 * u);
      const x = side * 0.008 * (1 - v) + end[0] * Math.pow(v, 1.25);
      const y = shaftTop + (end[1] - shaftTop) * u;
      arm.push([x, y]);
    }
    add(sweepBeam(arm, false, R.beamW * 0.95, R.beamD * 0.9), frameMat);
  }
  // shaft, from the handle into the throat
  const shaft = add(new THREE.CylinderGeometry(0.0115, 0.0145, 0.06, 8), frameMat);
  shaft.position.y = -0.172;
  shaft.rotation.y = Math.PI / 8;

  // handle: octagonal, the overgrip wound round, a collar where the wrap ends, a butt cap
  const gripMat = new THREE.MeshStandardMaterial({ color: gripColor, roughness: 0.85, map: gripTex });
  if (gripTex) { gripMat.map = gripTex.clone(); gripMat.map.needsUpdate = true; gripMat.map.repeat.set(1, 1); }
  const handle = add(new THREE.CylinderGeometry(0.0158, 0.0162, 0.19, 8), gripMat);
  handle.position.y = -0.05;
  handle.rotation.y = Math.PI / 8;
  const collar = add(new THREE.CylinderGeometry(0.0168, 0.0168, 0.012, 8), trimMat);
  collar.position.y = -0.146; collar.rotation.y = Math.PI / 8;
  const cap = add(new THREE.CylinderGeometry(0.0185, 0.0172, 0.014, 8), frameMat);
  cap.position.y = 0.05; cap.rotation.y = Math.PI / 8;

  // the string bed, inside the frame
  const shape = new THREE.Shape();
  for (let i = 0; i <= 96; i++) { const [x, y] = headPoint(i / 96, -R.beamW + 0.001); if (i) shape.lineTo(x, y); else shape.moveTo(x, y); }
  const bed = new THREE.ShapeGeometry(shape, 48);
  const uv = bed.attributes.uv, P = bed.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (P.getX(i) + R.a) / (2 * R.a), (P.getY(i) - R.headY + R.b) / (2 * R.b));
  const strings = new THREE.Mesh(bed, new THREE.MeshStandardMaterial({
    map: stringTex, alphaTest: 0.5, roughness: 0.55, side: THREE.DoubleSide,
  }));
  g.add(strings);
  // dampener: a small rubber knot between the two middle mains, near the throat
  const damp = add(new THREE.BoxGeometry(0.018, 0.012, 0.009), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 }), false);
  damp.position.set(0, R.headY + R.b * 0.84, 0);

  g.userData.headY = R.headY;
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
  hairStyle: 'short', // 'short' | 'buzz' | 'long' | 'curly' | 'none'
  headwear: 'none', // 'none' | 'cap' | 'headband'
  headwearColor: 0xffffff,
  racket: false,
  racketColor: 0x1d1f24,
  gripColor: 0xf0f0f0,
  scale: 1,
};

// Hair and headwear on a head group whose skull centre sits at y = hr + 0.012.
function buildHair(head, hr, o, mat, ball) {
  const cap = (radius, thetaLen, scale, tilt, material) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 10, 0, Math.PI * 2, 0, thetaLen), material);
    m.scale.set(...scale);
    m.position.set(0, hr + 0.014, -0.004);
    m.rotation.x = tilt;
    m.castShadow = true;
    head.add(m);
    return m;
  };
  const style = o.hairStyle;
  if (style === 'short') cap(hr * 0.93 + 0.012, Math.PI * 0.5, [0.93, 1.1, 1.03], -0.62, mat.hair);
  else if (style === 'buzz') cap(hr * 0.93 + 0.004, Math.PI * 0.47, [0.92, 1.08, 1.02], -0.55, mat.hair);
  else if (style === 'curly') {
    cap(hr * 0.93 + 0.03, Math.PI * 0.52, [1.0, 1.12, 1.08], -0.5, mat.hair);
    for (let i = 0; i < 14; i++) { // a bumpy outline of curls
      const a = (i / 14) * Math.PI * 2;
      head.add(ball(0.03, mat.hair, Math.cos(a) * 0.085, hr + 0.07 + Math.sin(i * 1.7) * 0.012, Math.sin(a) * 0.08 - 0.01));
    }
  } else if (style === 'long') {
    cap(hr * 0.93 + 0.014, Math.PI * 0.55, [0.95, 1.1, 1.05], -0.7, mat.hair);
    // ponytail: gathered at the back of the head, hanging down
    const tail = lathe([[0.012, -0.2], [0.028, -0.14], [0.034, -0.06], [0.026, 0]], mat.hair, 1, 10);
    tail.position.set(0, hr + 0.04, -0.09);
    tail.rotation.x = 0.35;
    head.add(tail);
  }
  const hw = new THREE.MeshStandardMaterial({ color: o.headwearColor, roughness: 0.8 });
  if (o.headwear === 'cap') {
    const crown = cap(hr * 0.93 + 0.022, Math.PI * 0.46, [0.97, 0.95, 1.06], -0.25, hw);
    crown.position.y += 0.006;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.008, 18, 1, false, -Math.PI / 2, Math.PI), hw);
    brim.scale.set(1, 1, 1.25);
    brim.position.set(0, hr + 0.06, 0.07);
    brim.rotation.x = 0.12;
    brim.castShadow = true;
    head.add(brim);
  } else if (o.headwear === 'headband') {
    const band = new THREE.Mesh(new THREE.TorusGeometry(hr * 0.93 + 0.004, 0.012, 6, 24), hw);
    band.rotation.x = Math.PI / 2 - 0.25;
    band.scale.set(0.92, 1.03, 1);
    band.position.set(0, hr + 0.045, 0.004);
    head.add(band);
  }
}

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
  buildHair(head, hr, o, mat, ball);

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
    legL.foot.rotation.x = p.lHip - p.lKnee + p.lAnkle; // the sole level, plus the ankle
    legR.foot.rotation.x = p.rHip - p.rKnee + p.rAnkle;

    if (plant) {
      const drop = Math.max(legDrop(p.lHip, p.lHipZ, p.lKnee), legDrop(p.rHip, p.rHipZ, p.rKnee));
      hips.position.y = drop + B.footHeight + B.hipJointDrop + p.lift;
    } else {
      hips.position.y = p.hipY + p.lift;
    }
    hips.rotation.set(0, p.hipsYaw, p.hipsRoll);
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
    legs: { thigh: B.thigh, shin: B.shin, hipX: B.hipHalfWidth },
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

const LEG_KEYS = ['lHip', 'rHip', 'lHipZ', 'rHipZ', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle', 'lift'];
const LEG_SET = new Set([...LEG_KEYS, 'hipY']);

const READY = makePose({
  // athletic ready position: wide base, knees and hips flexed, chest forward over the
  // feet, eyes up; the racket in front of the body (the free hand joins it on the
  // throat while standing, see the idle pose)
  lHip: 0.62, rHip: 0.62, lKnee: 1.0, rKnee: 1.0, lHipZ: 0.28, rHipZ: 0.28,
  torsoX: 0.5, headX: -0.42,
  rShX: 0.55, rShZ: 0.12, rShY: 0.3, rElbow: 1.45, rWristX: -0.3, rWristZ: -0.6,
  lShX: 0.5, lShZ: 0.15, lShY: 0.4, lElbow: 1.4,
});
const key = (t, over, base = READY) => ({ t, pose: makePose({ ...base, ...over }) });

// catching breath between points: bent over, hands (and racket) resting on the knees
const HANDS_ON_KNEES = makePose({
  lHip: 1.15, rHip: 1.15, lKnee: 0.8, rKnee: 0.8, lHipZ: 0.2, rHipZ: 0.2,
  torsoX: 1.25, headX: -0.95,
  lShX: 0.55, lShZ: 0.25, lElbow: 0.15, rShX: 0.5, rShZ: 0.3, rElbow: 0.2, rWristX: -1.0, rWristZ: -0.2,
});
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
  key(SC, { hipsYaw: -0.35, torsoY: 0.5, torsoX: 0.3, torsoZ: -0.2, headX: -0.5, headY: 0.2,
    lHip: 0.05, rHip: 0.02, lHipZ: 0.1, rHipZ: 0.1, lKnee: 0.06, rKnee: 0.1, lift: 0.26,
    rShX: 0.2, rShZ: 2.7, rShY: 0.3, rElbow: 0.05, rWristX: 0.2,
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

const MIRROR_PAIRS = [['lHip', 'rHip'], ['lHipZ', 'rHipZ'], ['lKnee', 'rKnee'], ['lAnkle', 'rAnkle']];
const MIRROR_FLIP = ['hipsYaw', 'hipsRoll', 'torsoY', 'torsoZ', 'headY'];

// Dive, made for a forehand dive to the right (the backhand one mirrors it). The body
// is placed by its lowest point through the dive (groundW): it pushes off the outside
// leg, lays out full length with the racket at full stretch (contact), comes down on
// the forearm and hip and slides on its side, then sits up onto the hip, comes up onto
// one knee with the other foot planted, and stands back into the ready stance.
const DV = DIVE_CFG.duration;
const DIVE_ARMS_FH = [ // racket arm and free arm through the dive, by key
  {}, // ready
  { rShX: 0.4, rShZ: 0.9, rElbow: 0.8, lShZ: 0.45, lElbow: 0.9 }, // load
  { rShX: 0.3, rShZ: 1.6, rElbow: 0.35, lShX: 0.4, lShZ: 0.9, lElbow: 0.6 }, // take-off
  { rShX: 0.25, rShZ: 2.25, rShY: 0.1, rElbow: 0.08, rWristX: 0.2, lShX: 0.6, lShZ: 1.0, lElbow: 0.5 }, // contact
  { rShX: 0.3, rShZ: 2.45, rShY: 0.15, rElbow: 0.15, rWristX: 0.3, lShX: 1.0, lShZ: 0.8, lElbow: 0.8 }, // coming down
  { rShX: 0.35, rShZ: 2.55, rShY: 0.2, rElbow: 0.35, rWristX: 0.3, lShX: 1.25, lShZ: 0.55, lElbow: 1.1 }, // landing
  { rShX: 0.45, rShZ: 2.4, rShY: 0.2, rElbow: 0.55, rWristX: 0.3, lShX: 1.2, lShZ: 0.5, lElbow: 1.2 }, // sliding
  { rShX: 0.3, rShZ: 1.1, rElbow: 0.3, rWristX: -0.2, lShX: 0.9, lShZ: 0.3, lElbow: 1.0 }, // sitting up, racket hand on the court
  { rShX: 0.35, rShZ: 0.55, rElbow: 0.6, lShX: 0.6, lShZ: 0.35, lElbow: 1.1 }, // on one knee
  { rShX: 0.4, rShZ: 0.3, rElbow: 1.1, lShX: 0.45, lShZ: 0.25, lElbow: 1.2 }, // rising
  {}, // ready
];
const DIVE_BODY = [ // legs, trunk and placement (forehand side), by key
  [0, {}],
  [0.07, { lHip: 0.8, lKnee: 1.3, lHipZ: 0.1, rHip: 0.45, rKnee: 0.95, rHipZ: 0.5, torsoX: 0.45, torsoZ: 0.25, hipsRoll: 0.12, headY: -0.3, groundW: 0.2 }],
  [0.12, { lHip: 0.35, lKnee: 0.5, lHipZ: 0.2, rHip: 0.55, rKnee: 0.75, rHipZ: 0.35, torsoX: 0.3, torsoZ: 0.3, hipsRoll: 0.5, headY: -0.45, groundW: 0.8, clearance: 0.12 }],
  [C, { lHip: 0.0, lKnee: 0.15, lHipZ: 0.2, rHip: 0.4, rKnee: 0.6, rHipZ: 0.1, torsoX: 0.15, torsoZ: 0.25, hipsRoll: 0.95, headY: -0.5, headX: -0.2, groundW: 1, clearance: 0.3 }],
  [0.29, { lHip: 0.1, lKnee: 0.3, lHipZ: 0.08, rHip: 0.35, rKnee: 0.65, rHipZ: 0.05, torsoX: 0.12, torsoZ: 0.2, hipsRoll: 1.25, headY: -0.4, headX: -0.3, groundW: 1, clearance: 0.12 }],
  [DIVE_CFG.flight, { lHip: 0.25, lKnee: 0.45, lHipZ: -0.08, rHip: 0.3, rKnee: 0.7, rHipZ: 0.02, torsoX: 0.1, torsoZ: 0.18, hipsRoll: 1.42, headY: -0.3, headX: -0.4, groundW: 1, clearance: 0 }],
  [0.72, { lHip: 0.4, lKnee: 0.7, lHipZ: -0.1, rHip: 0.35, rKnee: 0.85, rHipZ: 0.02, torsoX: 0.15, torsoZ: 0.12, hipsRoll: 1.45, headY: -0.1, headX: -0.45, groundW: 1, clearance: 0 }],
  // sit up onto the right hip, legs folding, trunk coming upright over the hand on the court
  [0.98, { lHip: 0.95, lKnee: 1.35, lHipZ: 0.2, rHip: 0.8, rKnee: 1.9, rHipZ: 0.25, torsoX: 0.35, torsoZ: -0.75, hipsRoll: 0.85, headX: -0.25, groundW: 1, clearance: 0 }],
  // up onto the right knee, left foot planted in front
  [1.17, { lHip: 1.35, lKnee: 1.45, lHipZ: 0.15, rHip: 0.05, rKnee: 1.6, rHipZ: 0.1, rAnkle: 0.6, torsoX: 0.3, torsoZ: -0.1, hipsRoll: 0.12, headX: -0.15, groundW: 1, clearance: 0 }],
  // driving up off the front foot
  [1.36, { lHip: 0.75, lKnee: 0.95, lHipZ: 0.15, rHip: 0.35, rKnee: 0.85, rHipZ: 0.15, torsoX: 0.35, hipsRoll: 0.02, groundW: 0.3, clearance: 0 }],
  [DV, {}],
];
const DIVE_FH = DIVE_BODY.map(([t, body], i) => key(t, { ...body, ...DIVE_ARMS_FH[i] }));
// the backhand dive, to the left: legs and trunk mirrored; the racket arm reaches across
// the body and the free (left) arm takes the landing and the push up
const DIVE_ARMS_BH = [
  {},
  { rShX: 0.9, rShY: 0.6, rShZ: 0.3, rElbow: 0.7, lShZ: 0.6, lElbow: 0.7 },
  { rShX: 1.2, rShY: 0.9, rShZ: 0.3, rElbow: 0.35, lShX: 0.3, lShZ: 1.2, lElbow: 0.4 },
  { rShX: 1.35, rShY: 1.1, rShZ: 0.35, rElbow: 0.15, lShX: 0.3, lShZ: 1.4, lElbow: 0.3 },
  { rShX: 1.4, rShY: 1.15, rShZ: 0.4, rElbow: 0.2, lShX: 0.4, lShZ: 1.7, lElbow: 0.3 },
  { rShX: 1.45, rShY: 1.1, rShZ: 0.4, rElbow: 0.35, lShX: 0.4, lShZ: 2.0, lElbow: 0.4 },
  { rShX: 1.4, rShY: 1.0, rShZ: 0.4, rElbow: 0.5, lShX: 0.45, lShZ: 1.9, lElbow: 0.5 },
  { rShX: 1.0, rShY: 0.4, rShZ: 0.3, rElbow: 0.9, lShX: 0.3, lShZ: 1.1, lElbow: 0.3 },
  { rShX: 0.6, rShZ: 0.35, rElbow: 1.0, lShX: 0.35, lShZ: 0.55, lElbow: 0.6 },
  { rShX: 0.45, rShZ: 0.25, rElbow: 1.15, lShX: 0.45, lShZ: 0.3, lElbow: 1.1 },
  {},
];
const DIVE_BH = DIVE_FH.map((k, i) => {
  const pose = mirrorLegs(makePose(), k.pose);
  for (const key of ['rShX', 'rShY', 'rShZ', 'rElbow', 'rWristX', 'lShX', 'lShY', 'lShZ', 'lElbow']) pose[key] = READY[key] || 0;
  Object.assign(pose, DIVE_ARMS_BH[i]);
  return { t: k.t, pose };
});

const HAND_CLIPS = {
  forehand: FOREHAND, backhand: BACKHAND, fhVolley: FH_VOLLEY, bhVolley: BH_VOLLEY,
  smash: SMASH, toss: TOSS, serve: SERVE, diveF: DIVE_FH, diveB: DIVE_BH,
  serveReady: [{ t: 0, pose: SERVE_STANCE }],
};
// Captured strokes (tools/build-strokes.mjs): the body comes from motion capture of
// club players; the racket's angle in the hand, the left hand's grip on a two-handed
// backhand and the head's turn toward the ball come from the hand-made clip above.
const KEEP_FROM_HAND = ['rWristX', 'rWristY', 'rWristZ', 'lGrip', 'headY'];
function captured(name, hand) {
  const keys = CAPTURE.clips[name];
  if (!keys) return hand;
  const legLen = BODY.thigh + BODY.shin;
  const h = makePose();
  return keys.map((k) => {
    sampleClip(hand, k.t, h);
    const pose = makePose({ ...READY, ...k.pose });
    pose.lift = k.pose.lift * legLen;
    for (const key of KEEP_FROM_HAND) pose[key] = h[key];
    pose.rkW = 1;
    return { t: k.t, pose };
  });
}
const CAPTURED_CLIPS = Object.fromEntries(Object.entries(HAND_CLIPS).map(([name, clip]) => [name, captured(name, clip)]));
CAPTURED_CLIPS.serveReady = [CAPTURED_CLIPS.toss[0]];
const CLIPS = new Proxy({}, { get: (_, name) => (ANIM.capturedStrokes ? CAPTURED_CLIPS : HAND_CLIPS)[name] });
const NAMED = { ...POSES, ready: READY, trophy: TROPHY, serveStance: SERVE_STANCE };

// Clip sampling: a smooth curve through the key poses (cubic Hermite, tangents from
// the neighbouring keys and their timing), so a stroke accelerates and decelerates
// through its keys instead of moving in straight lines between them. The first and
// last keys have zero tangents: the clip eases out of and into rest.
function sampleClip(keys, t, out) {
  if (t <= keys[0].t) return copyPose(out, keys[0].pose);
  const last = keys[keys.length - 1];
  if (t >= last.t) return copyPose(out, last.pose);
  let i = 1;
  while (keys[i].t < t) i++;
  const a = keys[i - 1], b = keys[i];
  const pa = keys[i - 2], pb = keys[i + 1];
  const h = b.t - a.t;
  const u = (t - a.t) / h, u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  for (const k of POSE_KEYS) {
    const va = a.pose[k] || 0, vb = b.pose[k] || 0;
    const ma = pa ? ((vb - (pa.pose[k] || 0)) / (b.t - pa.t)) * h : 0;
    const mb = pb ? (((pb.pose[k] || 0) - va) / (pb.t - a.t)) * h : 0;
    out[k] = h00 * va + h10 * ma + h01 * vb + h11 * mb;
  }
  return out;
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

// out = pose mirrored left to right, legs only plus the twist and lean keys
function mirrorLegs(out, pose) {
  copyPose(out, pose);
  for (const [l, r] of MIRROR_PAIRS) { out[l] = pose[r]; out[r] = pose[l]; }
  for (const k of MIRROR_FLIP) out[k] = -pose[k];
  return out;
}

// ---- captured gaits (tools/build-mocap.mjs)
const GAITS = ['walk', 'jog', 'run', 'dash'].map((n) => MOCAP.clips[n]);
const BACK = MOCAP.clips.back;
const GAIT_KEYS = Object.keys(BACK.keys);
const GAIT_N = MOCAP.samples;
for (const c of [...GAITS, BACK]) {
  c.mean = {}; c.min = {};
  for (const key of GAIT_KEYS) {
    const a = c.keys[key];
    c.mean[key] = a.reduce((x, y) => x + y, 0) / a.length;
    c.min[key] = Math.min(...a);
  }
}
// a looping cycle at phase u (0..1), Catmull-Rom between samples
function sampleCycle(a, u) {
  const x = (((u % 1) + 1) % 1) * GAIT_N, i = Math.floor(x), t = x - i;
  const p0 = a[(i + GAIT_N - 1) % GAIT_N], p1 = a[i % GAIT_N], p2 = a[(i + 1) % GAIT_N], p3 = a[(i + 2) % GAIT_N];
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}
// a gait key with its swing scaled: shorter steps below the slowest clip, longer above the fastest
const SWING_KEYS = new Set(['lHip', 'rHip', 'lAnkle', 'rAnkle', 'lShX', 'rShX']);
const FOLD_KEYS = new Set(['lKnee', 'rKnee', 'lift']);
function scaled(c, u, key, a) {
  const v = sampleCycle(c.keys[key], u);
  if (a === 1) return v;
  if (SWING_KEYS.has(key)) return c.mean[key] + (v - c.mean[key]) * a;
  if (FOLD_KEYS.has(key)) return c.min[key] + (v - c.min[key]) * a;
  return v;
}
// clip weights for a speed, and how much to stretch the stride beyond the clips
function gaitWeights(speed, w) {
  w.fill(0);
  const last = GAITS.length - 1;
  if (speed <= GAITS[0].speed) { w[0] = 1; const a = clamp(Math.sqrt(speed / GAITS[0].speed), 0.45, 1); return { legs: a, stride: a }; }
  if (speed >= GAITS[last].speed) { w[last] = 1; const a = Math.sqrt(speed / GAITS[last].speed); return { legs: Math.min(a, 1.25), stride: a }; }
  for (let i = 0; i < last; i++) {
    if (speed <= GAITS[i + 1].speed) {
      const t = (speed - GAITS[i].speed) / (GAITS[i + 1].speed - GAITS[i].speed);
      w[i] = 1 - t; w[i + 1] = t;
      break;
    }
  }
  return { legs: 1, stride: 1 };
}
function gaitMean(key, w, back) {
  let m = 0;
  for (let i = 0; i < GAITS.length; i++) m += w[i] * GAITS[i].mean[key];
  return m + (BACK.mean[key] - m) * back;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const chestQ = new THREE.Quaternion(), spineQ = new THREE.Quaternion(), spineE = new THREE.Euler(), rkDir = new THREE.Vector3();
const reachLocal = new THREE.Vector3(), reachWorld = new THREE.Vector3();
// Where the racket head should meet the ball, in the player's frame (x to its left,
// z toward the net), and how strongly to reach for it now (strongest at contact).
// Returns 0 when there is nothing to reach for.
function reachTarget(s, out) {
  const sw = s.swing;
  if (s.action === 'serve') {
    out.set(-SERVE_CFG.tossSide, ANIM.serveReachY, SERVE_CFG.tossFront);
    return Math.exp(-(((s.actionT - SERVE_ANIM.contact) / 0.08) ** 2));
  }
  if (!sw || sw.contactH === undefined || !(STROKES.has(s.action) || s.action === 'smash')) return 0;
  const fore = s.action === 'forehand' || s.action === 'fhVolley' || s.action === 'smash';
  const side = s.action === 'smash' ? 0.25 : clamp(sw.contactSide, 0.45, 1.5);
  out.set(fore ? -side : side, clamp(sw.contactH, 0.3, 3.0), ANIM.reachFront);
  return ANIM.reachStrength * Math.exp(-(((s.actionT - SWING.ideal) / 0.07) ** 2));
}

const smooth = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, dt * rate);

// Strokes shaped to the ball: around contact, a low ball brings deeper knees, more
// lean and a lower hitting arm; a high one straighter legs and a higher arm; a wide
// one a lean toward it, a longer arm and a wider stance. Clips are built for a ball
// at waist height (about 1 m) and 0.75 m to the side.
const STROKES = new Set(['forehand', 'backhand', 'fhVolley', 'bhVolley']);
const DIVES = new Set(['diveF', 'diveB']);
// the upper body, for blending a pose over the legs
const UPPER_KEYS = POSE_KEYS.filter((k) => !LEG_SET.has(k) && !['hipsRoll', 'groundW', 'clearance'].includes(k));
function shapeStroke(p, s) {
  const sw = s.swing;
  if (!sw || !STROKES.has(s.action) || sw.contactH === undefined) return;
  const w = Math.exp(-(((s.actionT - SWING.ideal) / 0.13) ** 2)); // strongest at contact
  const dh = clamp(sw.contactH - 1.0, -0.75, 0.75) * w;
  const reach = clamp(sw.contactSide - 0.75, -0.35, 0.7) * w;
  const fore = s.action === 'forehand' || s.action === 'fhVolley';
  const low = Math.max(0, -dh), high = Math.max(0, dh);
  p.lKnee += low * 1.3 - high * 0.4; p.rKnee += low * 1.3 - high * 0.4;
  p.lHip += low * 0.65 - high * 0.2; p.rHip += low * 0.65 - high * 0.2;
  p.torsoX += low * 0.45 - high * 0.15;
  if (ANIM.capturedStrokes) return; // captured strokes: the arm reaches for the ball itself (reachTarget)
  if (fore) { p.rShZ += dh * 0.85; p.rShX += dh * 0.3; } else { p.rShX += dh * 0.55; p.rShZ += dh * 0.25; }
  // reaching: lean toward the ball (right for forehands), straighter arm, wider feet
  p.torsoZ += (fore ? 1 : -1) * reach * 0.4;
  p.rElbow -= Math.max(0, reach) * 0.5;
  p.lHipZ += Math.max(0, reach) * 0.18; p.rHipZ += Math.max(0, reach) * 0.18;
}

// ---------------------------------------------------------------- reactions
// Short animations between points, layered over the standing pose: celebrations,
// frustration, and the occasional racket thrown to the ground. Each takes the time t
// since it began and writes into the pose p (already a copy of the standing pose).
const ease = (u) => { const v = Math.min(1, Math.max(0, u)); return v * v * (3 - 2 * v); };
const crouch = (p, k) => { p.lHip += 0.35 * k; p.rHip += 0.35 * k; p.lKnee += 0.5 * k; p.rKnee += 0.5 * k; };
export const EMOTES = {
  // a fist pump with the free hand, knees bent
  fist: { dur: 1.4, pose(p, t) {
    const pump = t < 0.8 ? Math.max(0, Math.sin(t * 15)) : 0;
    crouch(p, 0.5); p.torsoX = 0.32; p.headX = 0.05;
    p.lShX = 0.7 + 0.25 * pump; p.lShZ = 0.25; p.lElbow = 2.05 - 0.35 * pump;
    p.rShX = 0.25; p.rShZ = 0.15; p.rElbow = 0.45;
  } },
  // "come on!": a crouch, then up with the racket raised and a clenched fist
  comeOn: { dur: 2.0, pose(p, t) {
    const up = ease((t - 0.25) / 0.25);
    crouch(p, 0.9 - 0.8 * up); p.torsoX = 0.45 - 0.6 * up; p.headX = -0.35 * up;
    p.rShX = 0.4 + 2.35 * up; p.rShZ = 0.3; p.rElbow = 0.35;
    p.lShX = 0.9 + 0.3 * up; p.lShZ = 0.55; p.lElbow = 2.15;
    p.lift = 0.05 * Math.max(0, Math.sin((t - 0.25) * 9)) * (t < 0.6 ? 1 : 0);
  } },
  // match won: both arms up, a couple of little jumps
  arms: { dur: 3.4, pose(p, t) {
    p.rShX = 2.9; p.lShX = 2.9; p.rShZ = 0.45; p.lShZ = 0.45; p.rElbow = 0.15; p.lElbow = 0.15;
    p.headX = -0.45; p.torsoX = -0.15;
    p.lift = t < 1.6 ? 0.13 * Math.max(0, Math.sin(t * 7.5)) : 0;
  } },
  // bent over, hands on knees, and a shake of the head
  knees: { dur: 2.5, pose(p, t) {
    crouch(p, 0.6); p.torsoX = 0.85; p.headX = 0.15;
    p.lShX = 0.75; p.rShX = 0.75; p.lShZ = 0.12; p.rShZ = 0.12; p.lElbow = 0.25; p.rElbow = 0.3;
    p.headY = t > 0.5 && t < 1.9 ? 0.35 * Math.sin((t - 0.5) * 7) : 0;
  } },
  // head down, shoulders slumped
  dejected: { dur: 2.3, pose(p) {
    crouch(p, 0.2); p.torsoX = 0.5; p.headX = 0.6;
    p.lShX = 0.12; p.rShX = 0.18; p.lShZ = 0.06; p.rShZ = 0.06; p.lElbow = 0.25; p.rElbow = 0.3;
  } },
  // match lost: crouched, head in hands
  headInHands: { dur: 3.6, pose(p) {
    crouch(p, 1.2); p.torsoX = 0.8; p.headX = 0.6;
    p.lShX = 1.75; p.lShZ = -0.05; p.lElbow = 2.45; p.rShX = 1.6; p.rShZ = -0.05; p.rElbow = 2.35;
  } },
  // the trophy lifted overhead in both hands, with a little bounce
  trophy: { dur: 7, pose(p, t) {
    const up = ease(t / 0.8);
    p.lShX = 0.4 + 2.35 * up; p.rShX = 0.4 + 2.35 * up; p.lShZ = 0.15 - 0.4 * up; p.rShZ = 0.15 - 0.4 * up;
    p.lElbow = 0.9 - 0.35 * up; p.rElbow = 0.9 - 0.35 * up; p.headX = -0.4 * up; p.torsoX = -0.1 * up;
    p.lift = t > 1 && t < 4 ? 0.06 * Math.max(0, Math.sin((t - 1) * 6)) : 0;
  } },
  // the racket thrown down: wind up, slam, let go, then both hands on the head
  throw: { dur: 3.0, release: 0.5, pose(p, t) {
    if (t < 0.35) { const u = ease(t / 0.35); p.rShX = 2.6 * u; p.rElbow = 0.6 * u; p.torsoX = -0.15 * u; p.headX = -0.2 * u; return; }
    if (t < 0.62) { const u = ease((t - 0.35) / 0.2); p.rShX = 2.6 - 3.0 * u; p.rElbow = 0.6 - 0.5 * u; p.torsoX = -0.15 + 0.75 * u; crouch(p, 0.6 * u); p.headX = 0.3 * u; return; }
    const u = ease((t - 0.62) / 0.35);
    crouch(p, 0.6 * (1 - u)); p.torsoX = 0.6 - 0.5 * u; p.headX = 0.3 - 0.45 * u;
    p.lShX = 2.3 * u; p.lShZ = 0.6 * u; p.lElbow = 2.5 * u; p.rShX = -0.4 + 2.7 * u; p.rShZ = 0.6 * u; p.rElbow = 0.1 + 2.4 * u;
    p.headY = t > 1.1 && t < 2.3 ? 0.25 * Math.sin((t - 1.1) * 6) : 0;
  } },
};

// the face that goes with each reaction (morph weights by name; t: seconds into it)
const EMOTE_FACE = {
  fist: () => ({ shout: 0.7 }),
  comeOn: (t) => ({ shout: t > 0.2 ? 1 : 0.4, grimace: t > 0.2 ? 0 : 0.5 }),
  arms: () => ({ smile: 0.75, shout: 0.45 }),
  trophy: () => ({ smile: 1 }),
  knees: () => ({ grimace: 0.55, sad: 0.35 }),
  dejected: () => ({ sad: 1 }),
  headInHands: () => ({ sad: 1, grimace: 0.25 }),
  throw: (t) => (t < 0.62 ? { shout: 0.9, grimace: 0.4 } : { grimace: 0.7, sad: 0.45 }),
};

// ---------------------------------------------------------------- personal style
// Every player moves a little differently: how low they stand and how quickly they
// bounce, how they carry the racket when running, how big the finish of their strokes
// is, how many times they bounce the ball before serving, and which small habits they
// fall into between points. Drawn from a seed (the player's name), so it stays theirs.
function styleRng(seed) {
  let h = 2166136261;
  for (const ch of String(seed ?? Math.random())) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}
function makeStyle(seed) {
  const r = styleRng(seed);
  const between = (a, b) => a + (b - a) * r();
  return {
    bounceHz: ANIM.idleHz * between(0.8, 1.25), bounceAmp: between(0.6, 1.4),
    crouch: between(-0.08, 0.16), sway: between(0.5, 1.5), breathHz: between(0.22, 0.3),
    armCarry: between(-0.2, 0.25), lean: between(-0.04, 0.08),
    flair: between(0.6, 1.4), // how big the finish of a stroke is
    serveBounces: 2 + Math.floor(r() * 2), servePeriod: between(0.38, 0.48),
    habits: FIDGET_NAMES.map(() => 0.3 + r()), // how much each habit appeals
    fidgety: between(0.6, 1.5), // how often
  };
}

// Small habits between points, layered over the standing pose like the reactions.
const FIDGETS = {
  // the strings: racket up in front, a look and a straightening tug at them
  strings: { dur: 2.4, pose(p, t) {
    const u = Math.min(ease(t / 0.4), ease((2.4 - t) / 0.4)), tug = Math.max(0, Math.sin(t * 9)) * (t > 0.6 && t < 1.9 ? 1 : 0);
    p.rShX += (0.85 - p.rShX) * u; p.rShZ += (0.15 - p.rShZ) * u; p.rElbow += (1.75 - p.rElbow) * u;
    p.lShX += (0.95 - p.lShX) * u; p.lShZ += (0.05 - p.lShZ) * u; p.lElbow += (1.85 + 0.2 * tug - p.lElbow) * u;
    p.headX += 0.35 * u; p.torsoX += 0.05 * u;
    p.rkW = 1 - u; p.lGrip = 1 - u; p.lThroat = 1 - u;
  } },
  // a wipe of the brow with the wristband
  wipe: { dur: 1.6, pose(p, t) {
    const u = Math.min(ease(t / 0.3), ease((1.6 - t) / 0.35)), sweep = Math.sin(clamp((t - 0.35) / 0.8, 0, 1) * Math.PI);
    p.lShX += (1.95 - p.lShX) * u; p.lShZ += (0.25 + 0.25 * sweep - p.lShZ) * u; p.lElbow += (2.45 - p.lElbow) * u;
    p.headX += 0.25 * u; p.headY += (sweep - 0.5) * 0.5 * u;
    p.lGrip = 1 - u; p.lThroat = 1 - u;
  } },
  // loosen up: a twist of the back each way and a roll of the shoulders
  loosen: { dur: 2.2, pose(p, t) {
    const u = Math.min(ease(t / 0.3), ease((2.2 - t) / 0.4)), tw = Math.sin(t * 5.4);
    p.torsoY += 0.38 * tw * u; p.headY -= 0.2 * tw * u;
    p.lShX += 0.25 * Math.max(0, Math.sin(t * 5.4 + 1)) * u; p.rShX += 0.25 * Math.max(0, Math.sin(t * 5.4 + 2.5)) * u;
    p.lGrip = 1 - u; p.lThroat = 1 - u;
  } },
  // a breath and a look up, then back to business
  lookUp: { dur: 1.9, pose(p, t) {
    const u = Math.min(ease(t / 0.45), ease((1.9 - t) / 0.5));
    p.headX -= 0.45 * u; p.headY += 0.25 * Math.sin(t * 1.6) * u; p.torsoX -= 0.08 * u;
    p.lShX -= 0.1 * u; p.rShX -= 0.05 * u;
  } },
  // up on the toes, staying lively
  toes: { dur: 1.8, pose(p, t) {
    const u = Math.min(ease(t / 0.2), ease((1.8 - t) / 0.3));
    p.lift += 0.03 * Math.abs(Math.sin(t * 9)) * u;
    p.lKnee += 0.08 * Math.sin(t * 18) * u; p.rKnee += 0.08 * Math.sin(t * 18) * u;
  } },
};
const FIDGET_NAMES = Object.keys(FIDGETS);

export function createCharacter(options = {}) {
  // a MakeHuman body when one is given (see rig.js), else the code-built figure
  const rig = options.body ? createBodyRig(options.body, options) : createFigure({ racket: true, ...options });
  const loco = makePose(), run = makePose(), idle = makePose(), shuffle = makePose(), clip = makePose(), out = makePose();
  const slidePose = makePose(), tmp = makePose();
  let time = Math.random() * 10;
  let phase = 0, shufflePhase = 0;
  let runBlend = 0, shuffleBlend = 0, slideBlend = 0, legBlend = 0;
  // stepping along the baseline before a serve, and the time since the server last stood still
  let serveStepBlend = 0, serveStill = 0;
  let gaitU = 0, backU = 0, backBlend = 0, restBlend = 0, prepBlend = 0;
  const prepPose = makePose();
  const gw = [0, 0, 0, 0];
  let yaw = 0, yawRate = 0;
  let actionBlend = 0;
  let held = null;
  // the reaction in progress, and a racket thrown to the ground
  let emote = null, emoteT = 0, onEmoteEvent = null;
  // the face: current expression weights, and the blink clock
  const face = { smile: 0, shout: 0, grimace: 0, sad: 0, blink: 0 };
  let blinkIn = 1 + Math.random() * 3, blinkT = 1;
  let faceOverride = null; // a set face (checks, or a cutscene that wants a particular look)
  const emotePose = makePose();
  let thrown = null;
  let lastFwd = 0, lastSide = 0, accFwd = 0, accSide = 0;
  let wasSliding = false, slideSide = 1, slideLateral = 1;
  let turnedRun = false; // turned around to chase a ball going over or past
  let splitT = 99;
  // smoothing: a short blend into each new action, and critically damped springs
  // on the body (the hitting arm stays exact while swinging, for clean contact)
  const entryFrom = makePose(), last = makePose(), spring = makePose(), springV = makePose();
  let prevActing = false;
  let prevAction = 'ready', prevT = 0, entryT = 1, springReady = false;
  // personal style; habits between points; this swing's own flavour; the serve's ball bounces
  const style = makeStyle(options.styleSeed);
  let fidget = null, fidgetT = 0, fidgetIn = 1.5 + Math.random() * 2;
  const swingVar = [0, 0, 0];
  let serveBallY = 0, serveBounced = -1, onServeBounce = null;

  const L = rig.legs || { thigh: BODY.thigh, shin: BODY.shin, hipX: BODY.hipHalfWidth };
  const feet = [0, 1].map(() => ({ x: 0, z: 0, fx: 0, fz: 0, t: -1, dur: 0.2, h: 0.05, c: 0 }));
  let feetReady = false, ikW = 0;
  const ik = makePose();
  const legDropOf = (flex, abduct, knee) => {
    const cz = Math.cos(abduct), cf = Math.cos(flex);
    return L.thigh * cz * cf + L.shin * (Math.cos(knee) * cz * cf + Math.sin(knee) * Math.sin(flex));
  };
  // where a foot would stand under the hips (world), body yaw th, side 0 left / 1 right
  const home = (s, th, side, width, out) => {
    const lx = (side === 0 ? 1 : -1) * width;
    const lz = L.hipZ || 0;
    out.x = s.x + lx * Math.cos(th) + lz * Math.sin(th);
    out.z = s.z - lx * Math.sin(th) + lz * Math.cos(th);
    return out;
  };
  const tmpH = { x: 0, z: 0 };
  function plantFeet(dt, s, speed, k, stride, sliding) {
    const th = s.facing + yaw + loco.hipsYaw;
    const width = L.hipX + 0.02 + 0.15 * (1 - k); // feet outside the shoulders standing, narrower running
    if (!feetReady) { feet.forEach((f, i) => { home(s, th, i, width, f); f.t = -1; }); feetReady = true; }
    // planting suits standing, adjusting steps and walking; a real run keeps its
    // natural stride (knee fold, kick-back, a moment in the air)
    const runFade = shuffleBlend > 0.5
      ? 1 - clamp((speed - ANIM.plantRunFrom) / (ANIM.plantRunTo - ANIM.plantRunFrom), 0, 1)
      : 1 - clamp((speed - ANIM.plantWalkFrom) / (ANIM.plantWalkTo - ANIM.plantWalkFrom), 0, 1); // captured gaits step on their own
    // turning on the spot: the feet step round with the body instead of staying put and crossing
    const turnFade = 1 - clamp((Math.abs(yawRate) - 1.2) / 1.8, 0, 1);
    ikW = smooth(ikW, sliding || held || !ANIM.footPlant ? 0 : Math.min(runFade, turnFade), 12, dt);
    if (ikW < 0.05) { feet.forEach((f, i) => { home(s, th, i, width, f); f.t = -1; }); }
    const moving = speed > 0.6;
    const gaitPhase = shuffleBlend > 0.5 ? shufflePhase : phase;
    const cycle = (shuffleBlend > 0.5 ? ANIM.shuffleStride : stride) / Math.max(speed, 0.6);
    const swingFrac = 0.5 + 0.15 * k;
    feet.forEach((f, i) => {
      const c = (((gaitPhase + Math.PI / 2) / (Math.PI * 2) + i * 0.5) % 1 + 1) % 1;
      const wrapped = c < f.c - 0.5; // the cycle came round: this foot's swing begins
      f.c = c;
      const other = feet[1 - i];
      if (f.t < 0) {
        let start = false, dur = 0.2, h = 0.04;
        if (moving && (wrapped || c < 0.05) && c < swingFrac) { start = true; dur = Math.max(0.12, swingFrac * cycle); h = 0.05 + 0.1 * k; }
        else if (!moving && other.t < 0) {
          home(s, th, i, width, tmpH);
          const err = Math.hypot(f.x - tmpH.x, f.z - tmpH.z);
          const otherErr = Math.hypot(other.x - home(s, th, 1 - i, width, { x: 0, z: 0 }).x, other.z - home(s, th, 1 - i, width, { x: 0, z: 0 }).z);
          if (err > 0.15 && err >= otherErr) { start = true; dur = 0.2; h = 0.035; } // a small adjusting step
        }
        if (start) { f.fx = f.x; f.fz = f.z; f.t = 0; f.dur = dur; f.h = h; }
      }
      f.lift = 0;
      if (f.t >= 0) {
        f.t += dt;
        const u = Math.min(1, f.t / f.dur);
        // land ahead of the hips by half a stance, where the body will be by then
        const left = Math.max(0, f.dur - f.t) + (moving ? (1 - swingFrac) * cycle * 0.5 : 0);
        home({ x: s.x + s.vx * left, z: s.z + s.vz * left }, th, i, width, tmpH);
        const e = u * u * (3 - 2 * u);
        f.x = f.fx + (tmpH.x - f.fx) * e;
        f.z = f.fz + (tmpH.z - f.fz) * e;
        f.lift = f.h * Math.sin(Math.PI * u);
        if (u >= 1) f.t = -1;
      }
    });
    // leg IK in the body frame; the hips sit at the animated height, lowered if a planted foot is far
    let H = Math.max(legDropOf(loco.lHip, loco.lHipZ, loco.lKnee), legDropOf(loco.rHip, loco.rHipZ, loco.rKnee));
    const reach = 0.985 * (L.thigh + L.shin);
    const local = feet.map((f, i) => {
      const hx = (i === 0 ? 1 : -1) * L.hipX;
      const wx = f.x - s.x, wz = f.z - s.z;
      const lx = wx * Math.cos(th) - wz * Math.sin(th) - hx;
      const lz = wx * Math.sin(th) + wz * Math.cos(th) - (L.hipZ || 0); // hip joints sit a little forward of the body's centre
      if (f.t < 0) H = Math.min(H, Math.sqrt(Math.max(0.01, reach * reach - lx * lx - lz * lz)));
      // a swinging leg follows its animated fold mid-swing, the IK only near lift-off and landing
      const w = f.t < 0 ? 1 : 1 - Math.sin(Math.PI * Math.min(1, f.t / f.dur));
      return { lx, lz, lift: f.lift || 0, w };
    });
    local.forEach(({ lx, lz, lift }, i) => {
      const dy = -(H - lift);
      const D = Math.min(reach, Math.hypot(lx, dy, lz));
      const ck = (D * D - L.thigh * L.thigh - L.shin * L.shin) / (2 * L.thigh * L.shin);
      const knee = Math.acos(Math.max(-1, Math.min(1, ck)));
      const Lc = L.thigh + L.shin * Math.cos(knee), Ls = L.shin * Math.sin(knee);
      const out2 = (i === 0 ? lx : -lx) / Math.max(0.05, Lc);
      const a = Math.asin(Math.max(-0.9, Math.min(0.9, out2)));
      const A = Lc * Math.cos(a);
      const flex = Math.atan2(lz, -dy) + Math.atan2(Ls, A);
      if (i === 0) { ik.lHip = flex; ik.lHipZ = a; ik.lKnee = knee; } else { ik.rHip = flex; ik.rHipZ = a; ik.rKnee = knee; }
    });
    ['lHip', 'lHipZ', 'lKnee'].forEach((key) => { loco[key] += (ik[key] - loco[key]) * ikW * local[0].w; });
    ['rHip', 'rHipZ', 'rKnee'].forEach((key) => { loco[key] += (ik[key] - loco[key]) * ikW * local[1].w; });
  }

  function update(dt, s) {
    time += dt;
    const speed = Math.hypot(s.vx, s.vz);
    const sf = Math.sin(s.facing), cf = Math.cos(s.facing);
    const fwd = s.vx * sf + s.vz * cf; // along the facing direction (toward the net)
    const side = s.vx * cf - s.vz * sf; // toward the figure's left
    // the server picking a spot on the baseline leaves the stance and walks there like
    // anyone would (turned to the way they are going), then turns back and settles
    const serveStepping = s.action === 'serveReady' && speed > 0.15;
    serveStepBlend = smooth(serveStepBlend, serveStepping ? 1 : 0, 10, dt);
    const acting = s.action && s.action !== 'ready' && CLIPS[s.action] && !serveStepping;
    const sliding = !!s.slide;
    if (s.action !== 'serveReady' || s.action !== prevAction || serveStepping) serveStill = 0;
    else serveStill += dt;

    // smoothed acceleration, for leaning into a sprint and back when braking
    if (dt > 0) {
      accFwd = smooth(accFwd, (fwd - lastFwd) / dt, 8, dt);
      accSide = smooth(accSide, (side - lastSide) / dt, 8, dt);
    }
    lastFwd = fwd; lastSide = side;

    // a slow sideways move is a side shuffle facing the net; faster ones turn and run
    const lateral = speed > 0.3 ? Math.abs(side) / speed : 0;
    const wantShuffle = !sliding && !acting && s.action !== 'serveReady' && speed > 0.3 && speed < ANIM.shuffleMax && lateral > 0.7 ? 1 : 0;
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
    const yawBefore = yaw;
    yaw = smooth(yaw, yawTarget, rate, dt);
    if (dt > 0) yawRate = smooth(yawRate, (yaw - yawBefore) / dt, 20, dt);
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
    idle.lGrip = 1; idle.lThroat = 1; // both hands on the racket, the free one on the throat
    // the racket points at the opponent, head up (chest frame: the chest leans forward)
    idle.rkX = 0.05; idle.rkY = 0.76; idle.rkZ = 0.66; idle.rkW = 1;
    const b = Math.sin(time * Math.PI * 2 * style.bounceHz) * style.bounceAmp;
    const sway = Math.sin(time * 0.9) * style.sway;
    idle.lKnee += b * 0.07 + style.crouch; idle.rKnee += b * 0.07 + style.crouch;
    idle.lHip += b * 0.035 + style.crouch * 0.5; idle.rHip += b * 0.035 + style.crouch * 0.5;
    idle.rShX += b * 0.03; idle.lShX += b * 0.03;
    idle.torsoZ = sway * 0.04; idle.hipsYaw = sway * 0.05; idle.headY = -sway * 0.05;
    idle.lift = Math.max(0, -b) * 0.012;
    // breathing: the chest rises and falls, faster when tired
    const breath = Math.sin(time * Math.PI * 2 * (style.breathHz + 0.45 * tiredness(s)));
    idle.torsoX += 0.018 * breath + style.lean; idle.headX -= 0.012 * breath;
    idle.lShX += 0.015 * breath; idle.rShX += 0.015 * breath;
    // tired: deep, slow breaths, a lower stance and a forward slump
    const tired = tiredness(s);
    if (tired > 0) {
      const breath = Math.sin(time * Math.PI * 2 * 0.85);
      idle.torsoX += tired * (0.22 + 0.08 * breath);
      idle.headX -= tired * 0.15;
      idle.lShX -= tired * 0.15; idle.rShX -= tired * 0.1;
      idle.lKnee += tired * 0.1; idle.rKnee += tired * 0.1;
    }

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

    // run cycle from motion capture: walk, jog, run and sprint cycles blended by
    // speed at one shared phase (each starts at the left foot's touchdown), with
    // the stride matched to the speed so the feet do not skate. Backwards it is a
    // captured backpedal. Leans, the head on the ball and the racket arm go on top.
    const k = clamp(speed / 6.2, 0, 1);
    const sn = Math.sin(phase);
    const legLen = L.thigh + L.shin;
    const amp = gaitWeights(speed, gw);
    let cyc = 0;
    for (let i = 0; i < GAITS.length; i++) cyc += gw[i] * GAITS[i].stride;
    cyc *= legLen * amp.stride * ANIM.gaitStride;
    backBlend = smooth(backBlend, dir < 0 && !acting ? 1 : 0, 8, dt);
    const backAmp = clamp(Math.sqrt(speed / BACK.speed), 0.5, 1.5);
    if (dir < 0) backU = (backU + speed * dt / (BACK.stride * legLen * backAmp * ANIM.gaitStride)) % 1;
    else gaitU = (gaitU + speed * dt / Math.max(0.3, cyc)) % 1;
    copyPose(run, READY);
    for (const key of GAIT_KEYS) {
      let v = 0;
      for (let i = 0; i < GAITS.length; i++) if (gw[i] > 0) v += gw[i] * scaled(GAITS[i], gaitU, key, amp.legs);
      if (backBlend > 0.001) v += (scaled(BACK, backU, key, backAmp) - v) * backBlend;
      run[key] = v;
    }
    run.lift *= legLen;
    // a tennis player moves low: bent knees and a forward lean at walking pace
    const athletic = 1 - clamp((speed - 1) / 3, 0, 1);
    run.lHip += 0.18 * athletic; run.rHip += 0.18 * athletic;
    run.lKnee += 0.3 * athletic; run.rKnee += 0.3 * athletic;
    run.torsoX += 0.12 * athletic;
    // lean into a sprint and back when braking, into the turn sideways
    run.torsoX += clamp(accFwd * 0.03, -0.3, 0.2);
    run.torsoZ += clamp(-accSide * 0.025, -0.25, 0.25);
    run.torsoY -= look * 0.15;
    // running away from the net, the head turns to keep an eye on the ball
    run.headY = clamp(-run.hipsYaw - run.torsoY - look * 0.5, -1.1, 1.1);
    run.headX -= 0.12 + 0.08 * k;
    // the racket arm carries the racket in front and swings half as much
    const rMean = gaitMean('rShX', gw, backBlend), eMean = gaitMean('rElbow', gw, backBlend);
    run.rShX = 0.4 + 0.5 * (run.rShX - rMean);
    run.rElbow = 1.2 + style.armCarry + 0.5 * (run.rElbow - eMean);
    run.torsoX += style.lean * k;
    run.rShZ = 0.2;

    // side shuffle: legs open and close, body stays square to the net
    const ss = Math.sin(shufflePhase);
    copyPose(shuffle, READY);
    shuffle.lHipZ = 0.24 + 0.2 * ss; shuffle.rHipZ = 0.24 - 0.2 * ss;
    shuffle.lKnee = 0.95 + 0.15 * Math.max(0, -ss); shuffle.rKnee = 0.95 + 0.15 * Math.max(0, ss);
    shuffle.lHip = 0.55; shuffle.rHip = 0.55;
    shuffle.torsoX = 0.35; shuffle.torsoZ = clamp(-side * 0.03, -0.12, 0.12);
    shuffle.lift = 0.035 * Math.abs(Math.sin(shufflePhase * 2));

    blendPose(loco, idle, run, runBlend);
    if (s.action === 'serveReady') {
      // walking to a serving spot: the free hand carries the ball, the racket hangs by the side
      loco.lGrip = 0; loco.lThroat = 0;
      loco.rShX = 0.12 + 0.12 * Math.sin(phase); loco.rShZ = 0.12; loco.rElbow = 0.35; loco.rkW = 0;
    }
    // spent between points: hands on the knees, catching breath
    restBlend = smooth(restBlend, s.resting && speed < 0.3 ? clamp((tired - 0.35) / 0.35, 0, 1) : 0, 3, dt);
    legBlend = smooth(legBlend, clamp(speed / 0.8, 0, 1) * (1 - shuffleBlend), 10, dt);
    for (const key of LEG_KEYS) loco[key] = idle[key] + (run[key] - idle[key]) * legBlend;
    if (shuffleBlend > 0.001) blendPose(loco, loco, shuffle, shuffleBlend);
    // charging a shot: the racket comes back and the body turns, ready to swing
    prepBlend = smooth(prepBlend, s.charge && !s.charge.serve && !acting ? 1 : 0, 9, dt);
    if (prepBlend > 0.001) {
      sampleClip(CLIPS[s.charge && s.charge.hand < 0 ? 'backhand' : 'forehand'], 0.0, prepPose);
      for (const key of UPPER_KEYS) loco[key] += (prepPose[key] - loco[key]) * prepBlend * 0.85;
    }
    if (restBlend > 0.001) {
      copyPose(tmp, HANDS_ON_KNEES);
      tmp.torsoX += 0.05 * Math.sin(time * Math.PI * 2 * 0.7); // heaving breaths
      blendPose(loco, loco, tmp, restBlend);
    }

    // ---- planted feet: each foot stays fixed on the court while it carries weight,
    // and steps (in an arc) to where the body will be; the legs reach their feet by IK
    plantFeet(dt, s, speed, k, stride, sliding);

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
      shapeStroke(clip, s);
      // no two swings alike: after contact the finish turns further or less, rises
      // higher or lower, and the knees drive more or less, around the player's own style
      if (STROKES.has(s.action) && s.actionT > SWING.ideal) {
        const u = ease((s.actionT - SWING.ideal) / 0.22) * style.flair;
        clip.torsoY += swingVar[0] * 0.16 * u;
        clip.rShX += swingVar[1] * 0.22 * u;
        clip.headX += swingVar[2] * 0.08 * u;
        const kd = swingVar[2] * 0.12 * u;
        clip.lKnee -= kd; clip.rKnee -= kd;
      }
      if (s.action === 'serveReady') {
        serveRitual(clip, Math.min(s.actionT, serveStill));
      }
      actionBlend = 1;
      copyPose(out, clip);
      // legs keep running, or sliding, if the player swings on the move
      const legW = DIVES.has(s.action) ? 1 : (1 - 0.8 * runBlend) * (1 - slideBlend);
      for (const key of LEG_KEYS) out[key] = loco[key] + (clip[key] - loco[key]) * legW;
    } else {
      // ease back from the last clip pose into locomotion
      actionBlend = Math.max(0, actionBlend - dt * 8);
      if (actionBlend > 0) blendPose(out, loco, clip, actionBlend);
      else copyPose(out, loco);
    }

    // a reaction between points, blended over the standing pose; moving off cuts it short
    if (emote) {
      emoteT += dt;
      const E = EMOTES[emote];
      if (acting || speed > 1.6 || emoteT >= E.dur) emote = null;
      else {
        copyPose(emotePose, out);
        E.pose(emotePose, emoteT);
        // the free hand leaves the racket and the racket stops aiming
        emotePose.lGrip = 0; emotePose.lThroat = 0; emotePose.rkW = 0;
        const env = Math.min(ease(emoteT / 0.18), ease((E.dur - emoteT) / 0.45));
        blendPose(out, out, emotePose, env);
        if (E.release && !thrown && emoteT >= E.release) throwRacket(s);
      }
    }
    if (thrown) stepThrown(dt);

    // habits between points, when standing still and not reacting
    const calm = !acting && !emote && !held && speed < 0.25 && restBlend < 0.2 && prepBlend < 0.05;
    if (fidget) {
      fidgetT += dt;
      const F = FIDGETS[fidget];
      if (!calm || fidgetT >= F.dur) fidget = null;
      else { copyPose(emotePose, out); F.pose(emotePose, fidgetT); blendPose(out, out, emotePose, Math.min(1, fidgetT / 0.12)); }
    } else if (calm && s.resting) {
      fidgetIn -= dt * 1.6 * style.fidgety;
      if (fidgetIn <= 0) {
        let total = 0;
        for (const w of style.habits) total += w;
        let pick = Math.random() * total, n = 0;
        while (n < FIDGET_NAMES.length - 1 && (pick -= style.habits[n]) > 0) n++;
        fidget = FIDGET_NAMES[n]; fidgetT = 0;
        fidgetIn = 2.5 + Math.random() * 3;
      }
    } else fidgetIn = Math.max(fidgetIn, 0.8);

    // the face: a blink every few seconds, effort through a stroke, and the reaction's expression
    if (rig.setExpression) {
      blinkIn -= dt;
      if (blinkIn <= 0) { blinkIn = 2 + Math.random() * 4; blinkT = 0; }
      blinkT += dt;
      const want = emote ? EMOTE_FACE[emote](emoteT) : acting ? { grimace: s.actionT < 0.5 ? 0.65 : 0.2 } : {};
      const k = Math.min(1, dt * 10);
      for (const name of ['smile', 'shout', 'grimace', 'sad']) face[name] += ((want[name] || 0) - face[name]) * k;
      face.blink = blinkT < 0.15 ? Math.sin((blinkT / 0.15) * Math.PI) : 0;
      rig.setExpression(faceOverride || face);
    }

    // blend into a new action from wherever the body was
    if (acting && (s.action !== prevAction || s.actionT < prevT || !prevActing)) {
      copyPose(entryFrom, last); entryT = 0;
      for (let n = 0; n < 3; n++) swingVar[n] = (Math.random() * 2 - 1);
      serveBounced = -1;
    }
    if (s.action !== 'serveReady') serveBallY = 0;
    prevAction = s.action; prevT = s.actionT; prevActing = !!acting;
    if (serveStepping) serveBounced = -1; // the ball bounces start again once settled
    if (entryT < 1) {
      entryT = Math.min(1, entryT + dt / ANIM.entryBlend);
      const u = entryT * entryT * (3 - 2 * entryT);
      blendPose(out, entryFrom, out, u);
    }
    // springs: the whole body when moving about, only the legs during a stroke
    if (!springReady) { copyPose(spring, out); springReady = true; }
    const w = ANIM.springFreq, steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (const key of POSE_KEYS) {
      if (acting && !LEG_SET.has(key)) { springV[key] = 0; spring[key] = out[key]; continue; } // strokes stay exact above the hips
      // planted feet: the legs come from the foot IK, already smooth; a lag would drag the feet
      if (!acting && ikW > 0.05 && (LEG_SET.has(key) || key === 'hipsYaw')) { springV[key] = 0; spring[key] = out[key]; continue; }
      let x = spring[key], v = springV[key];
      for (let n = 0; n < steps; n++) { v += (w * w * (out[key] - x) - 2 * w * v) * h; x += v * h; }
      spring[key] = x; springV[key] = v;
      out[key] = x;
    }
    copyPose(last, out);
    rig.setPose(out);
    rig.object3d.position.set(s.x, 0, s.z);
    rig.object3d.rotation.y = s.facing + yaw;
    if (out.rkW > 0.01 && rig.aimRacket) {
      // the chest's frame as the rig builds it: body turn, hips, then four spine bones
      chestQ.setFromAxisAngle(Y_AXIS, s.facing + yaw + out.hipsYaw);
      spineQ.setFromEuler(spineE.set(out.torsoX / 4, out.torsoY / 4, out.torsoZ / 4));
      for (let n = 0; n < 4; n++) chestQ.multiply(spineQ);
      rkDir.set(out.rkX, out.rkY, out.rkZ);
      if (rkDir.lengthSq() > 1e-4) rig.aimRacket(rkDir.normalize().applyQuaternion(chestQ), out.rkW);
      // reach: around contact the racket head goes to the ball (the toss for a serve)
      const reach = reachTarget(s, reachLocal);
      if (reach > 0.001 && rig.reachRacket) {
        reachWorld.copy(reachLocal).applyAxisAngle(Y_AXIS, s.facing);
        reachWorld.x += s.x; reachWorld.z += s.z;
        rig.reachRacket(reachWorld, reach * out.rkW);
      }
    }
    rig.applyGrip(out.lGrip, out.lThroat);
    if (rig.updateCloth) rig.updateCloth(dt);
  }

  // Before the serve: the ball bounced a few times, the player bent over it, the free
  // hand pushing it down and catching it; then still, eyes on the opponent. The ball's
  // drawn height comes from here (serveBallY, below the hand), the game's ball stays held.
  function serveRitual(p, t) {
    const start = 0.12, per = style.servePeriod, n = style.serveBounces;
    const into = clamp((t - start) / 0.25, 0, 1) * clamp((start + n * per + 0.3 - t) / 0.3, 0, 1);
    const k = ease(into);
    p.torsoX += 0.4 * k; p.headX += 0.3 * k;
    p.lKnee += 0.28 * k; p.rKnee += 0.28 * k; p.lHip += 0.16 * k; p.rHip += 0.16 * k;
    const c = (t - start) / per;
    serveBallY = 0;
    if (c >= 0 && c < n) {
      const u = c % 1, d = Math.abs(1 - 2 * u);
      serveBallY = (SERVE_CFG.handY - 0.05) * (Math.pow(d, 0.75) - 1); // down to the court and back
      const push = Math.pow(d, 6); // the hand dips to push the ball down and to catch it
      p.lShX -= 0.18 * push; p.lElbow -= 0.35 * push;
      const i = Math.floor(c);
      if (u >= 0.5 && serveBounced < i) { serveBounced = i; if (onServeBounce) onServeBounce(); }
    }
  }

  // The racket leaves the hand: a copy flies from where it was, tumbles to the court
  // and lies there until the next point, when the real one is back in the hand.
  function throwRacket(s) {
    const racket = rig.racket, scene = rig.object3d.parent;
    if (!racket || !scene) return;
    racket.updateMatrixWorld(true);
    const copy = racket.clone();
    racket.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
    scene.add(copy);
    racket.visible = false;
    const face = s.facing + yaw;
    thrown = {
      obj: copy, landed: 0,
      v: new THREE.Vector3(Math.sin(face) * 2.6, -4.5, Math.cos(face) * 2.6),
      w: new THREE.Vector3(9 + Math.random() * 4, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4),
      rest: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, Math.random() * Math.PI * 2, 0, 'YXZ')),
    };
  }
  const spinQ = new THREE.Quaternion(), spinE = new THREE.Euler();
  function stepThrown(dt) {
    const T = thrown, o = T.obj;
    if (T.landed > 1) { o.quaternion.slerp(T.rest, Math.min(1, dt * 6)); return; }
    T.v.y -= 9.8 * dt;
    o.position.addScaledVector(T.v, dt);
    spinQ.setFromEuler(spinE.set(T.w.x * dt, T.w.y * dt, T.w.z * dt));
    o.quaternion.multiply(spinQ);
    if (o.position.y < 0.06 && T.v.y < 0) {
      o.position.y = 0.06;
      if (onEmoteEvent && T.landed === 0) onEmoteEvent({ type: 'racketDown', x: o.position.x, z: o.position.z, speed: -T.v.y });
      T.v.y *= -0.32; T.v.x *= 0.55; T.v.z *= 0.55; T.w.multiplyScalar(0.4);
      T.landed++;
      if (T.landed > 1) { o.position.y = 0.03; T.v.set(0, 0, 0); }
    }
  }
  function endEmote() {
    emote = null;
    if (thrown) { thrown.obj.removeFromParent(); thrown = null; }
    if (rig.racket) rig.racket.visible = true;
  }

  const headLocal = new THREE.Vector3();
  return {
    object3d: rig.object3d,
    setPose(name) { held = name; },
    // a reaction between points (EMOTES); endEmote() puts everything back for the next point
    emote(name) { if (!EMOTES[name]) return; if (thrown) endEmote(); emote = name; emoteT = 0; },
    endEmote,
    onEmoteEvent(fn) { onEmoteEvent = fn; },
    setRacketVisible(v) { if (rig.racket) rig.racket.visible = v; },
    // hold a face (morph weights by name), or null to let the character's own face run
    setFace(w) { faceOverride = w; },
    get emoting() { return emote; },
    update,
    splitStep() { splitT = 0; },
    // the serve's ball bounce: drawn height offset of the held ball, and a callback as it hits the court
    get serveBallY() { return serveBallY; },
    // 0 to 1: how far the server is walking to a new spot (the ball is then carried in the hand)
    get serveCarry() { return serveStepBlend; },
    onServeBounce(fn) { onServeBounce = fn; },
    // start a habit now (FIDGETS; for cutscenes and checks)
    habit(name) { if (FIDGETS[name]) { fidget = name; fidgetT = 0; } },
    feet, // the foot planner's state (for checks)
    get lastPose() { return last; }, // the pose last applied (for checks)
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
