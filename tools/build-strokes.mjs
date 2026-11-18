// Turns captured tennis strokes (BVH) into the game's stroke clips.
//
// Source: Tennis-MoCap, a tennis action dataset of Caldas-Colombia tennis league
// players (Pulgarin-Giraldo et al., Universidad Autonoma de Occidente / Universidad
// Nacional de Colombia / Universidad de Caldas), CC BY-SA 3.0:
//   https://github.com/jdpulgarin/Tennis-MoCap
// Fetch the takes with tools/fetch-strokes.sh, then run
//   node tools/build-strokes.mjs
// It writes src/assets/strokes.js (CC BY-SA 3.0, as data derived from the takes).
//
// Each take is 30 seconds of one stroke hit again and again. The tool finds every
// repetition by the racket hand's speed peak (taken as contact), drops ones with
// marker glitches, keeps the most typical, and retargets it onto the game's pose
// keys from joint positions: legs, ankles and torso as for the gaits, and each arm
// by fitting the rig's shoulder (flexion, abduction, sweep) and elbow angles to the
// captured upper arm and forearm directions. The take's timeline is then mapped onto
// the game's: contact at the game's contact time, the forward swing in real time,
// the backswing quickened, the follow-through in real time.
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { readBVH, pose } from './bvh.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.STROKES_DIR || `${HERE}.cache/tennis-mocap/data`;
const STEP = 1 / 60; // key spacing in the game clips
const C = 0.18, S = 0.5; // the game's contact time and stroke length (config.js SWING)
const TOSS_T = 0.7, SERVE_C = 0.18, SERVE_S = 0.5; // config.js SERVE_ANIM

// stroke: [take, timeline]. Timelines map game time to take time (seconds from contact).
const swing = [[0, -0.32], [C * 0.45, -0.11], [C, 0], [S, S - C]];
const STROKES = {
  forehand: ['cferrero_Derecha.bvh', swing],
  backhand: ['lvargas_Reves.bvh', swing],
  fhVolley: ['jdescobar_VDerecha.bvh', [[0, -0.22], [C * 0.5, -0.08], [C, 0], [S, S - C]]],
  bhVolley: ['jgacosta_VReves.bvh', [[0, -0.22], [C * 0.5, -0.08], [C, 0], [S, S - C]]],
  smash: ['jduribe_Remate.bvh', [[0, -0.36], [C * 0.45, -0.12], [C, 0], [S, S - C]]],
  // the serve is two clips: the toss up to the trophy pose, then the swing
  toss: ['jarua_Servicio.bvh', [[0, -1.25], [TOSS_T, -0.3]]],
  serve: ['jarua_Servicio.bvh', [[0, -0.3], [0.05, -0.17], [SERVE_C, 0], [SERVE_S, SERVE_S - SERVE_C]]],
};

// The capture has no racket. Its direction is set at contact (level and side-on for
// groundstrokes, up for volleys and overheads), which fixes the grip in the hand; the
// racket then turns with the player's captured wrist through the whole stroke.
const RACKET_AT_CONTACT = {
  forehand: [-0.9, 0.05, 0.4], backhand: [0.9, 0.05, 0.4],
  fhVolley: [-0.55, 0.75, 0.35], bhVolley: [0.55, 0.75, 0.35],
  smash: [-0.1, 0.95, 0.3], toss: [-0.1, 0.95, 0.3], serve: [-0.1, 0.95, 0.3],
};
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const heading = (v) => Math.atan2(v.x, v.z);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]).multiplyScalar(0.01);

const JOINTS = {
  hips: 'Hips', neck: 'Neck', head: 'Head', headEnd: 'Head_end',
  hipL: 'LeftHip', kneeL: 'LeftKnee', ankleL: 'LeftAnkle', toeL: 'LeftAnkle_end',
  hipR: 'RightHip', kneeR: 'RightKnee', ankleR: 'RightAnkle', toeR: 'RightAnkle_end',
  shL: 'LeftShoulder', elL: 'LeftElbow', wrL: 'LeftWrist', handL: 'LeftWrist_end',
  shR: 'RightShoulder', elR: 'RightElbow', wrR: 'RightWrist', handR: 'RightWrist_end',
};

function frames(bvh) {
  const raw = [];
  for (let f = 0; f < bvh.frames; f++) {
    const P = pose(bvh, f);
    const o = {};
    for (const [k, n] of Object.entries(JOINTS)) o[k] = V(P[n].p);
    const R = P.RightWrist.R; // row-major world rotation of the racket hand
    o.wristQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1));
    raw.push(o);
  }
  // light smoothing (5 frames at 100 Hz) against marker jitter
  return raw.map((_, i) => {
    const o = {};
    for (const k of Object.keys(JOINTS)) {
      const v = new THREE.Vector3();
      let n = 0;
      for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) { v.add(raw[j][k]); n++; }
      o[k] = v.multiplyScalar(1 / n);
    }
    o.wristQ = raw[i].wristQ;
    return o;
  });
}

