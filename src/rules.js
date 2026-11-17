// Tennis rules: court tests and scoring. Pure logic, no rendering.
// Sides: 0 is the near player (+z half), 1 is the far player (-z half).
import { BALL, COURT } from './config.js';

const sideSign = (side) => (side === 0 ? 1 : -1);

// Is a bounce at (x, z) inside the singles court of `side`? Lines count as in.
export function inSingles(x, z, side) {
  const m = BALL.radius;
  const d = z * sideSign(side);
  return Math.abs(x) <= COURT.singlesHalf + m && d >= 0 && d <= COURT.halfLength + m;
}

// Is a serve bounce inside the correct service box? The server stands on the
// right of the centre mark when fromRight is true, and serves diagonally.
export function inServiceBox(x, z, server, fromRight) {
  const m = BALL.radius;
  const receiver = 1 - server;
  const d = z * sideSign(receiver);
  if (d < 0 || d > COURT.serviceLine + m) return false;
  // server's right is +x for side 0 and -x for side 1; the target box is diagonal
  const serverX = sideSign(server) * (fromRight ? 1 : -1);
  const bx = -x * serverX; // positive when on the diagonal side
  return bx >= -m && bx <= COURT.singlesHalf + m;
}

export function createMatch({ gamesToWin = 6, firstServer = 0 } = {}) {
  return {
    gamesToWin,
    points: [0, 0],
    games: [0, 0],
    server: firstServer,
    serveNumber: 1, // 1 or 2
    over: false,
    winner: -1,
  };
}

// The server stands right of the centre mark on even points.
export function serveFromRight(m) {
  return (m.points[0] + m.points[1]) % 2 === 0;
}

// Record a fault. Returns true on a double fault (the caller then awards the point).
export function fault(m) {
  if (m.serveNumber === 1) { m.serveNumber = 2; return false; }
  return true;
}

// Award a point. Returns { game, set } flags for what it completed.
export function awardPoint(m, side) {
  const result = { game: false, set: false, gameWinner: -1 };
  if (m.over) return result;
  m.serveNumber = 1;
  m.points[side]++;
  const a = m.points[side], b = m.points[1 - side];
  if (a >= 4 && a - b >= 2) {
    result.game = true;
    result.gameWinner = side;
    m.games[side]++;
    m.points[0] = m.points[1] = 0;
    m.server = 1 - m.server;
    if (m.games[side] >= m.gamesToWin && m.games[side] - m.games[1 - side] >= 2) {
      m.over = true;
      m.winner = side;
      result.set = true;
    }
  }
  return result;
}

const LABELS = ['0', '15', '30', '40'];

// Scoreboard labels for the current game, e.g. ['30', '40'] or ['AD', '40'].
export function pointLabels(m) {
  const [a, b] = m.points;
  if (a >= 3 && b >= 3) {
    if (a === b) return ['40', '40'];
    return a > b ? ['AD', '40'] : ['40', 'AD'];
  }
  return [LABELS[a], LABELS[b]];
}

// 'deuce' | 'advantage' | null, with the side holding advantage.
export function gameCall(m) {
  const [a, b] = m.points;
  if (a >= 3 && b >= 3) {
    if (a === b) return { call: 'deuce', side: -1 };
    return { call: 'advantage', side: a > b ? 0 : 1 };
  }
  return { call: null, side: -1 };
}
