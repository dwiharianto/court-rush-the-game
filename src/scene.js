// Court, net, arena dressing, lighting, and the broadcast camera.
import * as THREE from 'three';
import { COURT, ARENA, CAMERA, RENDER, LIGHT, COLORS, NAMES, BALL, SURFACES, DEFAULT_SURFACE, netHeightAt } from './config.js';
import { createFigure, POSES } from './human.js';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Small deterministic RNG so the arena looks the same on every load.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function noiseTexture(base, seed, { speckles = 9000, blotches = 60, light = '255,235,215', dark = '60,20,10' } = {}) {
  const rnd = makeRng(seed);
  const t = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < blotches; i++) {
      const x = rnd() * w, y = rnd() * h, r = 30 + rnd() * 70;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const c = rnd() < 0.5 ? light : dark;
      grad.addColorStop(0, `rgba(${c},0.07)`);
      grad.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < speckles; i++) {
      const c = rnd() < 0.5 ? light : dark;
      g.fillStyle = `rgba(${c},${0.04 + rnd() * 0.1})`;
      const s = 1 + rnd() * 2;
      g.fillRect(rnd() * w, rnd() * h, s, s);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function boardTexture(text, { bg, fg, w = 512, h = 128, sub = '' }) {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = h * 0.5;
    g.font = `800 ${size}px "Helvetica Neue", Arial, sans-serif`;
    const max = w * 0.86;
    const tw = g.measureText(text).width;
    if (tw > max) {
      size *= max / tw;
      g.font = `800 ${size}px "Helvetica Neue", Arial, sans-serif`;
    }
    g.fillText(text, w / 2, sub ? h * 0.42 : h * 0.53);
    if (sub) {
      g.font = `600 ${h * 0.16}px "Helvetica Neue", Arial, sans-serif`;
      g.fillText(sub, w / 2, h * 0.8);
    }
  });
}

