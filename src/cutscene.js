// Cutscenes: short cinematic moments with their own camera, letterbox bars and
// captions. A cutscene is a list of shots; each shot has a duration, a camera
// (a function of time giving a position, a target and a field of view), an optional
// caption or tag, and hooks to start, run and end it. While one plays the game is
// held; Space, Enter, Escape or a click skips it.
import * as THREE from 'three';

export function createCutscenes(doc, scene) {
  // ---------------------------------------------------------------- overlay
  const el = doc.createElement('div');
  el.id = 'cine';
  el.className = 'hidden';
  el.innerHTML = `<div class="cine-vignette"></div><div class="cine-flash"></div>
    <div class="cine-bar top"></div><div class="cine-bar bottom"></div>
    <div class="cine-tag"></div>
    <div class="cine-cap"><div class="cine-kicker"></div><div class="cine-title"></div><div class="cine-sub"></div></div>
    <div class="cine-card"></div>
    <div class="cine-skip">Space to skip</div>`;
  doc.body.appendChild(el);
  const tagEl = el.querySelector('.cine-tag'), titleEl = el.querySelector('.cine-title'), subEl = el.querySelector('.cine-sub');
  const capEl = el.querySelector('.cine-cap'), kickerEl = el.querySelector('.cine-kicker');
  const flashEl = el.querySelector('.cine-flash'), cardEl = el.querySelector('.cine-card');
  let clock = 0; // for the handheld drift

  let shots = null, i = 0, t = 0, onDone = null, hold = false;

  let capTimer = 0;
  function showShot(s, first) {
    tagEl.textContent = s.tag || '';
    tagEl.classList.toggle('on', !!s.tag);
    const sameCap = s.caption && titleEl.textContent === s.caption[0] && capEl.classList.contains('on');
    if (!sameCap) {
      capEl.classList.remove('on');
      clearTimeout(capTimer);
      kickerEl.textContent = s.caption ? s.caption[2] || '' : '';
      titleEl.textContent = s.caption ? s.caption[0] : '';
      subEl.textContent = s.caption ? s.caption[1] || '' : '';
      // captions slide in a beat after the shot starts
      if (s.caption) capTimer = setTimeout(() => capEl.classList.add('on'), first ? 450 : 250);
    }
    cardEl.innerHTML = s.card || '';
    cardEl.classList.toggle('on', !!s.card);
    // a cut between shots: a quick white flash, unless the shot asks for a plain cut
    if (!first && s.transition !== 'cut') {
      flashEl.classList.remove('go');
      void flashEl.offsetWidth;
      flashEl.classList.add('go');
    }
  }
  function startShot(first = false) {
    t = 0;
    const s = shots[i];
    showShot(s, first);
    if (s.start) s.start();
  }
  function finish() {
    if (!shots) return;
    const s = shots[i];
    if (s && s.end) s.end();
    for (let k = i + 1; k < shots.length; k++) if (shots[k].skipped) shots[k].skipped();
    shots = null;
    capEl.classList.remove('on');
    cardEl.classList.remove('on');
    // the bars slide away, then the broadcast picture returns
    el.classList.add('out');
    doc.body.classList.remove('cinematic');
    setTimeout(() => { if (!shots) { el.classList.add('hidden'); el.classList.remove('out'); } }, 380);
    const done = onDone;
    onDone = null;
    if (done) done();
  }

  // skip: keys and clicks, ahead of the game's own controls
  doc.addEventListener('keydown', (e) => {
    if (!shots || !['Space', 'Enter', 'Escape'].includes(e.code)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    finish();
  }, true);
  el.addEventListener('click', () => finish());

  // ---------------------------------------------------------------- trophy and confetti
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9b44a, metalness: 1, roughness: 0.22 });
  const trophy = new THREE.Group();
  {
    const cup = new THREE.LatheGeometry([[0.02, 0], [0.07, 0.01], [0.075, 0.03], [0.025, 0.06], [0.02, 0.14], [0.05, 0.17], [0.13, 0.22], [0.15, 0.32], [0.14, 0.36], [0.13, 0.36]]
      .map(([r, y]) => new THREE.Vector2(r, y)), 28);
    const body = new THREE.Mesh(cup, gold);
    body.castShadow = true;
    trophy.add(body);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 20, Math.PI * 1.2), gold);
      h.position.set(s * 0.15, 0.28, 0);
      h.rotation.set(0, 0, s > 0 ? -Math.PI * 0.55 : Math.PI * 1.55);
      trophy.add(h);
    }
    trophy.visible = false;
    scene.add(trophy);
  }

  const N = 420;
  const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.06, 0.09),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), N);
  const parts = [];
  const COLORS = [0xd8f23a, 0xffffff, 0xe8792f, 0x2f7de1, 0xe0464b, 0xf2c14e, 0x2f9e58];
  const col = new THREE.Color(), o = new THREE.Object3D();
  for (let k = 0; k < N; k++) {
    parts.push({ x: 0, y: 0, z: 0, vy: 0, ph: Math.random() * 6, sp: 2 + Math.random() * 4, rx: Math.random() * 6, ry: Math.random() * 6 });
    confetti.setColorAt(k, col.setHex(COLORS[k % COLORS.length]));
  }
  confetti.visible = false;
  confetti.frustumCulled = false;
  scene.add(confetti);
  let confettiOn = false;
  function startConfetti(cx, cz) {
    confettiOn = true;
    confetti.visible = true;
    for (const p of parts) {
      p.x = cx + (Math.random() - 0.5) * 9;
      p.z = cz + (Math.random() - 0.5) * 9;
      p.y = 4 + Math.random() * 6;
      p.vy = -(0.7 + Math.random() * 0.9);
    }
  }
  function stepConfetti(dt) {
    if (!confettiOn) return;
    parts.forEach((p, k) => {
      p.ph += dt * p.sp;
      p.y = Math.max(0.01, p.y + p.vy * dt);
      p.x += Math.sin(p.ph) * 0.4 * dt;
      p.z += Math.cos(p.ph * 0.7) * 0.3 * dt;
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(p.rx + p.ph, p.ry + p.ph * 0.6, 0);
      o.updateMatrix();
      confetti.setMatrixAt(k, o.matrix);
    });
    confetti.instanceMatrix.needsUpdate = true;
  }
  function stopConfetti() { confettiOn = false; confetti.visible = false; }

  // photographers in the stands: little bursts of white light
  const flashTex = (() => {
    const c = doc.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.6)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const flashes = [];
  for (let k = 0; k < 36; k++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    sp.scale.setScalar(0.9);
    sp.visible = false;
    scene.add(sp);
    flashes.push({ sp, t: Math.random() * 2, life: 0 });
  }
  let flashBox = null;
  function stepFlashes(dt) {
    if (!flashBox) return;
    for (const f of flashes) {
      f.t -= dt;
      if (f.t <= 0) {
        // a new photo somewhere in the stands
        const b = flashBox[Math.floor(Math.random() * flashBox.length)];
        f.sp.position.set(b[0] + Math.random() * (b[1] - b[0]), b[2] + Math.random() * (b[3] - b[2]), b[4] + Math.random() * (b[5] - b[4]));
        f.life = 0.12;
        f.t = 0.3 + Math.random() * 1.8;
        f.sp.visible = true;
      }
      if (f.life > 0) { f.life -= dt; f.sp.material.opacity = Math.max(0, f.life / 0.12); } else f.sp.visible = false;
    }
  }

  return {
    // shots: [{ dur, camera(t) -> { pos, target, fov }, caption?: [title, sub], tag?, start?(), frame?(t, dt), end?() }]
    play(list, { done = null, holdGame = true } = {}) {
      if (shots) finish();
      shots = list;
      i = 0;
      onDone = done;
      hold = holdGame;
      el.classList.remove('hidden', 'out');
      doc.body.classList.add('cinematic');
      startShot(true);
    },
    // advance; the camera for this frame, or null when no cutscene is playing
    update(dt) {
      stepConfetti(dt);
      stepFlashes(dt);
      if (!shots) return null;
      t += dt;
      let s = shots[i];
      if (t >= s.dur) {
        if (s.end) s.end();
        i++;
        if (i >= shots.length) { shots.splice(0); i = 0; finish(); return null; }
        startShot();
        s = shots[i];
      }
      if (s.frame) s.frame(t, dt);
      const cam = s.camera(t, Math.min(1, t / s.dur));
      // a cameraman's hands: a slow drift, more on the close shots
      clock += dt;
      const h = (s.handheld ?? 1) * 0.035;
      if (h) {
        cam.target = [cam.target[0] + Math.sin(clock * 0.9) * h, cam.target[1] + Math.sin(clock * 1.3 + 1) * h * 0.6, cam.target[2] + Math.cos(clock * 0.7) * h];
      }
      return cam;
    },
    skip: finish,
    get active() { return !!shots; },
    get holding() { return !!shots && hold; },
    get replaying() { return !!shots && !!shots[i] && !!shots[i].replay; },
    trophy, startConfetti, stopConfetti,
    // boxes [x0, x1, y0, y1, z0, z1] where the photographers sit, or null to stop
    setFlashes(boxes) { flashBox = boxes; if (!boxes) for (const f of flashes) f.sp.visible = false; },
  };
}
