// Synthesised sound effects with the Web Audio API. No audio files.
import { AUDIO } from './config.js';

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  // Browsers only allow audio after a user gesture, so this runs on Play.
  function unlock() {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = AUDIO.volume;
      master.connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function envelope(gain, at, peak, dur, attack = 0.004) {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  }

  function tone(freq, dur, { type = 'sine', gain = 0.3, to = 0, delay = 0 } = {}) {
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, at + dur);
    envelope(g, at, gain, dur);
    osc.connect(g).connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  function noise(dur, { gain = 0.3, freq = 1500, type = 'bandpass', q = 1, delay = 0, attack = 0.004, sweepTo = 0 } = {}) {
    const at = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, at);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    envelope(g, at, gain, dur, attack);
    src.connect(filter).connect(g).connect(master);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  const SOUNDS = {
    // ball strikes: a short hollow "pock", mostly tone with only a whisper of noise
    hit: () => { tone(560, 0.05, { gain: 0.28, to: 330 }); noise(0.025, { gain: 0.1, freq: 3200, q: 2 }); },
    serve: () => { tone(600, 0.06, { gain: 0.32, to: 340 }); noise(0.03, { gain: 0.12, freq: 3200, q: 2 }); },
    slice: () => { tone(430, 0.05, { gain: 0.22, to: 280 }); noise(0.04, { gain: 0.09, freq: 3600, q: 2 }); },
    smash: () => { tone(470, 0.07, { gain: 0.36, to: 240 }); noise(0.035, { gain: 0.16, freq: 2600, q: 1.6 }); },
    bounce: () => { tone(170, 0.09, { gain: 0.3, to: 80 }); noise(0.04, { gain: 0.12, freq: 700, type: 'lowpass' }); },
    // shoes scraping across clay: fades in, no hard edge
    slide: () => { noise(0.5, { gain: 0.07, freq: 1400, sweepTo: 600, type: 'lowpass', q: 0.5, attack: 0.09 }); },
    net: () => { noise(0.22, { gain: 0.3, freq: 500, type: 'lowpass' }); tone(120, 0.12, { gain: 0.15, to: 70 }); },
    perfect: () => { tone(1320, 0.1, { gain: 0.1 }); tone(1980, 0.14, { gain: 0.07, delay: 0.05 }); },
    fault: () => { tone(210, 0.22, { type: 'square', gain: 0.09 }); },
    pointWon: () => { tone(660, 0.12, { gain: 0.16, delay: 0.25 }); tone(880, 0.2, { gain: 0.16, delay: 0.38 }); },
    pointLost: () => { tone(330, 0.14, { gain: 0.16, delay: 0.25 }); tone(247, 0.26, { gain: 0.16, delay: 0.4 }); },
    matchWon: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { gain: 0.18, delay: i * 0.14 })); },
    matchLost: () => { [392, 330, 262].forEach((f, i) => tone(f, 0.3, { gain: 0.16, delay: i * 0.2 })); },
  };

  return {
    unlock,
    play(name) {
      if (!ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
      SOUNDS[name]();
    },
  };
}
