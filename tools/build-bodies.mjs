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
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '.cache/makehuman');
const ARA = join(here, '.cache/ara3d/package/assets');
const PREVIEW = process.argv.includes('--preview');
const OUT = join(here, '../src/assets');

// ------------------------------------------------------------------ inputs
function readObj() {
  const V = [], VT = [], faces = { body: [], eyeL: [], eyeR: [] }, faceUV = { body: [], eyeL: [], eyeR: [] };
  let group = '';
  for (const line of readFileSync(join(SRC, 'base.obj'), 'utf8').split('\n')) {
    if (line.startsWith('v ')) V.push(line.split(/\s+/).slice(1, 4).map(Number));
    else if (line.startsWith('vt ')) VT.push(line.split(/\s+/).slice(1, 3).map(Number));
    else if (line.startsWith('g ')) group = line.slice(2).trim();
    else if (line.startsWith('f ')) {
      const key = group === 'body' ? 'body' : group === 'helper-l-eye' ? 'eyeL' : group === 'helper-r-eye' ? 'eyeR' : null;
      if (!key) continue;
      const corners = line.split(/\s+/).slice(1).filter(Boolean);
      const idx = corners.map((t) => parseInt(t, 10) - 1);
      const uvs = corners.map((t) => (t.includes('/') ? parseInt(t.split('/')[1], 10) - 1 : -1));
      for (let i = 1; i + 1 < idx.length; i++) {
        faces[key].push([idx[0], idx[i], idx[i + 1]]);
        faceUV[key].push([uvs[0], uvs[i], uvs[i + 1]]);
      }
    }
  }
  return { V, VT, faces, faceUV };
}

// MakeHuman's facial expression units (CC0), as morph targets on the base mesh: the
// three ethnic variants averaged, as the body itself is an even mix of them.
function readExpressionUnits() {
  const b = gunzipSync(readFileSync(join(ARA, 'web/targets/expression-units.pack')));
  const n = b.readUInt32LE(4);
  const h = JSON.parse(b.subarray(8, 8 + n).toString());
  const base = 8 + n;
  const arr = (name) => {
    const a = h.arrays.find((x) => x.name === name);
    const T = a.type === 'Uint16Array' ? Uint16Array : Uint8Array;
    return new T(new Uint8Array(b.subarray(base + a.offset, base + a.offset + a.length * T.BYTES_PER_ELEMENT)).buffer);
  };
  const idx = arr('idx'), lo = ['x', 'y', 'z'].map((c) => arr(`${c}lo`)), hi = ['x', 'y', 'z'].map((c) => arr(`${c}hi`));
  const s16 = (l, h2) => { const v = l | (h2 << 8); return v > 32767 ? v - 65536 : v; };
  const units = {};
  for (const [name, [off, count, scale]] of Object.entries(h.meta.targets)) {
    const unit = name.split('/').pop();
    const m = units[unit] || (units[unit] = new Map());
    let v = 0; // vertex indices are stored as steps from the previous one
    for (let i = off; i < off + count; i++) {
      v += idx[i];
      const d = m.get(v) || [0, 0, 0];
      for (let c = 0; c < 3; c++) d[c] += (s16(lo[c][i], hi[c][i]) * scale) / 3;
      m.set(v, d);
    }
  }
  return units;
}
// the expressions the game uses, as mixes of expression units
const EXPRESSIONS = {
  smile: { 'mouth-corner-puller': 1, 'mouth-elevation': 0.15, 'eye-left-slit': 0.3, 'eye-right-slit': 0.3, 'eyebrows-left-extern-up': 0.2, 'eyebrows-right-extern-up': 0.2 },
  shout: { 'mouth-open': 0.45, 'mouth-retraction': 0.45, 'eyebrows-left-down': 0.4, 'eyebrows-right-down': 0.4, 'nose-compression': 0.4, 'eye-left-slit': 0.35, 'eye-right-slit': 0.35 },
  grimace: { 'mouth-retraction': 0.8, 'mouth-compression': 0.3, 'eye-left-slit': 0.65, 'eye-right-slit': 0.65, 'eyebrows-left-down': 0.6, 'eyebrows-right-down': 0.6, 'nose-compression': 0.5 },
  sad: { 'mouth-depression': 0.8, 'eyebrows-left-inner-up': 0.85, 'eyebrows-right-inner-up': 0.85, 'eye-left-slit': 0.2, 'eye-right-slit': 0.2 },
  blink: { 'eye-left-closure': 1, 'eye-right-closure': 1 },
};