// repetitions: racket hand speed peaks at least a second apart
function repetitions(F, dt) {
  const sp = F.map((f, i) => (i ? f.handR.distanceTo(F[i - 1].handR) / dt : 0));
  const sorted = [...sp].sort((a, b) => a - b);
  const top = sorted[Math.floor(sorted.length * 0.995)];
  const peaks = [];
  for (let i = 1; i < sp.length - 1; i++) {
    if (sp[i] < 0.45 * top || sp[i] < sp[i - 1] || sp[i] < sp[i + 1]) continue;
    const last = peaks[peaks.length - 1];
    if (last && i - last.i < 1 / dt) { if (sp[i] > last.v) { last.i = i; last.v = sp[i]; } } else peaks.push({ i, v: sp[i] });
  }
  return { sp, peaks };
}

// a glitch: a joint jumping (over 20 m/s) or a bone changing length by over 4 cm
function clean(F, a, b, dt) {
  const bones = [['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'], ['shR', 'elR'], ['elR', 'wrR'], ['shL', 'elL'], ['elL', 'wrL']];
  const len0 = bones.map(([x, y]) => F[a][x].distanceTo(F[a][y]));
  for (let i = Math.max(1, a); i <= b; i++) {
    for (const k of Object.keys(JOINTS)) if (F[i][k].distanceTo(F[i - 1][k]) / dt > 20) return false;
    for (let j = 0; j < bones.length; j++) if (Math.abs(F[i][bones[j][0]].distanceTo(F[i][bones[j][1]]) - len0[j]) > 0.04) return false;
  }
  return true;
}

// ---- the rig's arm, as rig.js builds it: upper arm E*down, forearm E*Rx(-elbow)*down
const eA = new THREE.Euler(), eB = new THREE.Euler(), qA = new THREE.Quaternion(), qB = new THREE.Quaternion();
function armDirs(side, x, y, z, el, up, fore) {
  if (side === 'L') eA.set(-x, -y, z, 'YXZ'); else eA.set(-x, y, -z, 'YXZ');
  qA.setFromEuler(eA);
  up.copy(DOWN).applyQuaternion(qA);
  eB.set(-el, 0, 0);
  qB.setFromEuler(eB);
  fore.copy(DOWN).applyQuaternion(qB).applyQuaternion(qA);
}
const tu = new THREE.Vector3(), tf = new THREE.Vector3();
function armError(side, p, u, f) {
  armDirs(side, p[0], p[1], p[2], p[3], tu, tf);
  return tu.distanceToSquared(u) + tf.distanceToSquared(f) + 0.002 * p[1] * p[1]; // a little pull toward no sweep
}
// fit [shX, shY, shZ, elbow] to captured directions, from a starting guess
function fitArm(side, u, f, guess) {
  const p = guess.slice();
  let err = armError(side, p, u, f);
  let step = 0.2;
  for (let it = 0; it < 400 && step > 1e-4; it++) {
    let improved = false;
    for (let k = 0; k < 4; k++) {
      for (const d of [step, -step]) {
        p[k] += d;
        if (k === 3) p[3] = Math.max(0, Math.min(2.6, p[3]));
        const e = armError(side, p, u, f);
        if (e < err - 1e-9) { err = e; improved = true; break; }
        p[k] -= d;
      }
    }
    if (!improved) step *= 0.5;
  }
  return p;
}

