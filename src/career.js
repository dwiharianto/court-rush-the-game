// Career mode: from a 14-year-old junior to the pro tour and, one day, retirement.
//
// Pure logic and plain data, so a career can be saved, exported and tested headless.
// The world is a tour of invented players who age, improve, peak and retire; each
// season is twelve weeks of events in invented tiers, from junior club events to the
// four Crown events; rankings count the last twelve weeks of results. The player
// enters one event a week (or rests), plays or simulates each match, and the rest of
// the week is simulated from the players' ratings.
//
// Stages: 'junior' (14 to 17), then 'pro'. College is the optional path in between,
// still to come: the decision at 18 already offers it.
import { AI } from './config.js';

export const WEEKS = 12;
const JUNIOR_POOL = 64, PRO_POOL = 128;
const START_AGE = 14, JUNIOR_LAST_AGE = 17, RETIRE_FORCED = 36;

// ---------------------------------------------------------------- tiers and events
// points: winner, finalist, semi-finalist, quarter-finalist, last 16, last 32
export const TIERS = {
  jClub: { stage: 'junior', label: 'Junior Club Series', short: 'J-CLUB', draw: 8, points: [30, 18, 10, 5], venue: 'club', maxRank: 0, rank: 0 },
  jOpen: { stage: 'junior', label: 'Junior Open', short: 'J-OPEN', draw: 16, points: [100, 60, 36, 18, 6], venue: 'club', maxRank: 40, rank: 1 },
  jCrown: { stage: 'junior', label: 'Junior Crown', short: 'J-CROWN', draw: 32, points: [300, 180, 110, 60, 30, 12], venue: 'stadium', maxRank: 20, rank: 2 },
  circuit: { stage: 'pro', label: 'Circuit', short: 'CIRCUIT', draw: 16, points: [25, 15, 8, 4, 1], venue: 'club', maxRank: 0, rank: 0 },
  contender: { stage: 'pro', label: 'Contender Series', short: 'CONTENDER', draw: 16, points: [100, 60, 35, 18, 7], venue: 'club', maxRank: 90, rank: 1 },
  tour: { stage: 'pro', label: 'Tour', short: 'TOUR', draw: 16, points: [300, 180, 110, 55, 25], venue: 'stadium', maxRank: 48, rank: 2 },
  crown: { stage: 'pro', label: 'Crown', short: 'CROWN', draw: 32, points: [1000, 600, 360, 180, 90, 45], venue: 'stadium', maxRank: 32, rank: 3 },
};
const ROUND_NAMES = { 2: 'FINAL', 4: 'SEMI-FINAL', 8: 'QUARTER-FINAL', 16: 'LAST 16', 32: 'LAST 32' };