function box(w, h, d, material, x, y, z, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// ---------------------------------------------------------------- surfaces
// Grass: mown stripes across the court, with worn, browner patches where players
// stand most: behind the baselines and around the centre marks.
function grassCourtTexture(color) {
  const rnd = makeRng(41);
  const t = canvasTexture(512, 1024, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    const bands = 24;
    for (let i = 0; i < bands; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,230,0.07)' : 'rgba(0,30,0,0.07)';
      g.fillRect(0, (i * h) / bands, w, h / bands);
    }
    // wear: baselines (top and bottom edges of the texture) and the service T
    for (const [cy, rx, ry, a] of [[0.02, 0.32, 0.05, 0.55], [0.98, 0.32, 0.05, 0.55], [0.5, 0.12, 0.09, 0.15]]) {
      for (let k = 0; k < 40; k++) {
        const x = w * (0.5 + (rnd() - 0.5) * rx * 1.6), y = h * (cy + (rnd() - 0.5) * ry * 1.4);
        const r = 14 + rnd() * 40;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(150,120,70,${(a * (0.25 + rnd() * 0.3)).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(150,120,70,0)');
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    for (let i = 0; i < 16000; i++) {
      g.fillStyle = rnd() < 0.5 ? `rgba(220,255,180,${0.04 + rnd() * 0.08})` : `rgba(0,40,0,${0.05 + rnd() * 0.1})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd(), 1 + rnd() * 2);
    }
  });
  return t;
}

function grassFloorTexture(color) {
  const rnd = makeRng(43);
  const t = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,230,0.05)' : 'rgba(0,30,0,0.06)';
      g.fillRect(0, (i * h) / 4, w, h / 4);
    }
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = rnd() < 0.5 ? `rgba(220,255,180,${0.03 + rnd() * 0.07})` : `rgba(0,40,0,${0.04 + rnd() * 0.08})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd(), 1 + rnd() * 2);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Acrylic hard court: a flat colour with fine sand grain.
function hardTexture(color, seed) {
  return noiseTexture(color, seed, { speckles: 14000, blotches: 12, light: '255,255,255', dark: '0,10,30' });
}

// ---------------------------------------------------------------- court
function buildCourt(scene) {
  const floorTex = noiseTexture(COLORS.floor, 7, { speckles: 5000, blotches: 20, light: '200,205,215', dark: '0,0,0' });
  floorTex.repeat.set(14, 18);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA.floorWidth, ARENA.floorLength),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const clayTex = noiseTexture(COLORS.clay, 21);
  clayTex.repeat.set(3, 6);
  const clay = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT.doublesWidth, COURT.length),
    new THREE.MeshStandardMaterial({
      map: clayTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
  );
  clay.rotation.x = -Math.PI / 2;
  clay.position.y = 0.002;
  clay.receiveShadow = true;
  scene.add(clay);

  // textures for each surface, built the first time it is chosen
  const looks = {
    clay: () => ({ court: clayTex, floor: floorTex, courtRough: 1 }),
    grass: () => {
      const f = grassFloorTexture(SURFACES.grass.floor);
      f.repeat.set(6, 8);
      return { court: grassCourtTexture(SURFACES.grass.court), floor: f, courtRough: 0.95 };
    },
    hard: () => {
      const c = hardTexture(SURFACES.hard.court, 61);
      c.repeat.set(3, 6);
      const f = hardTexture(SURFACES.hard.floor, 62);
      f.repeat.set(10, 14);
      return { court: c, floor: f, courtRough: 0.8 };
    },
  };
  const built = {};

  const lineMat = new THREE.MeshStandardMaterial({
    color: COLORS.line, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const addLine = (cx, cz, w, l) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, 0.004, cz);
    m.receiveShadow = true;
    scene.add(m);
  };
  const lw = COURT.lineWidth, bw = COURT.baselineWidth;
  const HL = COURT.halfLength;
  // lines are painted inside the court dimensions
  for (const s of [-1, 1]) {
    addLine(s * (COURT.doublesHalf - lw / 2), 0, lw, COURT.length); // doubles sideline
    addLine(s * (COURT.singlesHalf - lw / 2), 0, lw, COURT.length); // singles sideline
    addLine(0, s * (HL - bw / 2), COURT.doublesWidth, bw); // baseline
    addLine(0, s * COURT.serviceLine, COURT.singlesWidth, lw); // service line
    addLine(0, s * (HL - bw - 0.05), lw, 0.1); // centre mark
  }
  addLine(0, 0, lw, COURT.serviceLine * 2); // centre service line

  return {
    setSurface(name) {
      if (!looks[name]) return;
      const t = built[name] || (built[name] = looks[name]());
      clay.material.map = t.court;
      clay.material.roughness = t.courtRough;
      clay.material.needsUpdate = true;
      floor.material.map = t.floor;
      floor.material.needsUpdate = true;
    },
  };
}

function buildNet(scene) {
  const px = COURT.postX;
  const meshTex = canvasTexture(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(8,10,12,0.22)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(8,10,12,0.9)';
    g.lineWidth = 7;
    g.strokeRect(0, 0, w, h);
  });
  meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping;
  meshTex.repeat.set((px * 2) / 0.07, 1 / 0.07);

  const shaped = (bottom, topOffset) => {
    const g = new THREE.PlaneGeometry(px * 2, 1, 48, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const top = netHeightAt(x) + topOffset;
      pos.setY(i, pos.getY(i) > 0 ? top : bottom(x, top));
    }
    g.computeVertexNormals();
    return g;
  };

  const net = new THREE.Mesh(
    shaped(() => 0.02, -0.05),
    new THREE.MeshBasicMaterial({ map: meshTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
  );
  net.renderOrder = 2;
  scene.add(net);

  const band = new THREE.Mesh(
    shaped((x, top) => top - 0.06, 0),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }),
  );
  band.renderOrder = 3;
  scene.add(band);

  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  scene.add(box(0.05, COURT.netCentre, 0.012, white, 0, COURT.netCentre / 2, 0, { cast: false }));

  const postMat = new THREE.MeshStandardMaterial({ color: COLORS.post, roughness: 0.5, metalness: 0.3 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, COURT.netPost + 0.03, 12), postMat);
    post.position.set(s * px, (COURT.netPost + 0.03) / 2, 0);
    post.castShadow = true;
    scene.add(post);
  }

  // soft strip under the net so it sits on the clay (the mesh itself casts no shadow)
  const shade = new THREE.Mesh(
    new THREE.PlaneGeometry(px * 2, 0.5),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.13, depthWrite: false }),
  );
  shade.rotation.x = -Math.PI / 2;
  shade.position.set(0.15, 0.008, -0.2);
  shade.renderOrder = 1;
  scene.add(shade);
}

// ---------------------------------------------------------------- live boards
function liveBoard(label) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 208;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  let last = null;
  function draw(value, unit) {
    const key = `${value}|${unit}`;
    if (key === last) return;
    last = key;
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, 512, 208);
    g.strokeStyle = '#2b3442';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 506, 202);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#9fb3c8';
    g.font = '700 30px "Helvetica Neue", Arial, sans-serif';
    g.fillText(label, 256, 38);
    g.fillStyle = '#ffc531';
    g.font = '800 112px "Helvetica Neue", Arial, sans-serif';
    if (unit) {
      const vw = g.measureText(value).width;
      g.font = '700 40px "Helvetica Neue", Arial, sans-serif';
      const uw = g.measureText(unit).width;
      const total = vw + 14 + uw;
      g.textAlign = 'left';
      g.font = '800 112px "Helvetica Neue", Arial, sans-serif';
      g.fillText(value, 256 - total / 2, 126);
      g.font = '700 40px "Helvetica Neue", Arial, sans-serif';
      g.fillText(unit, 256 - total / 2 + vw + 14, 146);
    } else {
      g.fillText(value, 256, 126);
    }
    tex.needsUpdate = true;
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 1.62), new THREE.MeshBasicMaterial({ map: tex }));
  return { mesh, draw };
}

