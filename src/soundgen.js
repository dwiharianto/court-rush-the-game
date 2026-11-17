// Offline sound generators: plain sample arrays, built once when audio starts.
// The crowd bed is band-limited pink noise with slow swells; applause is many
// clappers, each a train of short filtered noise bursts; the reverb is a
// decaying, darkening noise tail. No voices (synthetic voices sound ghostly)
// and no audio files.

export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// RBJ band-pass, 0 dB peak. Returns [b0, b2, a1, a2] (b1 is 0).
function bandpass(f, q, sr) {
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return [alpha / a0, -alpha / a0, (-2 * Math.cos(w)) / a0, (1 - alpha) / a0];
}

function stereo(n) { return [new Float32Array(n), new Float32Array(n)]; }

function normalize(chans, peak = 0.9) {
  let m = 1e-9;
  for (const c of chans) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  const k = peak / m;
  for (const c of chans) for (let i = 0; i < c.length; i++) c[i] *= k;
  return chans;
}

// Gentle one-pole low-pass over a buffer (distance across the stadium).
function lowpass(chans, cutoff, sr) {
  const k = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
  for (const c of chans) {
    let y = 0;
    for (let i = 0; i < c.length; i++) { y += k * (c[i] - y); c[i] = y; }
  }
  return chans;
}

// One-pole high-pass over a buffer.
function highpass(chans, cutoff, sr) {
  const k = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
  for (const c of chans) {
    let y = 0;
    for (let i = 0; i < c.length; i++) { y += k * (c[i] - y); c[i] -= y; }
  }
  return chans;
}

// Seamless loop: overlap the extra tail onto the head with a cross-fade.
function loopFold(chans, len, fade) {
  return chans.map((c) => {
    const o = new Float32Array(len);
    for (let i = 0; i < len; i++) o[i] = c[i];
    for (let i = 0; i < fade; i++) {
      const w = i / fade;
      o[i] = c[i] * w + c[len + i] * (1 - w);
    }
    return o;
  });
}

// Stadium room tone: the broad, wordless hum of a full arena (no voices), as a
// loopable stereo bed. Pink-ish noise, band-limited, with slow swells.
export function roomTone(sr, seconds, rnd) {
  const len = Math.floor(seconds * sr), fade = Math.floor(0.6 * sr);
  const n = len + fade;
  const out = stereo(n);
  for (const c of out) {
    // pink noise (Paul Kellet's economy filter)
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      c[i] = b0 + b1 + b2 + w * 0.1848;
    }
    // slow, independent swells on each side
    let lvl = 1, target = 1, next = 0;
    for (let i = 0; i < n; i++) {
      if (i >= next) { target = 0.7 + rnd() * 0.6; next = i + Math.floor((1 + rnd() * 2.5) * sr); }
      lvl += (target - lvl) * (1 / sr) * 1.2;
      c[i] *= lvl;
    }
  }
  // band-limit: no rumble, no hiss; a crowd heard across a stadium
  highpass(out, 160, sr);
  lowpass(out, 1100, sr);
  lowpass(out, 1600, sr);
  return normalize(loopFold(out, len, fade), 0.9);
}

// Applause: `clappers` people clapping for about `duration` seconds.
export function applause(sr, duration, clappers, rnd) {
  const len = Math.floor((duration + 1.2) * sr);
  const out = stereo(len);
  const burst = Math.floor(0.03 * sr);
  for (let c = 0; c < clappers; c++) {
    const pan = rnd() * 2 - 1;
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    const rate = 3 + rnd() * 2.6;
    const start = rnd() * 0.3;
    const end = duration * (0.5 + rnd() * 0.5);
    const gain = 0.35 + rnd() * 0.65;
    const coef = bandpass(700 + rnd() * 1800, 1 + rnd() * 1.6, sr);
    const tau = (0.002 + rnd() * 0.004) * sr;
    for (let t = start; t < end; t += (1 / rate) * (0.88 + rnd() * 0.24)) {
      const env = Math.min(1, (t - start) / 0.2) * Math.min(1, (end - t) / (end * 0.35));
      const a = env * gain * (0.6 + rnd() * 0.4);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      const i0 = Math.floor(t * sr);
      for (let i = 0; i < burst && i0 + i < len; i++) {
        const src = (rnd() * 2 - 1) * Math.exp(-i / tau);
        const y = coef[0] * src + coef[1] * x2 - coef[2] * y1 - coef[3] * y2;
        x2 = x1; x1 = src; y2 = y1; y1 = y;
        const v = (y * 2.5 + src * 0.35) * a;
        out[0][i0 + i] += v * gl;
        out[1][i0 + i] += v * gr;
      }
    }
  }
  return normalize(lowpass(out, 5200, sr), 0.9);
}

