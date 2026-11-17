// Match sound, synthesised with the Web Audio API. No audio files.
//
// Ball strikes are modal: a few short decaying resonances, a filtered noise
// body and a click. The crowd is generated once (soundgen.js): a wordless
// stadium bed that settles during points, applause sized to each point, and
// whistles for the big ones. Everything runs through a stadium reverb.
import { AUDIO } from './config.js';
import { applause, ballSound, grit, impulse, makeRng, roomTone, whistles } from './soundgen.js';

const CROWD_SR = 22050; // crowd buffers are generated at a lower rate; it is all below 5 kHz

export function createAudio(options = {}) {
  let ctx = null;
  let master = null, sfx = null, crowd = null, verbSend = null;
  let noiseBuf = null, gritBuf = null;
  const bank = { applauseLong: [], applauseShort: [], whistles: [], ball: {} };
  let murmurGain = null;
  let crowdMode = 'chatter', swellIn = 0;
  let muted = false, paused = false;
  const rnd = options.rng || Math.random;

  // ------------------------------------------------------------ setup
  function buffer(chans, sr) {
    const b = ctx.createBuffer(chans.length, chans[0].length, sr);
    chans.forEach((c, i) => b.copyToChannel(c, i));
    return b;
  }

  function build() {
    const sr = ctx.sampleRate;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : AUDIO.volume;
    const comp = ctx.createDynamicsCompressor();
    // a hard safety limiter just below full scale. A softer setting adds automatic
    // make-up gain, which pumps quiet passages up.
    comp.threshold.value = -2;
    comp.knee.value = 0;
    comp.ratio.value = 20;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    master.connect(comp).connect(ctx.destination);

    const verb = ctx.createConvolver();
    verb.buffer = buffer(impulse(sr, 2.0, makeRng(7)), sr);
    verbSend = ctx.createGain();
    verbSend.gain.value = AUDIO.reverb;
    verbSend.connect(verb).connect(master);

    sfx = ctx.createGain();
    sfx.connect(master);
    sfx.connect(verbSend);
    crowd = ctx.createGain();
    crowd.gain.value = AUDIO.crowd;
    crowd.connect(master);
    crowd.connect(verbSend);

    const white = new Float32Array(sr * 2);
    for (let i = 0; i < white.length; i++) white[i] = Math.random() * 2 - 1;
    noiseBuf = buffer([white], sr);
    gritBuf = buffer(grit(sr, 1.5, makeRng(11)), sr);
    // several variations of each ball sound, so repeated hits never sound identical
    const br = makeRng(21);
    for (const kind of ['hit', 'volley', 'slice', 'serve', 'smash', 'bounce']) {
      bank.ball[kind] = [];
      for (let i = 0; i < 6; i++) bank.ball[kind].push(buffer(ballSound(sr, kind, br), sr));
    }

    // the crowd takes a moment to generate; do it in slices so nothing stalls
    const r = makeRng(1234);
    const jobs = [
      () => startMurmur(buffer(roomTone(CROWD_SR, 12, r), CROWD_SR)),
      () => bank.applauseShort.push(buffer(applause(CROWD_SR, 2.2, 60, r), CROWD_SR)),
      () => bank.applauseLong.push(buffer(applause(CROWD_SR, 4.5, 110, r), CROWD_SR)),
      () => bank.whistles.push(buffer(whistles(CROWD_SR, 2.5, 3, r), CROWD_SR)),
      () => bank.applauseShort.push(buffer(applause(CROWD_SR, 2.6, 70, r), CROWD_SR)),
      () => bank.applauseLong.push(buffer(applause(CROWD_SR, 5.5, 120, r), CROWD_SR)),
      () => bank.whistles.push(buffer(whistles(CROWD_SR, 3, 4, r), CROWD_SR)),
    ];
    if (options.sync) jobs.forEach((j) => j());
    else {
      const next = () => { const j = jobs.shift(); if (j) { j(); setTimeout(next, 30); } };
      setTimeout(next, 30);
    }
  }

  function startMurmur(buf) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    murmurGain = ctx.createGain();
    murmurGain.gain.value = 0;
    src.connect(murmurGain).connect(crowd);
    src.start();
    setCrowd(crowdMode, true);
  }

  // ------------------------------------------------------------ building blocks
  const now = () => ctx.currentTime;

  // where on court: pan by x, quieter at the far end
  function place(opts) {
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.8, Math.min(0.8, (opts.x || 0) / 9));
    const g = ctx.createGain();
    g.gain.value = (opts.z || 0) < -1 ? 0.7 : 1;
    pan.connect(g).connect(sfx);
    return pan;
  }

  // gain envelope: quick rise, exponential decay with time constant tau
  function env(at, peak, attack, tau, dest) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.setTargetAtTime(0, at + attack, tau);
    g.connect(dest);
    return g;
  }

  // a decaying sine: one resonance of the ball, frame or court
  function mode(at, f, tau, amp, dest, drop = 0.97) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f, at);
    o.frequency.setTargetAtTime(f * drop, at, tau * 2);
    o.connect(env(at, amp, 0.0008, tau, dest));
    o.start(at);
    o.stop(at + 0.001 + tau * 7);
  }

  // a filtered noise burst
  function burst(at, { type = 'bandpass', f = 1000, q = 1, amp = 0.5, attack = 0.0008, tau = 0.01, dest, buf = noiseBuf, rate = 1 }) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    s.connect(fl).connect(env(at, amp, attack, tau, dest));
    const off = rnd() * (buf.duration - 0.6);
    s.start(at, Math.max(0, off));
    s.stop(at + attack + tau * 7 + 0.01);
    return fl;
  }

  // ------------------------------------------------------------ sound effects
  // Racket on ball, or ball on clay: one of the prebuilt variations, at a level set by pace.
  function ballHit(kind, level, opts) {
    const list = bank.ball[kind] || bank.ball.hit;
    const s = ctx.createBufferSource();
    s.buffer = list[Math.floor(rnd() * list.length)];
    s.playbackRate.value = 0.97 + rnd() * 0.06;
    const g = ctx.createGain();
    g.gain.value = level;
    s.connect(g).connect(place(opts));
    s.start(now() + 0.005);
  }

  // power 0..1 from shot speed. Slices brush, serves and smashes crack.
  function strike(kind, opts) {
    const p = Math.max(0.35, Math.min(1, opts.power ?? 0.7));
    const weight = { serve: 1.15, smash: 1.2, volley: 0.85, slice: 0.8 }[kind] || 1;
    ballHit(kind, AUDIO.levels.strike * weight * (0.3 + 0.7 * p), opts);
  }

  // Ball on clay: a soft, gritty thud, louder for faster impacts.
  function bounce(opts) {
    const p = Math.max(0.12, Math.min(1, (opts.speed ?? 6) / 9));
    ballHit('bounce', AUDIO.levels.bounce * p, opts);
  }

  // Ball into the net: a dull thump and the mesh rattling.
  function net(opts) {
    const at = now() + 0.005;
    const dest = place(opts);
    const k = AUDIO.levels.net;
    mode(at, 90, 0.05, 0.6 * k, dest, 0.8);
    burst(at, { type: 'lowpass', f: 520, amp: 0.9 * k, attack: 0.004, tau: 0.06, dest });
    for (let i = 0; i < 4; i++) burst(at + 0.02 + i * 0.028, { f: 1700 + rnd() * 600, q: 3, amp: 0.25 * k * (1 - i * 0.2), tau: 0.012, dest });
  }

  // Shoe sliding over clay: a gritty scrape that fades in and out.
  function slide(opts) {
    const at = now() + 0.005;
    const dest = place(opts);
    const p = Math.max(0.4, Math.min(1, (opts.speed ?? 5) / 6));
    const dur = 0.3 + 0.3 * p;
    const s = ctx.createBufferSource();
    s.buffer = gritBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(1600, at);
    bp.frequency.exponentialRampToValueAtTime(700, at + dur);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 220;
    const g = ctx.createGain();
    const peak = AUDIO.levels.slide * p;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.07);
    g.gain.setValueAtTime(peak, at + dur * 0.55);
    g.gain.linearRampToValueAtTime(0, at + dur);
    s.connect(bp).connect(hp).connect(g).connect(dest);
    s.start(at, rnd() * 0.8);
    s.stop(at + dur + 0.02);
  }

  // ------------------------------------------------------------ crowd
  // 'chatter' between points, 'hush' while a player serves and during the rally, 'off' for silence.
  function setCrowd(mode, immediate = false) {
    if (!ctx || !murmurGain) { crowdMode = mode; return; }
    if (mode === crowdMode && !immediate) return;
    crowdMode = mode;
    const target = mode === 'off' ? 0 : mode === 'hush' ? AUDIO.levels.hush : AUDIO.levels.chatter;
    murmurGain.gain.cancelScheduledValues(now());
    murmurGain.gain.setTargetAtTime(target, now(), immediate ? 0.5 : mode === 'hush' ? 0.7 : 1.2);
  }

  function update(dt) {
    if (!ctx || !murmurGain || crowdMode !== 'chatter') return;
    // the chatter swells and settles on its own
    swellIn -= dt;
    if (swellIn <= 0) {
      swellIn = 2 + rnd() * 3;
      murmurGain.gain.setTargetAtTime(AUDIO.levels.chatter * (0.75 + rnd() * 0.5), now(), 1.0);
    }
  }

  function playCrowd(list, gain, { delay = 0, rate = 1 } = {}) {
    if (!list.length) return;
    const s = ctx.createBufferSource();
    s.buffer = list[Math.floor(rnd() * list.length)];
    s.playbackRate.value = rate * (0.96 + rnd() * 0.08);
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(crowd);
    s.start(now() + delay);
  }

  // Crowd reactions. intensity 0..1.
  const REACT = {
    applause(i) {
      playCrowd(i > 0.55 ? bank.applauseLong : bank.applauseShort, AUDIO.levels.applause * (0.35 + 0.65 * i));
    },
    // a big point: louder, longer applause with whistles from the stands
    roar(i) {
      playCrowd(bank.applauseLong, AUDIO.levels.applause * (0.6 + 0.4 * i));
      playCrowd(bank.whistles, AUDIO.levels.whistle * (0.5 + 0.5 * i), { delay: 0.2 });
    },
    ovation() {
      playCrowd(bank.applauseLong, AUDIO.levels.applause);
      playCrowd(bank.applauseLong, AUDIO.levels.applause * 0.8, { delay: 0.6, rate: 0.93 });
      playCrowd(bank.whistles, AUDIO.levels.whistle, { delay: 0.3 });
      playCrowd(bank.whistles, AUDIO.levels.whistle * 0.8, { delay: 1.6, rate: 1.05 });
      playCrowd(bank.applauseLong, AUDIO.levels.applause * 0.7, { delay: 3 });
    },
  };

  const SFX = { strike, bounce, net, slide };

  return {
    // Browsers only allow audio after a user gesture, so this runs on Play.
    unlock() {
      if (!ctx) {
        const Ctor = options.context ? null : window.AudioContext || window.webkitAudioContext;
        if (!options.context && !Ctor) return;
        ctx = options.context || new Ctor();
        build();
      }
      if (ctx.state === 'suspended' && !paused && !options.context) ctx.resume();
    },
    // name: strike | bounce | net | slide; opts: { kind, power, speed, x, z }
    play(name, opts = {}) {
      if (!ctx || (ctx.state !== 'running' && !options.context) || !SFX[name]) return;
      if (name === 'strike') strike(opts.kind, opts);
      else SFX[name](opts);
    },
    react(kind, intensity = 0.5) {
      if (!ctx || !REACT[kind]) return;
      REACT[kind](Math.max(0, Math.min(1, intensity)));
    },
    setCrowd,
    update,
    pause() { paused = true; if (ctx && ctx.suspend) ctx.suspend(); },
    resume() { paused = false; if (ctx && ctx.resume) ctx.resume(); },
    setMuted(m) {
      muted = m;
      if (master) master.gain.setTargetAtTime(m ? 0 : AUDIO.volume, ctx.currentTime, 0.05);
    },
    get muted() { return muted; },
    get context() { return ctx; },
  };
}
