// The country club venue.
// A fenced club court with small bleachers, chain-link fencing with a windscreen,
// trees all round, a clubhouse with a terrace, a neighbouring court with its own
// rally going on, people strolling on the paths and flags in the breeze.
import * as THREE from 'three';
import { ARENA, CLUB, NAMES } from './config.js';
import { createFigure, makePose, POSES } from './human.js';
import { canvasTexture, makeRng, noiseTexture, boardTexture, box, grassFloorTexture } from './gfx.js';
import { buildCrowd } from './crowd.js';

const SKINS = [0xe2b28f, 0xc98f68, 0x9a6845, 0xf0c9a8, 0x6f4a32];

// ---------------------------------------------------------------- textures
function chainLinkTexture() {
  const t = canvasTexture(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, h / 2); g.lineTo(w / 2, 0); g.lineTo(w, h / 2); g.lineTo(w / 2, h); g.closePath();
    g.moveTo(0, 0); g.lineTo(1, 1); g.moveTo(w, h); g.lineTo(w - 1, h - 1);
    g.stroke();
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function stripeTexture(a, b, n = 8) {
  return canvasTexture(256, 32, (g, w, h) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? b : a;
      g.fillRect((i * w) / n, 0, w / n + 1, h);
    }
  });
}

function windowTexture() {
  const t = canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#f2eee4';
    g.fillRect(0, 0, w, h);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 6; c++) {
        const x = 12 + c * 41, y = 14 + r * 60;
        g.fillStyle = '#2c3a44';
        g.fillRect(x, y, 26, 38);
        g.fillStyle = 'rgba(190,220,235,0.35)';
        g.fillRect(x + 2, y + 2, 10, 34);
        g.fillStyle = '#e4dccb';
        g.fillRect(x + 12, y, 2, 38);
        g.fillStyle = '#1f4a35';
        g.fillRect(x - 5, y, 4, 38);
        g.fillRect(x + 27, y, 4, 38);
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// A sky dome: pale at the horizon, blue overhead, with a soft treeline of distant hills.
function buildSky(group) {
  const geo = new THREE.SphereGeometry(125, 32, 16);
  const pos = geo.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) colors.push(0, 0, 0);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const c = new THREE.Color(), lo = new THREE.Color(), hi = new THREE.Color();
  const paintSky = (a, b) => {
    lo.set(a); hi.set(b);
    const col = geo.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      c.copy(lo).lerp(hi, Math.pow(Math.max(0, pos.getY(i) / 125), 0.6));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  };
  paintSky(0xe3edf3, 0x6fa6da);
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  group.add(sky);

  // distant hills
  const rnd = makeRng(5);
  const seg = 96, R = 112;
  const hv = [], hc = [];
  const near = new THREE.Color(0x4d6e4f), far = new THREE.Color(0x8fa9a0);
  let hgt = 8;
  const heights = [];
  for (let i = 0; i <= seg; i++) {
    hgt += (rnd() - 0.5) * 3;
    hgt = Math.max(4, Math.min(16, hgt));
    heights.push(i === seg ? heights[0] : hgt);
  }
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = [[Math.cos(a0) * R, 0, Math.sin(a0) * R], [Math.cos(a1) * R, 0, Math.sin(a1) * R],
      [Math.cos(a1) * R, heights[i + 1], Math.sin(a1) * R], [Math.cos(a0) * R, heights[i], Math.sin(a0) * R]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      hv.push(...p[k]);
      const col = k < 2 ? near : far;
      hc.push(col.r, col.g, col.b);
    }
  }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(hv, 3));
  hg.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3));
  group.add(new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false })));
  const paintHills = (a, b) => {
    near.set(a); far.set(b);
    const col = hg.attributes.color;
    for (let i = 0; i < col.count; i++) { const k = i % 6; const v = k === 0 || k === 1 || k === 3 ? near : far; col.setXYZ(i, v.r, v.g, v.b); }
    col.needsUpdate = true;
  };
  return { paintSky, paintHills };
}