// The four Crown events, the season's biggest, for juniors and pros alike.
export const CROWNS = [
  { city: 'PORTO VELANO', name: 'PORTO VELANO OPEN', surface: 'clay' },
  { city: 'ASHBRIDGE', name: 'ASHBRIDGE LAWN CHAMPIONSHIPS', surface: 'grass' },
  { city: 'HARBOUR CITY', name: 'HARBOUR CITY MASTERS', surface: 'hard' },
  { city: 'MERIDIAN BAY', name: 'MERIDIAN BAY CLASSIC', surface: 'hard' },
];
const CITIES = [
  'WILLOWMERE', 'CASTELROCK', 'LINDENFELD', 'SALTMARSH', 'CORVALLEN', 'RIVENHALL', 'MONTELUCE', 'OAKHAVEN',
  'VALDORO', 'KINGSFERRY', 'SUNDALE', 'NORRHOLM', 'ALDMOOR', 'BELLACOSTA', 'GREYWATER', 'MARRENFORD',
  'TALVERA', 'ESKBY', 'PORTHALLOW', 'SILVANO',
];
// the season's swings: hard courts to start, then clay, a short grass swing, and hard to finish
const SURFACE_OF_WEEK = ['hard', 'hard', 'hard', 'clay', 'clay', 'clay', 'grass', 'grass', 'hard', 'hard', 'hard', 'hard'];
const ROTATE = ['hard', 'clay', 'grass'];
// the tiers on offer each week; the Crowns fall in weeks 3, 6, 8 and 12 (index: CROWNS)
const CROWN_WEEK = { 2: 3, 5: 0, 7: 1, 11: 2 };
const SCHEDULE = {
  junior: [['jClub'], ['jClub', 'jOpen'], ['jCrown', 'jClub'], ['jOpen', 'jClub'], ['jClub', 'jOpen'], ['jCrown', 'jClub'],
    ['jOpen', 'jClub'], ['jCrown', 'jClub'], ['jClub', 'jOpen'], ['jOpen', 'jClub'], ['jClub', 'jOpen'], ['jCrown', 'jClub']],
  pro: [['circuit', 'contender', 'tour'], ['circuit', 'contender', 'tour'], ['crown', 'circuit'], ['tour', 'contender', 'circuit'],
    ['circuit', 'contender', 'tour'], ['crown', 'circuit'], ['tour', 'contender', 'circuit'], ['crown', 'contender', 'circuit'],
    ['circuit', 'contender', 'tour'], ['tour', 'contender', 'circuit'], ['circuit', 'contender', 'tour'], ['crown', 'circuit']],
};

// The events of one week: plain data with a stable id.
export function weekEvents(stage, season, week) {
  let others = 0; // events beyond the first that is not a Crown: these go on other surfaces
  return SCHEDULE[stage][week].map((tierId, i) => {
    const T = TIERS[tierId];
    const swing = SURFACE_OF_WEEK[week];
    let name, surface = swing, venue = T.venue;
    if (tierId !== 'crown' && tierId !== 'jCrown') {
      const n = others++;
      // the week's swing for the first, then a different court for each of the rest
      if (n > 0) surface = ROTATE[(ROTATE.indexOf(swing) + n + ((season + week) % 2)) % 3];
      if (surface === swing && n > 0) surface = ROTATE[(ROTATE.indexOf(swing) + 1) % 3];
    }
    if (tierId === 'crown' || tierId === 'jCrown') {
      const c = CROWNS[CROWN_WEEK[week]];
      name = tierId === 'crown' ? c.name : `${c.city} JUNIOR CHAMPIONSHIPS`;
      surface = c.surface;
    } else {
      const city = CITIES[(season * 7 + week * 3 + i * 5 + T.rank * 11) % CITIES.length];
      name = `${city} ${{ jClub: 'JUNIOR CLASSIC', jOpen: 'JUNIOR OPEN', circuit: 'CIRCUIT', contender: 'CONTENDER', tour: 'OPEN' }[tierId]}`;
      if (tierId === 'contender' && week % 2) venue = 'stadium';
    }
    return { id: `${stage}-${season}-${week}-${tierId}`, tier: tierId, stage, name, surface, venue, draw: T.draw, week };
  });
}

// ---------------------------------------------------------------- randomness and names
function rngFrom(state) {
  let s = state >>> 0 || 1;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  next.state = () => s;
  return next;
}
// the career's random stream; its position is saved with the career
function rng(c) {
  const r = rngFrom(c.rng);
  return () => { const v = r(); c.rng = r.state(); return v; };
}

// Invented surnames from coined syllables, so no real player's name comes up.
const NAME_A = ['VEL', 'KOR', 'DRA', 'OST', 'LIND', 'BRAN', 'QUIL', 'TOR', 'FAL', 'SEL', 'WYN', 'RAV', 'CAL', 'THAL', 'VES',
  'GAL', 'PEL', 'ZAN', 'OBER', 'RUV', 'SAB', 'KEL', 'DUN', 'FEN', 'ALV', 'BRES', 'MOR', 'HAL', 'TEV', 'ISK', 'NAR', 'ULV'];