// Two-finger whistles from the stands, for the big points.
export function whistles(sr, seconds, count, rnd) {
  const out = stereo(Math.floor(seconds * sr));
  for (let w = 0; w < count; w++) {
    const f0 = 1900 + rnd() * 900, dur = 0.35 + rnd() * 0.6;
    const i0 = Math.floor((0.05 + rnd() * (seconds - dur - 0.1)) * sr), n = Math.floor(dur * sr);
    const pan = rnd() * 2 - 1;
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    const gain = 0.5 + rnd() * 0.5;
    const twoNote = rnd() < 0.4; // the classic rising then falling whistle
    let ph = 0;
    for (let i = 0; i < n && i0 + i < out[0].length; i++) {
      const t = i / sr;
      let f = f0 * (1 + 0.25 * Math.min(1, t / 0.08));
      if (twoNote && t > dur * 0.55) f *= 0.8;
      f *= 1 + 0.006 * Math.sin(t * 38);
      ph += f / sr;
      const v = Math.sin(2 * Math.PI * ph) * gain * Math.min(1, t / 0.02) * Math.min(1, (dur - t) / 0.06);
      out[0][i0 + i] += v * gl;
      out[1][i0 + i] += v * gr;
    }
  }
  return normalize(out, 0.9);
}

// Stadium reverb impulse: early reflections, then a tail that darkens as it decays.
export function impulse(sr, seconds, rnd) {
  const n = Math.floor(seconds * sr);
  const out = stereo(n);
  const pre = Math.floor(0.012 * sr);
  for (const [t, g] of [[0.019, 0.5], [0.031, 0.35], [0.047, 0.3], [0.066, 0.22]]) {
    const i = Math.floor(t * sr);
    out[0][i] += g * (rnd() < 0.5 ? 1 : -1);
    out[1][i + Math.floor(rnd() * 40)] += g * (rnd() < 0.5 ? 1 : -1);
  }
  for (const c of out) {
    let y = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const k = 0.55 * Math.exp(-t / 0.5) + 0.06; // air absorbs the highs over time
      y += k * ((rnd() * 2 - 1) - y);
      c[i] += y * Math.exp(-t / 0.42) * 0.6;
    }
  }
  return out;
}

// Gritty texture for a shoe sliding over clay: noise made of tiny crunches.
export function grit(sr, seconds, rnd) {
  const n = Math.floor(seconds * sr);
  const c = new Float32Array(n);
  let env = 0;
  for (let i = 0; i < n; i++) {
    if (rnd() < 900 / sr) env = 0.4 + rnd() * 0.6; // a grain of clay
    env *= 0.996;
    c[i] = (rnd() * 2 - 1) * (0.25 + env);
  }
  return [c];
}

// ---------------------------------------------------------------- ball sounds
// A real strike barely rings: strings and felt damp it within milliseconds. So no
// tones here, just a short pressure pulse (the hollow "pop") and noise bursts
// that die away in a few milliseconds, each through a broad filter.
const BALL_RECIPES = {
  // pop: pulse width (ms); bursts: [centre Hz, Q, decay ms, level]; low: thump level; brush: slice brush level
  hit: { pop: 0.9, popAmp: 0.6, bursts: [[1100, 1.2, 2.6, 0.9], [2700, 1.6, 1.4, 0.45], [5200, 1, 0.6, 0.2]], low: 0.25 },
  volley: { pop: 0.85, popAmp: 0.55, bursts: [[1250, 1.3, 2.0, 0.8], [2900, 1.6, 1.1, 0.4], [5400, 1, 0.5, 0.18]], low: 0.12 },
  slice: { pop: 1.1, popAmp: 0.45, bursts: [[1400, 1.1, 2.2, 0.6], [3200, 1.4, 1.3, 0.35], [5600, 1, 0.6, 0.2]], low: 0.1, brush: 0.3 },
  serve: { pop: 0.8, popAmp: 0.65, bursts: [[1050, 1.2, 2.8, 1.0], [2600, 1.5, 1.6, 0.6], [5000, 1, 0.7, 0.3]], low: 0.35 },
  smash: { pop: 0.8, popAmp: 0.7, bursts: [[1000, 1.2, 3.0, 1.0], [2500, 1.5, 1.7, 0.65], [5000, 1, 0.8, 0.32]], low: 0.4 },
  // ball on clay: wider, softer pulse, darker and grittier
  bounce: { pop: 2.6, popAmp: 1, bursts: [[650, 1, 3.5, 0.5], [1800, 1.2, 1.5, 0.18], [4200, 0.9, 0.8, 0.12]], low: 0.45 },
};

function filterBurst(out, sr, f, q, decayMs, level, rnd, start = 0) {
  const c = bandpass(f, q, sr);
  const tau = (decayMs / 1000) * sr;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const n = Math.min(out.length - start, Math.floor(tau * 9));
  for (let i = 0; i < n; i++) {
    const x = (rnd() * 2 - 1) * Math.exp(-i / tau);
    const y = c[0] * x + c[1] * x2 - c[2] * y1 - c[3] * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[start + i] += y * level * 3;
  }
}

