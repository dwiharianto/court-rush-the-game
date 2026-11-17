// Offline sound generators: plain sample arrays, built once when audio starts.
// Crowd voices are glottal pulse trains through vowel formant filters; applause
// is many clappers, each a train of short filtered noise bursts; the reverb is
// a decaying, darkening noise tail. No audio files.

export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// Vowel formants (F1, F2) in Hz.
const VOWELS = {
  a: [730, 1090], e: [530, 1840], i: [300, 2250], o: [570, 840],
  u: [320, 870], ae: [660, 1720], er: [490, 1350],
};
const CHAT_VOWELS = ['a', 'e', 'i', 'o', 'u', 'ae', 'er'];

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

// One voice: a pulse train at pitch(t) through two formants(t), with amplitude amp(t).
// Parameters are sampled every 64 samples. Writes into out from sample `start`
// (wrapping when `wrap` is set, for seamless loops).
function renderVoice(out, sr, start, seconds, { pitch, formants, amp, pan, breath, rnd, wrap = false }) {
  const n = Math.floor(seconds * sr);
  const L = out[0].length;
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  let phase = rnd();
  let c1 = null, c2 = null, f = 100, a = 0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 63) === 0) {
      const t = i / sr;
      f = pitch(t);
      a = amp(t);
      const [fa, fb] = formants(t);
      c1 = bandpass(fa, 6, sr);
      c2 = bandpass(fb, 9, sr);
    }
    phase += f / sr;
    if (phase >= 1) phase -= 1;
    const src = (1 - breath) * (2 * phase - 1) + breath * (rnd() * 2 - 1);
    const o1 = c1[0] * src + c1[1] * x2 - c1[2] * y1 - c1[3] * y2;
    const o2 = c2[0] * src + c2[1] * x2 - c2[2] * u1 - c2[3] * u2;
    x2 = x1; x1 = src; y2 = y1; y1 = o1; u2 = u1; u1 = o2;
    const v = (o1 + 0.7 * o2) * a;
    let j = start + i;
    if (wrap) j %= L;
    else if (j >= L) break;
    out[0][j] += v * gl;
    out[1][j] += v * gr;
  }
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

// Crowd chatter: many people talking at once, as a loopable stereo bed.
export function babble(sr, seconds, voices, rnd) {
  const len = Math.floor(seconds * sr), fade = Math.floor(0.5 * sr);
  const out = stereo(len + fade);
  for (let v = 0; v < voices; v++) {
    const base = 95 + rnd() * 150; // mixed voices
    const gain = 0.25 + rnd() * 0.75; // near and far seats
    const pan = rnd() * 2 - 1;
    // a chain of phrases, each a run of syllables
    const syl = [];
    let t = 0;
    while (t < seconds + 0.5) {
      const count = 3 + Math.floor(rnd() * 8);
      for (let s = 0; s < count; s++) {
        const d = 0.08 + rnd() * 0.18;
        syl.push({ t0: t, t1: t + d, vowel: VOWELS[CHAT_VOWELS[Math.floor(rnd() * CHAT_VOWELS.length)]], p: base * (0.9 + rnd() * 0.25) });
        t += d + 0.02 + rnd() * 0.08;
      }
      t += 0.4 + rnd() * 1.6;
    }
    let k = 0;
    const find = (tt) => {
      while (k < syl.length - 1 && syl[k].t1 < tt) k++;
      return syl[k];
    };
    renderVoice(out, sr, 0, seconds + 0.5, {
      pitch: (tt) => find(tt).p,
      formants: (tt) => find(tt).vowel,
      amp: (tt) => {
        const s = find(tt);
        if (tt < s.t0 || tt > s.t1) return 0;
        const e = Math.min(1, (tt - s.t0) / 0.02, (s.t1 - tt) / 0.04);
        return e * gain;
      },
      pan, breath: 0.25, rnd,
    });
  }
  return normalize(loopFold(lowpass(out, 2600, sr), len, fade), 0.9);
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

// A cheer: shouted "yeah"s rising then falling, with a few whistles.
export function cheer(sr, seconds, voices, rnd) {
  const out = stereo(Math.floor(seconds * sr));
  for (let v = 0; v < voices; v++) {
    const p0 = 170 + rnd() * 260;
    const dur = 0.8 + rnd() * 1.5;
    const start = Math.floor(rnd() * 0.35 * sr);
    const gain = 0.3 + rnd() * 0.7;
    const from = VOWELS[rnd() < 0.5 ? 'e' : 'o'], to = VOWELS[rnd() < 0.7 ? 'a' : 'ae'];
    renderVoice(out, sr, start, dur, {
      pitch: (t) => p0 * (1 + 0.12 * Math.min(1, t / 0.25) - 0.25 * Math.max(0, (t - dur * 0.6) / (dur * 0.4))) * (1 + 0.015 * Math.sin(t * 31)),
      formants: (t) => {
        const u = Math.min(1, t / 0.22);
        return [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u];
      },
      amp: (t) => gain * Math.min(1, t / 0.06) * Math.min(1, (dur - t) / 0.45),
      pan: rnd() * 2 - 1, breath: 0.45, rnd,
    });
  }
  // two-finger whistles
  for (let w = 0; w < 3; w++) {
    const f0 = 1900 + rnd() * 800, dur = 0.5 + rnd() * 0.7;
    const i0 = Math.floor((0.1 + rnd() * 0.5) * sr), n = Math.floor(dur * sr);
    const pan = rnd() * 2 - 1;
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    let ph = 0;
    for (let i = 0; i < n && i0 + i < out[0].length; i++) {
      const t = i / sr;
      const f = f0 * (1 + 0.3 * Math.min(1, t / 0.15)) * (1 + 0.01 * Math.sin(t * 40));
      ph += f / sr;
      const v = Math.sin(2 * Math.PI * ph) * 0.18 * Math.min(1, t / 0.03) * Math.min(1, (dur - t) / 0.1);
      out[0][i0 + i] += v * gl;
      out[1][i0 + i] += v * gr;
    }
  }
  return normalize(lowpass(out, 3800, sr), 0.9);
}

// A disappointed "ohh" from the crowd: falling pitch, rounded vowel.
export function groan(sr, seconds, voices, rnd) {
  const out = stereo(Math.floor(seconds * sr));
  for (let v = 0; v < voices; v++) {
    const p0 = 130 + rnd() * 200;
    const dur = 0.7 + rnd() * (seconds - 0.9);
    const start = Math.floor(rnd() * 0.15 * sr);
    const gain = 0.3 + rnd() * 0.7;
    renderVoice(out, sr, start, dur, {
      pitch: (t) => p0 * (1.08 - 0.32 * (t / dur)),
      formants: (t) => {
        const u = Math.min(1, t / dur);
        return [VOWELS.o[0] + (VOWELS.u[0] - VOWELS.o[0]) * u, VOWELS.o[1] + (VOWELS.u[1] - VOWELS.o[1]) * u];
      },
      amp: (t) => gain * Math.min(1, t / 0.08) * Math.min(1, (dur - t) / (dur * 0.6)),
      pan: rnd() * 2 - 1, breath: 0.35, rnd,
    });
  }
  return normalize(lowpass(out, 2400, sr), 0.9);
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
