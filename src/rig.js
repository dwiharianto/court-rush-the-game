// A player built on a MakeHuman body (see body.js and tools/build-bodies.mjs),
// with the same interface as the code-built figure in human.js:
//   object3d, racket, leftHand, pose, setPose(pose, { plant }), applyGrip(w)
// so every animation clip and pose keeps working unchanged.
//
// How poses map onto the skeleton: the figure's joints rotate about the world's
// axes from a neutral stance (arms and legs hanging straight). Each bone here
// knows its neutral orientation N (the MakeHuman rest pose has the arms out in an
// A, so the arms and legs get one), and a joint rotation E becomes the local
// rotation  N(parent)^-1 * E * N(bone).
import * as THREE from 'three';
import { makePose, copyPose, buildRacket, GRIP_POINT } from './human.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion();
const e1 = new THREE.Euler();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = (c) => new THREE.Color(c);

// ------------------------------------------------------------------ per body, computed once
const prepared = new WeakMap();
function prepare(body) {
  if (prepared.has(body)) return prepared.get(body);
  const { arrays, bones, parts: P } = body;
  // smooth normals of the rest mesh, used to give clothes and hair some volume
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arrays.position), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(arrays.index), 1));
  g.computeVertexNormals();
  const normal = g.getAttribute('normal').array;

  // shoes: smooth the feet (the toes merge into one shape) before the kit adds volume
  const shoe = new Float32Array(arrays.position);
  {
    const isFoot = (i) => arrays.part[i] === P.foot;
    const nb = new Map();
    const idx = arrays.index;
    for (let t = 0; t < idx.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = idx[t + k], b = idx[t + (k + 1) % 3];
        if (!isFoot(a)) continue;
        if (!nb.has(a)) nb.set(a, new Set());
        nb.get(a).add(b);
        if (isFoot(b)) { if (!nb.has(b)) nb.set(b, new Set()); nb.get(b).add(a); }
      }
    }
    const tmp = new Float32Array(shoe.length);
    for (let it = 0; it < 12; it++) {
      tmp.set(shoe);
      for (const [i, set] of nb) {
        if (arrays.along[i] / 255 < 0.06) continue; // keep the sole flat on the ground
        let x = 0, y = 0, z = 0;
        for (const j of set) { x += shoe[j * 3]; y += shoe[j * 3 + 1]; z += shoe[j * 3 + 2]; }
        const n = set.size;
        tmp[i * 3] = shoe[i * 3] * 0.4 + (x / n) * 0.6;
        tmp[i * 3 + 1] = Math.max(shoe[i * 3 + 1] * 0.4 + (y / n) * 0.6, 0.004);
        tmp[i * 3 + 2] = shoe[i * 3 + 2] * 0.4 + (z / n) * 0.6;
      }
      shoe.set(tmp);
    }
  }

  const byName = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const head = (n) => new THREE.Vector3(...bones[byName[n]].head);
  // neutral orientation of every bone (world): limbs hang straight down
  const N = bones.map(() => new THREE.Quaternion());
  const straight = (bone, from, to, followers) => {
    const q = new THREE.Quaternion().setFromUnitVectors(v1.subVectors(head(to), head(from)).normalize(), DOWN);
    N[byName[bone]].copy(q);
    for (const f of followers) N[byName[f]].copy(q);
  };
  const fingers = (s) => [1, 2, 3, 4, 5].flatMap((f) => [1, 2, 3].map((k) => `finger${f}-${k}.${s}`));
  for (const s of ['L', 'R']) {
    straight(`upperarm01.${s}`, `upperarm01.${s}`, `lowerarm01.${s}`, [`upperarm02.${s}`]);
    straight(`lowerarm01.${s}`, `lowerarm01.${s}`, `wrist.${s}`, [`lowerarm02.${s}`, `wrist.${s}`, ...fingers(s)]);
    straight(`upperleg01.${s}`, `upperleg01.${s}`, `lowerleg01.${s}`, [`upperleg02.${s}`]);
    straight(`lowerleg01.${s}`, `lowerleg01.${s}`, `foot.${s}`, [`lowerleg02.${s}`]);
  }
  // finger curl axes (neutral world frame): bending toward the palm
  const curl = {};
  for (const s of ['L', 'R']) {
    const Nh = N[byName[`wrist.${s}`]];
    const at = (n) => head(n).applyQuaternion(Nh);
    const across = new THREE.Vector3().subVectors(at(`finger2-1.${s}`), at(`finger5-1.${s}`));
    const along = new THREE.Vector3().subVectors(at(`finger3-1.${s}`), at(`wrist.${s}`)).normalize();
    const palm = new THREE.Vector3().crossVectors(across, along).normalize();
    if (Math.sign(palm.x) === (s === 'L' ? 1 : -1)) palm.negate(); // palms face the body
    for (let f = 1; f <= 5; f++) {
      for (let k = 1; k <= 3; k++) {
        const n = `finger${f}-${k}.${s}`;
        const b = bones[byName[n]];
        const dir = new THREE.Vector3(...b.tail).sub(new THREE.Vector3(...b.head)).applyQuaternion(Nh).normalize();
        curl[n] = new THREE.Vector3().crossVectors(dir, palm).normalize();
      }
    }
    curl[`palm.${s}`] = palm;
  }
  // leg geometry for keeping the feet on the ground
  const seg = (a, b) => head(a).distanceTo(head(b));
  const legs = {
    thigh: seg('upperleg01.L', 'lowerleg01.L'),
    shin: seg('lowerleg01.L', 'foot.L'),
    ankle: head('foot.L').y,
    hipJoint: head('upperleg01.L').y,
  };
  legs.neutralHip = legs.thigh + legs.shin + legs.ankle; // hip joint height, legs straight
  const rootY = head('root').y;
  // head landmarks, for headwear and hair pieces
  let top = 0, back = 1;
  for (let i = 0; i < arrays.part.length; i++) {
    if (arrays.part[i] !== P.scalp) continue;
    top = Math.max(top, arrays.position[i * 3 + 1]);
    back = Math.min(back, arrays.position[i * 3 + 2]);
  }
  const eyeY = (body.eyes.l[1] + body.eyes.r[1]) / 2, eyeZ = (body.eyes.l[2] + body.eyes.r[2]) / 2;
  const headInfo = { top, back, eyeY, eyeZ, front: body.frontZ, centre: new THREE.Vector3(0, (eyeY + top) / 2 - 0.005, (back + body.frontZ) / 2 - 0.012) };
  const out = { normal, shoe, byName, N, curl, legs, rootY, headInfo, head };
  prepared.set(body, out);
  return out;
}

