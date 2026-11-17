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
