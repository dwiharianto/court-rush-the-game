// A player built on a MakeHuman body (see body.js and tools/build-bodies.mjs),
// with the same interface as the code-built figure in human.js:
//   object3d, racket, leftHand, pose, setPose(pose, { plant }), applyGrip(w), aimRacket(dir, w), reachRacket(target, w)
// so every animation clip and pose keeps working unchanged.
//
// How poses map onto the skeleton: the figure's joints rotate about the world's
// axes from a neutral stance (arms and legs hanging straight). Each bone here
// knows its neutral orientation N (the MakeHuman rest pose has the arms out in an
// A, so the arms and legs get one), and a joint rotation E becomes the local
// rotation  N(parent)^-1 * E * N(bone).
import * as THREE from 'three';
import { makePose, copyPose, buildRacket, GRIP_POINT, THROAT_POINT } from './human.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion();
const e1 = new THREE.Euler();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = (c) => new THREE.Color(c);

// ------------------------------------------------------------------ per body, computed once
// The body has copies of some vertices along the skin texture's seams (orig[] points back
// to the original). Lighting and smoothing work on the joined mesh, so the seams never show.
const origOf = (arrays) => arrays.orig || null;
function weldedIndex(arrays, index = arrays.index) {
  const o = origOf(arrays);
  return o ? Uint16Array.from(index, (i) => o[i]) : index;
}
function weldedNormals(pos, arrays, index = arrays.index) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(weldedIndex(arrays, index)), 1));
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal').array;
  const o = origOf(arrays);
  if (o) for (let j = 0; j < o.length; j++) if (o[j] !== j) for (let c = 0; c < 3; c++) nrm[j * 3 + c] = nrm[o[j] * 3 + c];
  return nrm;
}
const prepared = new WeakMap();
function prepare(body) {
  if (prepared.has(body)) return prepared.get(body);
  const { arrays, bones, parts: P } = body;
  // smooth normals of the rest mesh, used to give clothes and hair some volume
  const normal = weldedNormals(new Float32Array(arrays.position), arrays);

  // shoes: smooth the feet (the toes merge into one shape) before the kit adds volume
  const shoe = new Float32Array(arrays.position);
  {
    const isFoot = (i) => arrays.part[i] === P.foot;
    const nb = new Map();
    const idx = weldedIndex(arrays);
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
    const o = origOf(arrays);
    if (o) for (let j = 0; j < o.length; j++) if (o[j] !== j) for (let c = 0; c < 3; c++) shoe[j * 3 + c] = shoe[o[j] * 3 + c];
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

function paint(body, prep, o, dressed = false, hairMesh = false, textured = false) {
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
    // with the skin detail texture (stored around 0.8), colours step up to match; the
    // texture has its own lips, so they take the plain skin colour; the eyes have no texture
    if (textured && part !== P.eye) {
      if (part === P.lips) c.copy(skin);
      if (part === P.brows) c.copy(hex(o.hair).lerp(skin, 0.7)); // the texture's shading does the rest
      col[i * 3] = c.r * 1.25; col[i * 3 + 1] = c.g * 1.25; col[i * 3 + 2] = c.b * 1.25;
    }
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
  // the outfit: tee and shorts, or tank and pleated skirt
  const outfit = kit ? (o.bottoms === 'skirt' && kit.outfitSkirt ? kit.outfitSkirt : kit.outfit) : null;
  const worn = kit ? [outfit, kit.shoes].filter(Boolean) : [];
  // skin detail texture: pores, lips, the flush of the cheeks (MakeHuman, CC0)
  const skinMap = kit && arrays.uv && kit.textures[`skin_${body.gender}`];
  const { pos, col } = paint(body, prep, o, worn.length > 0, !!hairGarment, !!skinMap);
  const hidden = new Set();
  for (const g of worn) for (const v of g.arrays.hidden) hidden.add(v);
  const og = origOf(arrays);
  const base = (i) => (og ? og[i] : i);
  // skin under the clothes is left out; the eyes are drawn with their own material
  const skinTris = [], eyeTris = [];
  for (let t = 0; t < arrays.index.length; t += 3) {
    const a = arrays.index[t], b = arrays.index[t + 1], c = arrays.index[t + 2];
    if (hidden.has(base(a)) || hidden.has(base(b)) || hidden.has(base(c))) continue;
    (arrays.part[a] === body.parts.eye ? eyeTris : skinTris).push(a, b, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (arrays.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(arrays.uv), 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(arrays.skinIndex), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from(arrays.skinWeight, (w) => w / 255), 4));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array([...skinTris, ...eyeTris]), 1));
  geo.addGroup(0, skinTris.length, 0);
  geo.addGroup(skinTris.length, eyeTris.length, 1);
  // normals from the whole body, joined across the texture seams, so the edges where
  // clothes begin stay smooth
  geo.setAttribute('normal', new THREE.BufferAttribute(weldedNormals(pos, arrays), 3));
  // facial expressions: MakeHuman's expression units mixed into a few faces (see build-bodies.mjs)
  const E = body.expressions;
  if (E && arrays.exprIdx) {
    const nv = pos.length / 3;
    let k = 0;
    geo.morphAttributes.position = E.names.map((name, t) => {
      const a = new Float32Array(nv * 3);
      for (let e = 0; e < E.counts[t]; e++, k++) a.set(arrays.exprDelta.subarray(k * 3, k * 3 + 3), arrays.exprIdx[k] * 3);
      if (og) for (let j = 0; j < og.length; j++) if (og[j] !== j) for (let c = 0; c < 3; c++) a[j * 3 + c] = a[og[j] * 3 + c];
      const attr = new THREE.Float32BufferAttribute(a, 3);
      attr.name = name;
      return attr;
    });
    geo.morphTargetsRelative = true;
  }
  // skin: a soft sheen at grazing angles stands in for light scattering under the skin
  const mat = skinMap
    ? new THREE.MeshPhysicalMaterial({ vertexColors: true, map: skinMap, roughness: 0.6, metalness: 0, sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xffb090) })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
  const eyeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0 });
  const mesh = new THREE.SkinnedMesh(geo, [mat, eyeMat]);
  if (geo.morphAttributes.position) mesh.updateMorphTargets();
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
  let cloth = null;
  if (outfit) {
    // top (piece 0), shorts or skirt below, in the player's colours;
    // the normal map keeps the fabric's folds, seams and hems
    const shirt = hex(o.shirt), shorts = hex(o.shorts);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.88, normalMap: kit.textures.outfitNormal, side: THREE.DoubleSide,
    });
    const m = garment(outfit, material, (piece) => (piece === 0 ? shirt : shorts));
    cloth = createCloth(m, outfit.arrays, material);
  }
  if (kit && kit.shoes) {
    // trainers in the chosen colour; the socks (top piece) stay white
    const shoe = hex(o.shoes), sock = hex(o.socks).multiplyScalar(1.45); // the texture is greyish under the socks
    garment(kit.shoes, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, map: kit.textures.shoes }),
      (piece) => (piece === 0 ? sock : shoe));
  }
  if (hairGarment) {
    // hair: a sheen along the strands catches the light
    garment(hairGarment, new THREE.MeshPhysicalMaterial({
      color: hex(o.hair).multiplyScalar(1.6), map: kit.textures[hairKey], alphaTest: 0.45, side: THREE.DoubleSide,
      roughness: 0.55, sheen: 0.6, sheenRoughness: 0.35, sheenColor: hex(o.hair).lerp(new THREE.Color(0xffffff), 0.5),
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

  addHeadwear(bone('head'), prep, o, hairGarment, body);
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
    setJoint('foot.L', euler(p.lHip - p.lKnee + p.lAnkle, 0, 0)); // the sole level, plus the ankle
    setJoint('foot.R', euler(p.rHip - p.rKnee + p.rAnkle, 0, 0));
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
    setJoint('root', euler(0, p.hipsYaw, p.hipsRoll));
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
    if (plant) groundBody(p, rootBone);
  }

  // Ground contact. Normally the feet set the height (above). With groundW the body is
  // instead placed by its lowest point, `clearance` metres above the court (dives:
  // airborne, then lying, sitting and kneeling on it). Either way nothing goes through it.
  const contacts = [
    ['foot.L', legs.ankle * 0.9], ['foot.R', legs.ankle * 0.9],
    ['lowerleg01.L', 0.055], ['lowerleg01.R', 0.055], ['upperleg01.L', 0.09], ['upperleg01.R', 0.09],
    ['root', 0.1], ['spine03', 0.11], ['spine01', 0.12], ['head', 0.09],
    ['upperarm01.L', 0.07], ['upperarm01.R', 0.07], ['lowerarm01.L', 0.045], ['lowerarm01.R', 0.045],
    ['wrist.L', 0.035], ['wrist.R', 0.035],
  ].map(([n, r]) => [bones[byName[n]], r]);
  function groundBody(p, rootBone) {
    object3d.updateMatrixWorld(true);
    let low = Infinity;
    for (const [b, r] of contacts) { b.getWorldPosition(v3); low = Math.min(low, v3.y - object3d.position.y - r); }
    let dy = p.groundW > 0 ? (p.clearance - low) * Math.min(1, p.groundW) : 0;
    if (low + dy < 0) dy = -low;
    if (Math.abs(dy) > 1e-5) {
      rootBone.position.y += dy;
      rootBone.updateMatrixWorld(true);
    }
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
  function applyGrip(w, throat = 0) {
    if (w <= 0.001) return;
    object3d.updateMatrixWorld(true);
    const up = bone('upperarm01.L'), low = bone('lowerarm01.L');
    up.getWorldPosition(ik.s);
    ik.t.copy(GRIP_POINT).lerp(THROAT_POINT, Math.max(0, Math.min(1, throat))).applyMatrix4(racket.matrixWorld);
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
  // turns the racket hand so the racket's shaft points along dir (world), blended by w;
  // the racket keeps its roll from the pose
  const shaft = new THREE.Vector3(), want = new THREE.Vector3();
  function aimRacket(dir, w) {
    if (w <= 0.001) return;
    object3d.updateMatrixWorld(true);
    const b = bone('wrist.R');
    racket.getWorldQuaternion(q1);
    shaft.set(0, -1, 0).applyQuaternion(q1); // the head is at local -y (buildRacket)
    q1.setFromUnitVectors(shaft, want.copy(dir).normalize());
    b.getWorldQuaternion(q2);
    q1.multiply(q2);
    b.parent.getWorldQuaternion(q3).invert();
    q3.multiply(q1);
    b.quaternion.slerp(q3, Math.min(1, w));
    b.updateMatrixWorld(true);
  }

  // swings the racket arm at the shoulder so the racket head moves toward target (world),
  // blended by w; the arm keeps its shape
  const sh = new THREE.Vector3(), hd = new THREE.Vector3(), tg = new THREE.Vector3();
  function reachRacket(target, w) {
    if (w <= 0.001) return;
    object3d.updateMatrixWorld(true);
    const b = bone('upperarm01.R');
    b.getWorldPosition(sh);
    hd.set(0, racket.userData.headY, 0).applyMatrix4(racket.matrixWorld).sub(sh).normalize();
    tg.copy(target).sub(sh).normalize();
    q1.setFromUnitVectors(hd, tg);
    b.getWorldQuaternion(q2);
    q1.multiply(q2);
    b.parent.getWorldQuaternion(q3).invert();
    q3.multiply(q1);
    b.quaternion.slerp(q3, Math.min(1, w));
    b.updateMatrixWorld(true);
  }

  // secondary motion of the shirt and shorts, after the body has been posed and placed
  function updateCloth(dt) {
    if (cloth) cloth.update(dt, object3d, current);
  }

  // faces: weights 0..1 by name (smile, shout, grimace, sad, blink)
  function setExpression(w) {
    const dict = mesh.morphTargetDictionary, inf = mesh.morphTargetInfluences;
    if (!dict || !inf) return;
    for (const [name, i] of Object.entries(dict)) inf[i] = w[name] || 0;
  }
  return { object3d, racket, leftHand, pose: current, setPose, applyGrip, aimRacket, reachRacket, updateCloth, mesh, legs: legInfo, setExpression };
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

// Headwear fitted to the head: the shape is measured from the head (and the hair, where
// it is worn under it) slice by slice, so a band sits snug all round. A band runs
// higher over the forehead than at the back. The cap has a six-panel crown with seams
// and a button, and a curved brim; the visor is a deep band and the same brim; the
// headband is a terry band.
function headOutline(body, hair, minY) {
  const pts = [], A = body.arrays, P = body.parts, n = body.vertexCount || A.part.length;
  for (let i = 0; i < n; i++) {
    const pt = A.part[i];
    if (pt === P.head || pt === P.scalp || pt === P.brows) pts.push([A.position[i * 3], A.position[i * 3 + 1], A.position[i * 3 + 2]]);
  }
  if (hair) for (let i = 0; i < hair.arrays.position.length / 3; i++) {
    const y = hair.arrays.position[i * 3 + 1];
    if (y > minY) pts.push([hair.arrays.position[i * 3], y, hair.arrays.position[i * 3 + 2]]);
  }
  return pts;
}
function makeFitter(pts, cx, cz, SEG) {
  // the head's radius at an angle (0 = front) and height: the furthest point near that slice
  pts.sort((p, q) => p[1] - q[1]);
  const firstAbove = (y) => { let lo = 0, hi = pts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][1] < y) lo = m + 1; else hi = m; } return lo; };
  return (y, band = 0.012) => {
    const r = new Float32Array(SEG);
    for (let i = firstAbove(y - band); i < pts.length && pts[i][1] <= y + band; i++) {
      const [x, , z] = pts[i];
      const a = Math.atan2(x - cx, z - cz);
      const k = ((Math.round((a / (2 * Math.PI)) * SEG) % SEG) + SEG) % SEG;
      r[k] = Math.max(r[k], Math.hypot(x - cx, z - cz));
    }
    if (r.some((v) => v > 0)) for (let it = 0; it < SEG && r.some((v) => !v); it++) for (let k = 0; k < SEG; k++) if (!r[k]) r[k] = Math.max(r[(k + 1) % SEG], r[(k + SEG - 1) % SEG]);
    return r.map((_, k) => Math.max(r[k], (r[(k + 1) % SEG] + r[(k + SEG - 1) % SEG] + r[(k + 2) % SEG] + r[(k + SEG - 2) % SEG]) / 4));
  };
}
function ringsMesh(rings, SEG, mat, closeTop = null, colours = null) {
  const pos = [], col = [], idx = [];
  rings.forEach((ring) => ring.forEach((p) => pos.push(...p)));
  if (colours) colours.forEach((c) => col.push(...c));
  for (let r = 0; r + 1 < rings.length; r++) for (let k = 0; k < SEG; k++) {
    const a = r * SEG + k, b = r * SEG + (k + 1) % SEG, c = (r + 1) * SEG + k, d = (r + 1) * SEG + (k + 1) % SEG;
    idx.push(a, b, c, b, d, c);
  }
  if (closeTop) {
    const top = pos.length / 3, last = (rings.length - 1) * SEG;
    pos.push(...closeTop);
    if (colours) col.push(...colours[colours.length - 1]);
    for (let k = 0; k < SEG; k++) idx.push(last + k, last + (k + 1) % SEG, top);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colours) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}
function addHeadwear(headBone, prep, o, hairGarment = null, body = null) {
  const hairMesh = !!hairGarment;
  const h = prep.headInfo;
  const origin = prep.head('head');
  const at = (v) => v.clone().sub(origin);
  const c = at(h.centre);
  const r = Math.max(0.085, (h.top - h.centre.y) + 0.006); // for the painted curls
  const hairMat = new THREE.MeshStandardMaterial({ color: o.hair, roughness: 0.9 });
  if (o.headwear && o.headwear !== 'none' && body) {
    const SEG = 64;
    const cx = 0, cz = h.centre.z;
    // the band's line: across the middle of the forehead, lower at the back
    const yFront = h.eyeY + (o.headwear === 'cap' ? 0.072 : 0.066), yBack = h.eyeY + (o.headwear === 'headband' ? 0.045 : 0.025);
    const lineY = (k) => { const a = (k / SEG) * Math.PI * 2; return yBack + (yFront - yBack) * (1 + Math.cos(a)) / 2; };
    const pts = headOutline(body, o.headwear === 'cap' && o.hairStyle !== 'long' ? null : hairGarment, yBack - 0.02);
    const fit = makeFitter(pts, cx, cz, SEG);
    const cache = new Map();
    const radiusAt = (y) => { const key = Math.round(y * 400); if (!cache.has(key)) cache.set(key, fit(key / 400)); return cache.get(key); };
    const ease = o.hairStyle === 'none' || hairMesh ? 0.004 : (SCALP[o.hairStyle] ?? 0.011) + 0.006; // painted hair sits out from the scalp
    const ringAt = (lift, extra, k) => {
      const y = lineY(k) + lift, a = (k / SEG) * Math.PI * 2, R = radiusAt(y)[k] + ease + extra;
      return [cx + Math.sin(a) * R, y, cz + Math.cos(a) * R];
    };
    const mat = new THREE.MeshStandardMaterial({ color: o.headwearColor, roughness: o.headwear === 'headband' ? 1 : 0.78, side: THREE.DoubleSide, vertexColors: o.headwear === 'cap' });
    const add = (mesh) => { mesh.position.sub(origin); headBone.add(mesh); return mesh; };
    const bandH = o.headwear === 'visor' ? 0.034 : o.headwear === 'headband' ? 0.042 : 0.03;
    const rings = [];
    for (let r = 0; r <= 4; r++) rings.push(Array.from({ length: SEG }, (_, k) => ringAt(-bandH / 2 + (bandH * r) / 4, 0.002 + (o.headwear === 'headband' ? 0.004 * Math.sin((r / 4) * Math.PI) : 0), k)));
    if (o.headwear === 'cap') {
      // the crown: from the band up over the head, panels meeting at a button on top
      let topY = -Infinity;
      for (const p of pts) topY = Math.max(topY, p[1]);
      const crown = [], colours = [];
      const base = rings[rings.length - 1];
      const seam = (k) => (Math.abs(((k / SEG) * 6) % 1 - 0.5) > 0.46 ? 0.8 : 1); // six panels: darker seams
      const lift = ease + 0.007, peak = topY + lift;
      let prev = base.map((p) => Math.hypot(p[0] - cx, p[2] - cz));
      crown.push(base);
      for (let r = 1; r <= 12; r++) {
        const f = r / 12;
        const ring = base.map((p, k) => {
          const y = p[1] + (peak - p[1]) * Math.sin((f * Math.PI) / 2);
          // the head's own outline at this height, a little out; never wider than below
          let R = r === 12 ? 0.004 : radiusAt(Math.min(y, topY - 0.003))[k] + lift;
          if (y > topY - 0.02) R = Math.min(R, prev[k] * Math.sqrt(Math.max(0, (peak - y) / Math.max(0.004, peak - y + 0.012))) + 0.004);
          R = Math.min(R, prev[k]);
          prev[k] = R;
          const a = (k / SEG) * Math.PI * 2;
          return [cx + Math.sin(a) * R, y, cz + Math.cos(a) * R];
        });
        crown.push(ring);
      }
      const all = [...rings, ...crown.slice(1)];
      for (const ring of all) for (let k = 0; k < SEG; k++) colours.push([seam(k), seam(k), seam(k)]);
      const topP = [cx, all[all.length - 1][0][1] + 0.003, cz];
      add(ringsMesh(all, SEG, mat, topP, colours));
      const button = new THREE.Mesh(new THREE.SphereGeometry(0.007, 10, 6), new THREE.MeshStandardMaterial({ color: o.headwearColor, roughness: 0.7 }));
      button.position.set(...topP);
      add(button);
    } else add(ringsMesh(rings, SEG, mat));
    if (o.headwear === 'cap' || o.headwear === 'visor') {
      // the brim: from the front of the band, forward and curved down at the sides
      const span = 0.36, rows = 6, cols = 28, bpos = [], bidx = [];
      for (let i = 0; i <= cols; i++) {
        const u = i / cols - 0.5, k = ((Math.round(u * span * SEG) % SEG) + SEG) % SEG;
        const edge = rings[1][k]; // tucked into the band, just above its lower edge
        const a = (k / SEG) * Math.PI * 2;
        const len = (o.headwear === 'cap' ? 0.072 : 0.062) * Math.cos(u * Math.PI * 0.9) ** 0.6;
        for (let j = 0; j <= rows; j++) {
          const v = j / rows, d = len * v;
          const droop = -0.005 * v * v - 0.016 * Math.abs(u) * v; // curved down at the sides
          bpos.push(edge[0] + Math.sin(a) * (d - 0.002), edge[1] + droop - 0.008 * v, edge[2] + Math.cos(a) * (d - 0.002));
        }
      }
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const q = i * (rows + 1) + j, r2 = (i + 1) * (rows + 1) + j;
        bidx.push(q, r2, q + 1, q + 1, r2, r2 + 1);
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
      bg.setIndex(bidx);
      bg.computeVertexNormals();
      const brim = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: o.headwearColor, roughness: 0.75, side: THREE.DoubleSide }));
      brim.castShadow = true;
      add(brim);
    }
  }
  if (hairMesh) return; // real hair is on
  if (o.hairStyle === 'long') {
    const pts = [[0.012, -0.21], [0.026, -0.15], [0.032, -0.07], [0.024, 0]].map(([x, y]) => new THREE.Vector2(x, y));
    const tail = new THREE.Mesh(new THREE.LatheGeometry(pts, 12), hairMat);
    tail.position.copy(at(new THREE.Vector3(0, h.centre.y + 0.01, h.back + 0.01)));
    tail.rotation.x = 0.35;
    tail.castShadow = true;
    headBone.add(tail);
  } else if (o.hairStyle === 'curly' && o.headwear !== 'cap') {
    for (let i = 0; i < 16; i++) { // a bumpy outline of curls
      const a = (i / 16) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), hairMat);
      m.position.copy(c).add(new THREE.Vector3(Math.cos(a) * r * 0.92, 0.035 + Math.sin(i * 1.7) * 0.01, Math.sin(a) * r * 0.95));
      headBone.add(m);
    }
  }
}

