// Looks for each event: the hard court's colours, the time of day, the stadium's
// colours, the club's windscreen and trees, and how full the stands are. Career and
// tournament events each get their own, so no two weeks look quite the same; the
// four Crowns have fixed signature looks. Exhibitions use the default.

// lighting presets: hemisphere and sun (floodlights at night), the stadium's dark
// backdrop, and the club's sky and distant hills
export const LIGHTS = {
  day: { hemiSky: 0xe6edff, hemiGround: 0x4a3830, hemi: 1.25, sun: 0xfff3e0, sunI: 2.3, pos: [-15, 26, 12], stadiumBg: 0x0b0e13, sky: [0xe3edf3, 0x6fa6da], hills: [0x4d6e4f, 0x8fa9a0] },
  evening: { hemiSky: 0xffd9b8, hemiGround: 0x3a2a22, hemi: 0.95, sun: 0xffb070, sunI: 2.1, pos: [-34, 11, 4], stadiumBg: 0x120d0c, sky: [0xf6c18c, 0x5f78b0], hills: [0x3c4a3a, 0x9a8c90] },
  night: { hemiSky: 0x9aa8c8, hemiGround: 0x14181e, hemi: 0.6, sun: 0xf4f7ff, sunI: 2.0, pos: [3, 34, 9], stadiumBg: 0x040507, sky: [0x18213a, 0x04060c], hills: [0x0f1612, 0x1d2433] },
};

export const DEFAULT_THEME = {
  light: 'day', hard: '#2f5d93', hardFloor: '#36624e',
  wall: 0x12161d, stand: 0x191d24, accent: '#0e2a47',
  screen: '#1f4a35', foliage: 'summer', fill: 1,
};

const HARD = [['#2f5d93', '#36624e'], ['#2f7a55', '#2b4d3c'], ['#5b4a8c', '#3b3352'], ['#2a7f88', '#2b4752'], ['#3d4f8f', '#7a3b36']];
const STADIUM = [
  [0x12161d, 0x191d24, '#0e2a47'], [0x1d1420, 0x221826, '#5b2d82'], [0x0f1d1a, 0x13221e, '#1f6a48'],
  [0x1d1712, 0x241c16, '#8a4b1f'], [0x101a2a, 0x132036, '#1d3f8f'], [0x1f1214, 0x26161a, '#9a2a35'],
];
const SCREENS = ['#1f4a35', '#0e2a47', '#5a1f2b', '#2b2f36', '#3b2f5a'];
const FILL = { jClub: 0.35, jOpen: 0.55, jCrown: 0.85, circuit: 0.3, contender: 0.55, tour: 0.85, crown: 1 };

// the Crowns' signature looks
const CROWN_LOOKS = {
  'PORTO VELANO': { light: 'day', wall: 0x1d1712, stand: 0x241c16, accent: '#b9573a', screen: '#5a1f2b' },
  ASHBRIDGE: { light: 'day', wall: 0x0f1d1a, stand: 0x13221e, accent: '#4a2a6a', screen: '#1f4a35' },
  'HARBOUR CITY': { light: 'night', hard: '#2f5d93', hardFloor: '#36624e', wall: 0x101a2a, stand: 0x132036, accent: '#1d3f8f' },
  'MERIDIAN BAY': { light: 'evening', hard: '#2a7f88', hardFloor: '#2b4752', wall: 0x101a2a, stand: 0x132036, accent: '#0a6c74' },
};

function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// the season's trees: blossom in spring, green in summer, turning late in the year
const foliageOfWeek = (w) => (w == null ? 'summer' : w <= 2 ? 'spring' : w >= 9 ? 'autumn' : 'summer');

// event: { id?, name, tier?, venue?, week? } from the career, or a tournament event
export function themeForEvent(e) {
  if (!e) return DEFAULT_THEME;
  const h = hash(e.id || e.name);
  const pick = (list, salt) => list[(h >>> salt) % list.length];
  const crown = Object.keys(CROWN_LOOKS).find((city) => String(e.name).startsWith(city));
  const [wall, stand, accent] = pick(STADIUM, 3);
  const [hard, hardFloor] = pick(HARD, 7);
  const roll = (h >>> 11) % 100;
  const stadium = e.venue === 'stadium';
  const light = stadium ? (roll < 35 ? 'night' : roll < 60 ? 'evening' : 'day') : roll < 25 ? 'evening' : 'day';
  const theme = {
    ...DEFAULT_THEME,
    light, hard, hardFloor, wall, stand, accent,
    screen: pick(SCREENS, 13),
    foliage: foliageOfWeek(e.week),
    fill: FILL[e.tier] ?? 1,
  };
  if (crown) Object.assign(theme, CROWN_LOOKS[crown], { fill: e.tier === 'jCrown' ? FILL.jCrown : 1 });
  return theme;
}
