// Spectators for both venues.
//
// Until the bodies have loaded they are simple blocks. Then they become the same
// MakeHuman bodies the players use, simplified for the crowd (tools/build-crowd.mjs),
// posed once by the players' rig and baked into a handful of still poses: sitting,
// leaning forward, clapping (two frames), on their feet and cheering (two frames).
// Each pose is one instanced mesh, so a full stadium is a few draw calls. The
// clothes, skin and hair colours are per spectator, picked in the shader.
import * as THREE from 'three';
import { makePose } from './human.js';

const SHIRTS = [0xd9d4c7, 0xb9c4d6, 0x7f8fa6, 0xc9695a, 0xe0b65a, 0x5f7f6b, 0xf0ede6, 0x8d6e97, 0x3f5d8a, 0xcf8f6a, 0x9aa5a8, 0xf2f2f2, 0x2b6cb0, 0x1d2b4a];
const BOTTOMS = [0x2a2d35, 0x3c4a63, 0xc9bfa6, 0xd8d0bc, 0x4a4a4a, 0x6b5a45, 0xe8e4da, 0x24324f];
const SKINS = [0xe2b28f, 0xc98f68, 0x9a6845, 0xf0c9a8, 0x6f4a32, 0xd9a37c];
const HAIRS = [0x2a1d14, 0x6b4a2a, 0x1a1a1a, 0x8a6a4a, 0xc9a66b, 0x8c8c8c, 0xd9d4c7, 0x4a2a1a];
const SHOES = [0xf2f2f2, 0x222222, 0x6b4a2f, 0x3c4a63, 0xd9d4c7];

// ---------------------------------------------------------------- poses
const sit = { lHip: 1.5, rHip: 1.5, lKnee: 1.45, rKnee: 1.45, lHipZ: 0.1, rHipZ: 0.1, hipY: 0.1 };
const POSE_DEFS = {
  sit: { seated: true, pose: { ...sit, lShX: 0.55, rShX: 0.55, lElbow: 1.0, rElbow: 1.0, lShZ: -0.05, rShZ: -0.05, lShY: 0.15, rShY: 0.15, torsoX: 0.04 } },
  lean: { seated: true, pose: { ...sit, torsoX: 0.42, headX: -0.38, lShX: 0.75, rShX: 0.75, lElbow: 1.5, rElbow: 1.5, lShY: 0.25, rShY: 0.25 } },
  sitClapA: { seated: true, pose: { ...sit, torsoX: 0.06, lShX: 0.95, rShX: 0.95, lElbow: 1.2, rElbow: 1.2, lShY: 0.3, rShY: 0.3 } },
  sitClapB: { seated: true, pose: { ...sit, torsoX: 0.06, lShX: 0.9, rShX: 0.9, lElbow: 1.3, rElbow: 1.3, lShY: 0.1, rShY: 0.1, lShZ: 0.12, rShZ: 0.12 } },
  stand: { seated: false, pose: { lShZ: 0.1, rShZ: 0.1, lElbow: 0.2, rElbow: 0.2, lShX: 0.05, rShX: 0.05 } },
  standClapA: { seated: false, pose: { lShX: 1.0, rShX: 1.0, lElbow: 1.15, rElbow: 1.15, lShY: 0.3, rShY: 0.3 } },
  standClapB: { seated: false, pose: { lShX: 0.95, rShX: 0.95, lElbow: 1.25, rElbow: 1.25, lShY: 0.1, rShY: 0.1, lShZ: 0.12, rShZ: 0.12 } },
  cheerA: { seated: false, pose: { lShX: 2.75, rShX: 2.55, lShZ: 0.35, rShZ: 0.5, lElbow: 0.25, rElbow: 0.45, headX: -0.15 } },
  cheerB: { seated: false, pose: { lShX: 2.5, rShX: 2.8, lShZ: 0.55, rShZ: 0.3, lElbow: 0.45, rElbow: 0.2, headX: -0.15 } },
};
const POSE_NAMES = Object.keys(POSE_DEFS);

// colour slots, by body region: 0 skin, 1 top, 2 bottom, 3 hair, 4 shoes,
// 5 lower leg (trousers or bare), 6 forearm (long sleeves or bare)
function slotOf(P, part, t) {
  switch (part) {
    case P.scalp: case P.brows: return 3;
    case P.torso: return t > 0.2 ? 1 : 2;
    case P.pelvis: return 2;
    case P.upperarm: return t < 0.42 ? 1 : 6;
    case P.forearm: return 6;
    case P.thigh: return t < 0.58 ? 2 : 5;
    case P.shin: return 5;
    case P.foot: return 4;
    default: return 0;
  }
}

