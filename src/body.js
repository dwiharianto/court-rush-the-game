// Loads a player body built by tools/build-bodies.mjs (MakeHuman data, CC0) and
// turns it into a skinned three.js mesh coloured with a tennis kit.
import * as THREE from 'three';

const URLS = {
  male: new URL('./assets/body-male.json', import.meta.url).href,
  female: new URL('./assets/body-female.json', import.meta.url).href,
};
const cache = {};

const TYPES = { Float32Array, Uint16Array, Uint32Array, Uint8Array };

// The file is JSON: a header (bones, eyes, array layout) plus the arrays as one
// base64 blob.
export function parseBody(json) {
  const bin = atob(json.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const arrays = {};
  for (const [name, a] of Object.entries(json.arrays)) {
    arrays[name] = new TYPES[a.type](bytes.buffer, a.offset, a.length);
  }
  const { data, ...header } = json;
  return { ...header, arrays };
}

// Fetches and parses both bodies once.
export async function loadBodies() {
  await Promise.all(Object.entries(URLS).map(async ([g, url]) => {
    if (cache[g]) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`body ${g}: ${res.status}`);
    cache[g] = parseBody(await res.json());
  }));
  return cache;
}

export function getBody(gender) {
  return cache[gender] || cache.male || null;
}
