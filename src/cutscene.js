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
  el.innerHTML = `<div class="cine-bar top"></div><div class="cine-bar bottom"></div>
    <div class="cine-tag"></div>
    <div class="cine-cap"><div class="cine-title"></div><div class="cine-sub"></div></div>
    <div class="cine-skip">Space to skip</div>`;
  doc.body.appendChild(el);
  const tagEl = el.querySelector('.cine-tag'), titleEl = el.querySelector('.cine-title'), subEl = el.querySelector('.cine-sub');
  const capEl = el.querySelector('.cine-cap');

  let shots = null, i = 0, t = 0, onDone = null, hold = false;

  function showShot(s) {
    tagEl.textContent = s.tag || '';
    tagEl.classList.toggle('on', !!s.tag);
    titleEl.textContent = s.caption ? s.caption[0] : '';
    subEl.textContent = s.caption ? s.caption[1] || '' : '';
    capEl.classList.remove('on');
    // captions slide in a beat after the shot starts
    if (s.caption) setTimeout(() => capEl.classList.add('on'), 250);
  }
  function startShot() {
    t = 0;
    const s = shots[i];
    showShot(s);
    if (s.start) s.start();
  }
  function finish() {
    if (!shots) return;
    const s = shots[i];
    if (s && s.end) s.end();
    for (let k = i + 1; k < shots.length; k++) if (shots[k].skipped) shots[k].skipped();
    shots = null;
    el.classList.add('hidden');
    capEl.classList.remove('on');
    doc.body.classList.remove('cinematic');
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

  return {
    // shots: [{ dur, camera(t) -> { pos, target, fov }, caption?: [title, sub], tag?, start?(), frame?(t, dt), end?() }]
    play(list, { done = null, holdGame = true } = {}) {
      if (shots) finish();
      shots = list;
      i = 0;
      onDone = done;
      hold = holdGame;
      el.classList.remove('hidden');
      doc.body.classList.add('cinematic');
      startShot();
    },
    // advance; the camera for this frame, or null when no cutscene is playing
    update(dt) {
      stepConfetti(dt);
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
      return s.camera(t);
    },
    skip: finish,
    get active() { return !!shots; },
    get holding() { return !!shots && hold; },
    get replaying() { return !!shots && !!shots[i] && !!shots[i].replay; },
    trophy, startConfetti, stopConfetti,
  };
}