// Trees: instanced trunks and canopies, swaying a little in the wind.
function buildTrees(group, spots, rnd, clock) {
  const trunks = [], blobs = [], cones = [];
  for (const [x, z, kind] of spots) {
    const s = 0.8 + rnd() * 0.6;
    if (kind === 'conifer') {
      const h = (5.5 + rnd() * 4) * s;
      trunks.push([x, z, 0.18 * s, 1.2 * s]);
      cones.push([x, 1.0 * s + h / 2, z, 1.4 * s + rnd() * 0.5, h]);
    } else {
      const th = (2.2 + rnd() * 1.4) * s;
      trunks.push([x, z, 0.22 * s, th + 1]);
      const r = (1.7 + rnd() * 1.0) * s;
      blobs.push([x, th + r * 0.7, z, r]);
      for (let k = 0; k < 3; k++) {
        const a = rnd() * Math.PI * 2, d = r * (0.45 + rnd() * 0.25);
        blobs.push([x + Math.cos(a) * d, th + r * (0.45 + rnd() * 0.6), z + Math.sin(a) * d, r * (0.6 + rnd() * 0.25)]);
      }
    }
  }
  const o = new THREE.Object3D();
  const col = new THREE.Color();
  const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 1, 1, 7).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x5a4332, roughness: 1 }), trunks.length);
  trunks.forEach(([x, z, r, h], i) => {
    o.position.set(x, 0, z); o.scale.set(r, h, r); o.rotation.set(0, 0, 0); o.updateMatrix();
    trunkMesh.setMatrixAt(i, o.matrix);
  });
  trunkMesh.castShadow = true;

  // wind: a sway that grows with height, phased by where the tree stands
  const wind = { value: 0 };
  clock.push((t) => { wind.value = t; });
  const sway = (material) => {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = wind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = instanceMatrix[3].x * 0.23 + instanceMatrix[3].z * 0.19;
          float k = 0.05 * (position.y + 1.0);
          transformed.x += sin(uWind * 1.3 + ph) * k + sin(uWind * 3.1 + ph * 2.0) * k * 0.3;
          transformed.z += cos(uWind * 1.1 + ph) * k * 0.6;`);
    };
    return material;
  };
  const greens = [0x3f6b35, 0x4f7d3a, 0x2f5a32, 0x5d8a40, 0x6b8f3a, 0x46753c, 0x7c9a45];
  const blobMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
    sway(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true })), blobs.length);
  const shades = blobs.map(() => [rnd(), 0.85 + rnd() * 0.3]);
  blobs.forEach(([x, y, z, r], i) => {
    o.position.set(x, y, z); o.scale.set(r, r * 0.85, r); o.rotation.set(rnd(), rnd() * 3, 0); o.updateMatrix();
    blobMesh.setMatrixAt(i, o.matrix);
    blobMesh.setColorAt(i, col.setHex(greens[Math.floor(shades[i][0] * greens.length)]).multiplyScalar(shades[i][1]));
  });
  // the season: blossom among the green in spring, reds, golds and browns in autumn
  const PALETTES = {
    summer: greens,
    spring: [0x5d8a40, 0x6b9a45, 0x7caa50, 0x4f7d3a, 0x6b8f3a, 0xf0b6c8, 0xf6e4ec],
    autumn: [0xc8742c, 0xd9a03a, 0xa8452a, 0x8a6a2a, 0x6b7a35, 0xb85a2a, 0x4f7d3a],
  };
  blobMesh.castShadow = true;
  const coneMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8),
    sway(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true })), Math.max(1, cones.length));
  cones.forEach(([x, y, z, r, h], i) => {
    o.position.set(x, y, z); o.scale.set(r, h, r); o.rotation.set(0, rnd() * 3, 0); o.updateMatrix();
    coneMesh.setMatrixAt(i, o.matrix);
    coneMesh.setColorAt(i, col.setHex(0x2d5234).multiplyScalar(0.8 + rnd() * 0.35));
  });
  coneMesh.count = cones.length;
  coneMesh.castShadow = true;
  group.add(trunkMesh, blobMesh, coneMesh);
  return {
    setFoliage(kind) {
      const pal = PALETTES[kind] || greens;
      for (let i = 0; i < blobs.length; i++) blobMesh.setColorAt(i, col.setHex(pal[Math.floor(shades[i][0] * pal.length)]).multiplyScalar(shades[i][1]));
      blobMesh.instanceColor.needsUpdate = true;
    },
  };
}

// a simple walk cycle for the strolling figures
const walkPose = makePose();
function walk(phase, out = walkPose) {
  const s = Math.sin(phase), c = Math.cos(phase);
  out.lHip = 0.38 * s; out.rHip = -0.38 * s;
  out.lKnee = 0.15 + 0.45 * Math.max(0, -c); out.rKnee = 0.15 + 0.45 * Math.max(0, c);
  out.lShX = -0.32 * s; out.rShX = 0.32 * s;
  out.lElbow = 0.3; out.rElbow = 0.3; out.lShZ = 0.08; out.rShZ = 0.08;
  out.torsoX = 0.06;
  return out;
}

// ---------------------------------------------------------------- the club
export function buildClub(parent, { speedBoard, clockBoard } = {}) {
  const group = new THREE.Group();
  group.visible = false;
  parent.add(group);
  const rnd = makeRng(2024);
  const clock = []; // per-frame updates
  const X = CLUB.fenceX, ZB = ARENA.backWallZ, ZF = CLUB.fenceZ, H = CLUB.fenceHeight;

  const sky = buildSky(group);

  // lawn
  const lawnTex = grassFloorTexture('#5d8a45');
  lawnTex.repeat.set(40, 40);
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(250, 250), new THREE.MeshStandardMaterial({ map: lawnTex, roughness: 1 }));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.02;
  lawn.receiveShadow = true;
  group.add(lawn);

  const flat = (w, l, mat, x, z, y = 0.005) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  // gravel paths
  const gravelTex = noiseTexture('#cdbf9f', 77, { speckles: 12000, blotches: 30, light: '255,250,235', dark: '80,60,30' });
  gravelTex.repeat.set(2, 30);
  const gravel = new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 1 });
  const PATH_Z = ZB - 3.6, PATH_X = X + 7.6;
  flat(60, 2.2, gravel, 16, PATH_Z); // behind the back fence, from the clubhouse to the right
  flat(2.2, 44, gravel, -PATH_X, 13); // left, from the terrace forward
  flat(2.2, 61, gravel, PATH_X, 4.5); // right, the length of the court

  // ------------------------------------------------ fence
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1d3b2c, roughness: 0.6, metalness: 0.3 });
  const linkTex = chainLinkTexture();
  const linkMat = (w, h) => {
    const t = linkTex.clone();
    t.needsUpdate = true;
    t.repeat.set(w / 0.11, h / 0.11);
    return new THREE.MeshStandardMaterial({
      color: 0x2c4a3a, alphaMap: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4,
    });
  };
  const postGeo = new THREE.CylinderGeometry(0.045, 0.045, H, 8).translate(0, H / 2, 0);
  const sides = [
    // [x0, z0, x1, z1]
    [-X, ZB, X, ZB], [-X, ZF, X, ZF], [-X, ZB, -X, ZF], [X, ZB, X, ZF],
  ];
  const posts = [];
  for (const [x0, z0, x1, z1] of sides) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.round(len / 3);
    for (let i = 0; i <= n; i++) posts.push([x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n]);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, H), linkMat(len, H));
    mesh.position.set((x0 + x1) / 2, H / 2, (z0 + z1) / 2);
    if (x0 === x1) mesh.rotation.y = Math.PI / 2;
    mesh.renderOrder = 2;
    group.add(mesh);
    // top and bottom rails
    for (const y of [H - 0.03, 0.05]) {
      const rail = box(x0 === x1 ? 0.06 : len, 0.06, x0 === x1 ? len : 0.06, postMat, (x0 + x1) / 2, y, (z0 + z1) / 2, { cast: false });
      group.add(rail);
    }
  }
  const postMesh = new THREE.InstancedMesh(postGeo, postMat, posts.length);
  const o = new THREE.Object3D();
  posts.forEach(([x, z], i) => { o.position.set(x, 0, z); o.updateMatrix(); postMesh.setMatrixAt(i, o.matrix); });
  postMesh.castShadow = true;
  group.add(postMesh);

  // windscreen along the back fence, with the club or event name in the middle
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x1f4a35, roughness: 0.9 });
  const SH = 1.6;
  for (const s of [-1, 1]) group.add(box(X - 3.6, SH, 0.03, screenMat, s * (X + 3.6) / 2, SH / 2, ZB + 0.05, { cast: false }));
  let screenBg = '#1f4a35', signName = NAMES.tour;
  const signTex = (name) => boardTexture(name, { bg: screenBg, fg: '#f3efe2', w: 1024, h: 228, sub: 'WILLOWMERE LAWN AND RACQUET CLUB' });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(7.2, SH), new THREE.MeshBasicMaterial({ map: signTex(NAMES.tour) }));
  sign.position.set(0, SH / 2, ZB + 0.07);
  group.add(sign);
  // a couple of small sponsor boards on the screen
  const sponsors = NAMES.sponsors;
  [[-7.4, 1], [7.4, 3]].forEach(([x, i]) => {
    const s = sponsors[i % sponsors.length];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.7), new THREE.MeshBasicMaterial({ map: boardTexture(s.text, s) }));
    m.position.set(x, 0.85, ZB + 0.08);
    group.add(m);
  });
  // the speed and clock boards, smaller, on posts above the screen
  for (const [b, x] of [[speedBoard, -5.6], [clockBoard, 5.6]]) {
    if (!b) continue;
    const m = new THREE.Mesh(b.geometry, b.material);
    m.scale.setScalar(0.55);
    m.position.set(x, SH + 0.62, ZB + 0.09);
    group.add(m);
  }

  // ------------------------------------------------ bleachers either side
  const alu = new THREE.MeshStandardMaterial({ color: 0xb9c0c6, roughness: 0.45, metalness: 0.6 });
  const frame = new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.6 });
  const seats = [];
  const ROWS = 5, RD = 0.8, RR = 0.42, BZ0 = -10, BZ1 = 10;
  const frameBits = [];
  for (const s of [-1, 1]) {
    for (let r = 0; r < ROWS; r++) {
      const top = 0.45 + r * RR;
      const x = s * (X + 1.0 + (r + 0.5) * RD);
      group.add(box(0.32, 0.05, BZ1 - BZ0, alu, x + s * 0.12, top, 0, { cast: true }));
      group.add(box(0.36, 0.04, BZ1 - BZ0, alu, x - s * 0.22, top - RR + 0.02, 0, { cast: false })); // footboard
      for (let z = BZ0 + 0.35; z < BZ1 - 0.3; z += 0.6) {
        if (rnd() < 0.74) seats.push([x + s * 0.12, top, z + (rnd() - 0.5) * 0.1, s > 0 ? -Math.PI / 2 : Math.PI / 2]);
      }
      for (let z = BZ0; z <= BZ1 + 0.01; z += 2.5) frameBits.push([x + s * 0.3, top, z]);
    }
    // back rail
    const bx = s * (X + 1.0 + ROWS * RD + 0.05);
    const btop = 0.45 + (ROWS - 1) * RR + 1.0;
    group.add(box(0.05, 0.05, BZ1 - BZ0, frame, bx, btop, 0, { cast: false }));
    for (let z = BZ0; z <= BZ1 + 0.01; z += 2.5) frameBits.push([bx, btop, z]);
    // a white end panel at each end
    for (const z of [BZ0 - 0.05, BZ1 + 0.05]) {
      const shape = new THREE.Shape();
      const w = ROWS * RD + 0.1;
      shape.moveTo(0, 0); shape.lineTo(w, 0); shape.lineTo(w, 0.45 + (ROWS - 1) * RR); shape.lineTo(0, 0.45);
      const panel = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0xe9e9e2, roughness: 0.7, side: THREE.DoubleSide }));
      panel.position.set(s * (X + 0.95), 0, z);
      panel.scale.x = s;
      panel.rotation.y = 0;
      group.add(panel);
    }
  }
  const legGeo = new THREE.BoxGeometry(0.06, 1, 0.06).translate(0, 0.5, 0);
  const legs = new THREE.InstancedMesh(legGeo, frame, frameBits.length);
  frameBits.forEach(([x, top, z], i) => { o.position.set(x, 0, z); o.scale.set(1, top, 1); o.updateMatrix(); legs.setMatrixAt(i, o.matrix); });
  group.add(legs);

  // standing spectators along the side fences near the back corners, and by the near corners
  for (const s of [-1, 1]) {
    for (let z = ZB + 1.2; z < BZ0 - 0.8; z += 0.7 + rnd() * 1.6) {
      if (rnd() < 0.55) seats.push([s * (X + 0.55 + rnd() * 0.5), 0, z, s > 0 ? -Math.PI / 2 + (rnd() - 0.5) * 0.6 : Math.PI / 2 + (rnd() - 0.5) * 0.6, true]);
    }
    for (let z = BZ1 + 1; z < 17; z += 0.8 + rnd() * 1.8) {
      if (rnd() < 0.5) seats.push([s * (X + 0.55 + rnd() * 0.5), 0, z, s > 0 ? -Math.PI / 2 : Math.PI / 2, true]);
    }
  }

  // ------------------------------------------------ clubhouse, terrace and flags (back left)
  const CX = -X - 13, CZ = ZB - 1; // centre of the building
  const wallMat = new THREE.MeshStandardMaterial({ map: windowTexture(), roughness: 0.85 });
  wallMat.map.repeat.set(2, 1);
  const plain = new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.85 });
  const house = box(16, 6, 9, [wallMat, plain, plain, plain, wallMat, plain], CX, 3, CZ);
  group.add(house);
  // pitched roof
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-5.2, 0); roofShape.lineTo(5.2, 0); roofShape.lineTo(0, 3.2); roofShape.closePath();
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: 17, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: 0x2f5a46, roughness: 0.7, flatShading: true }));
  roof.rotation.y = Math.PI / 2;
  roof.position.set(CX - 8.5, 6, CZ);
  roof.castShadow = true;
  group.add(roof);
  // veranda: columns and a flat canopy facing the courts
  const vx = CX + 8 + 1.6;
  group.add(box(3.4, 0.12, 9.6, plain, vx, 3.2, CZ, { cast: true }));
  for (let z = CZ - 4.4; z <= CZ + 4.41; z += 2.2) group.add(box(0.2, 3.2, 0.2, plain, vx + 1.5, 1.6, z));
  flat(3.4, 9.6, new THREE.MeshStandardMaterial({ color: 0xb8a88a, roughness: 0.9 }), vx, CZ, 0.01);
  // terrace in front with tables and parasols, and people having lunch
  const deck = noiseTexture('#a8916d', 31, { speckles: 4000, blotches: 10 });
  deck.repeat.set(4, 4);
  const TX = CX + 4, TZ = CZ + 8.5;
  flat(12, 7.5, new THREE.MeshStandardMaterial({ map: deck, roughness: 0.9 }), TX, TZ, 0.012);
  const parasols = [[0xb3261e, '#f4efe2'], [0x1f4a35, '#f4efe2'], [0x0e2a47, '#e9d8a6']];
  const tableMat = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.5 });
  let pi = 0;
  for (const dx of [-4, 0, 4]) {
    for (const dz of [-1.8, 1.8]) {
      const x = TX + dx, z = TZ + dz;
      const [c, c2] = parasols[pi++ % parasols.length];
      const table = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 16), tableMat);
      table.position.set(x, 0.74, z);
      group.add(table, box(0.05, 0.74, 0.05, tableMat, x, 0.37, z, { cast: false }));
      group.add(box(0.04, 2.4, 0.04, tableMat, x, 1.2, z));
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.45, 8, 1, true),
        new THREE.MeshStandardMaterial({ map: stripeTexture(`#${c.toString(16).padStart(6, '0')}`, c2), roughness: 0.9, side: THREE.DoubleSide }));
      canopy.position.set(x, 2.35, z);
      canopy.castShadow = true;
      group.add(canopy);
      // two to four diners
      const k = 2 + Math.floor(rnd() * 3);
      for (let j = 0; j < k; j++) {
        const a = (j / k) * Math.PI * 2 + rnd();
        seats.push([x + Math.cos(a) * 0.75, 0.42, z + Math.sin(a) * 0.75, Math.atan2(-Math.cos(a), -Math.sin(a))]);
      }
    }
  }
  // flower beds along the front of the clubhouse
  const flowers = noiseTexture('#3e6b33', 13, { speckles: 2500, blotches: 0, light: '240,90,120', dark: '250,220,80' });
  flowers.repeat.set(6, 1);
  const bedMat = new THREE.MeshStandardMaterial({ map: flowers, roughness: 1 });
  group.add(box(0.9, 0.45, 9, bedMat, vx + 2.2, 0.22, CZ - 0.2, { cast: false }));
  // flags
  const flagSets = [['#1f4a35', '#f3efe2'], ['#0e2a47', '#e0b65a'], ['#7a1f2b', '#f3efe2']];
  const flags = [];
  flagSets.forEach(([a, b], i) => {
    const fx = X + 2.4 + i * 2.2, fz = ZB - 1.5;
    group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 8, 8).translate(fx, 4, fz), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.5, roughness: 0.4 })));
    const geo = new THREE.PlaneGeometry(1.8, 1.1, 12, 4).translate(0.9, 0, 0);
    const tex = canvasTexture(128, 80, (g) => {
      g.fillStyle = a; g.fillRect(0, 0, 128, 80);
      g.fillStyle = b; g.fillRect(0, 30, 128, 20); g.fillRect(36, 0, 18, 80);
    });
    const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 }));
    flag.position.set(fx, 7.35, fz);
    flag.rotation.y = 0.5 + i * 0.1;
    flag.castShadow = true;
    group.add(flag);
    flags.push({ flag, base: Float32Array.from(geo.attributes.position.array), phase: i * 1.7 });
  });
  clock.push((t) => {
    for (const f of flags) {
      const p = f.flag.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = f.base[3 * i], y = f.base[3 * i + 1];
        const k = x / 1.8;
        p.setZ(i, Math.sin(x * 3.2 - t * 6 + f.phase) * 0.16 * k + Math.sin(y * 2 - t * 3.7) * 0.04 * k);
        p.setY(i, y - k * k * 0.12);
      }
      p.needsUpdate = true;
      f.flag.geometry.computeVertexNormals();
    }
  });

  // ------------------------------------------------ the neighbouring court, behind the back fence
  const NZ = ZB - 14.5, NX = 5; // centre; the court runs along x
  const hardTex = noiseTexture('#3b6ea5', 91, { speckles: 6000, blotches: 10, light: '255,255,255', dark: '0,10,30' });
  const outer = noiseTexture('#5b8a5a', 92, { speckles: 6000, blotches: 10, light: '255,255,255', dark: '0,10,30' });
  outer.repeat.set(3, 2);
  flat(36, 18, new THREE.MeshStandardMaterial({ map: outer, roughness: 0.85 }), NX, NZ, 0.006);
  flat(23.77, 10.97, new THREE.MeshStandardMaterial({ map: hardTex, roughness: 0.85 }), NX, NZ, 0.008);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf4f1ea });
  const ln = (w, l, x, z) => flat(w, l, lineMat, NX + x, NZ + z, 0.011);
  for (const s of [-1, 1]) {
    ln(0.08, 10.97, s * 11.85, 0); // baselines
    ln(23.77, 0.05, 0, s * 5.46); ln(23.77, 0.05, 0, s * 4.1); // sidelines
    ln(0.05, 8.23, s * 6.4, 0); // service lines
  }
  ln(12.8, 0.05, 0, 0);
  // its net
  group.add(box(0.03, 0.9, 12, new THREE.MeshStandardMaterial({ color: 0x15171a, transparent: true, opacity: 0.75 }), NX, 0.45, NZ, { cast: false }));
  for (const s of [-1, 1]) group.add(box(0.08, 1.07, 0.08, postMat, NX, 0.53, NZ + s * 6.4));
  // a low fence round it
  for (const [w, l, x, z] of [[36, 0.04, NX, NZ - 9], [36, 0.04, NX, NZ + 9], [0.04, 18, NX - 18, NZ], [0.04, 18, NX + 18, NZ]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, l), 2.6), linkMat(Math.max(w, l), 2.6));
    m.position.set(x, 1.3, z);
    if (l > w) m.rotation.y = Math.PI / 2;
    group.add(m);
  }
  // two club players rallying: one at each baseline
  const rally = [0, 1].map((i) => {
    const fig = createFigure({
      shirt: i ? 0xf2f2f2 : 0x2b6cb0, shorts: i ? 0x1c2333 : 0xf2f2f2, hair: i ? 0x6b4a2a : 0x2a1d14,
      skin: i ? 0xe2b28f : 0x9a6845, racket: true, racketColor: 0x222222, gripColor: 0xeeeeee,
    });
    fig.object3d.position.set(NX + (i ? 12.6 : -12.6), 0, NZ);
    fig.object3d.rotation.y = i ? -Math.PI / 2 : Math.PI / 2;
    group.add(fig.object3d);
    return { fig, z: NZ, target: NZ, pose: makePose(), phase: 0 };
  });
  const rBall = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd8f23a, roughness: 0.6 }));
  rBall.castShadow = true;
  group.add(rBall);
  const R = { from: 0, t: 0, dur: 1.7, z0: NZ, z1: NZ, hits: [] };
  const nextShot = () => {
    R.t = 0;
    R.dur = 1.45 + rnd() * 0.6;
    R.z0 = rally[R.from].z;
    R.z1 = NZ + (rnd() - 0.5) * 6;
    rally[1 - R.from].target = R.z1;
  };
  nextShot();
  let onHit = null;
  clock.push((t, dt) => {
    R.t += dt;
    const u = Math.min(1, R.t / R.dur);
    const xa = NX + (R.from ? 11.9 : -11.9), xb = NX + (R.from ? -11.9 : 11.9);
    // bounce at 70% of the flight
    const yA = u < 0.7 ? 1.0 + Math.sin((u / 0.7) * Math.PI) * 1.4 - (u / 0.7) * 0.95 : Math.sin(((u - 0.7) / 0.3) * Math.PI) * 0.9 + (u - 0.7) * 3;
    rBall.position.set(xa + (xb - xa) * u, Math.max(0.07, yA), R.z0 + (R.z1 - R.z0) * u);
    for (const [i, p] of rally.entries()) {
      const dz = p.target - p.z;
      const v = Math.max(-3, Math.min(3, dz * 3));
      p.z += v * dt;
      p.phase += Math.abs(v) * dt * 4.5;
      const P = Math.abs(v) > 0.3 ? walk(p.phase, p.pose) : Object.assign(p.pose, POSES.lineJudge);
      // swing near contact
      const swingT = i === 1 - R.from ? Math.max(0, 1 - Math.abs(u - 1) * 6) : 0;
      P.rShX = 0.5 + swingT * 0.6; P.rShY = -0.6 + swingT * 2.0; P.rElbow = 0.6;
      p.fig.setPose(P);
      p.fig.object3d.position.set(NX + (i ? 12.6 : -12.6), 0, p.z);
    }
    if (u >= 1) {
      R.from = 1 - R.from;
      if (onHit) onHit(rBall.position.x, rBall.position.z);
      nextShot();
    }
  });

  // ------------------------------------------------ people strolling on the paths
  const walkers = [];
  const people = [
    { shirt: 0xc9695a, shorts: 0xd8d0bc, trousers: true }, { shirt: 0x3f5d8a, shorts: 0x2a2a2a, trousers: true },
    { shirt: 0xf0ede6, shorts: 0x5f7f6b }, { shirt: 0xe0b65a, shorts: 0x3a3a3a, trousers: true, hairStyle: 'long' },
    { shirt: 0x8d6e97, shorts: 0xd9d4c7, hairStyle: 'long' }, { shirt: 0x5f7f6b, shorts: 0xc9bfa6, trousers: true, headwear: 'cap' },
  ];
  const routes = [
    // [axis, fixed, from, to, speed]
    ['x', PATH_Z - 0.4, -12, 44, 1.25], ['x', PATH_Z + 0.4, 42, -12, 1.1], ['x', PATH_Z, -6, 30, 1.4],
    ['z', -PATH_X, -8, 30, 1.2], ['z', PATH_X, 30, -24, 1.3], ['z', PATH_X + 0.5, -22, 26, 1.05],
  ];
  routes.forEach(([axis, fixed, a, b, speed], i) => {
    const fig = createFigure({ ...people[i], skin: SKINS[i % SKINS.length], hair: [0x2a1d14, 0x6b4a2a, 0x1a1a1a, 0x8a6a4a][i % 4], scale: 0.95 + rnd() * 0.08 });
    group.add(fig.object3d);
    walkers.push({ fig, axis, fixed, a, b, speed, s: rnd(), dir: 1, phase: rnd() * 6, pose: makePose() });
  });
  clock.push((t, dt) => {
    for (const w of walkers) {
      const len = Math.abs(w.b - w.a);
      w.s += (w.dir * w.speed * dt) / len;
      if (w.s > 1 || w.s < 0) { w.dir = -w.dir; w.s = Math.max(0, Math.min(1, w.s)); }
      const along = w.a + (w.b - w.a) * w.s;
      const heading = Math.sign(w.b - w.a) * w.dir;
      w.phase += w.speed * dt * 4.6;
      w.fig.setPose(walk(w.phase, w.pose));
      const ob = w.fig.object3d;
      if (w.axis === 'x') { ob.position.set(along, 0, w.fixed); ob.rotation.y = heading > 0 ? Math.PI / 2 : -Math.PI / 2; }
      else { ob.position.set(w.fixed, 0, along); ob.rotation.y = heading > 0 ? 0 : Math.PI; }
    }
  });

  // ------------------------------------------------ hedges, benches and trees
  const hedge = new THREE.MeshStandardMaterial({ color: 0x2f5a32, roughness: 1 });
  group.add(box(2 * X + 2, 1.1, 0.9, hedge, 0, 0.55, ZF + 1.4));
  for (const s of [-1, 1]) group.add(box(0.9, 1.1, 14, hedge, s * (X + 5.6), 0.55, 18));
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.8 });
  for (const [x, z] of [[-24, PATH_Z - 1.7], [16, PATH_Z - 1.7], [30, PATH_Z - 1.7]]) {
    group.add(box(1.8, 0.06, 0.45, benchMat, x, 0.45, z), box(1.8, 0.4, 0.05, benchMat, x, 0.7, z - 0.22));
    seats.push([x - 0.4, 0.45, z, 0], [x + 0.45, 0.45, z, 0]);
  }

  const spots = [];
  const clear = (x, z) => {
    if (z > 13 && z < 36) return false; // keep the broadcast camera's view clear
    if (Math.abs(x) < X + 6.6 && z > ZB - 2.2 && z < ZF + 2.5) return false; // court, bleachers, hedges
    if (Math.abs(Math.abs(x) - PATH_X) < 2.2 && z > ZB - 5 && z < 35) return false; // side paths
    if (Math.abs(z - PATH_Z) < 2.4) return false; // back path
    if (x > CX - 10 && x < TX + 7.5 && z > CZ - 6.5 && z < TZ + 4.5) return false; // clubhouse and terrace
    if (Math.abs(x - NX) < 19.5 && Math.abs(z - NZ) < 10) return false; // neighbour court
    if (Math.abs(x - X - 4.6) < 3.5 && Math.abs(z - (ZB - 1.5)) < 1.5) return false; // flags
    return true;
  };
  for (let i = 0; spots.length < 230 && i < 6000; i++) {
    const x = (rnd() - 0.5) * 120, z = -75 + rnd() * 125;
    if (!clear(x, z)) continue;
    if (spots.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 < 9)) continue;
    // denser near the club, sparser far away
    const d = Math.hypot(x / 1.4, z);
    if (rnd() < Math.min(0.75, d / 110)) continue;
    spots.push([x, z, rnd() < 0.28 ? 'conifer' : 'round']);
  }
  // a line of trees along the outside of the side paths
  for (let z = -18; z <= 10; z += 4.5) for (const s of [-1, 1]) spots.push([s * (PATH_X + 3.2 + rnd()), z + rnd() * 1.5, 'round']);
  const trees = buildTrees(group, spots, rnd, clock);

  const crowd = buildCrowd(group, seats, rnd, { idle: true });

  let t = 0;
  return {
    group,
    crowd,
    fence: { x: X, back: ZB, front: ZF },
    update(dt) {
      if (!group.visible) return;
      t += dt;
      for (const f of clock) f(t, dt);
      crowd.update(dt);
    },
    // the event's look: { light preset, screen, foliage }
    setTheme(theme, L) {
      sky.paintSky(L.sky[0], L.sky[1]);
      sky.paintHills(L.hills[0], L.hills[1]);
      trees.setFoliage(theme.foliage);
      screenMat.color.set(theme.screen);
      if (theme.screen !== screenBg) { screenBg = theme.screen; this.setTourName(signName); }
    },
    setTourName(name) {
      signName = name;
      const old = sign.material.map;
      sign.material.map = signTex(name);
      sign.material.needsUpdate = true;
      if (old) old.dispose();
    },
    onHit(cb) { onHit = cb; },
  };
}