// ---------------------------------------------------------------- arena
function buildArena(scene) {
  const A = ARENA;
  const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ color: COLORS.wallTrim, roughness: 0.8 });
  const standMat = new THREE.MeshStandardMaterial({ color: COLORS.stand, roughness: 0.95 });
  const sponsors = NAMES.sponsors;
  const sponsorMats = sponsors.map((s) => new THREE.MeshBasicMaterial({ map: boardTexture(s.text, s) }));

  // back wall
  const wallW = (A.sideWallX + A.standRows * A.standRowDepth + 2) * 2;
  scene.add(box(wallW, A.backWallHeight, 0.4, wallMat, 0, A.backWallHeight / 2, A.backWallZ - 0.2));
  scene.add(box(wallW, 0.12, 0.5, trimMat, 0, A.backWallHeight + 0.06, A.backWallZ - 0.2));
  const zFace = A.backWallZ + 0.02;

  // sponsor boards along the base of the back wall
  const bw = 3.6, bh = 0.95, gap = 0.12;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), sponsorMats[(i + 2) % sponsorMats.length]);
    m.position.set((i - (n - 1) / 2) * (bw + gap), 0.08 + bh / 2, zFace);
    scene.add(m);
  }
  // tour banner, centre top
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 1.5),
    new THREE.MeshBasicMaterial({
      map: boardTexture(NAMES.tour, { bg: '#0e2a47', fg: '#ffffff', w: 1024, h: 212, sub: 'COURT RUSH WORLD TOUR' }),
    }),
  );
  banner.position.set(0, 4.25, zFace);
  scene.add(banner);
  // upper sponsor panels either side of the banner
  [[-9.2, 4], [9.2, 6], [-14.2, 0], [14.2, 8]].forEach(([x, idx]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.1), sponsorMats[idx % sponsorMats.length]);
    m.position.set(x, 4.25, zFace);
    scene.add(m);
  });

  // live boards: last shot speed and match clock
  const speed = liveBoard('SHOT SPEED');
  speed.mesh.position.set(-5.6, 1.98, zFace);
  scene.add(speed.mesh);
  speed.draw('0', 'km/h');
  const clock = liveBoard('MATCH TIME');
  clock.mesh.position.set(5.6, 1.98, zFace);
  scene.add(clock.mesh);
  clock.draw('0:00', '');

  // low side walls with boards
  const sideLen = A.standZMax - A.backWallZ;
  const sideMid = (A.standZMax + A.backWallZ) / 2;
  for (const s of [-1, 1]) {
    scene.add(box(0.3, A.sideWallHeight, sideLen, wallMat, s * (A.sideWallX + 0.15), A.sideWallHeight / 2, sideMid));
    scene.add(box(0.36, 0.06, sideLen, trimMat, s * (A.sideWallX + 0.15), A.sideWallHeight + 0.03, sideMid));
    const count = Math.floor(sideLen / 4.3);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 0.85), sponsorMats[(i * 2 + (s > 0 ? 1 : 0)) % sponsorMats.length]);
      m.position.set(s * (A.sideWallX - 0.01), 0.5, A.backWallZ + 2.3 + i * 4.3);
      m.rotation.y = -s * Math.PI / 2;
      scene.add(m);
    }
  }

  // stands and spectators
  const rnd = makeRng(99);
  const seats = [];
  for (const s of [-1, 1]) {
    for (let r = 0; r < A.standRows; r++) {
      const top = A.sideWallHeight + 0.2 + r * A.standRowRise;
      const x = s * (A.sideWallX + 0.3 + (r + 0.5) * A.standRowDepth);
      scene.add(box(A.standRowDepth, top, sideLen, standMat, x, top / 2, sideMid, { cast: false }));
      for (let z = A.standZMin + 0.5; z < A.standZMax - 0.3; z += A.seatSpacing) {
        if (rnd() < A.seatFill) seats.push([x, top, z + (rnd() - 0.5) * 0.12]);
      }
    }
    // rear wall of each stand
    const backX = s * (A.sideWallX + 0.3 + A.standRows * A.standRowDepth + 0.2);
    const backH = A.sideWallHeight + 0.2 + A.standRows * A.standRowRise + 1.2;
    scene.add(box(0.4, backH, sideLen, wallMat, backX, backH / 2, sideMid, { cast: false }));
  }
  // upper tier above the back wall
  for (let r = 0; r < 4; r++) {
    const top = A.backWallHeight + 0.15 + r * A.standRowRise;
    const z = A.backWallZ - 0.45 - (r + 0.5) * A.standRowDepth;
    scene.add(box(wallW, top, A.standRowDepth, standMat, 0, top / 2, z, { cast: false }));
    for (let x = -wallW / 2 + 1; x < wallW / 2 - 1; x += A.seatSpacing) {
      if (rnd() < A.seatFill) seats.push([x + (rnd() - 0.5) * 0.12, top, z]);
    }
  }

  const shirtPalette = [0xd9d4c7, 0xb9c4d6, 0x7f8fa6, 0xc9695a, 0xe0b65a, 0x5f7f6b, 0xf0ede6, 0x8d6e97, 0x3f5d8a, 0xcf8f6a, 0x9aa5a8];
  const skinPalette = [0xe2b28f, 0xc98f68, 0x9a6845, 0xf0c9a8, 0x6f4a32];
  const bodyGeo = new THREE.BoxGeometry(0.42, 0.56, 0.3);
  const headGeo = new THREE.SphereGeometry(0.115, 8, 6);
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), seats.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), seats.length);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  seats.forEach(([x, y, z], i) => {
    const h = 0.9 + rnd() * 0.2;
    m4.makeScale(1, h, 1).setPosition(x, y + 0.28 * h, z);
    bodies.setMatrixAt(i, m4);
    m4.makeScale(1, 1, 1).setPosition(x, y + 0.56 * h + 0.12, z);
    heads.setMatrixAt(i, m4);
    bodies.setColorAt(i, col.setHex(shirtPalette[Math.floor(rnd() * shirtPalette.length)]).multiplyScalar(0.75 + rnd() * 0.25));
    heads.setColorAt(i, col.setHex(skinPalette[Math.floor(rnd() * skinPalette.length)]));
  });
  bodies.instanceColor.needsUpdate = true;
  heads.instanceColor.needsUpdate = true;
  scene.add(bodies, heads);

  return {
    setSpeed: (kmh) => speed.draw(String(Math.round(kmh)), 'km/h'),
    setClock: (seconds) => {
      const s = Math.floor(seconds);
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      const mm = h ? String(m).padStart(2, '0') : String(m);
      clock.draw(`${h ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`, '');
    },
  };
}

