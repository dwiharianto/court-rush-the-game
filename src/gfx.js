// Small drawing helpers shared by the arena and the club venue.
import * as THREE from 'three';

export function canvasTexture(w, h, draw) {
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
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function noiseTexture(base, seed, { speckles = 9000, blotches = 60, light = '255,235,215', dark = '60,20,10' } = {}) {
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

export function boardTexture(text, { bg, fg, w = 512, h = 128, sub = '' }) {
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

export function box(w, h, d, material, x, y, z, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}


export function grassFloorTexture(color) {
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

