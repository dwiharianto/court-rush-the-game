// Match sound, synthesised with the Web Audio API. No audio files.
//
// Ball strikes are modal: a few short decaying resonances, a filtered noise
// body and a click. The crowd is generated once (soundgen.js): a wordless
// stadium bed that settles during points, applause sized to each point, and
// whistles for the big ones. Everything runs through a stadium reverb.
import { AUDIO } from './config.js';
import { applause, ballSound, grit, grunt, impulse, makeRng, roomTone, whistles } from './soundgen.js';

const CROWD_SR = 22050; // crowd buffers are generated at a lower rate; it is all below 5 kHz

export function createAudio(options = {}) {
  let ctx = null;
  let master = null, sfx = null, crowd = null, verbSend = null;
  let noiseBuf = null, gritBuf = null;
  const bank = { applauseLong: [], applauseShort: [], whistles: [], ball: {}, grunt: [[], []] };
  let murmurGain = null;
  let crowdMode = 'chatter', swellIn = 0;
  let muted = false, paused = false;
  let surface = 'clay'; // the court changes how bounces, slides and stops sound
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
    for (const kind of ['hit', 'volley', 'slice', 'serve', 'smash', 'bounce', 'bounceGrass', 'bounceHard']) {
      bank.ball[kind] = [];
      for (let i = 0; i < 6; i++) bank.ball[kind].push(buffer(ballSound(sr, kind, br), sr));
    }
    // each player has their own voice: six effort grunts apiece
    const gr = makeRng(33);
    AUDIO.gruntPitch.forEach((f0, side) => {
      for (let i = 0; i < 6; i++) bank.grunt[side].push(buffer(grunt(sr, f0, gr), sr));
    });

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

  // Ball on the court: a gritty thud on clay, a soft thud on grass, a crisp pock on
  // a hard court; louder for faster impacts.
  function bounce(opts) {
    const p = Math.max(0.12, Math.min(1, (opts.speed ?? 6) / 9));
    const kind = surface === 'grass' ? 'bounceGrass' : surface === 'hard' ? 'bounceHard' : 'bounce';
    ballHit(kind, AUDIO.levels.bounce * AUDIO.surfaceBounce[surface] * p, opts);
  }

  // A player's effort grunt on a big shot.
  function effort(opts) {
    const list = bank.grunt[opts.side] || bank.grunt[0];
    if (!list.length) return;
    const s = ctx.createBufferSource();
    s.buffer = list[Math.floor(rnd() * list.length)];
    s.playbackRate.value = 0.96 + rnd() * 0.08;
    const g = ctx.createGain();
    g.gain.value = AUDIO.levels.grunt * (0.7 + 0.3 * Math.min(1, opts.power ?? 0.7));
    s.connect(g).connect(place(opts));
    s.start(now() + 0.02); // the breath comes out just after the strike
  }

  // Line calls, spoken by the browser's own speech voice (no audio files).
  // A British English voice is preferred, like a line judge.
  const speech = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voice = null;
  function pickVoice() {
    if (!speech) return;
    const vs = speech.getVoices();
    voice = vs.find((v) => /en-GB/i.test(v.lang) && /male|daniel|arthur|george|ryan/i.test(v.name))
      || vs.find((v) => /en-GB/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
  }
  if (speech) {
    pickVoice();
    speech.addEventListener?.('voiceschanged', pickVoice);
  }
  function call(text) {
    if (!speech || muted || paused) return;
    try {
      speech.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = voice ? voice.lang : 'en-GB';
      u.rate = 1.05;
      u.pitch = 0.85;
      u.volume = Math.min(1, AUDIO.volume * AUDIO.levels.call);
      speech.speak(u);
    } catch { /* speech not available here */ }
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

  // Ball clipping the tape: a sharp tick on the band and a short shiver of the mesh.
  function cord(opts) {
    const at = now() + 0.005;
    const dest = place(opts);
    const k = AUDIO.levels.net;
    burst(at, { f: 1500, q: 1.4, amp: 0.55 * k, tau: 0.004, dest });
    burst(at, { type: 'lowpass', f: 600, amp: 0.4 * k, tau: 0.02, dest });
    for (let i = 0; i < 3; i++) burst(at + 0.015 + i * 0.022, { f: 1900 + rnd() * 500, q: 3, amp: 0.15 * k * (1 - i * 0.25), tau: 0.008, dest });
  }

  // A shoe squeaking on a hard court: a short, high, nearly pure "eek" that bends
  // upward, with a fast fine chatter from the rubber gripping and slipping. Nothing
  // low or slow: a low, slowly rattling tone is what makes a squeak sound rude.
  function squeak(opts, level = 1) {
    const at = now() + 0.005;
    const dest = place(opts);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1500; hp.Q.value = 0.7;
    hp.connect(dest);
    const chirps = rnd() < 0.3 ? 2 : 1;
    let t = at;
    for (let c = 0; c < chirps; c++) {
      const f = 2300 + rnd() * 1300, dur = 0.05 + rnd() * 0.09;
      const rise = rnd() < 0.75; // most squeaks rise; some fall
      const g = ctx.createGain();
      const peak = AUDIO.levels.squeak * level * (0.7 + 0.3 * rnd()) * (c ? 0.6 : 1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.006);
      g.gain.setValueAtTime(peak * 0.85, t + dur - 0.02);
      g.gain.linearRampToValueAtTime(0, t + dur);
      g.connect(hp);
      const chatter = ctx.createOscillator(); // rubber stick-slip: fast and shallow
      chatter.frequency.value = 170 + rnd() * 110;
      const depth = ctx.createGain();
      depth.gain.value = f * 0.015;
      chatter.connect(depth);
      for (const [mult, amp] of [[1, 1], [2, 0.18]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f * mult * (rise ? 0.9 : 1.08), t);
        o.frequency.linearRampToValueAtTime(f * mult * (rise ? 1.08 : 0.92), t + dur);
        depth.connect(o.frequency);
        const og = ctx.createGain();
        og.gain.value = amp;
        o.connect(og).connect(g);
        o.start(t); o.stop(t + dur + 0.02);
      }
      chatter.start(t); chatter.stop(t + dur + 0.02);
      t += dur + 0.025 + rnd() * 0.04;
    }
  }

  // A hard stop or change of direction: a squeak on hard courts, a small scuff on clay,
  // nothing on grass.
  function plant(opts) {
    if (surface === 'hard') { if (rnd() < 0.8) squeak(opts, 0.8); }
    else if (surface === 'clay') scrape(opts, 0.12, 0.35);
  }

  // A slide: a long gritty scrape on clay, a soft brush on grass, a squeal and skid on a hard court.
  function slide(opts) {
    if (surface === 'hard') { squeak(opts, 1.1); scrape(opts, 0.2, 0.5, 2600); return; }
    if (surface === 'grass') { scrape(opts, 0.3, 0.45, 900); return; }
    scrape(opts);
  }

  // Shoe sliding over the court surface: a gritty scrape that fades in and out.
  function scrape(opts, durScale = 1, level = 1, centre = 1600) {
    const at = now() + 0.005;
    const dest = place(opts);
    const p = Math.max(0.4, Math.min(1, (opts.speed ?? 5) / 6));
    const dur = (0.3 + 0.3 * p) * durScale + 0.05;
    const s = ctx.createBufferSource();
    s.buffer = gritBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(centre, at);
    bp.frequency.exponentialRampToValueAtTime(centre * 0.45, at + dur);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 220;
    const g = ctx.createGain();
    const peak = AUDIO.levels.slide * p * level;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + Math.min(0.07, dur * 0.3));
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

  const SFX = { strike, bounce, net, cord, slide, plant, effort };

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
    // name: strike | bounce | net | cord | slide | plant | effort; opts: { kind, power, speed, side, x, z }
    play(name, opts = {}) {
      if (!ctx || (ctx.state !== 'running' && !options.context) || !SFX[name]) return;
      if (name === 'strike') strike(opts.kind, opts);
      else SFX[name](opts);
    },
    // a spoken line call: 'Out!', 'Fault!', 'Let!'
    call,
    setSurface(name) { surface = name; },
    react(kind, intensity = 0.5) {
      if (!ctx || !REACT[kind]) return;
      REACT[kind](Math.max(0, Math.min(1, intensity)));
    },
    setCrowd,
    update,
    pause() { paused = true; if (speech) speech.cancel(); if (ctx && ctx.suspend) ctx.suspend(); },
    resume() { paused = false; if (ctx && ctx.resume) ctx.resume(); },
    setMuted(m) {
      muted = m;
      if (m && speech) speech.cancel();
      if (master) master.gain.setTargetAtTime(m ? 0 : AUDIO.volume, ctx.currentTime, 0.05);
    },
    get muted() { return muted; },
    get context() { return ctx; },
  };
}