// ---------------------------------------------------------------- people and props
function buildDressing(scene) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.6, metalness: 0.2 });
  const green = new THREE.MeshStandardMaterial({ color: 0x1f4f3a, roughness: 0.8 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x2c3a52, roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f1ec, roughness: 0.8 });

  const place = (fig, x, y, z, ry, pose, plant = true) => {
    fig.setPose(pose, { plant });
    fig.object3d.position.set(x, y, z);
    fig.object3d.rotation.y = ry;
    scene.add(fig.object3d);
    return fig;
  };
  const faceRight = Math.PI / 2; // local +z turned toward +x
  const faceLeft = -Math.PI / 2;

  // umpire chair on the left of the net
  const ux = -7.75, seatY = 1.85;
  const chair = new THREE.Group();
  for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) {
    chair.add(box(0.07, seatY, 0.07, green, dx * 1.25, seatY / 2, dz * 1.25));
  }
  chair.add(box(0.8, 0.07, 0.8, green, 0, seatY, 0));
  chair.add(box(0.07, 0.8, 0.8, green, -0.38, seatY + 0.4, 0)); // backrest
  chair.add(box(0.6, 0.05, 0.9, green, 0.42, seatY - 0.52, 0)); // footrest
  chair.add(box(0.75, 0.05, 0.07, green, 0, seatY + 0.28, -0.4)); // arm rests
  chair.add(box(0.75, 0.05, 0.07, green, 0, seatY + 0.28, 0.4));
  for (let i = 1; i <= 4; i++) chair.add(box(0.05, 0.05, 0.75, green, -0.5, i * 0.36, 0)); // ladder rungs
  chair.add(box(0.9, 0.5, 0.03, white, 0.05, 0.9, 0.46, { cast: false })); // side panel
  chair.position.set(ux, 0, 0);
  scene.add(chair);
  place(createFigure({ shirt: 0x1d2b4a, shorts: 0xc9bfa6, trousers: true, longSleeves: true, hair: 0x555555, shoes: 0x222222 }),
    ux - 0.05, seatY + 0.04, 0, faceRight, POSES.seated, false);

  // ball kids crouched just outside each net post
  for (const s of [-1, 1]) {
    place(createFigure({ shirt: 0xe8792f, shorts: 0x1c2333, scale: 0.8, hair: s < 0 ? 0x2a1d14 : 0x6b4a2a }),
      s * 7.05, 0, 1.15, s < 0 ? faceRight : faceLeft, POSES.crouch);
  }

  // line judges behind the far baseline
  [[-4.7, 0x2a1d14], [1.1, 0x8a6a4a], [4.7, 0x1a1a1a]].forEach(([x, hair]) => {
    place(createFigure({ shirt: 0x1d2b4a, shorts: 0xd8d0bc, trousers: true, hair, shoes: 0xffffff }),
      x, 0, ARENA.backWallZ + 1.25, 0, POSES.lineJudge);
  });

  // player benches either side of the umpire chair
  for (const s of [-1, 1]) {
    const bz = s * 3.4;
    const bench = new THREE.Group();
    bench.add(box(0.5, 0.06, 2.2, wood, 0, 0.46, 0));
    bench.add(box(0.06, 0.5, 2.2, wood, -0.26, 0.78, 0));
    for (const dz of [-0.95, 0.95]) bench.add(box(0.45, 0.46, 0.06, dark, 0, 0.23, dz));
    bench.add(box(0.36, 0.3, 0.75, new THREE.MeshStandardMaterial({ color: s > 0 ? 0x2f9e58 : 0xe9e9e4, roughness: 0.8 }), 0.55, 0.15, 0.55)); // racket bag
    bench.add(box(0.34, 0.4, 0.34, new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.6 }), 0.5, 0.2, -0.75)); // cooler
    bench.add(box(0.3, 0.04, 0.42, white, 0.02, 0.51, -0.3, { cast: false })); // towel
    bench.position.set(-8.75, 0, bz);
    scene.add(bench);
  }

  // TV camera pit in the far right corner, against the back wall
  const px = 7.9, pz = ARENA.backWallZ + 1.35;
  const pit = new THREE.Group();
  const pitMat = new THREE.MeshStandardMaterial({ color: 0x0e2a47, roughness: 0.8 });
  pit.add(box(2.4, 0.85, 0.1, pitMat, 0, 0.425, 1.0));
  pit.add(box(0.1, 0.85, 2.0, pitMat, -1.2, 0.425, 0));
  pit.add(box(0.1, 0.85, 2.0, pitMat, 1.2, 0.425, 0));
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.6),
    new THREE.MeshBasicMaterial({ map: boardTexture('RUSH TV', { bg: '#0e2a47', fg: '#ffffff', w: 512, h: 140 }) }),
  );
  sign.position.set(0, 0.45, 1.06);
  pit.add(sign);
  // tripod and camera
  for (const a of [0, 2.1, 4.2]) {
    const leg = box(0.04, 1.35, 0.04, dark, Math.sin(a) * 0.22, 0.66, 0.1 + Math.cos(a) * 0.22);
    leg.rotation.set(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
    pit.add(leg);
  }
  pit.add(box(0.3, 0.3, 0.62, dark, 0, 1.5, 0.15));
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.34, 12), dark);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 1.5, 0.6);
  lens.castShadow = true;
  pit.add(lens);
  pit.add(box(0.04, 0.04, 0.5, dark, 0.2, 1.32, -0.3)); // pan handle
  pit.position.set(px, 0, pz);
  scene.add(pit);
  place(createFigure({ shirt: 0x15171a, shorts: 0x15171a, trousers: true, hair: 0x3a2a1a, shoes: 0x111111 }),
    px, 0, pz - 0.55, 0, POSES.operator);
}

