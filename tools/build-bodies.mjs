// Builds the player bodies from MakeHuman data (CC0 1.0): the hm08 base mesh, its
// default skeleton and skin weights, and the macro targets that shape an athletic
// young man and woman. Writes src/assets/body-male.json and body-female.json.
//
//   sh tools/fetch-makehuman.sh && node tools/build-bodies.mjs
//
// Each file holds one skinned mesh: positions, triangle indices, four bone
// influences per vertex, and a body region per vertex (torso, thigh, scalp, ...)
// with a position along that limb, so the game can paint a tennis kit, hair and
// skin colours onto it at load time. The skeleton is simplified to the 60 bones
// the game animates; the rest (face, toes, metacarpals) fold into their parents.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '.cache/makehuman');
const OUT = join(here, '../src/assets');

// ------------------------------------------------------------------ inputs
function readObj() {
  const V = [], faces = { body: [], eyeL: [], eyeR: [] };
  let group = '';
  for (const line of readFileSync(join(SRC, 'base.obj'), 'utf8').split('\n')) {
    if (line.startsWith('v ')) V.push(line.split(/\s+/).slice(1, 4).map(Number));
    else if (line.startsWith('g ')) group = line.slice(2).trim();
    else if (line.startsWith('f ')) {
      const key = group === 'body' ? 'body' : group === 'helper-l-eye' ? 'eyeL' : group === 'helper-r-eye' ? 'eyeR' : null;
      if (!key) continue;
      const idx = line.split(/\s+/).slice(1).filter(Boolean).map((t) => parseInt(t, 10) - 1);
      for (let i = 1; i + 1 < idx.length; i++) faces[key].push([idx[0], idx[i], idx[i + 1]]);
    }
  }
  return { V, faces };
}