// ---------------------------------------------------------------- cloth
// Secondary motion for the outfit. The garment stays skinned to the skeleton; on top,
// in the vertex shader, its loose parts (the shirt below the chest, the sleeves, the
// legs of the shorts) are weighted from 0 where the fabric sits on the body to 1 at the
// hems, and those parts:
//   stand off the body a little (a looser fit),
//   lag behind the body's movement on a damped spring (inertia, and the wind of running),
//   twist behind the hips and torso when they turn quickly, then catch up,
//   ripple with a small flutter that grows with speed.
// The springs are simulated per player on the CPU and passed in as uniforms.
const CLOTH = {
  shirtTop: 1.27, // the shirt hangs free from this far above its hem (shirtTop - shirtHem, m)
  shirtHem: 1.03,
  sleeveFrom: 0.21, // sideways distance where the sleeves start
  loose: [0.018, 0.016], // stand-off at the hem: shirt, shorts
  stiffness: 90, damping: 7, // the hem spring (1/s^2, 1/s)
  inertia: 0.8, drag: 0.008, // response to the body's acceleration, and to its speed (wind)
  maxOffset: 0.07,
  twistStiffness: 110, twistDamping: 12, maxTwist: 0.3,
  flutter: 0.009, // ripple size (m) at full speed
};

