// HTML overlay: scoreboard, centre message, timing label.
import { NAMES } from './config.js';

export function createHud(doc = document) {
  const rows = [...doc.querySelectorAll('.sb-row')];
  const els = rows.map((row) => ({
    row,
    name: row.querySelector('.sb-name'),
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
  playButton.addEventListener('click', () => { if (playHandler) playHandler(level); });
  let messageTimer = 0;
  let timingTimer = 0;

  doc.getElementById('sb-tour').textContent = `${NAMES.tour} | ${NAMES.round}`;
  els[0].name.textContent = NAMES.player;
  els[1].name.textContent = NAMES.cpu;
  doc.body.classList.add('in-menu');
  doc.getElementById('menu-result').style.display = 'none';

  return {
    onPlay(handler) { playHandler = handler; },
    // result: { headline, detail, button } shown above the Play button after a match
    showMenu(result = null) {
      doc.getElementById('menu-headline').textContent = result ? result.headline : '';
      doc.getElementById('menu-detail').textContent = result ? result.detail : '';
      doc.getElementById('menu-result').style.display = result ? 'block' : 'none';
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
    // kind: 'perfect' | 'early' | 'late'
    showTiming(kind, prefix = '') {
      timing.textContent = (prefix ? prefix + ' ' : '') + kind.toUpperCase();
      timing.className = `show ${kind}`;
      clearTimeout(timingTimer);
      timingTimer = setTimeout(() => timing.classList.remove('show'), 700);
    },
  };
}
