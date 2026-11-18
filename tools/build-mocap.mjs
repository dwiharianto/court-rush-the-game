// Turns motion capture clips (BVH) into looping gait cycles for the game.
//
// Source: Bandai Namco Research Motion Dataset (CC BY-NC 4.0),
//   https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset
// Fetch the takes with tools/fetch-mocap.sh, then run
//   node tools/build-mocap.mjs
// It writes src/assets/mocap.js: per clip, one gait cycle (left foot touchdown
// to the next) resampled to SAMPLES poses in the game's pose keys, the speed and
// the distance covered per cycle.
//
// Retargeting is done on joint positions, not bone rotations, so the actor's
// proportions and rest pose do not matter: thigh and shin directions give the hip
// and knee angles, the foot's pitch the ankle, the spine and shoulder line the
// torso, and the upper and lower arm directions the shoulder and elbow.
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { readBVH, pose } from './bvh.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.MOCAP_DIR || `${HERE}.cache/bandai`;
const SAMPLES = 40;

// one take per gait, from the fastest athletic takes (the dataset has no tennis side shuffle)
const CLIPS = {
  walk: ['Bandai-Namco-Research-Motiondataset-1/data/dataset-1_walk_active_001.bvh'],
  jog: ['Bandai-Namco-Research-Motiondataset-1/data/dataset-1_run_active_001.bvh'],
  run: ['Bandai-Namco-Research-Motiondataset-2/data/dataset-2_run_active_002.bvh'],
  dash: ['Bandai-Namco-Research-Motiondataset-1/data/dataset-1_dash_masculinity_001.bvh'],
  back: ['Bandai-Namco-Research-Motiondataset-1/data/dataset-1_walk-back_active_001.bvh'],
};
const pick = process.argv[2] ? Object.fromEntries(Object.entries(CLIPS).filter(([k]) => process.argv.slice(2).includes(k))) : CLIPS;

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]).multiplyScalar(0.01); // cm to m
const UP = new THREE.Vector3(0, 1, 0);
const heading = (v) => Math.atan2(v.x, v.z); // 0 along +z
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function frames(bvh) {
  const out = [];
  for (let f = 0; f < bvh.frames; f++) {
    const P = pose(bvh, f);
    const g = (n) => V(P[n].p);
    out.push({
      hips: g('Hips'), neck: g('Neck'), head: g('Head'), headEnd: V(P.Head_end.p),
      hipL: g('UpperLeg_L'), hipR: g('UpperLeg_R'), kneeL: g('LowerLeg_L'), kneeR: g('LowerLeg_R'),
      ankleL: g('Foot_L'), ankleR: g('Foot_R'), toeL: g('Toes_L'), toeR: g('Toes_R'),
      shL: g('UpperArm_L'), shR: g('UpperArm_R'), elL: g('LowerArm_L'), elR: g('LowerArm_R'), wrL: g('Hand_L'), wrR: g('Hand_R'),
    });
  }
  return out;
}

// touchdowns of one foot: the ankle comes down to the floor and stops
function touchdowns(F, side, dt) {
  const a = side === 'L' ? 'ankleL' : 'ankleR';
  const ys = F.map((f) => f[a].y);
  const floor = [...ys].sort((x, y) => x - y)[Math.floor(ys.length * 0.05)];
  const out = [];
  let up = true;
  for (let i = 1; i < F.length; i++) {
    const v = F[i][a].clone().sub(F[i - 1][a]).setY(0).length() / dt;
    const low = ys[i] < floor + 0.035 && v < 2.2;
    if (low && up) out.push(i);
    if (ys[i] > floor + 0.06) up = true;
    else if (low) up = false;
  }
  return out;
}

function retarget(F, i, facing) {
  const f = F[i];
  const left = f.hipL.clone().sub(f.hipR).setY(0);
  const pelvisFwd = left.clone().cross(UP).normalize(); // left x up = forward
  const hipsYaw = wrap(heading(pelvisFwd) - facing);
  const qPelvis = new THREE.Quaternion().setFromAxisAngle(UP, facing + hipsYaw);
  const inv = qPelvis.clone().invert();
  const toPelvis = (v) => v.clone().applyQuaternion(inv);
  const o = { hipsYaw };
  for (const s of ['L', 'R']) {
    const thigh = toPelvis(f['knee' + s].clone().sub(f['hip' + s])).normalize();
    const shin = toPelvis(f['ankle' + s].clone().sub(f['knee' + s])).normalize();
    const foot = toPelvis(f['toe' + s].clone().sub(f['ankle' + s])).normalize();
    const out = s === 'L' ? thigh.x : -thigh.x;
    o[s.toLowerCase() + 'HipZ'] = Math.asin(Math.max(-1, Math.min(1, out)));
    o[s.toLowerCase() + 'Hip'] = Math.atan2(thigh.z, -thigh.y);
    o[s.toLowerCase() + 'Knee'] = thigh.angleTo(shin);
    o[s.toLowerCase() + 'FootPitch'] = Math.atan2(-foot.y, Math.hypot(foot.x, foot.z)); // toes down positive
  }
  // torso: the spine from the hips to the neck, and the shoulder line's turn
  const mid = f.hipL.clone().add(f.hipR).multiplyScalar(0.5);
  const spine = toPelvis(f.neck.clone().sub(mid)).normalize();
  o.torsoX = Math.atan2(spine.z, spine.y);
  o.torsoZ = Math.atan2(-spine.x, spine.y);
  const shLine = f.shL.clone().sub(f.shR).setY(0);
  o.torsoY = wrap(heading(shLine.clone().cross(UP)) - heading(pelvisFwd));
  // the chest frame the arms hang from: pelvis turn, then the spine as the rig builds it
  const e = new THREE.Euler(o.torsoX / 4, o.torsoY / 4, o.torsoZ / 4);
  const q4 = new THREE.Quaternion().setFromEuler(e);
  const chest = qPelvis.clone();
  for (let k = 0; k < 4; k++) chest.multiply(q4);
  const toChest = (v) => v.clone().applyQuaternion(chest.clone().invert());
  for (const s of ['L', 'R']) {
    const up = toChest(f['el' + s].clone().sub(f['sh' + s])).normalize();
    const low = toChest(f['wr' + s].clone().sub(f['el' + s])).normalize();
    const out = s === 'L' ? up.x : -up.x;
    o[s.toLowerCase() + 'ShZ'] = Math.asin(Math.max(-1, Math.min(1, out)));
    o[s.toLowerCase() + 'ShX'] = Math.atan2(up.z, -up.y);
    o[s.toLowerCase() + 'Elbow'] = up.angleTo(low);
  }
  // head nod relative to the chest
  const hv = toChest(f.headEnd.clone().sub(f.neck)).normalize();
  o.headX = Math.atan2(hv.z, hv.y);
  return o;
}