// One variation of a ball sound, mono, about 80 ms.
export function ballSound(sr, kind, rnd) {
  const R = BALL_RECIPES[kind] || BALL_RECIPES.hit;
  const v = 0.92 + rnd() * 0.16; // each variation a little different
  const n = Math.floor(0.08 * sr);
  const out = new Float32Array(n);
  const start = R.brush ? Math.floor(0.012 * sr) : 0;
  // brush: strings sliding under the ball just before a slice leaves
  if (R.brush) {
    const tau = 0.006 * sr;
    const c = bandpass(4200, 0.9, sr);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < start + 20; i++) {
      const env = Math.min(1, i / (0.008 * sr)) * Math.exp(-Math.max(0, i - start) / tau);
      const x = (rnd() * 2 - 1) * env;
      const y = c[0] * x + c[1] * x2 - c[2] * y1 - c[3] * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[i] += y * R.brush * 2;
    }
  }
  // the pop: one smooth pressure pulse, positive then a smaller negative rebound
  const w = (R.pop / 1000) * sr * (2 - v);
  for (let i = 0; i < w * 2.2 && start + i < n; i++) {
    const t = i / w;
    const p = t < 1 ? Math.sin(Math.PI * t) : -0.35 * Math.sin(Math.PI * (t - 1) / 1.2);
    out[start + i] += p * R.popAmp * 0.8;
  }
  for (const [f, q, d, l] of R.bursts) filterBurst(out, sr, f * v, q, d, l * (0.85 + rnd() * 0.3), rnd, start);
  // low thump of the frame or the court, still heavily damped
  if (R.low) {
    const tmp = new Float32Array(n);
    filterBurst(tmp, sr, 220 * v, 0.8, 6, R.low * 2, rnd, start);
    for (let i = 0; i < n; i++) out[i] += tmp[i];
  }
  // a short fade so nothing clicks at the end
  for (let i = 0; i < 64; i++) out[n - 1 - i] *= i / 64;
  let m = 1e-9;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.9 / m;
  return [out];
}

// ---------------------------------------------------------------- effort grunt
// A short "huh!" as a player strikes: a breathy glottal source with jitter, a
// falling pitch, and a cascade of vocal-tract resonances (Klatt-style formants).
// Short and noisy on purpose: long, steady synthetic vowels are what sound ghostly.
const GRUNT_VOWELS = [[640, 1190, 2390], [700, 1220, 2600], [600, 1040, 2250], [560, 1480, 2500]];

function resonator(x, f, bw, sr) {
  const C = -Math.exp((-2 * Math.PI * bw) / sr);
  const B = 2 * Math.exp((-Math.PI * bw) / sr) * Math.cos((2 * Math.PI * f) / sr);
  const A = 1 - B - C;
  let y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = A * x[i] + B * y1 + C * y2;
    y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}

export function grunt(sr, f0, rnd) {
  const dur = 0.17 + rnd() * 0.16;
  const n = Math.floor(dur * sr);
  const src = new Float32Array(n);
  const [F1, F2, F3] = GRUNT_VOWELS[Math.floor(rnd() * GRUNT_VOWELS.length)];
  const p0 = f0 * (0.92 + rnd() * 0.16);
  const breath = 0.35 + rnd() * 0.3;
  // glottal flow derivative pulses (Rosenberg), period by period, with jitter and shimmer
  let t = 0;
  while (t < n) {
    const u = t / n;
    const f = p0 * (1.18 - 0.38 * u); // falls as the breath runs out
    const T0 = (sr / f) * (1 + (rnd() - 0.5) * 0.06);
    const amp = 0.8 + rnd() * 0.4;
    const open = T0 * 0.42, close = T0 * 0.16;
    for (let k = 0; k < T0 && t + k < n; k++) {
      let d = 0;
      if (k < open) d = Math.sin((Math.PI * k) / open) * 0.5; // opening slope
      else if (k < open + close) d = -Math.sin((Math.PI * (k - open)) / (2 * close)) * 1.4; // sharp closure
      src[Math.floor(t + k)] += d * amp;
    }
    t += T0;
  }
  // breath noise, strongest at the start (the push) and in the tail
  for (let i = 0; i < n; i++) {
    const u = i / n;
    src[i] = src[i] * (1 - breath * 0.5) + (rnd() * 2 - 1) * breath * (0.6 + 0.6 * u) * 0.5;
  }
  // vocal tract
  resonator(src, F1, 90, sr);
  resonator(src, F2, 110, sr);
  resonator(src, F3, 170, sr);
  resonator(src, 3400, 250, sr);
  // a hard onset (glottal stop) and a quick, breathy decay
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    const env = Math.min(1, tt / 0.012) * Math.exp(-Math.max(0, tt - 0.03) / (dur * 0.35));
    src[i] *= env;
  }
  const out = lowpass([src], 3800, sr);
  return normalize(out, 0.9);
}
