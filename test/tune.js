// Difficulty report: plays each scripted player profile against each CPU level
// and prints who wins. Run with: npm run tune
import { createGame } from '../src/main.js';
import { PROFILES, playPoints } from './bot.js';

const points = +(process.argv[2] || 600);
console.log(`points per cell: ${points}\n`);
console.log('player   level    player wins   avg rally   CPU errors   CPU winners   player errors   player winners   perfect   faults');
for (const profile of Object.keys(PROFILES)) {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const s = playPoints(createGame, { difficulty, profile, seed: 42, points });
    const r = s.reasons;
    const cpuErr = (r['human wins: out'] || 0) + (r['human wins: net'] || 0) + (r['human wins: doubleFault'] || 0);
    const cpuWin = (r['cpu wins: double'] || 0) + (r['cpu wins: ace'] || 0);
    const humErr = (r['cpu wins: out'] || 0) + (r['cpu wins: net'] || 0) + (r['cpu wins: doubleFault'] || 0);
    const humWin = (r['human wins: double'] || 0) + (r['human wins: ace'] || 0);
    const t = s.timing, tt = t.perfect + t.early + t.late || 1;
    const pct = (n, d = s.points) => `${Math.round((100 * n) / d)}%`.padStart(4);
    console.log(
      `${profile.padEnd(8)} ${difficulty.padEnd(8)} ${pct(s.human).padStart(8)}      ${(s.rallyHits / s.points).toFixed(1).padStart(6)}      ${pct(cpuErr).padStart(6)}       ${pct(cpuWin).padStart(6)}        ${pct(humErr).padStart(6)}          ${pct(humWin).padStart(6)}      ${pct(t.perfect, tt)}    ${String(s.faults).padStart(4)}${s.stuck ? '  STUCK' : ''}`,
    );
  }
}