const NAME_B = ['VEN', 'DICK', 'REIGH', 'QVALE', 'WICK', 'LANE', 'ORNE', 'ASSE', 'REN', 'ANDI', 'THORPE', 'ENNE', 'SBY', 'MIRE',
  'LUND', 'ARRO', 'ETTI', 'OVIC', 'AIN', 'ERY', 'OLT', 'UMBE', 'ISKA', 'ARDO', 'ENCE', 'OVAR', 'IX', 'AUX', 'WEN', 'ESSA', 'ORIN'];
const INITIALS = 'ABCDEFGHIJKLMNOPRSTVWZ';
function inventName(r, taken) {
  for (let k = 0; k < 50; k++) {
    const n = `${INITIALS[Math.floor(r() * INITIALS.length)]}. ${NAME_A[Math.floor(r() * NAME_A.length)]}${NAME_B[Math.floor(r() * NAME_B.length)]}`;
    if (n.length <= 14 && !taken.has(n)) { taken.add(n); return n; }
  }
  return `P. ${taken.size}`;
}

// ---------------------------------------------------------------- ratings
// Ratings run from 0 to 100. Each player has a potential and follows an age curve:
// fast growth as a junior, a peak in the mid-20s, a slow decline in the 30s.
const CURVE = [[14, 0.42], [15, 0.5], [16, 0.58], [17, 0.66], [18, 0.73], [20, 0.83], [22, 0.91], [24, 0.97], [26, 1], [29, 1], [31, 0.96], [33, 0.9], [36, 0.8]];
export function ageCurve(age) {
  if (age <= CURVE[0][0]) return CURVE[0][1];
  for (let i = 1; i < CURVE.length; i++) {
    const [a1, v1] = CURVE[i], [a0, v0] = CURVE[i - 1];
    if (age <= a1) return v0 + ((v1 - v0) * (age - a0)) / (a1 - a0);
  }
  return CURVE[CURVE.length - 1][1];
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// chance that a beats b
export const winChance = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 18));

// The CPU's settings for a rating: between the game's Easy (35), Normal (55) and
// Hard (75), extended a little either side and kept within sensible limits.
const ANCHORS = [[35, 'easy'], [55, 'normal'], [75, 'hard']];
const LIMITS = {
  speed: [4.2, 6.8], errorSize: [0.3, 1.8], errorRate: [0.012, 0.16], reaction: [0.07, 0.5], recover: [0.4, 0.85],
  reach: [1.25, 1.6], pressure: [0.45, 1.3], pressureMiss: [0.03, 0.22], awayChance: [0.4, 0.95], shotSpeed: [18, 34],
  serveSpeed: [27, 50], serveError: [0.035, 0.13], netRush: [0.08, 0.45], diveChance: [0.05, 0.4], fitness: [0.75, 1.35],
};
export function levelForRating(rating) {
  const r = clamp(rating, 10, 100);
  const i = r <= ANCHORS[1][0] ? 0 : 1;
  const [r0, n0] = ANCHORS[i], [r1, n1] = ANCHORS[i + 1];
  const t = (r - r0) / (r1 - r0);
  const a = AI.levels[n0], b = AI.levels[n1];
  const out = {};
  for (const k of Object.keys(b)) {
    const v = a[k] + (b[k] - a[k]) * t;
    out[k] = LIMITS[k] ? clamp(v, LIMITS[k][0], LIMITS[k][1]) : v;
  }
  return out;
}
const DIFFICULTY_SHIFT = { easy: -12, normal: 0, hard: 8 };

// ---------------------------------------------------------------- the world
function newPlayer(r, taken, age, id) {
  // a few have the potential to be great; most will be solid tour players
  const potential = clamp(52 + r() * 34 + (r() < 0.12 ? 10 : 0), 50, 97);
  const rating = clamp(potential * ageCurve(age) + (r() - 0.5) * 8, 12, 97);
  return {
    id, name: inventName(r, taken), age, potential, rating,
    style: ['baseliner', 'big server', 'all-court', 'counter-puncher'][Math.floor(r() * 4)],
    results: [], // { w: week number, p: points }
    titles: 0, retired: false,
  };
}