function readTarget(path) {
  const out = [];
  for (const line of readFileSync(join(SRC, 'targets/macrodetails', path), 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const [i, x, y, z] = line.trim().split(/\s+/).map(Number);
    out.push([i, x, y, z]);
  }
  return out;
}

const skel = JSON.parse(readFileSync(join(SRC, 'default.mhskel'), 'utf8'));
const weights = JSON.parse(readFileSync(join(SRC, 'default_weights.mhw'), 'utf8')).weights;

// ------------------------------------------------------------------ skeleton
const KEEP = new Set(['root', 'spine05', 'spine04', 'spine03', 'spine02', 'spine01', 'neck01', 'neck02', 'neck03', 'head']);
for (const s of ['L', 'R']) {
  for (const b of ['clavicle', 'shoulder01', 'upperarm01', 'upperarm02', 'lowerarm01', 'lowerarm02', 'wrist',
    'pelvis', 'upperleg01', 'upperleg02', 'lowerleg01', 'lowerleg02', 'foot']) KEEP.add(`${b}.${s}`);
  for (let f = 1; f <= 5; f++) for (let k = 1; k <= 3; k++) KEEP.add(`finger${f}-${k}.${s}`);
}
const bonesAll = skel.bones;
const keptAncestor = (name) => { let n = name; while (n && !KEEP.has(n)) n = bonesAll[n].parent; return n || 'root'; };
const depth = (n) => { let d = 0; while (bonesAll[n].parent) { n = bonesAll[n].parent; d++; } return d; };
const BONES = [...KEEP].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
const boneIndex = new Map(BONES.map((n, i) => [n, i]));

// body regions, from the bone that moves a vertex most
const PART = { head: 0, torso: 1, pelvis: 2, upperarm: 3, forearm: 4, hand: 5, thigh: 6, shin: 7, foot: 8, eye: 9, scalp: 10, brows: 11, lips: 12 };
function partOfBone(n) {
  if (/^(head|neck)/.test(n)) return PART.head;
  if (/^(spine|clavicle|shoulder)/.test(n)) return PART.torso;
  if (/^(root|pelvis)/.test(n)) return PART.pelvis;
  if (/^upperarm/.test(n)) return PART.upperarm;
  if (/^lowerarm/.test(n)) return PART.forearm;
  if (/^(wrist|finger)/.test(n)) return PART.hand;
  if (/^upperleg/.test(n)) return PART.thigh;
  if (/^lowerleg/.test(n)) return PART.shin;
  return PART.foot;
}

// ------------------------------------------------------------------ build one body
// shape: weights for the macro targets (see the MakeHuman macro modifier maths:
// young age, equal ethnic mix, extra muscle and height, ideal proportions).
function build(gender, { muscle, height, targetHeight }) {
  const { V: V0, faces } = readObj();
  const V = V0.map((v) => v.slice());
  const apply = (path, w) => { for (const [i, x, y, z] of readTarget(path)) { V[i][0] += x * w; V[i][1] += y * w; V[i][2] += z * w; } };
  for (const e of ['african', 'asian', 'caucasian']) apply(`${e}-${gender}-young.target`, 1 / 3);
  apply(`universal-${gender}-young-maxmuscle-averageweight.target`, muscle);
  apply(`height/${gender}-young-averagemuscle-averageweight-maxheight.target`, height);
  apply(`proportions/${gender}-young-averagemuscle-averageweight-idealproportions.target`, 1);

  const joint = (name) => {
    const idx = skel.joints[name];
    const p = [0, 0, 0];
    for (const i of idx) for (let k = 0; k < 3; k++) p[k] += V[i][k] / idx.length;
    return p;
  };

  // used vertices: body and eyes; remap to a compact list
  const used = new Map();
  const tris = [];
  const eyeVerts = new Set();
  for (const [key, list] of Object.entries(faces)) {
    for (const t of list) {
      tris.push(t.map((i) => { if (!used.has(i)) used.set(i, used.size); if (key !== 'body') eyeVerts.add(i); return used.get(i); }));
    }
  }
  const order = [...used.keys()];

  // units: decimetres to metres, scaled to the target height, feet on the ground,
  // the midpoint of the ankles at the origin
  let minY = Infinity, maxY = -Infinity;
  for (const i of order) { minY = Math.min(minY, V[i][1]); maxY = Math.max(maxY, V[i][1]); }
  const s = targetHeight / (maxY - minY);
  const aL = joint('foot.L____head'), aR = joint('foot.R____head');
  const ox = (aL[0] + aR[0]) / 2, oz = (aL[2] + aR[2]) / 2;
  const tx = (p) => [(p[0] - ox) * s, (p[1] - minY) * s, (p[2] - oz) * s];

  const bones = BONES.map((n) => ({
    name: n,
    parent: n === 'root' ? -1 : boneIndex.get(keptAncestor(bonesAll[n].parent)),
    head: tx(joint(bonesAll[n].head)).map((v) => +v.toFixed(5)),
    tail: tx(joint(bonesAll[n].tail)).map((v) => +v.toFixed(5)),
  }));
  const B = Object.fromEntries(bones.map((b) => [b.name, b]));

  // skin weights, folded into kept bones, best four, normalised
  const acc = new Map(order.map((i) => [i, new Map()]));
  for (const [bone, list] of Object.entries(weights)) {
    const k = boneIndex.get(keptAncestor(bone));
    for (const [vi, w] of list) {
      const m = acc.get(vi);
      if (m) m.set(k, (m.get(k) || 0) + w);
    }
  }
  const n = order.length;
  const position = new Float32Array(n * 3), skinIndex = new Uint8Array(n * 4), skinWeight = new Uint8Array(n * 4);
  const part = new Uint8Array(n), along = new Uint8Array(n);
  const P = order.map((i) => tx(V[i]));
  const eyeL = [0, 0, 0], eyeR = [0, 0, 0];
  let nl = 0, nr = 0;
  order.forEach((vi, j) => {
    if (!eyeVerts.has(vi)) return;
    const t = P[j];
    if (t[0] > 0) { for (let k = 0; k < 3; k++) eyeL[k] += t[k]; nl++; } else { for (let k = 0; k < 3; k++) eyeR[k] += t[k]; nr++; }
  });
  for (let k = 0; k < 3; k++) { eyeL[k] /= nl; eyeR[k] /= nr; }
  const eyeY = (eyeL[1] + eyeR[1]) / 2, eyeZ = (eyeL[2] + eyeR[2]) / 2, eyeX = Math.abs(eyeL[0]);

  const seg = (p, a, b) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    return Math.min(1, Math.max(0, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / L2));
  };
  const hipY = B['upperleg01.L'].head[1], shoulderY = B['upperarm01.L'].head[1];
  let frontZ = -Infinity; // nose tip
  order.forEach((vi, j) => {
    const m = [...acc.get(vi).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = m.reduce((a, [, w]) => a + w, 0) || 1;
    let left = 255;
    m.forEach(([bi, w], k) => {
      const q = k === m.length - 1 ? left : Math.round((w / sum) * 255);
      skinIndex[j * 4 + k] = bi; skinWeight[j * 4 + k] = q; left -= q;
    });
    if (!m.length) { skinIndex[j * 4] = boneIndex.get('root'); skinWeight[j * 4] = 255; }
    const p = P[j];
    position.set(p, j * 3);
    const top = m.length ? BONES[m[0][0]] : 'root';
    let pt = eyeVerts.has(vi) ? PART.eye : partOfBone(top);
    const side = p[0] >= 0 ? 'L' : 'R';
    let t = 0;
    if (pt === PART.upperarm) t = seg(p, B[`upperarm01.${side}`].head, B[`lowerarm01.${side}`].head);
    else if (pt === PART.forearm) t = seg(p, B[`lowerarm01.${side}`].head, B[`wrist.${side}`].head);
    else if (pt === PART.thigh) t = seg(p, B[`upperleg01.${side}`].head, B[`lowerleg01.${side}`].head);
    else if (pt === PART.shin) t = seg(p, B[`lowerleg01.${side}`].head, B[`foot.${side}`].head);
    else if (pt === PART.torso || pt === PART.pelvis) t = Math.min(1, Math.max(0, (p[1] - hipY) / (shoulderY - hipY)));
    else if (pt === PART.foot) t = Math.min(1, p[1] / 0.12); // height above the sole
    if (pt === PART.head && p[1] > eyeY - 0.1) frontZ = Math.max(frontZ, p[2]);
    part[j] = pt; along[j] = Math.round(t * 255);
  });
  // head zones: hair line, brows, lips
  order.forEach((vi, j) => {
    if (part[j] !== PART.head) return;
    const [x, y, z] = P[j];
    const ear = Math.abs(x) > eyeX + 0.035 && y < eyeY + 0.025 && y > eyeY - 0.06;
    const scalp = (y > eyeY + 0.05 && !(z > eyeZ + 0.005 && y < eyeY + 0.065))
      || (z < eyeZ - 0.075 && y > eyeY - 0.035);
    if (scalp && !ear) part[j] = PART.scalp;
    else if (y > eyeY + 0.014 && y < eyeY + 0.03 && z > eyeZ - 0.022 && Math.abs(Math.abs(x) - eyeX) < 0.026) part[j] = PART.brows;
    else if (Math.abs(x) < 0.021 && y < eyeY - 0.066 && y > eyeY - 0.083 && z > frontZ - 0.026) part[j] = PART.lips;
  });

  const index = new Uint16Array(tris.flat());
  const arrays = { position, index, skinIndex, skinWeight, part, along };
  const header = {
    format: 'court-rush-body', version: 1, gender, height: targetHeight,
    licence: 'Built from MakeHuman data (hm08 base mesh, default skeleton and weights, macro targets), CC0 1.0, makehumancommunity.org',
    parts: PART, bones, eyes: { l: eyeL, r: eyeR }, frontZ, arrays: {},
  };
  // JSON: the header plus every array as base64, 4-byte aligned in one blob
  let offset = 0;
  const chunks = [];
  for (const [name, arr] of Object.entries(arrays)) {
    const pad = (4 - (offset % 4)) % 4;
    offset += pad;
    chunks.push([offset, arr]);
    header.arrays[name] = { type: arr.constructor.name, offset, length: arr.length };
    offset += arr.byteLength;
  }
  const blob = Buffer.alloc(offset);
  for (const [at, arr] of chunks) Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(blob, at);
  header.data = blob.toString('base64');
  const out = Buffer.from(JSON.stringify(header));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `body-${gender}.json`), out);
  const counts = {};
  for (const p of part) counts[p] = (counts[p] || 0) + 1;
  console.log(`body-${gender}.json: ${n} vertices, ${tris.length} triangles, ${bones.length} bones, ${(out.length / 1024).toFixed(0)} KB, parts`, counts);
}

build('male', { muscle: 0.4, height: 0.3, targetHeight: 1.86 });
build('female', { muscle: 0.3, height: 0.2, targetHeight: 1.74 });
