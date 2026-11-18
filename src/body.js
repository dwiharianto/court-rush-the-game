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

// ---- the kit: real garments fitted to each body (MakeHuman CC0 assets), see
// tools/build-bodies.mjs. Listed one by one so the bundler ships each file.
const KIT_FILES = {
  male: {
    outfit: new URL('./assets/kit/male-female_casualsuit02.json', import.meta.url).href,
    shoes: new URL('./assets/kit/male-shoes05.json', import.meta.url).href,
    short: new URL('./assets/kit/male-short02.json', import.meta.url).href,
    long: new URL('./assets/kit/male-ponytail01.json', import.meta.url).href,
    curly: new URL('./assets/kit/male-afro01.json', import.meta.url).href,
  },
  female: {
    outfit: new URL('./assets/kit/female-female_casualsuit02.json', import.meta.url).href,
    shoes: new URL('./assets/kit/female-shoes05.json', import.meta.url).href,
    short: new URL('./assets/kit/female-short02.json', import.meta.url).href,
    long: new URL('./assets/kit/female-ponytail01.json', import.meta.url).href,
    curly: new URL('./assets/kit/female-afro01.json', import.meta.url).href,
  },
};
const KIT_TEXTURES = {
  outfitNormal: new URL('./assets/kit/textures/outfit_female_casualsuit02_normal.jpg', import.meta.url).href,
  shoes: new URL('./assets/kit/textures/outfit_shoes05.jpg', import.meta.url).href,
  short: new URL('./assets/kit/textures/hair_short02.png', import.meta.url).href,
  long: new URL('./assets/kit/textures/hair_ponytail01.png', import.meta.url).href,
  curly: new URL('./assets/kit/textures/hair_afro01.png', import.meta.url).href,
};
const kits = {};

// Fetches the garments for both bodies and their textures once.
export async function loadKit() {
  const loader = new THREE.TextureLoader();
  const textures = {};
  await Promise.all(Object.entries(KIT_TEXTURES).map(async ([k, url]) => {
    const t = await loader.loadAsync(url);
    if (k !== 'outfitNormal') t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    textures[k] = t;
  }));
  await Promise.all(Object.entries(KIT_FILES).map(async ([g, files]) => {
    const kit = { textures };
    await Promise.all(Object.entries(files).map(async ([k, url]) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`kit ${g} ${k}: ${res.status}`);
      kit[k] = parseBody(await res.json());
    }));
    kits[g] = kit;
  }));
  return kits;
}

export function getKit(gender) {
  return kits[gender] || null;
}