// ---------------------------------------------------------------- ball
// Slide trails scraped into the clay, and puffs of clay dust at the sliding foot.
function buildSlideFx(scene) {
  const onClay = (x, z) => Math.abs(x) <= COURT.doublesHalf && Math.abs(z) <= COURT.halfLength;
  // trail texture: a soft streak with scuffed edges, darker at the end where the foot stopped
  const c = document.createElement('canvas');
  c.width = 32; c.height = 128;
  const g = c.getContext('2d');
  for (let y = 0; y < 128; y++) {
    const along = y / 127;
    for (let x = 0; x < 32; x++) {
      const across = Math.abs(x - 15.5) / 16;
      let a = Math.max(0, 1 - Math.pow(across, 2.2)) * (0.45 + 0.55 * along);
      a *= 0.75 + 0.25 * Math.sin(x * 2.3 + y * 0.31) * Math.sin(y * 0.17);
      g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  const trails = [];
  const trailGeo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
      map: tex, color: 0x4a1a0d, transparent: true, opacity: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8, // above the clay and lines
    }));
    m.rotation.order = 'YXZ';
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.011;
    m.renderOrder = 3;
    m.visible = false;
    scene.add(m);
    trails.push(m);
  }
  let nextTrail = 0;

  // dust: small billboard sprites in a pool
  const dc = document.createElement('canvas');
  dc.width = dc.height = 32;
  const dg = dc.getContext('2d');
  const grad = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  dg.fillStyle = grad;
  dg.fillRect(0, 0, 32, 32);
  const dustTex = new THREE.CanvasTexture(dc);
  const dust = [];
  for (let i = 0; i < 48; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, color: 0xe2ab86, transparent: true, opacity: 0, depthWrite: false }));
    sp.visible = false;
    sp.renderOrder = 5;
    scene.add(sp);
    dust.push({ sp, vx: 0, vy: 0, vz: 0, life: 0, max: 1 });
  }
  let nextDust = 0;

  return {
    // one trail from where a slide started to where it stopped
    addTrail(x0, z0, x1, z1) {
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.25 || !onClay(x1, z1)) return;
      const m = trails[nextTrail];
      nextTrail = (nextTrail + 1) % trails.length;
      m.position.x = (x0 + x1) / 2;
      m.position.z = (z0 + z1) / 2;
      m.rotation.y = Math.atan2(dx, dz);
      m.rotation.z = Math.PI; // texture runs from start (top) to stop (bottom)
      m.scale.set(0.3, len + 0.25, 1);
      m.material.opacity = 0.9;
      m.visible = true;
    },
    // a puff at (x, z) kicked along (dx, dz); amount 0..1
    puff(x, z, dx, dz, amount, rand = Math.random) {
      if (!onClay(x, z)) return;
      const d = dust[nextDust];
      nextDust = (nextDust + 1) % dust.length;
      d.sp.position.set(x + (rand() - 0.5) * 0.15, 0.06, z + (rand() - 0.5) * 0.15);
      d.vx = dx * (0.6 + rand() * 0.8) + (rand() - 0.5) * 0.6;
      d.vz = dz * (0.6 + rand() * 0.8) + (rand() - 0.5) * 0.6;
      d.vy = 0.35 + rand() * 0.5;
      d.max = d.life = 0.5 + rand() * 0.5;
      d.size = 0.18 + 0.26 * amount;
      d.alpha = 0.5 + 0.4 * amount;
      d.sp.visible = true;
    },
    update(dt) {
      for (const m of trails) {
        if (!m.visible) continue;
        m.material.opacity -= dt * 0.06;
        if (m.material.opacity <= 0) m.visible = false;
      }
      for (const d of dust) {
        if (!d.sp.visible) continue;
        d.life -= dt;
        if (d.life <= 0) { d.sp.visible = false; continue; }
        const u = 1 - d.life / d.max;
        d.vx *= 1 - dt * 2.5; d.vz *= 1 - dt * 2.5; d.vy -= dt * 0.6;
        d.sp.position.x += d.vx * dt;
        d.sp.position.y = Math.max(0.03, d.sp.position.y + d.vy * dt);
        d.sp.position.z += d.vz * dt;
        const size = d.size * (1 + u * 2.2);
        d.sp.scale.set(size, size, 1);
        d.sp.material.opacity = d.alpha * (1 - u) * Math.min(1, u * 8);
      }
    },
  };
}

