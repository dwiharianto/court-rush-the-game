// Builds the spectators' bodies: the player bodies (src/assets/body-*.json, MakeHuman
// data, CC0) simplified to about a tenth of their triangles with meshoptimizer, in the
// same format, so the game's rig can pose them and bake them into crowd poses.
// Writes src/assets/crowd-male.json and crowd-female.json.
//
//   node tools/build-crowd.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, '../src/assets');
const TARGET_TRIS = 800;
const T = { Float32Array, Uint16Array, Uint32Array, Uint8Array };

await MeshoptSimplifier.ready;
for (const gender of ['male', 'female']) {
  const json = JSON.parse(readFileSync(join(ASSETS, `body-${gender}.json`), 'utf8'));
  const bytes = Buffer.from(json.data, 'base64');
  const A = {};
  for (const [name, a] of Object.entries(json.arrays)) {
    A[name] = new T[a.type](bytes.buffer.slice(bytes.byteOffset + a.offset, bytes.byteOffset + a.offset + a.length * T[a.type].BYTES_PER_ELEMENT));
  }
  const n = A.position.length / 3;
  const [idx, err] = MeshoptSimplifier.simplify(Uint32Array.from(A.index), A.position, 3, TARGET_TRIS * 3, 0.02);
  // keep only the vertices still used, renumbered
  const remap = new Int32Array(n).fill(-1);
  let m = 0;
  for (const v of idx) if (remap[v] < 0) remap[v] = m++;
  const out = {};
  for (const [name, arr] of Object.entries(A)) {
    if (name === 'index') continue;
    const per = arr.length / n;
    const o = new arr.constructor(m * per);
    for (let v = 0; v < n; v++) if (remap[v] >= 0) for (let k = 0; k < per; k++) o[remap[v] * per + k] = arr[v * per + k];
    out[name] = o;
  }
  out.index = Uint16Array.from(idx, (v) => remap[v]);
  // same layout as build-bodies.mjs: the header plus every array as base64
  const { data, arrays, ...header } = json;
  header.format = 'court-rush-body';
  header.licence += '; simplified for the crowd with meshoptimizer (MIT)';
  header.arrays = {};
  let offset = 0;
  const chunks = [];
  for (const [name, arr] of Object.entries(out)) {
    offset += (4 - (offset % 4)) % 4;
    chunks.push([offset, arr]);
    header.arrays[name] = { type: arr.constructor.name, offset, length: arr.length };
    offset += arr.byteLength;
  }
  const blob = Buffer.alloc(offset);
  for (const [at, arr] of chunks) Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(blob, at);
  header.data = blob.toString('base64');
  const file = Buffer.from(JSON.stringify(header));
  writeFileSync(join(ASSETS, `crowd-${gender}.json`), file);
  console.log(`crowd-${gender}.json: ${m} vertices, ${out.index.length / 3} triangles (from ${A.index.length / 3}), error ${err.toFixed(4)}, ${(file.length / 1024).toFixed(0)} KB`);
}
