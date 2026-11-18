// Minimal BVH reader with forward kinematics (Node, no dependencies).
// Rotation channels are applied in the order listed (intrinsic), positions as given.
import { readFileSync } from 'node:fs';

export function readBVH(path) {
  const text = readFileSync(path, 'utf8');
  const tok = text.split(/\s+/).filter(Boolean);
  let i = 0;
  const joints = [];
  const stack = [];
  let channelCount = 0;
  while (tok[i] !== 'MOTION') {
    const t = tok[i++];
    if (t === 'ROOT' || t === 'JOINT') {
      const j = { name: tok[i++], parent: stack.length ? stack[stack.length - 1] : -1, offset: [0, 0, 0], channels: [], start: 0, end: null };
      joints.push(j);
      stack.push(joints.length - 1);
    } else if (t === 'End') {
      i++; // Site
      const parent = joints[stack[stack.length - 1]];
      while (tok[i] !== 'OFFSET') i++;
      i++;
      parent.end = [+tok[i++], +tok[i++], +tok[i++]];
      while (tok[i] !== '}') i++;
      i++;
    } else if (t === 'OFFSET') {
      joints[stack[stack.length - 1]].offset = [+tok[i++], +tok[i++], +tok[i++]];
    } else if (t === 'CHANNELS') {
      const j = joints[stack[stack.length - 1]];
      const n = +tok[i++];
      j.start = channelCount;
      for (let k = 0; k < n; k++) j.channels.push(tok[i++]);
      channelCount += n;
    } else if (t === '}') stack.pop();
  }
  i++; // MOTION
  i++; const frames = +tok[i++];
  i += 2; const frameTime = +tok[i++];
  const data = [];
  for (let f = 0; f < frames; f++) { const row = new Float64Array(channelCount); for (let c = 0; c < channelCount; c++) row[c] = +tok[i++]; data.push(row); }
  return { joints, frames, frameTime, data };
}

// 3x3 rotation matrices, row-major arrays of 9
const mul = (a, b) => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
const rot = (axis, deg) => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  if (axis === 'X') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'Y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
export const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

// World positions (and rotations) of every joint at frame f: { name: { p, R } }
export function pose(bvh, f) {
  const row = bvh.data[f];
  const out = {};
  const world = [];
  bvh.joints.forEach((j, idx) => {
    let t = j.offset.slice();
    let R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const pos = [null, null, null];
    j.channels.forEach((ch, k) => {
      const v = row[j.start + k];
      if (ch.endsWith('position')) pos['XYZ'.indexOf(ch[0])] = v;
      else R = mul(R, rot(ch[0], v));
    });
    if (pos[0] !== null) t = pos;
    let p, W;
    if (j.parent < 0) { p = t; W = R; }
    else {
      const P = world[j.parent];
      const d = apply(P.R, t);
      p = [P.p[0] + d[0], P.p[1] + d[1], P.p[2] + d[2]];
      W = mul(P.R, R);
    }
    world[idx] = { p, R: W };
    out[j.name] = world[idx];
    if (j.end) { const d = apply(W, j.end); out[j.name + '_end'] = { p: [p[0] + d[0], p[1] + d[1], p[2] + d[2]], R: W }; }
  });
  return out;
}