function readTarget(path) {
  const out = [];
  for (const line of readFileSync(join(SRC, 'targets/macrodetails', path), 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const [i, x, y, z] = line.trim().split(/\s+/).map(Number);
    out.push([i, x, y, z]);
  }
  return out;
}

// MakeHuman clothing (CC0), as packed by ara3d-data: MHP1 + header JSON + arrays.
function readPack(file) {
  const b = gunzipSync(readFileSync(join(ARA, 'proxies', file)));
  const n = b.readUInt32LE(4);
  const h = JSON.parse(b.subarray(8, 8 + n).toString());
  const base = 8 + n;
  const T = { Uint32Array, Float32Array, Uint8Array };
  const arrays = {};
  for (const a of h.arrays) {
    const bytes = b.subarray(base + a.offset, base + a.offset + a.length * T[a.type].BYTES_PER_ELEMENT);
    arrays[a.name] = new T[a.type](new Uint8Array(bytes).buffer);
  }
  return { meta: h.meta, arrays };
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
  const { V: V0, VT, faces, faceUV } = readObj();
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
  const tris = [], trisUV = [];
  const eyeVerts = new Set();
  for (const [key, list] of Object.entries(faces)) {
    list.forEach((t, ti) => {
      tris.push(t.map((i) => { if (!used.has(i)) used.set(i, used.size); if (key !== 'body') eyeVerts.add(i); return used.get(i); }));
      trisUV.push(faceUV[key][ti]);
    });
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
      const q = k === m.length - 1 ? left : Math.floor((w / sum) * 255);
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

  // ---- garments fitted to this body: positions from three body vertices plus a
  // scaled offset (MakeHuman's proxy fitting), skin weights blended from the same
  // vertices, and the body vertices they cover (hidden while worn)
  const boneW = new Map(); // base vertex -> Map(kept bone -> weight), all vertices
  for (const [bn, list] of Object.entries(weights)) {
    const k = boneIndex.get(keptAncestor(bn));
    for (const [vi, w] of list) {
      if (!boneW.has(vi)) boneW.set(vi, new Map());
      const m = boneW.get(vi);
      m.set(k, (m.get(k) || 0) + w);
    }
  }
  function fitGarment(file) {
    const { meta, arrays: A } = readPack(file);
    const nv = meta.vertexCount;
    const sc = (meta.scale || []).map(([a, b, d], ax) => (d ? Math.abs(V[a][ax] - V[b][ax]) / d : 1));
    const fitted = [], skin = [];
    for (let i = 0; i < nv; i++) {
      const p = [0, 0, 0];
      const m = new Map();
      for (let k = 0; k < 3; k++) {
        const r = A.refs[i * 3 + k], w = A.weights[i * 3 + k];
        if (!w) continue;
        for (let c = 0; c < 3; c++) p[c] += V[r][c] * w;
        // fitting weights can be negative (extrapolation); skinning blends only the positive part
        for (const [bi, bw] of boneW.get(r) || []) m.set(bi, (m.get(bi) || 0) + bw * Math.max(0, w));
      }
      for (let c = 0; c < 3; c++) p[c] += A.offsets[i * 3 + c] * (sc[c] ?? 1);
      fitted.push(tx(p));
      skin.push([...m.entries()].filter(([, w]) => w > 1e-6).sort((a, b) => b[1] - a[1]).slice(0, 4));
    }
    // split vertices where the texture coordinates differ (three.js needs one uv per vertex)
    const key = new Map(), outPos = [], outUv = [], outSkin = [], tri = [];
    let f = 0;
    for (let face = 0; face < A.faceSizes.length; face++) {
      const size = A.faceSizes[face];
      const ids = [];
      for (let k = 0; k < size; k++) {
        const v = A.faceVerts[f + k], u = A.faceUVs[f + k];
        const kk = v * 65536 + u;
        if (!key.has(kk)) {
          key.set(kk, outPos.length);
          outPos.push(fitted[v]); outUv.push([A.uvs[u * 2], A.uvs[u * 2 + 1]]); outSkin.push(skin[v]);
        }
        ids.push(key.get(kk));
      }
      for (let k = 1; k + 1 < size; k++) tri.push(ids[0], ids[k], ids[k + 1]);
      f += size;
    }
    const n2 = outPos.length;
    const position = new Float32Array(n2 * 3), uv = new Float32Array(n2 * 2);
    const si = new Uint8Array(n2 * 4), sw = new Uint8Array(n2 * 4);
    outPos.forEach((p, i) => position.set(p, i * 3));
    outUv.forEach((t, i) => uv.set(t, i * 2));
    outSkin.forEach((m, i) => {
      const sum = m.reduce((a, [, w]) => a + w, 0) || 1;
      let left = 255;
      m.forEach(([bi, w], k) => { const q = k === m.length - 1 ? left : Math.floor((w / sum) * 255); si[i * 4 + k] = bi; sw[i * 4 + k] = q; left -= q; });
      if (!m.length) { si[i * 4] = 0; sw[i * 4] = 255; }
    });
    const hidden = [];
    for (const d of A.deleteVerts) if (used.has(d)) hidden.push(used.get(d));
    // pieces: the separate shells of a garment (shirt and shorts, shoe and sock),
    // numbered from the highest down: 0 is the topmost shell
    const par = Array.from({ length: n2 }, (_, i) => i);
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const weld = new Map();
    for (let i = 0; i < n2; i++) {
      const k = outPos[i].map((v) => v.toFixed(4)).join();
      if (weld.has(k)) par[find(i)] = find(weld.get(k)); else weld.set(k, i);
    }
    for (let t = 0; t < tri.length; t += 3) { const a = find(tri[t]); par[find(tri[t + 1])] = a; par[find(tri[t + 2])] = a; }
    const comps = new Map();
    for (let i = 0; i < n2; i++) {
      const r = find(i);
      if (!comps.has(r)) comps.set(r, { sum: 0, n: 0 });
      const c = comps.get(r); c.sum += outPos[i][1]; c.n++;
    }
    const levels = [...new Set([...comps.values()].map((c) => +(c.sum / c.n).toFixed(1)))].sort((a, b) => b - a);
    const piece = new Uint8Array(n2);
    for (let i = 0; i < n2; i++) { const c = comps.get(find(i)); piece[i] = levels.indexOf(+(c.sum / c.n).toFixed(1)); }
    return {
      meta, arrays: {
        position, uv, skinIndex: si, skinWeight: sw,
        index: n2 > 65535 ? new Uint32Array(tri) : new Uint16Array(tri), hidden: new Uint16Array(hidden), piece,
      },
    };
  }
  const packJson = (header, arrays) => {
    let off = 0;
    const chunks = [];
    header.arrays = {};
    for (const [name, arr] of Object.entries(arrays)) {
      off += (4 - (off % 4)) % 4;
      chunks.push([off, arr]);
      header.arrays[name] = { type: arr.constructor.name, offset: off, length: arr.length };
      off += arr.byteLength;
    }
    const blob = Buffer.alloc(off);
    for (const [at, arr] of chunks) Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(blob, at);
    header.data = blob.toString('base64');
    return Buffer.from(JSON.stringify(header));
  };
  const list = PREVIEW ? JSON.parse(readFileSync(join(ARA, 'catalog.json'))) : null;
  const wanted = PREVIEW
    ? [...list.outfits, ...list.shoes, ...list.hair].map((it) => it.id)
    : GARMENTS[gender];
  const gdir = PREVIEW ? join(here, '../dev/preview') : join(OUT, 'kit');
  mkdirSync(join(gdir, 'textures'), { recursive: true });
  const catalog = JSON.parse(readFileSync(join(ARA, 'catalog.json')));
  const all = [...catalog.outfits, ...catalog.shoes, ...catalog.hair, ...catalog.hats];
  for (const id of wanted) {
    const item = all.find((it) => it.id === id);
    const kind = catalog.outfits.includes(item) ? 'outfit' : catalog.shoes.includes(item) ? 'shoes' : catalog.hair.includes(item) ? 'hair' : 'hats';
    const file = `${kind}_${id}.pack`;
    const g = fitGarment(file);
    const mat = item.material;
    for (const t of [mat.diffuse, mat.normal]) if (t && existsSync(join(ARA, 'textures', t))) copyFileSync(join(ARA, 'textures', t), join(gdir, 'textures', t));
    const out = packJson({ format: 'court-rush-garment', id, kind, gender, material: mat,
      licence: 'MakeHuman asset (CC0 1.0), makehumancommunity.org' }, g.arrays);
    writeFileSync(join(gdir, `${gender}-${id}.json`), out);
  }
  console.log(`${wanted.length} garments fitted to the ${gender} body into ${gdir}`);

  // ---- modern tennis outfits, put together from MakeHuman pieces (CC0):
  //   tennis-shorts  the relaxed tee of male_casualsuit06 over shorts cut from its jeans
  //                  just above the knee (loose, today's length)
  //   tennis-skirt   the same tee cut sleeveless (a tank), short undershorts, and a
  //                  pleated skirt made here around the hips
  // The shorts and skirt take their texture coordinates from a plain patch of the tee,
  // so the fabric has soft folds and no denim.
  if (!PREVIEW) {
    const SUIT = 'male_casualsuit06';
    const suitItem = catalog.outfits.find((it) => it.id === SUIT);
    const suit = fitGarment(`outfit_${SUIT}.pack`).arrays;
    for (const t of [suitItem.material.normal]) if (t) copyFileSync(join(ARA, 'textures', t), join(gdir, 'textures', t));
    const kneeY = B['lowerleg01.L'].head[1], armX = Math.abs(B['upperarm01.L'].head[0]);
    const g0 = splitPieces(suit); // [tee, jeans]
    const tee = g0[0], jeans = g0[1];
    // a plain patch of the tee (the middle of the back) for the shorts and skirt
    const patch = (() => {
      let su = 0, sv = 0, k = 0;
      for (let i = 0; i < tee.position.length / 3; i++) {
        const x = tee.position[i * 3], y = tee.position[i * 3 + 1], z = tee.position[i * 3 + 2];
        if (Math.abs(x) < 0.06 && z < 0 && y > hipY + 0.15 && y < shoulderY - 0.15) { su += tee.uv[i * 2]; sv += tee.uv[i * 2 + 1]; k++; }
      }
      return [su / k, sv / k];
    })();
    const projectUV = (g) => {
      for (let i = 0; i < g.position.length / 3; i++) {
        g.uv[i * 2] = patch[0] + g.position[i * 3] * 0.25;
        g.uv[i * 2 + 1] = patch[1] + (g.position[i * 3 + 1] - hipY) * 0.25;
      }
    };
    const covered = (keep) => {
      const out = [];
      for (const v of suit.hidden) if (keep(position[v * 3], position[v * 3 + 1])) out.push(v);
      return out;
    };
    const teeHem = (() => { let m = Infinity; for (let i = 0; i < tee.position.length / 3; i++) if (Math.abs(tee.position[i * 3]) < armX * 0.8) m = Math.min(m, tee.position[i * 3 + 1]); return m; })();
    const write = (id, pieces, hidden) => {
      const g = mergeGarments(pieces);
      g.hidden = new Uint16Array(hidden);
      const out = packJson({ format: 'court-rush-garment', id, kind: 'outfit', gender, material: suitItem.material,
        licence: 'Made from MakeHuman assets (male_casualsuit06, CC0 1.0), makehumancommunity.org; skirt made in tools/build-bodies.mjs' }, g);
      writeFileSync(join(gdir, `${gender}-${id}.json`), out);
    };
    // tee and shorts
    {
      const cut = kneeY + 0.075;
      const shorts = clipGarment(jeans, (p) => p[1] - cut);
      projectUV(shorts);
      write('tennis-shorts', [[tee, 0], [shorts, 1]],
        covered((x, y) => y > cut + 0.02));
    }
    // tank, undershorts and pleated skirt
    {
      const armCut = armX - 0.025;
      const tank = clipGarment(tee, (p) => armCut - Math.abs(p[0]));
      // ball shorts under the skirt, in its colour, ending just above its hem
      const waistY = Math.min(teeHem + 0.035, hipY + 0.1), hemY = hipY - 0.23;
      const underCut = hemY + 0.05;
      const under = clipGarment(jeans, (p) => p[1] - underCut);
      projectUV(under);
      const skirt = makeSkirt({ waistY, hemY, under, body: position, part, P: PART, root: boneIndex.get('root'),
        thighL: boneIndex.get('upperleg01.L'), thighR: boneIndex.get('upperleg01.R') });
      projectUV(skirt);
      write('tennis-skirt', [[tank, 0], [under, 1], [skirt, 2]],
        covered((x, y) => y > underCut + 0.02 && (y < hipY + 0.15 || Math.abs(x) < armCut - 0.015)));
    }
  }

  // texture coordinates: one per vertex; where a vertex sits on a seam of the skin
  // texture, copies are added after the original vertices, with orig[] pointing back
  const firstUV = new Int32Array(n).fill(-1);
  const dupKey = new Map(), dups = []; // [orig vertex, uv]
  const flat = [];
  tris.forEach((t, ti) => t.forEach((v, k) => {
    const u = trisUV[ti][k];
    if (firstUV[v] < 0 || firstUV[v] === u) { firstUV[v] = u; flat.push(v); return; }
    const key = v * 65536 + u;
    if (!dupKey.has(key)) { dupKey.set(key, n + dups.length); dups.push([v, u]); }
    flat.push(dupKey.get(key));
  }));
  const n2 = n + dups.length;
  const grow = (a, per) => { const o = new a.constructor(n2 * per); o.set(a); dups.forEach(([v], d) => { for (let c = 0; c < per; c++) o[(n + d) * per + c] = a[v * per + c]; }); return o; };
  const uv = new Float32Array(n2 * 2), orig = new Uint16Array(n2);
  for (let j = 0; j < n2; j++) {
    const [v, u] = j < n ? [j, firstUV[j]] : dups[j - n];
    orig[j] = v;
    if (u >= 0) { uv[j * 2] = VT[u][0]; uv[j * 2 + 1] = VT[u][1]; }
  }
  // expressions, as deltas on the original vertices (the copies follow their originals)
  const units = readExpressionUnits();
  const exprNames = Object.keys(EXPRESSIONS), exprCounts = [], exprIdx = [], exprDelta = [];
  for (const name of exprNames) {
    const sum = new Map();
    for (const [unit, w] of Object.entries(EXPRESSIONS[name])) {
      for (const [bv, d] of units[unit] || []) {
        if (!used.has(bv)) continue;
        const j = used.get(bv);
        const a = sum.get(j) || [0, 0, 0];
        for (let c = 0; c < 3; c++) a[c] += d[c] * w * s;
        sum.set(j, a);
      }
    }
    exprCounts.push(sum.size);
    for (const [j, d] of sum) { exprIdx.push(j); exprDelta.push(...d); }
  }
  const index = new Uint16Array(flat);
  const arrays = {
    position: grow(position, 3), index, skinIndex: grow(skinIndex, 4), skinWeight: grow(skinWeight, 4),
    part: grow(part, 1), along: grow(along, 1), uv, orig,
    exprIdx: new Uint16Array(exprIdx), exprDelta: new Float32Array(exprDelta),
  };
  const header = {
    format: 'court-rush-body', version: 1, gender, height: targetHeight,
    licence: 'Built from MakeHuman data (hm08 base mesh, default skeleton and weights, macro targets), CC0 1.0, makehumancommunity.org',
    parts: PART, bones, eyes: { l: eyeL, r: eyeR }, frontZ, arrays: {},
    vertexCount: n, // the original vertices; the rest are texture-seam copies (orig[])
    expressions: { names: exprNames, counts: exprCounts, source: 'MakeHuman expression units (CC0 1.0), averaged over its three ethnic variants' },
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
  console.log(`body-${gender}.json: ${n} vertices (+${n2 - n} seam copies), ${exprNames.length} expressions, ${tris.length} triangles, ${bones.length} bones, ${(out.length / 1024).toFixed(0)} KB, parts`, counts);
}


// ---------------------------------------------------------------- garment pieces
// A garment's arrays: position, uv, skinIndex/skinWeight (4 per vertex, bytes),
// index, piece (0 topmost shell), hidden (body vertices it covers).
function splitPieces(A) {
  const out = [[], []];
  for (let t = 0; t < A.index.length; t += 3) out[A.piece[A.index[t]] === 0 ? 0 : 1].push(A.index[t], A.index[t + 1], A.index[t + 2]);
  return out.map((tri) => subset(A, tri));
}
// the vertices a triangle list uses, renumbered
function subset(A, tri) {
  const map = new Map(), ids = [];
  const index = tri.map((v) => { if (!map.has(v)) { map.set(v, ids.length); ids.push(v); } return map.get(v); });
  const pick = (a, per) => { const o = new a.constructor(ids.length * per); ids.forEach((v, i) => { for (let c = 0; c < per; c++) o[i * per + c] = a[v * per + c]; }); return o; };
  return { position: pick(A.position, 3), uv: pick(A.uv, 2), skinIndex: pick(A.skinIndex, 4), skinWeight: pick(A.skinWeight, 4), index: Uint32Array.from(index) };
}
// keep the part where f(position) >= 0, cutting triangles cleanly along f = 0 (f is
// linear along each edge, so the new hem is straight)
function clipGarment(A, f) {
  const pos = Array.from(A.position), uv = Array.from(A.uv), si = Array.from(A.skinIndex), sw = Array.from(A.skinWeight);
  const n0 = A.position.length / 3;
  const val = [];
  for (let i = 0; i < n0; i++) val.push(f([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]));
  const edge = new Map();
  const cutAt = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (edge.has(key)) return edge.get(key);
    const t = val[a] / (val[a] - val[b]);
    const id = pos.length / 3;
    for (let c = 0; c < 3; c++) pos.push(pos[a * 3 + c] + (pos[b * 3 + c] - pos[a * 3 + c]) * t);
    for (let c = 0; c < 2; c++) uv.push(uv[a * 2 + c] + (uv[b * 2 + c] - uv[a * 2 + c]) * t);
    const src = t < 0.5 ? a : b;
    for (let c = 0; c < 4; c++) { si.push(si[src * 4 + c]); sw.push(sw[src * 4 + c]); }
    val.push(0);
    edge.set(key, id);
    return id;
  };
  const tri = [];
  for (let t = 0; t < A.index.length; t += 3) {
    const v = [A.index[t], A.index[t + 1], A.index[t + 2]];
    const inside = v.map((i) => val[i] >= 0);
    if (inside.every(Boolean)) { tri.push(...v); continue; }
    if (!inside.some(Boolean)) continue;
    const poly = [];
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3];
      if (val[a] >= 0) poly.push(a);
      if ((val[a] >= 0) !== (val[b] >= 0)) poly.push(cutAt(a, b));
    }
    for (let k = 1; k + 1 < poly.length; k++) tri.push(poly[0], poly[k], poly[k + 1]);
  }
  const full = { position: Float32Array.from(pos), uv: Float32Array.from(uv), skinIndex: Uint8Array.from(si), skinWeight: Uint8Array.from(sw) };
  return subset(full, tri);
}
// one garment from several, each with its piece number
function mergeGarments(list) {
  const nv = list.reduce((a, [g]) => a + g.position.length / 3, 0);
  const out = { position: new Float32Array(nv * 3), uv: new Float32Array(nv * 2), skinIndex: new Uint8Array(nv * 4), skinWeight: new Uint8Array(nv * 4), piece: new Uint8Array(nv) };
  const index = [];
  let at = 0;
  for (const [g, piece] of list) {
    const n = g.position.length / 3;
    out.position.set(g.position, at * 3); out.uv.set(g.uv, at * 2);
    out.skinIndex.set(g.skinIndex, at * 4); out.skinWeight.set(g.skinWeight, at * 4);
    out.piece.fill(piece, at, at + n);
    for (const v of g.index) index.push(v + at);
    at += n;
  }
  out.index = nv > 65535 ? new Uint32Array(index) : new Uint16Array(index);
  return out;
}
// A pleated tennis skirt: rings from the waist to the hem following the outline of the
// hips and legs (and the undershorts) with a little ease, flaring toward the hem, with
// sixteen knife pleats that deepen as they fall. The waist moves with the hips; lower
// down it follows the thighs more and more (the nearer thigh most).
function makeSkirt({ waistY, hemY, under, body, part, P, root, thighL, thighR }) {
  const SEG = 128, RINGS = 14, PLEATS = 16;
  const pts = [];
  for (let i = 0; i < body.length / 3; i++) {
    if ([P.upperarm, P.forearm, P.hand].includes(part[i])) continue;
    pts.push([body[i * 3], body[i * 3 + 1], body[i * 3 + 2]]);
  }
  for (let i = 0; i < under.position.length / 3; i++) pts.push([under.position[i * 3], under.position[i * 3 + 1], under.position[i * 3 + 2]]);
  let cx = 0, cz = 0, cn = 0;
  for (const p of pts) if (Math.abs(p[1] - waistY) < 0.02) { cx += p[0]; cz += p[2]; cn++; }
  cx /= cn; cz /= cn;
  const position = [], skinIndex = [], skinWeight = [], index = [];
  let prev = null;
  for (let r = 0; r < RINGS; r++) {
    const t = r / (RINGS - 1), y = waistY + (hemY - waistY) * t;
    const rad = new Float32Array(SEG);
    for (const p of pts) {
      if (Math.abs(p[1] - y) > 0.02) continue;
      const a = Math.atan2(p[0] - cx, p[2] - cz);
      const b = ((Math.round((a / (2 * Math.PI)) * SEG) % SEG) + SEG) % SEG;
      rad[b] = Math.max(rad[b], Math.hypot(p[0] - cx, p[2] - cz));
    }
    // fill gaps, smooth round the ring, never narrower than the ring above
    for (let k = 0; k < SEG; k++) if (!rad[k]) rad[k] = Math.max(rad[(k + 1) % SEG], rad[(k + SEG - 1) % SEG]);
    const sm = rad.map((_, k) => { let m = 0; for (let d = -6; d <= 6; d++) m = Math.max(m, rad[(k + d + SEG) % SEG]); return m; });
    const ring = sm.map((_, k) => { let a = 0; for (let d = -4; d <= 4; d++) a += sm[(k + d + SEG) % SEG]; return a / 9; });
    if (prev) for (let k = 0; k < SEG; k++) ring[k] = Math.max(ring[k], prev[k]);
    prev = ring;
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * 2 * Math.PI;
      const saw = ((k * PLEATS) / SEG) % 1; // a knife pleat: a slow rise, then a fold
      const R = ring[k] + 0.012 + 0.032 * Math.pow(t, 1.3) + (0.002 + 0.009 * t) * saw;
      const x = cx + Math.sin(a) * R, z = cz + Math.cos(a) * R;
      position.push(x, y, z);
      const wt = 0.8 * Math.pow(t, 1.2), wl = Math.min(1, Math.max(0, 0.5 + (x - cx) / 0.22));
      const w = [[root, 1 - wt], [thighL, wt * wl], [thighR, wt * (1 - wl)]].filter(([, v]) => v > 0.004);
      let left = 255;
      for (let c = 0; c < 4; c++) {
        const e = w[c];
        const q = !e ? 0 : c === w.length - 1 ? left : Math.round(e[1] * 255);
        skinIndex.push(e ? e[0] : 0); skinWeight.push(q); left -= q;
      }
    }
    if (r > 0) for (let k = 0; k < SEG; k++) {
      const a = (r - 1) * SEG + k, b = (r - 1) * SEG + (k + 1) % SEG, c = r * SEG + k, d = r * SEG + (k + 1) % SEG;
      index.push(a, c, b, b, c, d);
    }
  }
  return { position: Float32Array.from(position), uv: new Float32Array(position.length / 3 * 2), skinIndex: Uint8Array.from(skinIndex), skinWeight: Uint8Array.from(skinWeight), index: Uint32Array.from(index) };
}

// the pieces each build ships with (src/assets/kit): see README for the list
// T-shirt and shorts (MakeHuman's female_casualsuit02 cut, recoloured in game), trainers
// with socks (shoes05), and three real hair meshes
const KIT = ['shoes05', 'short02', 'ponytail01', 'afro01'];
const GARMENTS = { male: KIT, female: KIT };

build('male', { muscle: 0.4, height: 0.3, targetHeight: 1.86 });
build('female', { muscle: 0.3, height: 0.2, targetHeight: 1.74 });