function buildBall(scene) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL.visualRadius, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xd9f23c, emissive: 0x8fa81a, emissiveIntensity: 0.55, roughness: 0.7 }),
  );
  mesh.visible = false;
  scene.add(mesh);

  // blob shadow straight under the ball so its height reads at distance
  const blobTex = canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 4;
  blob.visible = false;
  scene.add(blob);

  // short-lived marks where the ball lands on the clay
  const marks = [];
  const markGeo = new THREE.CircleGeometry(BALL.visualRadius * 1.2, 12);
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({
      color: 0x5a2416, transparent: true, opacity: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8, // the clay is offset too
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.012;
    m.renderOrder = 3;
    m.visible = false;
    scene.add(m);
    marks.push(m);
  }
  let nextMark = 0;

  return {
    update(ball, dt) {
      mesh.visible = blob.visible = ball.visible;
      if (ball.visible) {
        mesh.position.set(ball.x, Math.max(BALL.visualRadius, ball.y), ball.z);
        const h = Math.max(0, ball.y);
        const size = BALL.visualRadius * 3.6 + Math.min(h, 6) * 0.05;
        blob.scale.set(size, size, 1);
        blob.position.set(ball.x, 0.015, ball.z);
        blob.material.opacity = 0.75 - Math.min(0.45, h * 0.09);
      }
      for (const m of marks) {
        if (!m.visible) continue;
        m.material.opacity -= dt * 0.12;
        if (m.material.opacity <= 0) m.visible = false;
      }
    },
    addMark(x, z) {
      if (Math.abs(x) > COURT.doublesHalf || Math.abs(z) > COURT.halfLength) return; // clay only
      const m = marks[nextMark];
      nextMark = (nextMark + 1) % marks.length;
      m.position.x = x;
      m.position.z = z;
      m.material.opacity = 0.5;
      m.visible = true;
    },
  };
}