// ------------------------------------------------------------------ kit colours
const DEFAULT_KIT = {
  skin: 0xd9a37c, hair: 0x2a1d14, hairStyle: 'short', headwear: 'none', headwearColor: 0xffffff,
  shirt: 0x2f9e58, shorts: 0x2452a6, shoes: 0xf2f2f2, socks: 0xffffff, sole: 0x9aa0a8,
  longSleeves: false, trousers: false, racketColor: 0x1d1f24, gripColor: 0xf0f0f0,
};
const SCALP = { none: 0, buzz: 0.003, short: 0.011, long: 0.013, curly: 0.026 };

function paint(body, prep, o, dressed = false, hairMesh = false) {
  const { arrays, parts: P } = body;
  const n = arrays.part.length;
  const pos = new Float32Array(arrays.position);
  const col = new Float32Array(n * 3);
  const skin = hex(o.skin), hair = hex(o.hair), shirt = hex(o.shirt), shorts = hex(o.shorts);
  const shoes = hex(o.shoes), socks = hex(o.socks), sole = hex(o.sole);
  const brows = hex(o.hair).lerp(skin, 0.45); // soft, not painted on
  const lips = skin.clone().multiply(hex(0xd88a86));
  const white = hex(0xf2efe8), iris = hex(0x3b2a1c), pupil = hex(0x0b0b0b);
  const sleeve = o.longSleeves ? 1.01 : 0.42, shortLen = o.trousers ? 1.01 : 0.58;
  const scalpLift = SCALP[o.hairStyle] ?? SCALP.short;
  const eyes = [new THREE.Vector3(...body.eyes.l), new THREE.Vector3(...body.eyes.r)];
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const part = arrays.part[i], t = arrays.along[i] / 255;
    let lift = 0;
    switch (part) {
      case P.scalp:
        if (o.hairStyle === 'none') c.copy(skin);
        else { c.copy(hair); lift = scalpLift * (0.6 + 0.4 * clamp((pos[i * 3 + 1] - prep.headInfo.eyeY) / 0.12, 0, 1)); }
        break;
      case P.brows: c.copy(brows); break;
      case P.lips: c.copy(lips); break;
      case P.eye: {
        const e = pos[i * 3] > 0 ? eyes[0] : eyes[1];
        const fz = (pos[i * 3 + 2] - e.z) / 0.012; // how far forward on the eyeball
        c.copy(fz > 0.975 ? pupil : fz > 0.9 ? iris : white);
        break;
      }
      case P.torso:
        if (t > 0.2) { c.copy(shirt); lift = 0.005; } else { c.copy(shorts); lift = 0.008; }
        break;
      case P.pelvis: c.copy(shorts); lift = 0.009; break;
      case P.upperarm: if (t < sleeve) { c.copy(shirt); lift = 0.005 + 0.004 * t; } else c.copy(skin); break;
      case P.forearm: if (o.longSleeves) { c.copy(shirt); lift = 0.005; } else c.copy(skin); break;
      case P.thigh:
        if (t < shortLen) { c.copy(shorts); lift = 0.009 + (o.trousers ? 0 : 0.012 * t); } else c.copy(skin);
        break;
      case P.shin:
        if (o.trousers) { c.copy(shorts); lift = 0.008; } else if (t > 0.8) { c.copy(socks); lift = 0.002; } else c.copy(skin);
        break;
      case P.foot:
        c.copy(t < 0.16 ? sole : shoes);
        if (!dressed) for (let k = 0; k < 3; k++) pos[i * 3 + k] = prep.shoe[i * 3 + k];
        lift = 0.016;
        break;
      default: c.copy(skin);
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    if (dressed && part !== P.scalp) {
      lift = 0; // the real garments carry the volume and colour; skin shows at the edges
      if ([P.torso, P.pelvis, P.upperarm, P.forearm, P.thigh, P.shin, P.foot].includes(part)) c.copy(skin);
      // skin that the clothes cover sits a little inside them, so it cannot poke through as limbs bend
      if (part === P.torso || part === P.pelvis || part === P.foot || (part === P.upperarm && t < 0.5) || (part === P.thigh && t < 0.6)) lift = -0.008;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    if (hairMesh && part === P.scalp) lift = 0.002;
    if (lift) for (let k = 0; k < 3; k++) pos[i * 3 + k] += prep.normal[i * 3 + k] * lift;
  }
  return { pos, col };
}

// ------------------------------------------------------------------ the rig
export function createBodyRig(body, options = {}) {
  const o = { ...DEFAULT_KIT, ...options };
  const prep = prepare(body);
  const { arrays, bones: B } = body;
  const { N, byName, curl, legs } = prep;

  // real garments (MakeHuman CC0 assets fitted to this body, see body.js) when loaded
  const kit = o.kit || null;
  const hairKey = { short: 'short', long: 'long', curly: 'curly' }[o.hairStyle];
  // under a cap short and curly hair is painted on; a ponytail still shows
  const hairGarment = kit && hairKey && !(o.headwear === 'cap' && hairKey !== 'long') ? kit[hairKey] : null;
  const worn = kit ? [kit.outfit, kit.shoes].filter(Boolean) : [];
  const { pos, col } = paint(body, prep, o, worn.length > 0, !!hairGarment);
  const hidden = new Set();
  for (const g of worn) for (const v of g.arrays.hidden) hidden.add(v);
  let bodyIndex = arrays.index;
  if (hidden.size) {
    const keep = [];
    for (let t = 0; t < bodyIndex.length; t += 3) {
      const a = bodyIndex[t], b = bodyIndex[t + 1], c = bodyIndex[t + 2];
      if (hidden.has(a) || hidden.has(b) || hidden.has(c)) continue; // skin under the clothes
      keep.push(a, b, c);
    }
    bodyIndex = keep;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(arrays.skinIndex), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from(arrays.skinWeight, (w) => w / 255), 4));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(bodyIndex), 1));
  // normals from the whole body, so the edges where clothes begin stay smooth
  const full = geo.clone();
  full.setIndex(new THREE.BufferAttribute(new Uint16Array(arrays.index), 1));
  full.computeVertexNormals();
  geo.setAttribute('normal', full.getAttribute('normal'));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = true;
  mesh.frustumCulled = false;

  // bones at their rest heads, unrotated
  const bones = B.map((b) => { const bone = new THREE.Bone(); bone.name = b.name; return bone; });
  B.forEach((b, i) => {
    const p = new THREE.Vector3(...b.head);
    if (b.parent >= 0) { p.sub(new THREE.Vector3(...B[b.parent].head)); bones[b.parent].add(bones[i]); }
    bones[i].position.copy(p);
  });
  const root = bones[byName.root];
  const rest = bones.map((b) => b.position.clone());
  mesh.add(root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  const object3d = new THREE.Group();
  object3d.add(mesh);

  // garments: skinned meshes on the same skeleton
  const skeleton = mesh.skeleton;
  const garment = (g, material, colourOf) => {
    const A = g.arrays;
    const n = A.position.length / 3;
    const ge = new THREE.BufferGeometry();
    ge.setAttribute('position', new THREE.BufferAttribute(new Float32Array(A.position), 3));
    ge.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(A.uv), 2));
    ge.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(A.skinIndex), 4));
    ge.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from(A.skinWeight, (w) => w / 255), 4));
    ge.setIndex(new THREE.BufferAttribute(A.index.constructor === Uint32Array ? new Uint32Array(A.index) : new Uint16Array(A.index), 1));
    if (colourOf) {
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colourOf(A.piece[i]).toArray(col, i * 3);
      ge.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    ge.computeVertexNormals();
    const m = new THREE.SkinnedMesh(ge, material);
    m.castShadow = true;
    m.frustumCulled = false;
    object3d.add(m);
    m.bind(skeleton, new THREE.Matrix4());
    return m;
  };
  if (kit && kit.outfit) {
    // T-shirt on top (piece 0), shorts and waistband below, in the player's colours;
    // the normal map keeps the fabric's folds, seams and hems
    const shirt = hex(o.shirt), shorts = hex(o.shorts);
    garment(kit.outfit, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.88, normalMap: kit.textures.outfitNormal, side: THREE.DoubleSide,
    }), (piece) => (piece === 0 ? shirt : shorts));
  }
  if (kit && kit.shoes) {
    // trainers in the chosen colour; the socks (top piece) stay white
    const shoe = hex(o.shoes), sock = hex(o.socks).multiplyScalar(1.45); // the texture is greyish under the socks
    garment(kit.shoes, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, map: kit.textures.shoes }),
      (piece) => (piece === 0 ? sock : shoe));
  }
  if (hairGarment) {
    garment(hairGarment, new THREE.MeshStandardMaterial({
      color: hex(o.hair).multiplyScalar(1.6), map: kit.textures[hairKey], alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.65,
    }));
  }
  const bone = (n) => bones[byName[n]];
  const Ninv = N.map((q) => q.clone().invert());
  const parentOf = B.map((b) => b.parent);
  // local rotation for joint rotation E (world axes from the neutral stance)
  const setJoint = (name, E) => {
    const i = byName[name], p = parentOf[i];
    bones[i].quaternion.copy(p >= 0 ? Ninv[p] : q3.identity()).multiply(E).multiply(N[i]);
  };
  const euler = (x, y, z, order = 'XYZ') => q1.setFromEuler(e1.set(x, y, z, order));

  // racket in the right fist; at the neutral stance it hangs straight down
  const fistOffset = (s) => {
    const palm = curl[`palm.${s}`];
    return new THREE.Vector3(0, -0.085, 0).addScaledVector(palm, 0.03);
  };
  let racket = null;
  const anchorR = new THREE.Object3D();
  anchorR.position.copy(fistOffset('R').applyQuaternion(Ninv[byName['wrist.R']]));
  anchorR.quaternion.copy(Ninv[byName['wrist.R']]);
  bone('wrist.R').add(anchorR);
  racket = buildRacket(o.racketColor, o.gripColor);
  anchorR.add(racket);
  const leftHand = new THREE.Object3D();
  leftHand.position.copy(fistOffset('L').applyQuaternion(Ninv[byName['wrist.L']]));
  bone('wrist.L').add(leftHand);

  addHeadwear(bone('head'), prep, o, !!hairGarment);
  if (!(kit && kit.shoes)) for (const side of ['L', 'R']) addShoe(bone(`foot.${side}`), body, prep, side, o);
  if (o.wristbands) for (const side of ['L', 'R']) addWristband(bone(`lowerarm01.${side}`), prep, side, o, Ninv[byName[`lowerarm01.${side}`]]);

  const current = makePose();
  const legDrop = (flex, abduct, knee) => {
    const cz = Math.cos(abduct), cf = Math.cos(flex);
    return legs.thigh * cz * cf + legs.shin * (Math.cos(knee) * cz * cf + Math.sin(knee) * Math.sin(flex));
  };
  const curlFingers = (s, amount, thumb) => {
    for (let f = 1; f <= 5; f++) {
      for (let k = 1; k <= 3; k++) {
        const n = `finger${f}-${k}.${s}`;
        const a = f === 1 ? thumb * [0.25, 0.45, 0.4][k - 1] : amount * [0.95, 1.15, 0.75][k - 1];
        setJoint(n, q2.setFromAxisAngle(curl[n], a));
      }
    }
  };

  function setPose(pose, { plant = true } = {}) {
    const p = copyPose(current, pose);
    // legs
    setJoint('upperleg01.L', euler(-p.lHip, 0, p.lHipZ));
    setJoint('upperleg01.R', euler(-p.rHip, 0, -p.rHipZ));
    setJoint('lowerleg01.L', euler(p.lKnee, 0, 0));
    setJoint('lowerleg01.R', euler(p.rKnee, 0, 0));
    setJoint('foot.L', euler(p.lHip - p.lKnee, 0, 0));
    setJoint('foot.R', euler(p.rHip - p.rKnee, 0, 0));
    for (const n of ['upperleg02.L', 'upperleg02.R', 'lowerleg02.L', 'lowerleg02.R', 'upperarm02.L', 'upperarm02.R', 'lowerarm02.L', 'lowerarm02.R', 'pelvis.L', 'pelvis.R', 'spine05', 'shoulder01.L', 'shoulder01.R']) setJoint(n, q2.identity());
    // hips: height from the legs so the lower foot stays on the ground
    const rootBone = bones[byName.root];
    rootBone.position.copy(rest[byName.root]);
    if (plant) {
      const drop = Math.max(legDrop(p.lHip, p.lHipZ, p.lKnee), legDrop(p.rHip, p.rHipZ, p.rKnee));
      rootBone.position.y = prep.rootY - (legs.neutralHip - legs.ankle - drop) + p.lift;
    } else {
      rootBone.position.y = prep.rootY - (legs.hipJoint - p.hipY) + p.lift;
    }
    setJoint('root', euler(0, p.hipsYaw, 0));
    // spine: the twist, lean and side lean spread over four vertebrae
    for (const n of ['spine04', 'spine03', 'spine02', 'spine01']) setJoint(n, euler(p.torsoX * 0.25, p.torsoY * 0.25, p.torsoZ * 0.25));
    setJoint('neck01', euler(p.headX * 0.4, p.headY * 0.4, 0));
    setJoint('neck02', q2.identity());
    setJoint('neck03', q2.identity());
    setJoint('head', euler(p.headX * 0.6, p.headY * 0.6, 0));
    // arms; the collarbones lift when an arm goes above the shoulder
    setJoint('clavicle.L', euler(0, 0, clamp(p.lShZ - 1.3, 0, 1.6) * 0.3));
    setJoint('clavicle.R', euler(0, 0, -clamp(p.rShZ - 1.3, 0, 1.6) * 0.3));
    setJoint('upperarm01.L', euler(-p.lShX, -p.lShY, p.lShZ, 'YXZ'));
    setJoint('upperarm01.R', euler(-p.rShX, p.rShY, -p.rShZ, 'YXZ'));
    setJoint('lowerarm01.L', euler(-p.lElbow, 0, 0));
    setJoint('lowerarm01.R', euler(-p.rElbow, 0, 0));
    setJoint('wrist.L', q2.identity());
    setJoint('wrist.R', euler(p.rWristX, p.rWristY, p.rWristZ));
    curlFingers('R', 1, 1); // gripping the racket
    curlFingers('L', 0.35 + 0.75 * clamp(p.lGrip, 0, 1), 0.4 + 0.5 * clamp(p.lGrip, 0, 1));
  }

  // two-bone IK: the left hand onto the racket handle, blended by w
  const L1 = prep.head('upperarm01.L').distanceTo(prep.head('lowerarm01.L'));
  const L2 = prep.head('lowerarm01.L').distanceTo(prep.head('wrist.L')) + fistOffset('L').length() * 0.9;
  const ik = { s: new THREE.Vector3(), t: new THREE.Vector3(), d: new THREE.Vector3(), pole: new THREE.Vector3(), u: new THREE.Vector3(), e: new THREE.Vector3(), f: new THREE.Vector3(), now: new THREE.Vector3() };
  const aimBone = (b, from, toNow, toWant, w) => {
    // rotate bone b (world) so the direction from -> toNow points along toWant
    v2.subVectors(toNow, from).normalize();
    q1.setFromUnitVectors(v2, toWant);
    b.getWorldQuaternion(q2);
    q1.multiply(q2);
    b.parent.getWorldQuaternion(q3).invert();
    q3.multiply(q1);
    b.quaternion.slerp(q3, w);
    b.updateMatrixWorld(true);
  };
  function applyGrip(w) {
    if (w <= 0.001) return;
    object3d.updateMatrixWorld(true);
    const up = bone('upperarm01.L'), low = bone('lowerarm01.L');
    up.getWorldPosition(ik.s);
    ik.t.copy(GRIP_POINT).applyMatrix4(racket.matrixWorld);
    ik.d.subVectors(ik.t, ik.s);
    const len = ik.d.length() || 1;
    ik.d.divideScalar(len);
    const d = Math.min(Math.max(len, 0.08), (L1 + L2) * 0.999);
    const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    ik.pole.set(0.55, -1, -0.25).transformDirection(object3d.matrixWorld);
    ik.pole.addScaledVector(ik.d, -ik.pole.dot(ik.d)).normalize();
    ik.u.copy(ik.d).multiplyScalar(Math.cos(a)).addScaledVector(ik.pole, Math.sin(a));
    low.getWorldPosition(ik.now);
    aimBone(up, ik.s, ik.now, ik.u, w);
    low.getWorldPosition(ik.e);
    leftHand.getWorldPosition(ik.now);
    ik.f.subVectors(ik.t, ik.e).normalize();
    aimBone(low, ik.e, ik.now, ik.f, w);
  }

  setPose(makePose());
  // leg geometry for the foot planner (human.js): thigh, shin, hip joints' sideways offset
  const legInfo = { thigh: legs.thigh, shin: legs.shin, hipX: Math.abs(prep.head('upperleg01.L').x - prep.head('root').x), hipZ: prep.head('upperleg01.L').z };
  return { object3d, racket, leftHand, pose: current, setPose, applyGrip, mesh, legs: legInfo };
}