export function createCareer({ name, build = 'male', difficulty = 'normal', gamesToWin = 3, seed = Date.now() } = {}) {
  const c = {
    version: 1, seed, rng: (seed >>> 0) || 1,
    settings: { difficulty, gamesToWin, build },
    season: 1, week: 0, t: 0, // t: weeks played since the start, for the rolling rankings
    players: [], nextId: 1,
    you: {
      id: 0, name, age: START_AGE, stage: 'junior', rating: 30, potential: 88,
      results: [], record: { w: 0, l: 0 }, titles: [], best: { junior: null, pro: null },
      wildcards: 0, history: [], fitness: 1, turnedPro: null, retired: false,
    },
    current: null, // the event the player is in
    pending: null, // a decision waiting: 'college-or-pro'
    log: [], // news of the career, newest last
    story: { queue: [], flags: {}, trust: 0, heat: 0, h2h: { w: 0, l: 0 }, rival: null, coach: 'ROSA HALVIK' },
  };
  const r = rng(c);
  const taken = new Set([name]);
  for (let i = 0; i < JUNIOR_POOL; i++) c.players.push(newPlayer(r, taken, START_AGE + (i % 4), c.nextId++));
  for (let i = 0; i < PRO_POOL; i++) c.players.push(newPlayer(r, taken, 18 + Math.floor(r() * 17), c.nextId++));
  c.taken = [...taken];
  // the rival: the most promising junior of the player's own age
  const peers = c.players.filter((p) => p.age === START_AGE).sort((a, b) => b.potential - a.potential);
  const rival = peers[0];
  rival.potential = Math.max(rival.potential, 90);
  rival.rating = clamp(rival.potential * ageCurve(START_AGE) + 2, 0, 100);
  c.story.rival = rival.id;
  // a season already played, so the rankings mean something on day one
  for (let w = 0; w < WEEKS; w++) { simulateWeek(c, null, w); c.t++; }
  for (const p of c.players) p.results = p.results.map((x) => ({ ...x, w: x.w - WEEKS }));
  c.t = 0;
  c.log = [];
  return c;
}

export const stageOf = (p) => (p.age <= JUNIOR_LAST_AGE ? 'junior' : 'pro');
const youStage = (c) => c.you.stage;
const byId = (c, id) => (id === 0 ? c.you : c.players.find((p) => p.id === id));

// rolling ranking points on one tour: results from the last twelve weeks
export function pointsOf(p, t, stage) {
  let s = 0;
  for (const x of p.results) if (x.w > t - WEEKS && x.w <= t && (!stage || x.s === stage)) s += x.p;
  return s;
}
// the ranking list of a stage, the player included when in that stage
export function rankings(c, stage) {
  const list = c.players.filter((p) => !p.retired && stageOf(p) === stage);
  if (youStage(c) === stage && !c.you.retired) list.push(c.you);
  return list
    .map((p) => ({ p, pts: pointsOf(p, c.t, stage) }))
    .sort((a, b) => b.pts - a.pts || b.p.rating - a.p.rating)
    .map((x, i) => ({ id: x.p.id, name: x.p.name, age: x.p.age, pts: x.pts, rank: i + 1, you: x.p === c.you, rival: x.p.id === c.story.rival }));
}
export function rankOf(c, id, stage = youStage(c)) {
  const e = rankings(c, stage).find((x) => x.id === id);
  return e && e.pts > 0 ? e.rank : null;
}