function buildLights(scene) {
  scene.add(new THREE.HemisphereLight(LIGHT.hemiSky, LIGHT.hemiGround, LIGHT.hemiIntensity));
  const sun = new THREE.DirectionalLight(LIGHT.sunColor, LIGHT.sunIntensity);
  sun.position.set(...LIGHT.sunPosition);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
  const cam = sun.shadow.camera;
  cam.left = -RENDER.shadowHalfWidth;
  cam.right = RENDER.shadowHalfWidth;
  cam.top = RENDER.shadowHalfLength;
  cam.bottom = -RENDER.shadowHalfLength;
  cam.near = 5;
  cam.far = 70;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 5;
  scene.add(sun, sun.target);
}

export function createWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);

  const court = buildCourt(scene);
  buildNet(scene);
  const boards = buildArena(scene);
  buildDressing(scene);
  const ballView = buildBall(scene);
  const slideFx = buildSlideFx(scene);
  let marks = SURFACES[DEFAULT_SURFACE].marks;
  buildLights(scene);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, CAMERA.baseAspect, CAMERA.near, CAMERA.far);
  const target = new THREE.Vector3(...CAMERA.target);
  camera.position.set(...CAMERA.position);
  camera.lookAt(target);
  let pan = 0;

  // Keep the horizontal field of view of the 16:9 framing on narrower screens.
  const baseHalfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(CAMERA.fov / 2)) * CAMERA.baseAspect);
  function resize(width, height) {
    const aspect = width / height;
    let fov = CAMERA.fov;
    if (aspect < CAMERA.baseAspect) {
      fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(baseHalfH) / aspect));
    }
    camera.fov = Math.min(CAMERA.maxFov, fov);
    camera.aspect = aspect;
    narrow = width <= 700;
    camera.updateProjectionMatrix();
  }

  // Showroom: while the player customises, the camera eases in and slowly orbits
  // the near player, framed beside the panel (or above it on a narrow screen).
  let showroom = false, show = 0, orbit = 0.6, narrow = false;
  const bcPos = new THREE.Vector3(), bcTarget = new THREE.Vector3();
  const srPos = new THREE.Vector3(), srTarget = new THREE.Vector3(), side = new THREE.Vector3();
  function updateCamera(dt, playerX = 0, playerZ = 12.5) {
    pan += (playerX - pan) * Math.min(1, dt * CAMERA.panLerp);
    bcPos.set(CAMERA.position[0] + pan * CAMERA.panPosition, CAMERA.position[1], CAMERA.position[2]);
    bcTarget.set(CAMERA.target[0] + pan * CAMERA.panTarget, CAMERA.target[1], CAMERA.target[2]);
    show += ((showroom ? 1 : 0) - show) * Math.min(1, dt * 3);
    if (show < 0.001) {
      camera.position.copy(bcPos);
      camera.lookAt(bcTarget);
      return;
    }
    orbit += dt * 0.35;
    const a = Math.sin(orbit) * 1.1; // sway between the player's front and sides
    // move the framing so the player sits clear of the panel: beside it on a wide
    // screen, above it (the panel is a sheet at the bottom) on a narrow one
    const r = narrow ? 3.8 : 4.4;
    srPos.set(playerX + Math.sin(a) * r, narrow ? 1.3 : 1.55, playerZ - Math.cos(a) * r);
    srTarget.set(playerX, narrow ? -0.4 : 1.0, playerZ);
    side.subVectors(srTarget, srPos).cross(camera.up).normalize();
    if (!narrow) srTarget.addScaledVector(side, -0.6);
    const u = show * show * (3 - 2 * show);
    camera.position.lerpVectors(bcPos, srPos, u);
    target.lerpVectors(bcTarget, srTarget, u);
    camera.lookAt(target);
  }

  return {
    scene, camera, resize, updateCamera,
    setSpeed: boards.setSpeed, setClock: boards.setClock,
    updateBall: ballView.update, addBounceMark: (x, z) => { if (marks) ballView.addMark(x, z); },
    addSlideTrail: (...a) => { if (marks) slideFx.addTrail(...a); },
    slideDust: (...a) => { if (marks) slideFx.puff(...a); },
    updateFx: slideFx.update,
    setShowroom(on) { showroom = on; },
    // switch the court between clay, grass and hard; marks and dust only show on clay
    setSurface(name) {
      court.setSurface(name);
      marks = !!(SURFACES[name] && SURFACES[name].marks);
    },
  };
}