function retarget(f, facing, prevArms, shaftLocal) {
  const left = f.hipL.clone().sub(f.hipR).setY(0);
  const pelvisFwd = left.clone().cross(UP).normalize();
  const hipsYaw = wrap(heading(pelvisFwd) - facing);
  const qPelvis = new THREE.Quaternion().setFromAxisAngle(UP, facing + hipsYaw);
  const inv = qPelvis.clone().invert();
  const toPelvis = (v) => v.clone().applyQuaternion(inv);
  const o = { hipsYaw };
  for (const s of ['L', 'R']) {
    const l = s.toLowerCase();
    const thigh = toPelvis(f['knee' + s].clone().sub(f['hip' + s])).normalize();
    const shin = toPelvis(f['ankle' + s].clone().sub(f['knee' + s])).normalize();
    const foot = toPelvis(f['toe' + s].clone().sub(f['ankle' + s])).normalize();
    o[l + 'HipZ'] = Math.asin(Math.max(-1, Math.min(1, s === 'L' ? thigh.x : -thigh.x)));
    o[l + 'Hip'] = Math.atan2(thigh.z, -thigh.y);
    o[l + 'Knee'] = thigh.angleTo(shin);
    o[l + 'FootPitch'] = Math.atan2(-foot.y, Math.hypot(foot.x, foot.z));
  }
  const mid = f.hipL.clone().add(f.hipR).multiplyScalar(0.5);
  const spine = toPelvis(f.neck.clone().sub(mid)).normalize();
  o.torsoX = Math.atan2(spine.z, spine.y);
  o.torsoZ = Math.atan2(-spine.x, spine.y);
  const shLine = f.shL.clone().sub(f.shR).setY(0);
  o.torsoY = wrap(heading(shLine.clone().cross(UP)) - heading(pelvisFwd));
  const q4 = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.torsoX / 4, o.torsoY / 4, o.torsoZ / 4));
  const chest = qPelvis.clone();
  for (let k = 0; k < 4; k++) chest.multiply(q4);
  const toChest = (v) => v.clone().applyQuaternion(chest.clone().invert());
  const arms = {};
  for (const s of ['L', 'R']) {
    const l = s.toLowerCase();
    const u = toChest(f['el' + s].clone().sub(f['sh' + s])).normalize();
    const fo = toChest(f['wr' + s].clone().sub(f['el' + s])).normalize();
    let guess = prevArms && prevArms[s];
    if (!guess) {
      const z = Math.asin(Math.max(-1, Math.min(1, s === 'L' ? u.x : -u.x)));
      guess = [Math.atan2(u.z, -u.y), 0, z, u.angleTo(fo)];
    }
    const p = fitArm(s, u, fo, guess);
    arms[s] = p;
    o[l + 'ShX'] = p[0]; o[l + 'ShY'] = p[1]; o[l + 'ShZ'] = p[2]; o[l + 'Elbow'] = p[3];
  }
  const hv = toChest(f.headEnd.clone().sub(f.neck)).normalize();
  o.headX = Math.atan2(hv.z, hv.y);
  const rk = toChest(shaftLocal.clone().applyQuaternion(f.wristQ));
  o.rkX = rk.x; o.rkY = rk.y; o.rkZ = rk.z;
  o.headY = 0;
  return { o, arms };
}

const KEYS = ['lHip', 'rHip', 'lHipZ', 'rHipZ', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle', 'hipsYaw', 'torsoX', 'torsoY', 'torsoZ', 'headX',
  'lShX', 'rShX', 'lShY', 'rShY', 'lShZ', 'rShZ', 'lElbow', 'rElbow', 'lift', 'rkX', 'rkY', 'rkZ'];

const takeCache = {};
function take(file) {
  if (takeCache[file]) return takeCache[file];
  const path = `${ROOT}/${file}`;
  if (!existsSync(path)) throw new Error(`missing ${path}: run tools/fetch-strokes.sh`);
  const bvh = readBVH(path);
  const dt = bvh.frameTime;
  const F = frames(bvh);
  const { sp, peaks } = repetitions(F, dt);
  const pre = Math.round(1.5 / dt), post = Math.round(0.45 / dt);
  const ok = peaks.filter((p) => p.i - pre >= 0 && p.i + post < F.length && clean(F, p.i - pre, p.i + post, dt));
  if (!ok.length) throw new Error(`${file}: no clean repetition (of ${peaks.length})`);
  const speeds = ok.map((p) => p.v).sort((a, b) => a - b);
  const median = speeds[Math.floor(speeds.length / 2)];
  const rep = ok.reduce((a, b) => (Math.abs(b.v - median) < Math.abs(a.v - median) ? b : a));
  takeCache[file] = { F, dt, contact: rep.i, peak: rep.v, reps: peaks.length, clean: ok.length, sp };
  return takeCache[file];
}

// contact, near the hand's speed peak: overhead strokes meet the ball at the hand's
// highest point around the peak; the others as the hand passes the front of the hips
function findContact(F, dt, peakI, overhead) {
  if (overhead) {
    let best = peakI;
    for (let i = peakI - Math.round(0.35 / dt); i <= peakI + Math.round(0.15 / dt); i++) if (F[i].handR.y > F[best].handR.y) best = i;
    return best;
  }
  for (let i = peakI - Math.round(0.12 / dt); i <= peakI + Math.round(0.15 / dt); i++) {
    if (F[i].handR.z - F[i].hips.z >= 0.12) return i; // lab +z is toward the net
  }
  return peakI;
}

