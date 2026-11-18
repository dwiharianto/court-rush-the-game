// The player's look and name, chosen on the start screen, plus each match's CPU
// opponent. The CPU's names are invented; none belongs to a real player.

export const PALETTE = {
  skin: [0xf1c9a5, 0xe0ac85, 0xd9a37c, 0xb98058, 0x8d5a3b, 0x5e3b27],
  hair: [0x1a1512, 0x2a1d14, 0x5a3a22, 0x9a6a3a, 0xd8b56e, 0x8a8a88],
  shirt: [0x2f9e58, 0xf6f6f2, 0x1d3f8f, 0xc23a32, 0xf2c14e, 0x5b2d82, 0x1b1f27, 0xf08a3c],
  shorts: [0x2452a6, 0xf0f0ec, 0x1b1f27, 0x6b7280, 0x0f5f4c, 0xc23a32],
  shoes: [0xf4f4f4, 0x1b1f27, 0xd8f23a, 0x2f7de1, 0xe0464b],
};
export const BUILDS = [['male', 'Male'], ['female', 'Female']];
export const HAIR_STYLES = [['short', 'Short'], ['buzz', 'Buzz'], ['long', 'Ponytail'], ['curly', 'Curly'], ['none', 'None']];
export const HEADWEAR = [['none', 'None'], ['cap', 'Cap'], ['headband', 'Headband']];

export const DEFAULT_PROFILE = {
  name: 'L. MARLOW', build: 'male',
  skin: 0xd9a37c, hair: 0x2a1d14, hairStyle: 'short', headwear: 'none',
  shirt: 0x2f9e58, shorts: 0x2452a6, shoes: 0xf4f4f4,
};

// Invented names for the CPU. Coined surnames on purpose, so no real player's
// name can come up.
export const CPU_NAMES = [
  'D. VESPER', 'R. QUILLAN', 'T. MARSDEVE', 'J. KORVELL', 'A. ESTOVAR', 'M. BRANWICK',
  'S. VALLOREN', 'H. OSTERLY', 'P. DRAVICK', 'E. MONTARRE', 'K. LINDQVALE', 'C. HARROWEN',
  'F. SELVANDI', 'G. WYNTHORPE', 'I. RAVENNE', 'O. FALKREN', 'N. TORVASSE', 'B. CALDREIGH',
];

const NAME_MAX = 14;

// Upper case letters, spaces and . ' - only; empty falls back to the default.
export function cleanName(text) {
  const t = String(text || '').toUpperCase().replace(/[^A-Z .'-]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return t || DEFAULT_PROFILE.name;
}

const pick = (list, v, fallback) => (list.includes(v) ? v : fallback);

// A clean profile: unknown values fall back to the defaults.
export function sanitize(p = {}) {
  const d = DEFAULT_PROFILE;
  return {
    name: cleanName(p.name),
    build: pick(BUILDS.map((b) => b[0]), p.build, d.build),
    skin: pick(PALETTE.skin, p.skin, d.skin),
    hair: pick(PALETTE.hair, p.hair, d.hair),
    hairStyle: pick(HAIR_STYLES.map((h) => h[0]), p.hairStyle, d.hairStyle),
    headwear: pick(HEADWEAR.map((h) => h[0]), p.headwear, d.headwear),
    shirt: pick(PALETTE.shirt, p.shirt, d.shirt),
    shorts: pick(PALETTE.shorts, p.shorts, d.shorts),
    shoes: pick(PALETTE.shoes, p.shoes, d.shoes),
  };
}

const KEY = 'courtRush.player';
export function loadProfile() {
  try { return sanitize(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return sanitize(); }
}
export function saveProfile(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}

// Figure options for a profile. Headwear matches the shirt (white on a dark shirt).
export function kitFor(p, racketColor = 0x16181c) {
  const dark = [0x1b1f27, 0x1d3f8f, 0x5b2d82].includes(p.shirt);
  return {
    build: p.build,
    skin: p.skin, hair: p.hair, hairStyle: p.hairStyle, headwear: p.headwear,
    headwearColor: dark ? 0xf4f4f4 : p.shirt,
    shirt: p.shirt, shorts: p.shorts, shoes: p.shoes, racketColor,
  };
}

export function randomProfile(rng = Math.random) {
  const any = (list) => list[Math.floor(rng() * list.length)];
  return sanitize({
    name: DEFAULT_PROFILE.name, build: any(BUILDS)[0],
    skin: any(PALETTE.skin), hair: any(PALETTE.hair), hairStyle: any(HAIR_STYLES)[0], headwear: any(HEADWEAR)[0],
    shirt: any(PALETTE.shirt), shorts: any(PALETTE.shorts), shoes: any(PALETTE.shoes),
  });
}

function colourDistance(a, b) {
  const d = (s) => Math.abs(((a >> s) & 255) - ((b >> s) & 255));
  return d(16) + d(8) + d(0);
}

// The CPU opponent for a match: an invented name and a look that never clashes
// with the player's shirt, so the two are easy to tell apart.
export function cpuOpponent(player, rng = Math.random) {
  const p = randomProfile(rng);
  const shirts = PALETTE.shirt.filter((c) => colourDistance(c, player.shirt) > 200);
  p.shirt = shirts[Math.floor(rng() * shirts.length)];
  const names = CPU_NAMES.filter((n) => n !== player.name);
  p.name = names[Math.floor(rng() * names.length)];
  return p;
}