// ---------------------------------------------------------------- draws
// seed order for a draw of n: slot i holds seed order[i]
function seedOrder(n) {
  let s = [1, 2];
  while (s.length < n) { const m = s.length * 2 + 1; s = s.flatMap((x) => [x, m - x]); }
  return s;
}
function makeDraw(event, entrants) {
  // entrants arrive best first; the draw is fully seeded
  const order = seedOrder(event.draw);
  const slots = order.map((s) => entrants[s - 1].id);
  const first = [];
  for (let i = 0; i < slots.length; i += 2) first.push({ a: slots[i], b: slots[i + 1], winner: null, score: '' });
  return { event, entrants: entrants.map((e) => e.id), seeds: Object.fromEntries(entrants.slice(0, event.draw / 4).map((e, i) => [e.id, i + 1])), rounds: [first], round: 0, done: false, champion: null };
}
function scoreline(r, toWin) {
  if (r() < 0.18) return `${toWin + 1}-${toWin - 1}`;
  return `${toWin}-${Math.floor(r() * (toWin - 1))}`;
}
function simMatch(c, m, r) {
  const A = byId(c, m.a), B = byId(c, m.b);
  m.winner = r() < winChance(A.rating, B.rating) ? m.a : m.b;
  m.score = scoreline(r, c.settings.gamesToWin);
}
// round reached -> index into the tier's points: winner 0, final 1, semi 2, ...
function award(c, draw) {
  const T = TIERS[draw.event.tier];
  const n = draw.rounds.length; // rounds played
  const lostIn = {};
  draw.rounds.forEach((round, ri) => round.forEach((m) => {
    const loser = m.winner === m.a ? m.b : m.a;
    lostIn[loser] = ri;
  }));
  const total = Math.log2(draw.event.draw);
  for (const id of draw.entrants) {
    const p = byId(c, id);
    const idx = id === draw.champion ? 0 : total - lostIn[id];
    const pts = T.points[idx] ?? 0;
    if (pts) p.results.push({ w: c.t, p: pts, s: draw.event.stage });
  }
  const champ = byId(c, draw.champion);
  if (champ !== c.you) champ.titles++;
}
function advance(draw) {
  const done = draw.rounds[draw.round];
  if (done.length === 1) { draw.done = true; draw.champion = done[0].winner; return; }
  const next = [];
  for (let i = 0; i < done.length; i += 2) next.push({ a: done[i].winner, b: done[i + 1].winner, winner: null, score: '' });
  draw.rounds.push(next);
  draw.round++;
}
function simRest(c, draw, r) {
  while (!draw.done) {
    for (const m of draw.rounds[draw.round]) if (m.winner === null) simMatch(c, m, r);
    advance(draw);
  }
}
export const roundName = (draw) => ROUND_NAMES[draw.rounds[draw.round].length * 2];

// Entrants for the week's events: the best available players go to the biggest event
// they can enter; some take the week off. `you` takes a place in your chosen event.
function fillEvents(c, events, yourEventId, r) {
  const stage = events[0].stage;
  const ranked = rankings(c, stage).filter((x) => !x.you).map((x) => ({ ...x, p: byId(c, x.id) }));
  const free = ranked.filter(() => r() > 0.15);
  const used = new Set();
  const out = {};
  const order = [...events].sort((a, b) => TIERS[b.tier].rank - TIERS[a.tier].rank);
  for (const e of order) {
    const need = e.draw - (e.id === yourEventId ? 1 : 0);
    const T = TIERS[e.tier];
    const list = [];
    for (const x of free) {
      if (list.length >= need) break;
      if (used.has(x.id)) continue;
      if (T.maxRank && x.pts > 0 && x.rank > T.maxRank * 1.6) continue; // far outside the cut
      list.push(x); used.add(x.id);
    }
    // not enough? anyone left will do
    for (const x of ranked) { if (list.length >= need) break; if (!used.has(x.id)) { list.push(x); used.add(x.id); } }
    out[e.id] = list.map((x) => x.p);
  }
  return out;
}

