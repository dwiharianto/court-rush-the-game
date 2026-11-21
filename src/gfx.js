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


// A tiling normal map made from noise, for surface detail that catches the light:
// 'grain' (clay: packed grit), 'blades' (grass: fine strokes along one direction),
// 'sand' (acrylic hard court: very fine). Generated once, no download.
export function surfaceNormalMap(kind, seed = 1, size = 256) {
  const rnd = makeRng(seed);
  const n = size * size;
  const h = new Float32Array(n);
  // a few octaves of smoothed value noise, wrapped so the map tiles
  const octave = (cells, amp, stretch = 1) => {
    const cx = cells, cy = Math.max(1, Math.round(cells / stretch));
    const g = new Float32Array(cx * cy).map(() => rnd());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cx, fy = (y / size) * cy;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const v = (i, j) => g[((j % cy) * cx) + (i % cx)];
        const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
        const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
        h[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
  };
  if (kind === 'blades') {
    octave(96, 0.6, 12); octave(192, 0.4, 20); octave(24, 0.25);
  } else if (kind === 'sand') {
    octave(128, 0.35); octave(48, 0.15);
    for (let i = 0; i < n; i++) h[i] += rnd() * 0.25;
  } else { // grain
    octave(64, 0.45); octave(16, 0.3);
    for (let i = 0; i < n; i++) h[i] += rnd() * 0.55;
  }
  const strength = { blades: 3.2, sand: 1.6, grain: 2.4 }[kind] || 2;
  return canvasTextureRaw(size, size, (img) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const at = (i, j) => h[((j + size) % size) * size + ((i + size) % size)];
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        const len = Math.hypot(dx, dy, 1);
        const o = (y * size + x) * 4;
        img[o] = (-dx / len * 0.5 + 0.5) * 255;
        img[o + 1] = (-dy / len * 0.5 + 0.5) * 255;
        img[o + 2] = (1 / len * 0.5 + 0.5) * 255;
        img[o + 3] = 255;
      }
    }
  });
}

// a texture from raw RGBA pixels, kept linear (for normal maps)
function canvasTextureRaw(w, h, fill) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const data = g.createImageData(w, h);
  fill(data.data);
  g.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