// A trainer on each foot: a rounded upper and a sole, sized from the foot itself
// and riding on the foot bone, so no toes show through.
function addShoe(footBone, body, prep, side, o) {
  const { arrays, parts: P } = body;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const v = new THREE.Vector3();
  for (let i = 0; i < arrays.part.length; i++) {
    if (arrays.part[i] !== P.foot) continue;
    v.fromArray(arrays.position, i * 3);
    if ((v.x >= 0) !== (side === 'L')) continue;
    if (arrays.along[i] / 255 > 0.85) continue; // the ankle stays out of the shoe
    min.min(v); max.max(v);
  }
  const origin = prep.head(`foot.${side}`);
  const size = new THREE.Vector3().subVectors(max, min);
  const centre = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5).sub(origin);
  // upper: a sphere stretched over the foot, with its underside cut flat
  const g = new THREE.SphereGeometry(1, 24, 14);
  const pa = g.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    const y = Math.max(pa.getY(i), -0.55);
    const z = pa.getZ(i);
    // toe box lower than the heel collar
    pa.setXYZ(i, pa.getX(i), y * (z > 0 ? 0.82 : 1), z);
  }
  g.computeVertexNormals();
  const hx = size.x / 2 + 0.013, hy = size.y / 2 + 0.012, hz = size.z / 2 + 0.016;
  const upper = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: o.shoes, roughness: 0.55 }));
  upper.scale.set(hx, hy, hz);
  upper.position.copy(centre).add(new THREE.Vector3(0, hy * 0.55 - size.y / 2 + 0.004, 0.004));
  upper.castShadow = true;
  footBone.add(upper);
  const sg = new THREE.CylinderGeometry(1, 1, 1, 24);
  const sole = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: o.sole, roughness: 0.8 }));
  sole.scale.set(hx * 1.02, 0.018, hz * 1.02);
  sole.position.set(centre.x, min.y - origin.y + 0.007, centre.z + 0.004);
  sole.castShadow = true;
  footBone.add(sole);
}