function simulateWeek(c, skipEventId, week = c.week, extra = null) {
  const r = rng(c);
  for (const stage of ['junior', 'pro']) {
    const events = weekEvents(stage, c.season, week);
    const fields = extra && extra.stage === stage ? extra.fields : fillEvents(c, events, null, r);
    for (const e of events) {
      if (e.id === skipEventId) continue;
      const field = fields[e.id];
      if (!field || field.length < e.draw) continue;
      const entrants = [...field].sort((a, b) => b.rating - a.rating + (r() - 0.5) * 6).slice(0, e.draw);
      const draw = makeDraw(e, entrants);
      simRest(c, draw, r);
      award(c, draw);
      if (c.you && draw.champion === c.story.rival && e.tier !== 'jClub' && e.tier !== 'circuit') news(c, `${byId(c, draw.champion).name} won the ${e.name}.`, 'rival');
    }
  }
}

function news(c, text, kind = 'news') {
  c.log.push({ season: c.season, week: c.week, age: c.you.age, text, kind });
  if (c.log.length > 120) c.log.shift();
}

// ---------------------------------------------------------------- the player's week
// Can the player enter this event? { ok, reason, wildcard }
export function entryFor(c, e) {
  const T = TIERS[e.tier];
  if (c.you.retired || c.pending) return { ok: false, reason: 'Not now' };
  if (e.stage !== youStage(c)) return { ok: false, reason: 'Other tour' };
  if (!T.maxRank) return { ok: true };
  const rank = rankOf(c, 0);
  if (rank && rank <= T.maxRank) return { ok: true };
  if (c.you.wildcards > 0) return { ok: true, wildcard: true, reason: `Wildcard (${c.you.wildcards} left)` };
  return { ok: false, reason: `Ranked ${T.maxRank} or better` };
}
export const thisWeek = (c) => (c.you.retired ? [] : weekEvents(youStage(c), c.season, c.week));

export function enterEvent(c, eventId) {
  const e = thisWeek(c).find((x) => x.id === eventId);
  if (!e || c.current) return false;
  const entry = entryFor(c, e);
  if (!entry.ok) return false;
  if (entry.wildcard) c.you.wildcards--;
  const r = rng(c);
  const events = thisWeek(c);
  const fields = fillEvents(c, events, e.id, r);
  // the player's place in the draw comes from their ranking
  const field = [...fields[e.id]];
  const rank = rankOf(c, 0);
  const pos = rank ? field.filter((p) => { const k = rankOf(c, p.id); return k && k < rank; }).length : field.length;
  field.splice(Math.min(pos, field.length), 0, c.you);
  const draw = makeDraw(e, field.slice(0, e.draw));
  c.current = { draw, fields, wildcard: !!entry.wildcard };
  const T = TIERS[e.tier];
  c.story.pendingEvents = [{ type: 'enter', tier: e.tier, label: T.label }];
  return true;
}

// the player's next match: { event, round, opponent, level, ... } or null
export function nextMatch(c) {
  const d = c.current && c.current.draw;
  if (!d || d.done) return null;
  const m = d.rounds[d.round].find((x) => x.a === 0 || x.b === 0);
  if (!m || m.winner !== null) return null;
  const opp = byId(c, m.a === 0 ? m.b : m.a);
  const rating = opp.rating + DIFFICULTY_SHIFT[c.settings.difficulty];
  return {
    event: d.event, round: roundName(d), opponent: { id: opp.id, name: opp.name, rating: opp.rating, rank: rankOf(c, opp.id), style: opp.style, age: opp.age, rival: opp.id === c.story.rival },
    level: levelForRating(rating), gamesToWin: c.settings.gamesToWin, surface: d.event.surface, venue: d.event.venue,
    yourRank: rankOf(c, 0), seed: d.seeds[0] || null,
  };
}