function createCloth(mesh, A, material) {
  const n = A.position.length / 3;
  const attr = new Float32Array(n * 3); // weight, sleeve, shorts
  const C = CLOTH;
  // where each piece hangs free: measured on the garment (rest pose), so any cut works.
  // The shirt from a little above its hem; shorts from about a leg's width above
  // theirs; a skirt (piece 2) from just under its waistband
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const k = Math.min(2, A.piece[i]), x = A.position[i * 3], y = A.position[i * 3 + 1];
    if (k === 0 && Math.abs(x) > C.sleeveFrom) continue;
    lo[k] = Math.min(lo[k], y); hi[k] = Math.max(hi[k], y);
  }
  const top = [lo[0] + (C.shirtTop - C.shirtHem), lo[1] + 0.26, hi[2] - 0.03];
  for (let i = 0; i < n; i++) {
    const x = A.position[i * 3], y = A.position[i * 3 + 1], k = Math.min(2, A.piece[i]);
    let w = 0, sleeve = 0, shorts = 0;
    if (k === 0) {
      if (Math.abs(x) > C.sleeveFrom) sleeve = Math.min(1, (Math.abs(x) - C.sleeveFrom) / 0.12);
      else w = Math.pow(Math.min(1, Math.max(0, (top[0] - y) / (top[0] - lo[0]))), 1.3);
    } else {
      shorts = 1;
      w = Math.min(1, Math.max(0, (top[k] - y) / (top[k] - lo[k])));
      if (k === 2) { w = Math.pow(w, 1.2); shorts = 0.6; } // a skirt swings more freely than shorts
    }
    attr[i * 3] = w; attr[i * 3 + 1] = sleeve; attr[i * 3 + 2] = shorts;
  }
  mesh.geometry.setAttribute('cloth', new THREE.BufferAttribute(attr, 3));

  const uniforms = {
    uOff: { value: new THREE.Vector3() }, // hem offset, in the player's frame
    uTwist: { value: 0 },
    uFlutter: { value: 0 },
    uTime: { value: 0 },
    uLoose: { value: new THREE.Vector2(C.loose[0], C.loose[1]) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 cloth;
        uniform vec3 uOff; uniform float uTwist; uniform float uFlutter; uniform float uTime; uniform vec2 uLoose;`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        {
          float w = cloth.x, sleeve = cloth.y, isShorts = cloth.z;
          vec3 nrm = normalize(objectNormal);
          // a looser fit toward the hems
          transformed += nrm * w * mix(uLoose.x, uLoose.y, isShorts);
          // twist behind the turning body (about its vertical axis), shorts less
          float tw = uTwist * w * mix(1.0, 0.35, isShorts);
          float c = cos(tw), s = sin(tw);
          transformed.xz = vec2(c * transformed.x + s * transformed.z, -s * transformed.x + c * transformed.z);
          // inertia and wind
          transformed += uOff * w * mix(1.0, 0.55, isShorts);
          // flutter: ripples running round the hem and along the sleeves
          float ph = uTime * 11.0 + transformed.y * 9.0 + atan(transformed.x, transformed.z) * 2.0;
          transformed += nrm * sin(ph) * uFlutter * (w + 0.6 * sleeve);
        }`);
  };
  material.customProgramCacheKey = () => 'cloth';
  material.userData.cloth = uniforms; // for checks

  const prev = new THREE.Vector3(), prevV = new THREE.Vector3(), off = new THREE.Vector3(), offV = new THREE.Vector3();
  const pos = new THREE.Vector3(), vel = new THREE.Vector3(), acc = new THREE.Vector3(), target = new THREE.Vector3();
  let ready = false, twist = 0, twistV = 0, prevYaw = 0, time = 0;
  return {
    update(dt, object3d, pose) {
      if (dt <= 0) return;
      time += dt;
      pos.copy(object3d.position);
      const yaw = object3d.rotation.y + pose.hipsYaw + 0.5 * pose.torsoY;
      if (!ready) { prev.copy(pos); prevV.set(0, 0, 0); prevYaw = yaw; ready = true; }
      vel.subVectors(pos, prev).divideScalar(dt);
      if (vel.lengthSq() > 400) vel.set(0, 0, 0); // a teleport (new point), not movement
      acc.subVectors(vel, prevV).divideScalar(dt);
      if (acc.lengthSq() > 2500) acc.setLength(50);
      prev.copy(pos); prevV.copy(vel);
      // the hem: pushed back by the body's acceleration, trailing in the wind of its speed
      target.copy(vel).multiplyScalar(-C.drag);
      target.y = Math.abs(target.y) * 0.5 + vel.length() * C.drag * 0.25; // lifts a little in the wind
      const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
      for (let k = 0; k < steps; k++) {
        offV.x += (C.stiffness * (target.x - off.x) - C.damping * offV.x - C.inertia * acc.x) * h;
        offV.y += (C.stiffness * (target.y - off.y) - C.damping * offV.y - C.inertia * 0.4 * acc.y) * h;
        offV.z += (C.stiffness * (target.z - off.z) - C.damping * offV.z - C.inertia * acc.z) * h;
        off.addScaledVector(offV, h);
      }
      if (off.length() > C.maxOffset) off.setLength(C.maxOffset);
      // twist: the hem lags the body's turn
      let dyaw = yaw - prevYaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      prevYaw = yaw;
      for (let k = 0; k < steps; k++) {
        twistV += (-C.twistStiffness * twist - C.twistDamping * twistV) * h;
        twist += twistV * h;
      }
      twist -= dyaw; // the body turned; the cloth stays behind
      twist = Math.max(-C.maxTwist, Math.min(C.maxTwist, twist));
      // into the player's frame
      const u = uniforms.uOff.value.copy(off).applyAxisAngle(UP_AXIS, -object3d.rotation.y);
      u.y = off.y;
      uniforms.uTwist.value = twist;
      uniforms.uFlutter.value = Math.min(1, vel.length() / 6) * C.flutter + Math.min(0.004, Math.abs(twistV) * 0.0006);
      uniforms.uTime.value = time;
    },
  };
}
const UP_AXIS = new THREE.Vector3(0, 1, 0);