function build(name, file, timeline) {
  const { F, dt, contact: peakI, peak, reps, clean: nClean } = take(file);
  const contact = findContact(F, dt, peakI, ['serve', 'toss', 'smash'].includes(name));
  // facing: the lab's +z points at the net in every take (the players' stances between
  // strokes, side-on for serves and smashes, turned to the stroke side in the drills,
  // all agree with it)
  const facing = 0;
  const hand = F[contact].handR.clone().sub(F[contact].hips);
  const legLen = F[contact].hipL.distanceTo(F[contact].kneeL) + F[contact].kneeL.distanceTo(F[contact].ankleL);
  // take times needed, retargeted frame by frame (arms warm-started for continuity)
  const tStart = timeline[0][1], tEnd = timeline[timeline.length - 1][1];
  const i0 = contact + Math.floor(tStart / dt) - 2, i1 = contact + Math.ceil(tEnd / dt) + 2;
  // the floor: the lowest ankle around this repetition
  let floor = Infinity;
  for (let i = contact - Math.round(1.5 / dt); i <= contact + Math.round(0.45 / dt); i++) floor = Math.min(floor, F[i].ankleL.y, F[i].ankleR.y);
  // ankles: zero where the foot lies flat
  const flat = { L: [], R: [] };
  const at0 = new THREE.Vector3(...RACKET_AT_CONTACT[name]).normalize();
  const shaftLocal = at0.applyAxisAngle(UP, facing).applyQuaternion(F[contact].wristQ.clone().invert());
  const per = [];
  let prev = null;
  for (let i = i0; i <= i1; i++) {
    const { o, arms } = retarget(F[i], facing, prev, shaftLocal);
    prev = arms;
    o.lift = (Math.min(F[i].ankleL.y, F[i].ankleR.y) - floor) / legLen;
    for (const s of ['L', 'R']) if (F[i]['ankle' + s].y < floor + 0.02) flat[s].push(o[s.toLowerCase() + 'FootPitch']);
    per.push(o);
  }
  for (const s of ['L', 'R']) {
    const l = s.toLowerCase();
    const arr = flat[s].sort((a, b) => a - b);
    const zero = arr.length ? arr[Math.floor(arr.length / 2)] : 0;
    per.forEach((o) => { o[l + 'Ankle'] = o[l + 'FootPitch'] - zero; });
  }
  // keep angles continuous (no jumps of 2 pi between frames)
  for (const key of ['hipsYaw', 'torsoY', 'lShY', 'rShY', 'lShX', 'rShX', 'lShZ', 'rShZ']) {
    for (let k = 1; k < per.length; k++) {
      while (per[k][key] - per[k - 1][key] > Math.PI) per[k][key] -= 2 * Math.PI;
      while (per[k][key] - per[k - 1][key] < -Math.PI) per[k][key] += 2 * Math.PI;
    }
  }
  const at = (tau, key) => {
    const x = (contact + tau / dt) - i0;
    const a = Math.max(0, Math.min(per.length - 1, Math.floor(x))), u = x - Math.floor(x);
    const b = Math.min(per.length - 1, a + 1);
    return per[a][key] + (per[b][key] - per[a][key]) * u;
  };
  const tau = (t) => {
    for (let k = 1; k < timeline.length; k++) {
      const [ta, xa] = timeline[k - 1], [tb, xb] = timeline[k];
      if (t <= tb + 1e-9) return xa + ((xb - xa) * (t - ta)) / (tb - ta);
    }
    return timeline[timeline.length - 1][1];
  };
  const T = timeline[timeline.length - 1][0];
  const keys = [];
  for (let t = 0; t <= T + 1e-6; t += STEP) {
    const pose = {};
    for (const key of KEYS) pose[key] = +at(tau(t), key).toFixed(4);
    keys.push({ t: +t.toFixed(4), pose });
  }
  const handsApart = F[contact].handL.distanceTo(F[contact].handR);
  console.log(`${name.padEnd(9)} ${file.padEnd(26)} reps ${reps} clean ${nClean}  hand ${peak.toFixed(1)} m/s  hands ${(handsApart * 100).toFixed(0)} cm apart  contact hand (x ${hand.x.toFixed(2)}, y ${F[contact].handR.y.toFixed(2)}, z ${hand.z.toFixed(2)})  hips yaw ${per[contact - i0] ? per[contact - i0].hipsYaw.toFixed(2) : "-"}`);
  return keys;
}

// arguments: stroke names to try (nothing is written), optionally stroke=take.bvh
const pick = [];
for (const a of process.argv.slice(2)) {
  const [n, f] = a.split('=');
  pick.push(n);
  if (f) STROKES[n] = [f, STROKES[n][1]];
}
const out = { source: 'Tennis-MoCap (CC BY-SA 3.0), https://github.com/jdpulgarin/Tennis-MoCap', clips: {} };
for (const [name, [file, timeline]] of Object.entries(STROKES)) {
  if (pick.length && !pick.includes(name)) continue;
  out.clips[name] = build(name, file, timeline);
}
if (!pick.length) {
  const head = '// Generated by tools/build-strokes.mjs from Tennis-MoCap\n// (https://github.com/jdpulgarin/Tennis-MoCap), licensed CC BY-SA 3.0; this derived data is shared under the same licence.\n';
  writeFileSync(`${HERE}../src/assets/strokes.js`, `${head}export default ${JSON.stringify(out)};\n`);
}