// Record the player's match (played, or simulated when `games` is null).
// Returns a summary: { won, score, round, out, champion, event }.
export function recordMatch(c, won, games = null) {
  const d = c.current.draw;
  const r = rng(c);
  const m = d.rounds[d.round].find((x) => x.a === 0 || x.b === 0);
  const opp = byId(c, m.a === 0 ? m.b : m.a);
  if (won === null) won = r() < winChance(c.you.rating, opp.rating);
  const toWin = c.settings.gamesToWin;
  if (!games) {
    const lose = Math.floor(r() * (toWin - 1));
    games = won ? [toWin, lose] : [lose, toWin];
  }
  m.winner = won ? 0 : opp.id;
  m.score = `${Math.max(...games)}-${Math.min(...games)}`;
  const round = roundName(d);
  // the player's rating follows results (a little) as well as age
  const exp = winChance(c.you.rating, opp.rating);
  c.you.rating = clamp(c.you.rating + 3 * ((won ? 1 : 0) - exp), 10, 99);
  c.you.record[won ? 'w' : 'l']++;
  const story = [];
  if (opp.id === c.story.rival) { c.story.h2h[won ? 'w' : 'l']++; story.push({ type: won ? 'beatRival' : 'lostRival' }); }
  story.push({ type: won ? 'won' : 'lost', round, opp: opp.name, oppRank: rankOf(c, opp.id), tier: d.event.tier });
  for (const x of d.rounds[d.round]) if (x.winner === null) simMatch(c, x, r);
  advance(d);
  const summary = { won, score: m.score, games, round, opponent: opp.name, event: d.event, out: !won, champion: false };
  if (!won) {
    simRest(c, d, r);
  } else if (d.done) {
    summary.champion = true;
    c.you.titles.push({ name: d.event.name, tier: d.event.tier, season: c.season, age: c.you.age, stage: d.event.stage });
    news(c, `You won the ${d.event.name}.`, 'title');
    story.push({ type: 'title', tier: d.event.tier, name: d.event.name, count: c.you.titles.length });
  }
  if (d.done) finishEvent(c, story);
  c.story.pendingEvents = story;
  return summary;
}

function finishEvent(c, story) {
  const d = c.current.draw;
  award(c, d);
  // the rest of the week
  const stage = d.event.stage;
  simulateWeek(c, d.event.id, c.week, { stage, fields: c.current.fields }); // both tours
  c.current = null;
  endWeek(c, story);
}

// Rest this week (or simply let it pass).
export function restWeek(c) {
  if (c.current || c.pending || c.you.retired) return false;
  const story = [{ type: 'rest' }];
  simulateWeek(c, null);
  endWeek(c, story);
  c.story.pendingEvents = story;
  return true;
}

function endWeek(c, story) {
  c.t++;
  c.week++;
  const rank = rankOf(c, 0);
  const stage = youStage(c);
  if (rank) {
    const best = c.you.best[stage];
    if (!best || rank < best) {
      c.you.best[stage] = rank;
      story.push({ type: 'bestRank', rank, stage });
    }
  }
  if (c.week >= WEEKS) endSeason(c, story);
}

