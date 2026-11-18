// HTML overlay: scoreboard, centre message, timing label.
import { BALL, NAMES } from './config.js';
import { PALETTE, BUILDS, HAIR_STYLES, HEADWEAR, WRISTBANDS, cleanName } from './profile.js';

// The statistics table: the player's value, the stat, the opponent's value.
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderStats(el, data) {
  if (!el) return;
  if (!data) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  const rows = data.rows.map(([label, a, b]) => `<tr><td>${esc(a)}</td><th>${esc(label)}</th><td>${esc(b)}</td></tr>`).join('');
  el.innerHTML = `<table>
    <thead><tr><td>${esc(data.names[0])}</td><th>MATCH STATS</th><td>${esc(data.names[1])}</td></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="stats-foot">Longest rally ${data.longestRally} shots | Match time ${esc(data.time)}</div>`;
}

export function createHud(doc = document) {
  const rows = [...doc.querySelectorAll('.sb-row')];
  const powerEl = doc.getElementById('power'), powerFill = doc.getElementById('power-fill');
  const BALL_R = BALL.radius;
  const challengeBtn = doc.getElementById('challenge-btn'), challengeLeft = doc.getElementById('challenge-left');
  const review = doc.getElementById('review'), rvSvg = doc.getElementById('rv-svg');
  const rvVerdict = doc.getElementById('rv-verdict'), rvLine = doc.getElementById('rv-line');
  let challengeHandler = null, reviewTimer = 0;
  challengeBtn.addEventListener('click', () => { if (challengeHandler) challengeHandler(); challengeBtn.blur(); });
  const els = rows.map((row) => ({
    row,
    name: row.querySelector('.sb-nm'),
    ch: row.querySelector('.sb-ch'),
    games: row.querySelector('.sb-games'),
    points: row.querySelector('.sb-points'),
  }));
  const message = doc.getElementById('message');
  const messageMain = doc.getElementById('message-main');
  const messageSub = doc.getElementById('message-sub');
  const timing = doc.getElementById('timing');
  const menu = doc.getElementById('menu');
  const playButton = doc.getElementById('play');
  const levelButtons = [...doc.querySelectorAll('#menu-levels button')];
  let level = 'normal';
  let playHandler = null;
  doc.getElementById('menu-tour').textContent = NAMES.tour;
  for (const b of levelButtons) {
    b.addEventListener('click', () => {
      level = b.dataset.level;
      for (const o of levelButtons) o.classList.toggle('on', o === b);
    });
  }
  // court surface: picking one previews it behind the menu
  const surfaceButtons = [...doc.querySelectorAll('#menu-surfaces button')];
  let surface = 'clay';
  let surfaceHandler = null;
  const pickSurface = (name) => {
    surface = name;
    for (const o of surfaceButtons) o.classList.toggle('on', o.dataset.surface === name);
    if (surfaceHandler) surfaceHandler(name);
  };
  for (const b of surfaceButtons) b.addEventListener('click', () => pickSurface(b.dataset.surface));
  playButton.addEventListener('click', () => { if (playHandler) playHandler(level, surface); });
  const pauseEl = doc.getElementById('pause');
  const pauseButton = doc.getElementById('pause-btn');
  const resumeButton = doc.getElementById('resume');
  let pauseHandler = null, resumeHandler = null, quitHandler = null;
  pauseButton.addEventListener('click', () => { if (pauseHandler) pauseHandler(); });
  resumeButton.addEventListener('click', () => { if (resumeHandler) resumeHandler(); });
  doc.getElementById('quit').addEventListener('click', () => { if (quitHandler) quitHandler(); });
  const soundButton = doc.getElementById('sound');
  let soundHandler = null;
  soundButton.addEventListener('click', () => { if (soundHandler) soundHandler(); });
  // ---- player customisation panel
  const custom = doc.getElementById('custom');
  const nameInput = doc.getElementById('custom-name');
  const rowsEl = doc.getElementById('custom-rows');
  let profile = null, customHandler = null, customOpenHandler = null, randomHandler = null;
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');
  const ROWS = [
    ['build', 'Body', BUILDS],
    ['shirt', 'Shirt', PALETTE.shirt], ['shorts', 'Shorts', PALETTE.shorts], ['shoes', 'Shoes', PALETTE.shoes],
    ['headwear', 'Headwear', HEADWEAR], ['wristbands', 'Wrists', WRISTBANDS], ['skin', 'Skin tone', PALETTE.skin], ['hair', 'Hair colour', PALETTE.hair],
    ['hairStyle', 'Hair', HAIR_STYLES],
  ];
  const rowButtons = {};
  for (const [key, label, opts] of ROWS) {
    const row = doc.createElement('div');
    row.className = 'custom-row';
    row.innerHTML = `<span>${label}</span><div class="custom-opts" role="group" aria-label="${label}"></div>`;
    const box = row.querySelector('.custom-opts');
    rowButtons[key] = opts.map((opt, i) => {
      const b = doc.createElement('button');
      b.type = 'button';
      if (typeof opt === 'number') {
        b.className = 'swatch';
        b.style.background = hex(opt);
        b.setAttribute('aria-label', `${label} ${i + 1}`);
        b.dataset.value = String(opt);
      } else {
        b.className = 'pill';
        b.textContent = opt[1];
        b.dataset.value = opt[0];
      }
      b.addEventListener('click', () => {
        profile[key] = typeof opt === 'number' ? opt : opt[0];
        syncCustom();
        if (customHandler) customHandler({ ...profile });
      });
      box.appendChild(b);
      return b;
    });
    rowsEl.appendChild(row);
  }
  function syncCustom() {
    nameInput.value = profile.name;
    for (const [key, buttons] of Object.entries(rowButtons)) {
      for (const b of buttons) {
        const on = b.dataset.value === String(profile[key]);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
    }
  }
  nameInput.addEventListener('input', () => {
    profile.name = cleanName(nameInput.value);
    if (customHandler) customHandler({ ...profile });
  });
  nameInput.addEventListener('blur', () => { nameInput.value = profile.name; });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });
  const closeCustom = () => {
    custom.classList.add('hidden');
    doc.body.classList.remove('customising');
    if (customOpenHandler) customOpenHandler(false);
    doc.getElementById('customise').focus({ preventScroll: true });
  };
  doc.getElementById('customise').addEventListener('click', () => {
    syncCustom();
    custom.classList.remove('hidden');
    doc.body.classList.add('customising');
    if (customOpenHandler) customOpenHandler(true);
  });
  doc.getElementById('custom-done').addEventListener('click', closeCustom);
  doc.getElementById('custom-random').addEventListener('click', () => { if (randomHandler) randomHandler(); });
  custom.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCustom(); } });

  let messageTimer = 0;
  let timingTimer = 0;

  doc.getElementById('sb-tour').textContent = `${NAMES.tour} | ${NAMES.round}`;
  doc.body.classList.add('in-menu');
  doc.getElementById('menu-result').style.display = 'none';

  return {
    onPlay(handler) { playHandler = handler; },
    // customisation: handler(profile) on every change; open(bool) when the panel opens or closes
    onCustomChange(handler) { customHandler = handler; },
    onCustomOpen(handler) { customOpenHandler = handler; },
    onRandomise(handler) { randomHandler = handler; },
    setProfile(p) { profile = { ...p }; syncCustom(); },
    setNames(player, cpu) {
      els[0].name.textContent = player;
      els[1].name.textContent = cpu;
    },
    onSurface(handler) { surfaceHandler = handler; },
    setSurface(name) { if (surfaceButtons.some((b) => b.dataset.surface === name)) pickSurface(name); },
    onPause(handler) { pauseHandler = handler; },
    onResume(handler) { resumeHandler = handler; },
    onQuit(handler) { quitHandler = handler; },
    onSound(handler) { soundHandler = handler; },
    setSound(on) { soundButton.textContent = on ? 'Sound: on' : 'Sound: off'; soundButton.setAttribute('aria-pressed', String(on)); },
    // data: { names: [a, b], rows: [[label, a, b]], longestRally, time }
    showPause(scoreLine, data = null) {
      doc.getElementById('pause-score').textContent = scoreLine;
      renderStats(doc.getElementById('pause-stats'), data);
      pauseEl.classList.remove('hidden');
      doc.body.classList.add('paused');
      pauseButton.blur();
      resumeButton.focus({ preventScroll: true });
    },
    hidePause() {
      pauseEl.classList.add('hidden');
      doc.body.classList.remove('paused');
      if (doc.activeElement && doc.activeElement.blur) doc.activeElement.blur();
    },
    // result: { headline, detail, button } shown above the Play button after a match
    showMenu(result = null) {
      doc.getElementById('menu-headline').textContent = result ? result.headline : '';
      doc.getElementById('menu-detail').textContent = result ? result.detail : '';
      doc.getElementById('menu-result').style.display = result ? 'block' : 'none';
      renderStats(doc.getElementById('menu-stats'), result && result.stats);
      menu.classList.toggle('has-result', !!(result && result.stats)); // the stats take the controls' place
      playButton.textContent = result && result.button ? result.button : 'Play';
      menu.classList.remove('hidden');
      doc.body.classList.add('in-menu');
    },
    hideMenu() {
      menu.classList.add('hidden');
      doc.body.classList.remove('in-menu');
      playButton.blur();
    },
    // score: { games: [a, b], points: ['15', '30'], server: 0 | 1 }
    setScore(score) {
      for (let i = 0; i < 2; i++) {
        els[i].games.textContent = score.games[i];
        els[i].points.textContent = score.points[i];
        els[i].row.classList.toggle('serving', score.server === i);
      }
    },
    // the power meter: level 0..1 while charging, null to fade it out
    setPower(level) {
      if (level === null) { powerEl.classList.add('hidden'); return; }
      powerEl.classList.remove('hidden');
      powerFill.style.width = `${Math.round(level * 100)}%`;
      powerEl.classList.toggle('max', level >= 0.99);
      powerEl.classList.toggle('high', level >= 0.75);
    },
    // stamina bars under the names, 0..1
    setStamina(a, b) {
      [a, b].forEach((v, i) => {
        els[i].row.style.setProperty('--st', v.toFixed(3));
        els[i].row.classList.toggle('tired', v < 0.6);
        els[i].row.classList.toggle('spent', v < 0.25);
      });
    },
    // challenges left, one pip each
    setChallenges(left) {
      for (let i = 0; i < 2; i++) els[i].ch.textContent = '\u25cf'.repeat(Math.max(0, left[i]));
    },
    // the challenge button: shown while the player can challenge the last call
    setChallengeAvailable(on, left) {
      challengeBtn.classList.toggle('hidden', !on);
      challengeLeft.textContent = on ? `${left} left` : '';
    },
    onChallenge(handler) { challengeHandler = handler; },
    // The review: the line and, after a moment, the ball's mark against it, drawn to
    // scale (1 px = 2 mm). margin: metres inside (positive) or outside the line.
    showReview({ margin, line, surfaceColor = '#2f5d93' }) {
      const S = 500, R = BALL_R * S, edge = 190; // the line's outer edge
      const cx = Math.max(20, Math.min(285, edge + (BALL_R - margin) * S));
      const names = { side: 'SIDELINE', base: 'BASELINE', service: 'SERVICE LINE', centre: 'CENTRE LINE' };
      rvLine.textContent = `| ${names[line] || 'LINE'}`;
      rvSvg.innerHTML = `
        <rect x="0" y="0" width="300" height="170" fill="${surfaceColor}"/>
        <rect x="${edge}" y="0" width="110" height="170" fill="#1d3b24" opacity="0.55"/>
        <rect x="${edge - 25}" y="0" width="25" height="170" fill="#f4f4ef"/>
        <text x="${edge - 34}" y="160" text-anchor="end" class="rv-lbl">IN</text>
        <text x="${edge + 10}" y="160" class="rv-lbl">OUT</text>
        <ellipse id="rv-ball" cx="${cx}" cy="80" rx="${R}" ry="${R * 1.6}" fill="#d8f23a" fill-opacity="0.85" stroke="#10140a" stroke-width="1.5"/>`;
      rvVerdict.textContent = '';
      rvVerdict.className = '';
      review.classList.remove('hidden', 'landed');
      clearTimeout(reviewTimer);
      reviewTimer = setTimeout(() => review.classList.add('landed'), 1100);
    },
    reviewVerdict(inside, margin) {
      review.classList.add('landed');
      rvVerdict.textContent = inside ? 'IN' : `OUT ${Math.max(1, Math.round(-margin * 1000))} MM`;
      rvVerdict.className = inside ? 'in' : 'out';
      clearTimeout(reviewTimer);
      reviewTimer = setTimeout(() => review.classList.add('hidden'), 2800);
    },
    hideReview() { clearTimeout(reviewTimer); review.classList.add('hidden'); },
    showMessage(main, sub = '', seconds = 1.6) {
      messageMain.textContent = main;
      messageSub.textContent = sub;
      message.classList.add('show');
      clearTimeout(messageTimer);
      if (seconds > 0) messageTimer = setTimeout(() => message.classList.remove('show'), seconds * 1000);
    },
    hideMessage() {
      clearTimeout(messageTimer);
      message.classList.remove('show');
    },
    // a short call in the timing spot, such as NET CORD
    showCall(text) {
      timing.textContent = text;
      timing.className = 'show call';
      clearTimeout(timingTimer);
      timingTimer = setTimeout(() => timing.classList.remove('show'), 1100);
    },
    // kind: 'perfect' | 'early' | 'late'
    showTiming(kind, prefix = '') {
      timing.textContent = (prefix ? prefix + ' ' : '') + kind.toUpperCase();
      timing.className = `show ${kind}`;
      clearTimeout(timingTimer);
      timingTimer = setTimeout(() => timing.classList.remove('show'), 700);
    },
  };
}
