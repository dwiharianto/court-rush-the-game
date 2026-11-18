// Match statistics for both players, kept by the game as points are played.
// Plain data (arrays indexed by side), so it can be saved with a line-call
// challenge's snapshot and restored if the point is replayed.

const KEYS = [
  'points', 'aces', 'doubleFaults', 'firstServes', 'firstFaults', 'firstWon', 'secondPlayed', 'secondWon',
  'fastestServe', 'bpChances', 'bpWon', 'winners', 'unforced', 'forced', 'netPlayed', 'netWon',
  'distance', 'dives', 'challenges', 'challengesWon',
];

export function createStats() {
  const s = { longestRally: 0 };
  for (const k of KEYS) s[k] = [0, 0];
  return s;
}

export function resetStats(s) {
  Object.assign(s, createStats());
}

export function loadStats(s, data) {
  s.longestRally = data.longestRally;
  for (const k of KEYS) s[k] = data[k].slice();
}

const pct = (a, b) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '-');
const frac = (a, b) => (b > 0 ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : '0/0');

// Display rows: [label, player value, CPU value]
export function statRows(s) {
  const firstIn = [0, 1].map((i) => s.firstServes[i] - s.firstFaults[i]);
  const both = (f) => [f(0), f(1)];
  return [
    ['Points won', ...both((i) => String(s.points[i]))],
    ['Aces', ...both((i) => String(s.aces[i]))],
    ['Double faults', ...both((i) => String(s.doubleFaults[i]))],
    ['1st serve in', ...both((i) => pct(firstIn[i], s.firstServes[i]))],
    ['1st serve points won', ...both((i) => pct(s.firstWon[i], firstIn[i]))],
    ['2nd serve points won', ...both((i) => pct(s.secondWon[i], s.secondPlayed[i]))],
    ['Fastest serve', ...both((i) => (s.fastestServe[i] ? `${Math.round(s.fastestServe[i])} km/h` : '-'))],
    ['Break points won', ...both((i) => frac(s.bpWon[i], s.bpChances[i]))],
    ['Winners', ...both((i) => String(s.winners[i]))],
    ['Unforced errors', ...both((i) => String(s.unforced[i]))],
    ['Forced errors', ...both((i) => String(s.forced[i]))],
    ['Net points won', ...both((i) => frac(s.netWon[i], s.netPlayed[i]))],
    ['Distance run', ...both((i) => `${Math.round(s.distance[i])} m`)],
    ['Dives', ...both((i) => String(s.dives[i]))],
    ['Challenges won', ...both((i) => `${s.challengesWon[i]}/${s.challenges[i]}`)],
  ];
}