function endSeason(c, story) {
  const r = rng(c);
  const stage = youStage(c);
  const rank = rankOf(c, 0);
  c.you.history.push({ season: c.season, age: c.you.age, stage, rank, record: { ...c.you.record }, titles: c.you.titles.filter((t) => t.season === c.season).length });
  story.push({ type: 'seasonEnd', rank, stage, season: c.season });
  c.season++;
  c.week = 0;
  // everyone a year older: growth, peak, decline; the oldest and weakest retire
  for (const p of c.players) {
    if (p.retired) continue;
    p.age++;
    const target = p.potential * ageCurve(p.age);
    p.rating = clamp(p.rating + (target - p.rating) * 0.6 + (r() - 0.5) * 4, 10, 99);
    const old = p.age >= 31 ? (p.age - 30) * 0.12 : 0;
    if (p.age > 18 && (r() < old || (p.age > 24 && p.rating < 40 && r() < 0.3))) p.retired = true;
  }
  // you too
  const y = c.you;
  y.age++;
  y.rating = clamp(y.rating + Math.max(0, (y.potential * ageCurve(y.age) - y.rating) * 0.5) - (y.age >= 31 ? (y.age - 30) * 0.8 : 0), 10, 99);
  story.push({ type: 'birthday', age: y.age });
  // a new generation of 14-year-olds; keep the pro tour full
  const taken = new Set(c.taken);
  const juniors = c.players.filter((p) => !p.retired && stageOf(p) === 'junior').length;
  for (let i = juniors; i < JUNIOR_POOL; i++) c.players.push(newPlayer(r, taken, START_AGE, c.nextId++));
  const pros = c.players.filter((p) => !p.retired && stageOf(p) === 'pro').length;
  for (let i = pros; i < PRO_POOL; i++) c.players.push(newPlayer(r, taken, 18, c.nextId++));
  c.taken = [...taken];
  // only the last season's results count any more
  for (const p of [...c.players, y]) p.results = p.results.filter((x) => x.w > c.t - WEEKS);
  // a full tour stays about its size: the weakest veterans call it a day
  const active = c.players.filter((p) => !p.retired && stageOf(p) === 'pro').sort((a, b) => a.rating - b.rating);
  for (let i = 0, extra = active.length - PRO_POOL; i < active.length && extra > 0; i++) {
    if (active[i].age > 22 && active[i].id !== c.story.rival) { active[i].retired = true; extra--; }
  }
  // retired players leave the world (the rival is remembered)
  c.players = c.players.filter((p) => !p.retired || p.id === c.story.rival);
  // decisions
  if (y.stage === 'junior' && y.age > JUNIOR_LAST_AGE) {
    c.pending = 'college-or-pro';
    story.push({ type: 'decision', juniorRank: rank });
  }
  if (y.stage === 'pro' && y.age >= RETIRE_FORCED) retire(c, story);
}

// The college-or-pro decision (and turning pro early, from 16).
export function canTurnProEarly(c) { return c.you.stage === 'junior' && c.you.age >= 16 && !c.current && !c.pending; }
export function turnPro(c) {
  const y = c.you;
  if (y.stage !== 'junior') return false;
  const jr = rankOf(c, 0, 'junior');
  y.stage = 'pro';
  y.turnedPro = { age: y.age, season: c.season, juniorRank: jr };
  // a strong junior record earns wildcards into bigger events
  y.wildcards = jr && jr <= 3 ? 3 : jr && jr <= 10 ? 2 : jr && jr <= 25 ? 1 : 0;
  c.pending = null;
  // the rival turns pro at 18 as well, if not already
  news(c, `You turned pro at ${y.age}.`, 'milestone');
  c.story.pendingEvents = [{ type: 'turnedPro', wildcards: y.wildcards, juniorRank: jr }];
  return true;
}

export function canRetire(c) { return c.you.stage === 'pro' && c.you.age >= 30 && !c.current && !c.you.retired; }
export function retire(c, story = null) {
  c.you.retired = true;
  c.pending = null;
  const ev = { type: 'retired', age: c.you.age };
  if (story) story.push(ev); else c.story.pendingEvents = [ev];
  news(c, `You retired at ${c.you.age}.`, 'milestone');
}

// a short summary for the hub and the menu
export function summary(c) {
  const y = c.you;
  return {
    name: y.name, age: y.age, stage: y.stage, season: c.season, week: c.week + 1, rank: rankOf(c, 0),
    points: pointsOf(y, c.t, y.stage), record: y.record, titles: y.titles.length, retired: y.retired, wildcards: y.wildcards,
  };
}

export function legacy(c) {
  const y = c.you;
  const crowns = y.titles.filter((t) => t.tier === 'crown').length;
  return {
    titles: y.titles.length, crowns, juniorCrowns: y.titles.filter((t) => t.tier === 'jCrown').length,
    bestPro: y.best.pro, bestJunior: y.best.junior, record: y.record, seasons: y.history.length,
  };
}

export { byId as playerById };