// Pose a rig and bake every visible mesh into one still geometry, with slot weights.
function bake(rig, body, def) {
  rig.setPose(Object.assign(makePose(), def.pose), { plant: !def.seated });
  rig.object3d.updateMatrixWorld(true);
  const pos = [], wa = [], wb = [], index = [];
  const v = new THREE.Vector3();
  const P = body.parts;
  let pelvis = new THREE.Vector3(), pelvisN = 0, minSeat = Infinity, minY = Infinity;
  rig.object3d.traverse((m) => {
    // only the body: its feet are already shaped and painted as shoes, and the
    // separate shoe meshes would more than double the triangles
    if (m !== rig.mesh) return;
    const g = m.geometry;
    const p = g.getAttribute('position');
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (m.isSkinnedMesh) m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      pos.push(v.x, v.y, v.z);
      const slot = slotOf(P, body.arrays.part[i], body.arrays.along[i] / 255);
      wa.push(slot === 1 ? 1 : 0, slot === 2 ? 1 : 0, slot === 3 ? 1 : 0);
      wb.push(slot === 4 ? 1 : 0, slot === 5 ? 1 : 0, slot === 6 ? 1 : 0);
      minY = Math.min(minY, v.y);
      const part = body.arrays.part[i];
      if (part === P.pelvis) { pelvis.add(v); pelvisN++; }
      if (part === P.pelvis || (part === P.thigh && body.arrays.along[i] < 128)) minSeat = Math.min(minSeat, v.y);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) index.push(base + g.index.getX(k));
    else for (let k = 0; k < p.count; k++) index.push(base + k);
  });
  // sit the seat (or stand the feet) on y = 0, the pelvis over the origin
  pelvis.divideScalar(Math.max(1, pelvisN));
  const dy = def.seated ? minSeat : minY;
  for (let i = 0; i < pos.length; i += 3) { pos[i] -= pelvis.x; pos[i + 1] -= dy; pos[i + 2] -= pelvis.z; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('wA', new THREE.Float32BufferAttribute(wa, 3));
  geo.setAttribute('wB', new THREE.Float32BufferAttribute(wb, 3));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

let baked = null;
// bodies: { male, female } crowd bodies; createRig: the players' rig builder
export function bakeCrowd(bodies, createRig) {
  if (baked) return baked;
  baked = {};
  for (const [gender, body] of Object.entries(bodies)) {
    const rig = createRig(body, { kit: null, hairStyle: 'short', headwear: 'none', wristbands: false });
    baked[gender] = Object.fromEntries(POSE_NAMES.map((name) => [name, bake(rig, body, POSE_DEFS[name])]));
  }
  return baked;
}

// one material for every pose: the colour comes from the spectator's own palette
function crowdMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 wA; attribute vec3 wB;
        attribute vec3 iSkin; attribute vec3 iTop; attribute vec3 iBottom; attribute vec3 iHair; attribute vec3 iShoe; attribute vec2 iFlags;`)
      .replace('#include <color_vertex>', `
        vec3 lowerLeg = mix(iSkin, iBottom, iFlags.x);
        vec3 fore = mix(iSkin, iTop, iFlags.y);
        float ws = clamp(1.0 - wA.x - wA.y - wA.z - wB.x - wB.y - wB.z, 0.0, 1.0);
        vColor = ws * iSkin + wA.x * iTop + wA.y * iBottom + wA.z * iHair + wB.x * iShoe + wB.y * lowerLeg + wB.z * fore;`);
  };
  return m;
}

// ---------------------------------------------------------------- a crowd
// seats: [x, y, z, yaw?, standing?]; yaw defaults to facing the court.
// cheer(i) gets them clapping, and on their feet waving for a big moment; with idle
// on, a few lean forward or sit back between points.
export function buildCrowd(parent, seats, rnd, { idle = false, shirts = SHIRTS } = {}) {
  const n = seats.length;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const col = new THREE.Color();
  const P = seats.map(([x, y, z, yaw, standing]) => {
    const skin = pick(SKINS);
    const bald = rnd() < 0.08;
    return {
      x, y, z, standing: !!standing,
      yaw: yaw ?? Math.atan2(-x, -z * 0.35),
      gender: rnd() < 0.5 ? 'male' : 'female',
      h: 0.93 + rnd() * 0.12,
      phase: rnd() * Math.PI * 2, freq: 4 + rnd() * 2.5,
      keen: 0.4 + rnd() * 0.6, // how readily they get up
      lean: rnd() < 0.3, fidget: rnd() * 100, fidgetRate: 0.03 + rnd() * 0.08,
      colors: [skin, pick(shirts), pick(BOTTOMS), bald ? skin : pick(HAIRS), pick(SHOES)]
        .map((c) => col.setHex(c).multiplyScalar(0.8 + rnd() * 0.2).toArray()),
      flags: [rnd() < 0.6 ? 1 : 0, rnd() < 0.2 ? 1 : 0], // trousers, long sleeves
    };
  });

  // stand-in blocks until the bodies arrive
  const blocks = new THREE.Group();
  parent.add(blocks);
  {
    const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.56, 0.3), new THREE.MeshStandardMaterial({ roughness: 0.9 }), n);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.115, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), n);
    const o = new THREE.Object3D();
    P.forEach((s, i) => {
      const y = s.y + (s.standing ? 0.55 : 0);
      o.position.set(s.x, y + 0.28 * s.h, s.z); o.rotation.set(0, s.yaw, 0); o.scale.set(1, s.h, 1); o.updateMatrix();
      bodies.setMatrixAt(i, o.matrix);
      o.position.y = y + 0.56 * s.h + 0.12; o.scale.set(1, 1, 1); o.updateMatrix();
      heads.setMatrixAt(i, o.matrix);
      bodies.setColorAt(i, col.fromArray(s.colors[1]));
      heads.setColorAt(i, col.fromArray(s.colors[0]));
    });
    blocks.add(bodies, heads);
  }

  // the real bodies: one instanced mesh per gender and pose
  let meshes = null;
  const o = new THREE.Object3D();
  function upgrade(set) {
    if (meshes || !set) return;
    const material = crowdMaterial();
    meshes = {};
    for (const [gender, poses] of Object.entries(set)) {
      for (const [name, geo] of Object.entries(poses)) {
        const g = geo.clone();
        const attrs = {};
        for (const [k, size] of [['iSkin', 3], ['iTop', 3], ['iBottom', 3], ['iHair', 3], ['iShoe', 3], ['iFlags', 2]]) {
          attrs[k] = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
          attrs[k].setUsage(THREE.DynamicDrawUsage);
          g.setAttribute(k, attrs[k]);
        }
        const mesh = new THREE.InstancedMesh(g, material, n);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.frustumCulled = false; // instances spread over the whole venue
        parent.add(mesh);
        meshes[`${gender}.${name}`] = { mesh, attrs, k: 0 };
      }
    }
    parent.remove(blocks);
    dirty = true;
    update(0);
  }

  let excite = 0, t = 0, dirty = true, lastKey = '';
  function poseFor(s) {
    const e = excite * s.keen;
    const beat = Math.floor(t * s.freq + s.phase) % 2;
    if (e > 0.5) return beat ? 'cheerA' : 'cheerB';
    if (e > 0.08) return s.standing ? (beat ? 'standClapA' : 'standClapB') : (beat ? 'sitClapA' : 'sitClapB');
    if (s.standing) return 'stand';
    const fidget = idle && Math.sin(t * s.fidgetRate + s.fidget) > 0.6;
    return s.lean !== fidget ? 'lean' : 'sit';
  }
  function update(dt) {
    t += dt;
    excite *= Math.exp(-dt * 0.45);
    if (excite < 0.004) excite = 0;
    if (!meshes) return;
    if (!dirty && excite === 0 && !idle) return;
    // only rebuild when someone's pose changes
    const names = P.map(poseFor);
    const key = names.join();
    if (key === lastKey && !dirty) return;
    lastKey = key;
    dirty = false;
    for (const m of Object.values(meshes)) m.k = 0;
    P.forEach((s, i) => {
      const m = meshes[`${s.gender}.${names[i]}`];
      const j = m.k++;
      // a seated spectator who gets up stands on the step in front of the seat
      const up = !s.standing && !POSE_DEFS[names[i]].seated;
      o.position.set(s.x, up ? s.y - 0.44 : s.y, s.z);
      o.rotation.set(0, s.yaw, 0);
      o.scale.setScalar(s.h);
      o.updateMatrix();
      m.mesh.setMatrixAt(j, o.matrix);
      const a = m.attrs;
      a.iSkin.array.set(s.colors[0], j * 3);
      a.iTop.array.set(s.colors[1], j * 3);
      a.iBottom.array.set(s.colors[2], j * 3);
      a.iHair.array.set(s.colors[3], j * 3);
      a.iShoe.array.set(s.colors[4], j * 3);
      a.iFlags.array.set(s.flags, j * 2);
    });
    for (const m of Object.values(meshes)) {
      m.mesh.count = m.k;
      m.mesh.instanceMatrix.needsUpdate = true;
      for (const a of Object.values(m.attrs)) a.needsUpdate = true;
    }
  }
  update(0);
  return {
    update,
    upgrade,
    cheer(i) { excite = Math.max(excite, Math.min(1, i)); dirty = true; },
    get count() { return n; },
  };
}