// cap, headband and ponytail ride on the head bone
// Terry wristband near the wrist, on the forearm bone.
function addWristband(armBone, prep, side, o, Ninv) {
  const a = prep.head(`lowerarm01.${side}`), b = prep.head(`wrist.${side}`);
  const len = a.distanceTo(b);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.07, 18, 1, true),
    new THREE.MeshStandardMaterial({ color: o.headwearColor, roughness: 0.95, side: THREE.DoubleSide }));
  // at the neutral stance the forearm hangs straight down: the band sits 0.08 m above the wrist
  band.position.set(0, -(len - 0.065), 0).applyQuaternion(Ninv);
  band.quaternion.copy(Ninv);
  band.castShadow = true;
  armBone.add(band);
}

function addHeadwear(headBone, prep, o, hairMesh = false) {
  const h = prep.headInfo;
  const origin = prep.head('head');
  const at = (v) => v.clone().sub(origin);
  const c = at(h.centre);
  const r = Math.max(0.085, (h.top - h.centre.y) + 0.006);
  const hw = new THREE.MeshStandardMaterial({ color: o.headwearColor, roughness: 0.8 });
  const hairMat = new THREE.MeshStandardMaterial({ color: o.hair, roughness: 0.9 });
  if (o.headwear === 'cap') {
    const crown = new THREE.Mesh(new THREE.SphereGeometry(r + 0.008, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hw);
    crown.scale.set(0.98, 0.78, 1.08);
    crown.position.copy(c).add(new THREE.Vector3(0, 0.012, -0.004));
    crown.rotation.x = -0.12;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.006, 20, 1, false, -Math.PI / 2, Math.PI), hw);
    brim.scale.set(1, 1, 1.15);
    brim.position.copy(c).add(new THREE.Vector3(0, 0.02, (h.front - h.centre.z) - 0.035));
    brim.rotation.x = 0.16;
    for (const m of [crown, brim]) { m.castShadow = true; headBone.add(m); }
  } else if (o.headwear === 'visor') {
    // a band round the head and a brim, open on top
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.99, 0.014, 6, 28), hw);
    band.rotation.x = Math.PI / 2 - 0.12;
    band.scale.set(0.9, 1.06, 1.4);
    band.position.copy(c).add(new THREE.Vector3(0, 0.0, 0.004));
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.006, 20, 1, false, -Math.PI / 2, Math.PI), hw);
    brim.scale.set(1, 1, 1.15);
    brim.position.copy(c).add(new THREE.Vector3(0, -0.004, (h.front - h.centre.z) - 0.03));
    brim.rotation.x = 0.16;
    for (const m of [band, brim]) { m.castShadow = true; headBone.add(m); }
  } else if (o.headwear === 'headband') {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, 0.012, 8, 28), hw);
    band.rotation.x = Math.PI / 2 - 0.22;
    band.scale.set(0.9, 1.06, 1);
    band.position.copy(c).add(new THREE.Vector3(0, 0.022, 0.004));
    headBone.add(band);
  }
  if (hairMesh) return; // real hair is on
  if (o.hairStyle === 'long') {
    const pts = [[0.012, -0.21], [0.026, -0.15], [0.032, -0.07], [0.024, 0]].map(([x, y]) => new THREE.Vector2(x, y));
    const tail = new THREE.Mesh(new THREE.LatheGeometry(pts, 12), hairMat);
    tail.position.copy(at(new THREE.Vector3(0, h.centre.y + 0.01, h.back + 0.01)));
    tail.rotation.x = 0.35;
    tail.castShadow = true;
    headBone.add(tail);
  } else if (o.hairStyle === 'curly') {
    for (let i = 0; i < 16; i++) { // a bumpy outline of curls
      const a = (i / 16) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), hairMat);
      m.position.copy(c).add(new THREE.Vector3(Math.cos(a) * r * 0.92, 0.035 + Math.sin(i * 1.7) * 0.01, Math.sin(a) * r * 0.95));
      headBone.add(m);
    }
  }
}
