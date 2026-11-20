// The career hub: the week's events, your draw, the rankings, your player page and
// the story cards. Talks to the game through two callbacks: onPlayMatch(match) to
// play a match on court, onClose() to go back to the start screen.
import {
  createCareer, thisWeek, entryFor, enterEvent, nextMatch, recordMatch, restWeek, rankings, rankOf, summary,
  canTurnProEarly, turnPro, canRetire, retire, legacy, TIERS, WEEKS, weekEvents, roundName, playerById,
} from './career.js';
import { storyIntro, storyAfter, choose, dismiss, speakerName, CAST } from './story.js';

const KEY = 'courtRush.career';
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const SURFACE = { clay: 'Clay', grass: 'Grass', hard: 'Hard' };
const VENUE = { club: 'Club court', stadium: 'Stadium' };
const ord = (n) => (n ? `#${n}` : 'Unranked');

export function createCareerUI(doc, { onPlayMatch, onClose, getProfile }) {
  let c = load();
  let tab = 'week', rankTab = null, open = false;

  // ---------------------------------------------------------------- storage
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      return s && s.version === 1 && s.you ? s : null;
    } catch { return null; }
  }
  function save() {
    try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  }

  // ---------------------------------------------------------------- DOM
  const root = doc.createElement('div');
  root.id = 'career';
  root.className = 'hidden';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Career');
  root.innerHTML = `<div class="cr-card">
    <div class="cr-head"><div class="cr-id"></div><button type="button" class="cr-close">Menu</button></div>
    <div class="cr-tabs" role="tablist"></div>
    <div class="cr-body"></div>
  </div>
  <div class="cr-story hidden" aria-live="polite"><div class="cr-story-card">
    <div class="cr-speaker"></div><div class="cr-text"></div><div class="cr-choices"></div>
  </div></div>
  <input type="file" accept=".json,application/json" class="cr-file" hidden>`;
  doc.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const head = $('.cr-id'), tabsEl = $('.cr-tabs'), body = $('.cr-body');
  const storyEl = $('.cr-story'), speakerEl = $('.cr-speaker'), textEl = $('.cr-text'), choicesEl = $('.cr-choices');
  const fileInput = $('.cr-file');
  $('.cr-close').addEventListener('click', () => close());
  doc.addEventListener('keydown', (e) => {
    if (!open) return;
    if (!storyEl.classList.contains('hidden') && (e.key === 'Enter' || e.key === ' ')) {
      const only = choicesEl.querySelectorAll('button');
      if (only.length === 1) { e.preventDefault(); only[0].click(); }
      return;
    }
    if (e.key === 'Escape' && storyEl.classList.contains('hidden')) { e.stopImmediatePropagation(); close(); }
  }, true);

  // ---------------------------------------------------------------- story cards
  function showStory() {
    const card = c && c.story.queue[0];
    storyEl.classList.toggle('hidden', !card);
    if (!card) { render(); return; }
    const cast = CAST[card.speaker];
    speakerEl.textContent = speakerName(c, card);
    speakerEl.style.setProperty('--who', cast.color);
    storyEl.dataset.speaker = card.speaker;
    textEl.textContent = card.text;
    choicesEl.innerHTML = '';
    const buttons = card.choices ? card.choices.map((ch, i) => [ch.label, () => { choose(c, i); save(); showStory(); }])
      : [['Continue', () => { dismiss(c); save(); showStory(); }]];
    for (const [label, fn] of buttons) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', fn);
      choicesEl.appendChild(b);
    }
    choicesEl.querySelector('button').focus();
  }

  // ---------------------------------------------------------------- rendering
  function render() {
    if (!c) { renderNew(); return; }
    const s = summary(c);
    const stage = s.retired ? 'RETIRED' : s.stage === 'junior' ? 'JUNIOR' : 'PRO';
    head.innerHTML = `<div class="cr-name">${esc(s.name)} <span class="cr-badge cr-${s.retired ? 'ret' : s.stage}">${stage}</span></div>
      <div class="cr-meta">Age ${s.age} · Season ${s.season}, week ${Math.min(s.week, WEEKS)} of ${WEEKS} · ${s.stage === 'junior' ? 'Junior' : 'World'} ranking <b>${ord(s.rank)}</b> (${s.points} pts) · ${s.record.w}-${s.record.l} · ${s.titles} title${s.titles === 1 ? '' : 's'}</div>`;
    const tabs = [['week', c.you.retired ? 'Legacy' : 'This week'], ['rankings', 'Rankings'], ['player', 'Your career'], ['log', 'News']];
    tabsEl.innerHTML = tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === tab}" data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('');
    tabsEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
    tabsEl.classList.remove('hidden');
    body.innerHTML = '';
    ({ week: renderWeek, rankings: renderRankings, player: renderPlayer, log: renderLog })[tab]();
  }

  function renderNew() {
    const p = getProfile();
    head.innerHTML = '<div class="cr-name">A NEW CAREER</div>';
    tabsEl.classList.add('hidden');
    body.innerHTML = `<div class="cr-new">
      <p>You start at fourteen, at the Halvik Academy, on the junior circuit. Win your way up the junior rankings, choose your road at eighteen, then climb the pro tour from the Circuit to the four Crowns. Your coach and your rival will be with you all the way.</p>
      <p class="cr-dim">Playing as <b>${esc(p.name)}</b>. Change your name and look with Customise player on the start screen.</p>
      <div class="cr-opt"><span>Opponents</span><div class="cr-seg" data-k="difficulty"><button data-v="easy">Easy</button><button data-v="normal" class="on">Normal</button><button data-v="hard">Hard</button></div></div>
      <div class="cr-opt"><span>Match length</span><div class="cr-seg" data-k="gamesToWin"><button data-v="3" class="on">Short: first to 3</button><button data-v="6">Standard: first to 6</button></div></div>
      <button type="button" class="cr-primary cr-start">Start career</button>
      <button type="button" class="cr-link cr-import">Import a saved career</button>
    </div>`;
    const opts = { difficulty: 'normal', gamesToWin: 3 };
    body.querySelectorAll('.cr-seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((o) => o.classList.toggle('on', o === b));
      opts[seg.dataset.k] = seg.dataset.k === 'gamesToWin' ? +b.dataset.v : b.dataset.v;
    })));
    body.querySelector('.cr-start').addEventListener('click', () => {
      c = createCareer({ name: p.name, build: p.build, difficulty: opts.difficulty, gamesToWin: opts.gamesToWin, seed: Date.now() });
      storyIntro(c);
      save();
      tab = 'week';
      render();
      showStory();
    });
    body.querySelector('.cr-import').addEventListener('click', () => fileInput.click());
  }

  function eventLine(e) {
    const T = TIERS[e.tier];
    return `<span class="cr-tier cr-t-${T.rank}">${T.short}</span> <b>${esc(e.name)}</b>
      <span class="cr-dim">${SURFACE[e.surface]} · ${VENUE[e.venue]} · ${e.draw}-player draw · winner ${T.points[0]} pts</span>`;
  }

  function renderWeek() {
    if (c.you.retired) { renderLegacy(); return; }
    if (c.pending === 'college-or-pro') { renderDecision(); return; }
    if (c.current) { renderDraw(); return; }
    const events = thisWeek(c);
    const wrap = doc.createElement('div');
    wrap.innerHTML = `<h3>Week ${c.week + 1}: choose an event</h3>`;
    for (const e of events) {
      const entry = entryFor(c, e);
      const row = doc.createElement('div');
      row.className = 'cr-event';
      row.innerHTML = `<div>${eventLine(e)}</div>`;
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = entry.ok ? 'cr-primary' : '';
      b.disabled = !entry.ok;
      b.textContent = entry.ok ? (entry.wildcard ? 'Enter with wildcard' : 'Enter') : entry.reason;
      b.addEventListener('click', () => { if (enterEvent(c, e.id)) { storyAfter(c); save(); render(); showStory(); } });
      row.appendChild(b);
      wrap.appendChild(row);
    }
    const rest = doc.createElement('div');
    rest.className = 'cr-actions';
    rest.innerHTML = '<button type="button" class="cr-rest">Rest this week</button>';
    rest.querySelector('.cr-rest').addEventListener('click', () => { restWeek(c); storyAfter(c); save(); render(); showStory(); });
    if (canTurnProEarly(c)) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = 'Turn pro early';
      b.addEventListener('click', () => {
        if (!confirmIn(b, 'Leave the juniors now? Your coach thinks it is too soon.')) return;
        turnPro(c); storyAfter(c); save(); tab = 'week'; render(); showStory();
      });
      rest.appendChild(b);
    }
    wrap.appendChild(rest);
    wrap.appendChild(calendar());
    body.appendChild(wrap);
  }

  // a two-step confirm on the same button
  function confirmIn(button, text) {
    if (button.dataset.armed) return true;
    button.dataset.armed = '1';
    button.textContent = `${text} Click again to confirm.`;
    return false;
  }

  function calendar() {
    const el = doc.createElement('div');
    el.className = 'cr-cal';
    const stage = c.you.stage;
    let html = `<h3>Season ${c.season} calendar</h3><div class="cr-weeks">`;
    for (let w = 0; w < WEEKS; w++) {
      const evs = weekEvents(stage, c.season, w);
      const top = evs.reduce((a, b) => (TIERS[b.tier].rank > TIERS[a.tier].rank ? b : a));
      html += `<div class="cr-wk${w === c.week ? ' now' : w < c.week ? ' past' : ''}" title="${esc(evs.map((e) => e.name).join(', '))}">
        <span>W${w + 1}</span><i class="cr-t-${TIERS[top.tier].rank}">${TIERS[top.tier].short}</i><small>${SURFACE[top.surface]}</small></div>`;
    }
    el.innerHTML = `${html}</div>`;
    return el;
  }

  function renderDraw() {
    const d = c.current.draw;
    const m = nextMatch(c);
    const name = (id) => { const p = playerById(c, id); return p ? p.name : '?'; };
    const wrap = doc.createElement('div');
    let html = `<div class="cr-evhead">${eventLine(d.event)}</div>`;
    if (m) {
      const o = m.opponent;
      html += `<div class="cr-next"><div class="cr-round">${esc(m.round)}</div>
        <div class="cr-vs"><b>${esc(c.you.name)}</b> ${m.seed ? `[${m.seed}]` : ''} <span>v</span> <b class="${o.rival ? 'cr-rival' : ''}">${esc(o.name)}</b></div>
        <div class="cr-dim">${o.rival ? 'Your rival · ' : ''}${ord(o.rank)} · age ${o.age} · ${esc(o.style)}</div>
        <div class="cr-actions"><button type="button" class="cr-primary cr-play">Play match</button><button type="button" class="cr-sim">Simulate match</button></div></div>`;
    }
    // your path, and the round so far
    html += '<div class="cr-path">';
    d.rounds.forEach((round, ri) => {
      const mine = round.find((x) => x.a === 0 || x.b === 0);
      const title = ({ 1: 'FINAL', 2: 'SEMI-FINAL', 4: 'QUARTER-FINAL', 8: 'LAST 16', 16: 'LAST 32' })[round.length];
      if (mine) {
        const opp = mine.a === 0 ? mine.b : mine.a;
        const res = mine.winner === null ? 'next' : mine.winner === 0 ? `won ${mine.score}` : `lost ${mine.score}`;
        html += `<div class="cr-pr"><span>${title}</span> v ${esc(name(opp))} <em class="${mine.winner === 0 ? 'w' : mine.winner === null ? '' : 'l'}">${res}</em></div>`;
      }
      if (ri === d.round && round.some((x) => x !== mine && x.winner !== null)) {
        html += `<div class="cr-others">${round.filter((x) => x !== mine && x.winner !== null).slice(0, 8).map((x) => `${esc(name(x.winner))} d. ${esc(name(x.winner === x.a ? x.b : x.a))} ${x.score}`).join('<br>')}</div>`;
      }
    });
    html += '</div>';
    wrap.innerHTML = html;
    body.appendChild(wrap);
    const play = wrap.querySelector('.cr-play');
    if (play) {
      play.addEventListener('click', () => { const mm = nextMatch(c); if (mm) { close(true); onPlayMatch(mm); } });
      wrap.querySelector('.cr-sim').addEventListener('click', () => {
        const r = recordMatch(c, null);
        storyAfter(c);
        c.story.queue.unshift({ speaker: 'news', text: r.champion ? `Simulated: you won the ${r.event.name} final, ${r.score}. Champion!` : `Simulated: you ${r.won ? 'won' : 'lost'} the ${r.round.toLowerCase()} against ${r.opponent}, ${r.score}.` });
        save(); render(); showStory();
      });
    }
  }

  function renderDecision() {
    const jr = rankOf(c, 0, 'junior');
    body.innerHTML = `<div class="cr-decision"><h3>Eighteen: choose your road</h3>
      <p>You finish the juniors ranked <b>${ord(jr)}</b>.</p>
      <div class="cr-roads">
        <div class="cr-road"><h4>Turn pro</h4><p>Start on the Circuit and climb the world rankings.${jr && jr <= 25 ? ' Your junior record earns you wildcards into bigger events.' : ''}</p><button type="button" class="cr-primary cr-pro">Turn pro</button></div>
        <div class="cr-road cr-soon"><h4>College</h4><p>A scholarship, team tennis and time to grow before the tour. College tennis is the next part of career mode being built.</p><button type="button" disabled>Coming soon</button></div>
      </div></div>`;
    body.querySelector('.cr-pro').addEventListener('click', () => { turnPro(c); storyAfter(c); save(); render(); showStory(); });
  }

  function renderLegacy() {
    const L = legacy(c);
    body.innerHTML = `<div class="cr-decision"><h3>A career complete</h3>
      <div class="cr-stats">
        <div><b>${L.titles}</b><span>Titles</span></div><div><b>${L.crowns}</b><span>Crowns</span></div>
        <div><b>${ord(L.bestPro)}</b><span>Best world ranking</span></div><div><b>${ord(L.bestJunior)}</b><span>Best junior ranking</span></div>
        <div><b>${L.record.w}-${L.record.l}</b><span>Match record</span></div><div><b>${L.seasons}</b><span>Seasons</span></div>
      </div>
      <button type="button" class="cr-primary cr-again">Start a new career</button></div>`;
    body.querySelector('.cr-again').addEventListener('click', (e) => {
      if (!confirmIn(e.currentTarget, 'This replaces the finished career.')) return;
      c = null; save(); render();
    });
  }

  function renderRankings() {
    const stage = rankTab || c.you.stage;
    const list = rankings(c, stage);
    const me = list.find((x) => x.you);
    const show = list.filter((x) => x.rank <= 20 || x.rival || (me && Math.abs(x.rank - me.rank) <= 4));
    let html = `<div class="cr-seg cr-rt"><button data-s="junior" class="${stage === 'junior' ? 'on' : ''}">Junior</button><button data-s="pro" class="${stage === 'pro' ? 'on' : ''}">World</button></div>
      <table class="cr-table"><thead><tr><th>#</th><th>Player</th><th>Age</th><th>Points</th></tr></thead><tbody>`;
    let lastRank = 0;
    for (const x of show) {
      if (x.rank > lastRank + 1) html += '<tr class="gap"><td colspan="4">···</td></tr>';
      lastRank = x.rank;
      html += `<tr class="${x.you ? 'you' : ''}${x.rival ? ' rival' : ''}"><td>${x.pts ? x.rank : '-'}</td><td>${esc(x.name)}${x.rival ? ' <small>rival</small>' : ''}</td><td>${x.age}</td><td>${x.pts}</td></tr>`;
    }
    body.innerHTML = `${html}</tbody></table><p class="cr-dim">Rankings count points from the last ${WEEKS} weeks.</p>`;
    body.querySelectorAll('.cr-rt button').forEach((b) => b.addEventListener('click', () => { rankTab = b.dataset.s; render(); }));
  }

  function renderPlayer() {
    const y = c.you;
    const rival = playerById(c, c.story.rival);
    const titles = y.titles.length ? y.titles.slice().reverse().map((t) => `<li><span class="cr-tier cr-t-${TIERS[t.tier].rank}">${TIERS[t.tier].short}</span> ${esc(t.name)} <span class="cr-dim">age ${t.age}</span></li>`).join('') : '<li class="cr-dim">No titles yet.</li>';
    const hist = y.history.length ? y.history.slice().reverse().map((h) => `<tr><td>${h.season}</td><td>${h.age}</td><td>${h.stage === 'junior' ? 'Junior' : 'Pro'}</td><td>${ord(h.rank)}</td><td>${h.titles}</td></tr>`).join('') : '<tr><td colspan="5" class="cr-dim">Your first season is under way.</td></tr>';
    body.innerHTML = `<div class="cr-cols"><div>
        <h3>Titles</h3><ul class="cr-titles">${titles}</ul>
        <h3>Rival</h3><p>${rival ? `<b class="cr-rival">${esc(rival.name)}</b>, ${rival.retired ? 'retired' : `${ord(rankOf(c, rival.id, rival.age <= 17 ? 'junior' : 'pro'))}`}. Head-to-head: you ${c.story.h2h.w}, ${esc(rival.name)} ${c.story.h2h.l}.` : 'None'}</p>
        <h3>Wildcards</h3><p>${y.wildcards ? `${y.wildcards} left, for events above your ranking.` : 'None.'}</p>
      </div><div>
        <h3>Seasons</h3><table class="cr-table"><thead><tr><th>Season</th><th>Age</th><th>Tour</th><th>Year-end</th><th>Titles</th></tr></thead><tbody>${hist}</tbody></table>
      </div></div>
      <div class="cr-actions cr-manage">
        <button type="button" class="cr-export">Export save</button>
        <button type="button" class="cr-import">Import save</button>
        ${canRetire(c) ? '<button type="button" class="cr-retire">Retire</button>' : ''}
        <button type="button" class="cr-delete">Delete career</button>
      </div>`;
    body.querySelector('.cr-export').addEventListener('click', exportSave);
    body.querySelector('.cr-import').addEventListener('click', () => fileInput.click());
    const ret = body.querySelector('.cr-retire');
    if (ret) ret.addEventListener('click', () => { if (!confirmIn(ret, 'Retire for good?')) return; retire(c); storyAfter(c); save(); tab = 'week'; render(); showStory(); });
    const del = body.querySelector('.cr-delete');
    del.addEventListener('click', () => { if (!confirmIn(del, 'Delete this career?')) return; c = null; save(); render(); });
  }

  function renderLog() {
    const items = c.log.slice().reverse();
    body.innerHTML = items.length ? `<ul class="cr-log">${items.map((n) => `<li><span class="cr-dim">S${n.season} W${n.week + 1}</span> ${esc(n.text)}</li>`).join('')}</ul>` : '<p class="cr-dim">No news yet.</p>';
  }

  // ---------------------------------------------------------------- save files
  function exportSave() {
    const blob = new Blob([JSON.stringify(c)], { type: 'application/json' });
    const a = doc.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `court-rush-career-${c.you.name.replace(/[^A-Z]/g, '').toLowerCase() || 'save'}.json`;
    doc.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || data.version !== 1 || !data.you || !Array.isArray(data.players)) throw new Error('not a career');
      c = data;
      c.current = c.current || null;
      save();
      tab = 'week';
      render();
      showStory();
    } catch {
      body.insertAdjacentHTML('afterbegin', '<p class="cr-error">That file is not a Court Rush career save.</p>');
    }
  });

  // ---------------------------------------------------------------- open, close, results
  function openHub() {
    open = true;
    root.classList.remove('hidden');
    doc.body.classList.add('in-menu'); // hides the scoreboard and touch controls
    render();
    showStory();
  }
  function close(toMatch = false) {
    open = false;
    root.classList.add('hidden');
    storyEl.classList.add('hidden');
    if (!toMatch) onClose();
  }

  return {
    open: openHub,
    close,
    get isOpen() { return open; },
    hasCareer: () => !!c,
    summary: () => (c ? summary(c) : null),
    // the match that is about to be played (for the menu's preview of the court)
    upcoming: () => (c && c.current ? nextMatch(c) : null),
    // after a played match: { won, champion, score, event, round, next }
    recordResult(won, games, forfeit = false) {
      if (!c || !c.current) return null;
      const r = recordMatch(c, won, games);
      if (forfeit) r.forfeit = true;
      storyAfter(c);
      const n = nextMatch(c);
      r.next = n ? n.round : null;
      save();
      return r;
    },
    roundName: () => (c && c.current ? roundName(c.current.draw) : null),
  };
}