const KEYS = ['lHip', 'rHip', 'lHipZ', 'rHipZ', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle', 'hipsYaw', 'torsoX', 'torsoY', 'torsoZ', 'headX',
  'lShX', 'rShX', 'lShZ', 'rShZ', 'lElbow', 'rElbow', 'lift'];

function build(name, file) {
  const path = `${ROOT}/${file}`;
  if (!existsSync(path)) throw new Error(`missing ${path}: run tools/fetch-mocap.sh`);
  const bvh = readBVH(path);
  const dt = bvh.frameTime;
  const F = frames(bvh);
  const legLen = F[0].hipL.distanceTo(F[0].kneeL) + F[0].kneeL.distanceTo(F[0].ankleL);
  // the last full cycle (left touchdown to left touchdown): clips start from a standstill
  const tds = touchdowns(F, 'L', dt);
  if (tds.length < 2) throw new Error(`${name}: no full cycle (touchdowns ${tds})`);
  const a = tds[tds.length - 2], b = tds[tds.length - 1];
  // facing: the pelvis's mean heading over the cycle
  let sx = 0, sz = 0;
  for (let i = a; i <= b; i++) {
    const fw = F[i].hipL.clone().sub(F[i].hipR).setY(0).cross(UP).normalize();
    sx += fw.x; sz += fw.z;
  }
  const facing = Math.atan2(sx, sz);
  const travel = F[b].hips.clone().sub(F[a].hips).setY(0);
  const T = (b - a) * dt, D = travel.length();
  const dir = wrap(heading(travel) - facing); // 0 forward, pi back, +pi/2 to the left
  const raw = [];
  for (let i = a; i <= b; i++) raw.push(retarget(F, i, facing));
  // ankles: zero where the foot lies flat (planted frames), positive lifts the heel
  for (const s of ['l', 'r']) {
    const side = s === 'l' ? 'L' : 'R';
    const ys = F.slice(a, b + 1).map((f) => f['ankle' + side].y);
    const floor = Math.min(...ys);
    const flat = raw.filter((_, k) => ys[k] < floor + 0.02).map((o) => o[s + 'FootPitch']).sort((x, y) => x - y);
    const zero = flat[Math.floor(flat.length / 2)];
    raw.forEach((o) => { o[s + 'Ankle'] = o[s + 'FootPitch'] - zero; });
  }
  // lift: how far the lower ankle is off the floor (heel raises and flight)
  const lows = F.slice(a, b + 1).map((f) => Math.min(f.ankleL.y, f.ankleR.y));
  const floor = Math.min(...lows);
  raw.forEach((o, k) => { o.lift = (lows[k] - floor) / legLen; }); // in leg lengths
  // resample to SAMPLES, closing the loop: a linear correction spreads the seam
  const out = {};
  for (const key of KEYS) {
    const vals = raw.map((o) => o[key]);
    const seam = vals[vals.length - 1] - vals[0];
    const arr = [];
    for (let s = 0; s < SAMPLES; s++) {
      const x = (s / SAMPLES) * (vals.length - 1);
      const i0 = Math.floor(x), u = x - i0;
      const v = vals[i0] + ((vals[Math.min(i0 + 1, vals.length - 1)] - vals[i0]) * u);
      arr.push(+(v - seam * (x / (vals.length - 1))).toFixed(4));
    }
    out[key] = arr;
  }
  // when the right foot lands, as a fraction of the cycle
  const rtd = touchdowns(F, 'R', dt).find((i) => i > a && i < b);
  return {
    speed: +(D / T).toFixed(3), period: +T.toFixed(3), stride: +(D / legLen).toFixed(3), // stride in leg lengths
    dir: +dir.toFixed(3), rightTouch: rtd ? +((rtd - a) / (b - a)).toFixed(3) : 0.5,
    keys: out,
  };
}

const result = { source: 'Bandai Namco Research Motion Dataset (CC BY-NC 4.0)', samples: SAMPLES, clips: {} };
for (const [name, [file]] of Object.entries(pick)) {
  const c = build(name, file);
  result.clips[name] = c;
  console.log(name.padEnd(5), `speed ${c.speed} m/s  period ${c.period}s  stride ${c.stride} legs  dir ${c.dir}  right lands at ${c.rightTouch}`);
}
if (!process.argv[2]) {
  const head = '// Generated by tools/build-mocap.mjs from the Bandai Namco Research Motion Dataset\n// (CC BY-NC 4.0, https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset).\n';
  writeFileSync(`${HERE}../src/assets/mocap.js`, `${head}export default ${JSON.stringify(result)};\n`);
}
