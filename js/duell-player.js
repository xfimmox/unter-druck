// Membran-Duell – Ansicht der Teilnehmenden: eine grosse Handpumpe.
import { D, strength } from './duell-sim.js';
import { createView } from './duell-view.js';
import { aip, TEAMS, fmtTime, esc, beep, sfx, soundOn, toggleSound, confetti } from './fx.js';


// Animierte Kurzanleitung (4 Karten, laeuft in Schleife)
const PUMP = (x, cls) => `<g class="${cls}" transform="translate(${x} 0)"><g class="hw-h"><rect x="-3" y="14" width="6" height="40" fill="#c9d2d9"/><rect x="-22" y="8" width="44" height="9" rx="4" class="hw-grip"/></g>
  <rect x="-13" y="52" width="26" height="40" rx="4" fill="#b9c2c9" stroke="#3a4046" stroke-width="1.5"/><rect x="-13" y="68" width="26" height="5" class="hw-band"/><rect x="-22" y="90" width="44" height="7" rx="2" fill="#3a4046"/></g>`;
export const howto = () => `
<div class="howto">
  <div class="hw-card"><svg viewBox="0 0 120 120">
    ${PUMP(38, 'hw-p1')}
    <rect x="66" y="66" width="52" height="18" rx="4" class="hw-key"/><text x="92" y="78" class="hw-kt">LEERTASTE</text></svg>
    <b>1 · Pumpen</b><span>Leertaste, Enter oder Klick auf die Pumpe</span></div>
  <div class="hw-card"><svg viewBox="0 0 120 120">
    <circle cx="60" cy="58" r="50" class="hw-ring0"/><circle cx="60" cy="58" r="50" class="hw-ring"/>
    <g transform="translate(-0 0)">${PUMP(60, 'hw-p2')}</g></svg>
    <b>2 · Im Takt</b><span>Erst drücken, wenn der Ring <em class="g">grün</em> ist – Hämmern bringt nichts</span></div>
  <div class="hw-card"><svg viewBox="0 0 120 120">${PUMP(22, 'hw-p3')}${PUMP(60, 'hw-p3')}${PUMP(98, 'hw-p3')}
    <text x="60" y="40" class="hw-combo">COMBO ×2!</text></svg>
    <b>3 · Gemeinsam</b><span>Alle gleichzeitig = Bonus. Ruft euch den Takt zu: <em>PUMP – PUMP!</em></span></div>
  <div class="hw-card"><svg viewBox="0 0 120 120">
    <rect x="8" y="22" width="104" height="76" rx="14" fill="#8d979f"/>
    <clipPath id="hwc"><rect x="14" y="28" width="92" height="64" rx="10"/></clipPath>
    <g clip-path="url(#hwc)">
      <rect x="14" y="28" width="92" height="64" fill="#ff8a1f"/>
      <path fill="#2f8fff" d="M14 28 H60 Q60 60 60 92 H14 Z"><animate attributeName="d" dur="3s" repeatCount="indefinite" keyTimes="0;0.7;0.78;1"
        values="M14 28 H60 Q60 60 60 92 H14 Z;M14 28 H60 Q148 60 60 92 H14 Z;M14 28 H106 Q106 60 106 92 H14 Z;M14 28 H106 Q106 60 106 92 H14 Z"/></path>
      <path fill="none" stroke="#e8edf1" stroke-width="4" d="M60 28 Q60 60 60 92"><animate attributeName="d" dur="3s" repeatCount="indefinite" keyTimes="0;0.7;0.71;1"
        values="M60 28 Q60 60 60 92;M60 28 Q148 60 60 92;M60 28 Q60 60 60 28;M60 28 Q60 60 60 28"/></path>
    </g>
    <rect x="0" y="0" width="120" height="120" class="hw-flash"/></svg>
    <b>4 · Membran sprengen</b><span>Drückt die Membran zum Gegner, bis sie platzt. Best of 3!</span></div>
</div>`;

export async function startDuellPlayer(db, code, app, startScreen) {
  const base = `rooms/${code}`;
  if (!(await db.get(`${base}/host`).catch(() => null))) return startScreen(`Raum „${code}“ nicht gefunden. Code prüfen.`);
  const me = `${base}/players/${db.uid}`;
  let meta = null, asg = null, roster = null, joined = false, lastPh = '', lastEvk = 0, lastRd = -1;
  let prevPc = null, prevCm = [1, 1];
  let last = -10, pressAt = -10, sid = 0;
  const queue = []; // [id, t, s] der letzten 2 s
  let sentId = 0;

  app.innerHTML = `
  <div class="d-wrap" id="dw">
    <header class="p-head">
      <div class="p-team" id="dTeam">MEMBRAN-DUELL</div>
      <div class="p-round" id="dRound"></div>
      <div class="d-wins" id="dWins"></div>
      <div class="p-timer" id="dTimer"></div>
      ${aip()}
      <button class="btn ghost" id="dSnd"></button>
    </header>
    <div class="d-arena"><canvas id="dArena"></canvas></div>
    <main class="d-main">
      <button class="d-pump" id="dPump" aria-label="Pumpen">
        <svg viewBox="0 0 200 300">
          <defs>
            <linearGradient id="gSteel" x1="0" x2="1"><stop offset="0" stop-color="#6c7780"/><stop offset=".35" stop-color="#eef2f5"/><stop offset=".65" stop-color="#b9c2c9"/><stop offset="1" stop-color="#5d666e"/></linearGradient>
          </defs>
          <circle id="dRing" cx="100" cy="150" r="96" class="d-ring"/>
          <g id="dHandle"><rect x="96" y="40" width="8" height="150" fill="url(#gSteel)"/><rect x="40" y="26" width="120" height="22" rx="11" class="d-grip"/></g>
          <rect x="70" y="150" width="60" height="120" rx="8" fill="url(#gSteel)" stroke="#3a4046" stroke-width="2"/>
          <rect x="70" y="200" width="60" height="12" class="d-band"/>
          <rect x="40" y="268" width="120" height="18" rx="4" fill="#3a4046"/>
          <path d="M130 245 h40 v-20" fill="none" stroke="#8d979f" stroke-width="10"/>
        </svg>
      </button>
      <div class="d-side">
        <div class="d-combo" id="dCombo"></div>
        <div class="d-fb" id="dFb">Leertaste, Enter oder Klick = Pumpen</div>
        <div class="d-help">Im <b>Takt</b> pumpen schlägt wild hämmern! Pumpt euer ganzes Team gleichzeitig, gibt es einen <b>COMBO-Bonus</b>. Deine Pumpe ist oben weiß umrandet.</div>
      </div>
    </main>
    <div class="p-overlay" id="dOv"></div>
  </div>`;
  const $ = (id) => app.querySelector('#' + id);
  const ov = $('dOv');
  const view = createView($('dArena'), { sound: false });

  const existing = await db.get(me).catch(() => null);
  if (existing && existing.name) join(existing.name);
  else {
    let saved = '';
    try { saved = localStorage.getItem('ud-name') || ''; } catch { /* egal */ }
    ov.innerHTML = `<div class="card">${aip('xl')}<h1 class="logo">MEMBRAN-<span>DUELL</span></h1><p class="sub">Raum ${esc(code)}</p>
      <form id="jf"><label>Dein Name<input id="jn" maxlength="20" autocomplete="off" value="${esc(saved)}" autofocus></label>
      <button class="btn big">Beitreten</button></form></div>`;
    ov.querySelector('#jf').onsubmit = (e) => {
      e.preventDefault();
      const n = ov.querySelector('#jn').value.trim().slice(0, 20);
      if (n) join(n);
    };
  }

  function join(name) {
    joined = true;
    try { localStorage.setItem('ud-name', name); } catch { /* egal */ }
    db.onConnected((ok) => {
      if (!ok) return;
      Promise.resolve(db.set(me, { name, online: true, ts: Date.now() })).then(() => db.onDisconnect(`${me}/online`, false));
    });
    db.on(`${base}/meta`, (m) => { meta = m; onMeta(); });
    db.on(`${base}/assign/${db.uid}`, (a) => { asg = a; render(); });
    db.on(`${base}/roster`, (r) => { roster = r; prevPc = null; });
    render();
  }

  const running = () => meta && meta.ph === 'run' && !meta.pz && asg;
  const roundT = () => (db.serverNow() - (meta.t0 || 0)) / 1000;

  function pump() {
    const now = performance.now() / 1000;
    pressAt = now;
    $('dPump').classList.remove('hit'); void $('dPump').offsetWidth; $('dPump').classList.add('hit');
    if (!running()) { beep(180, 0.05, 'square', 0.04); return; }
    const s = strength(now - last);
    last = now;
    if (asg && typeof asg.pos === 'number') view.pump(asg.team, asg.pos, s);
    queue.push([++sid, Math.round(roundT() * 1000) / 1000, Math.round(s * 100) / 100]);
    const fb = $('dFb');
    if (s >= 0.95) { fb.textContent = 'Voller Hub!'; fb.dataset.k = 'ok'; beep(140, 0.09, 'triangle', 0.16); }
    else if (s <= 0.15) { fb.textContent = 'Zu früh – Pumpe stottert!'; fb.dataset.k = 'bad'; beep(90, 0.06, 'square', 0.06); }
    else { fb.textContent = `Halber Hub (${Math.round(s * 100)} %) – etwas ruhiger!`; fb.dataset.k = 'mid'; beep(120, 0.08, 'triangle', 0.1); }
    spray(s);
  }
  function spray(s) {
    const box = $('dPump').getBoundingClientRect();
    for (let i = 0; i < 4 + s * 10; i++) {
      const d = document.createElement('i');
      d.className = 'd-drop';
      d.style.left = box.left + box.width * 0.85 + 'px';
      d.style.top = box.top + box.height * 0.73 + 'px';
      d.style.setProperty('--dx', (40 + Math.random() * 120) + 'px');
      d.style.setProperty('--dy', (-80 - Math.random() * 120 * s) + 'px');
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 700);
    }
  }
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) pump(); }
  });
  $('dPump').addEventListener('pointerdown', (e) => { e.preventDefault(); pump(); });
  $('dPump').addEventListener('keydown', (e) => e.preventDefault()); // kein doppeltes Ausloesen ueber den Button

  // Huebe gesammelt senden (letzte 2 s, damit verschluckte Updates nichts verlieren)
  setInterval(() => {
    const cut = sid - 12;
    while (queue.length && queue[0][0] < cut) queue.shift();
    if (joined && sid > sentId) { sentId = sid; db.set(`${base}/strokes/${db.uid}`, JSON.stringify(queue)); }
  }, 200);

  function onMeta() {
    if (!meta) return;
    if (meta.evk && meta.evk !== lastEvk) {
      if (lastEvk && meta.ev) { view.event(meta.ev); sfx.alarm(); }
      lastEvk = meta.evk;
    }
    // Pumpen der anderen animieren (Zaehler je Position)
    const pc = meta.pc || [[], []];
    if (prevPc && meta.ph === 'run') {
      for (const k of [0, 1]) (pc[k] || []).forEach((c, i) => {
        if (asg && k === asg.team && i === asg.pos) return; // eigene Pumpe laeuft schon lokal
        if (prevPc[k] && prevPc[k][i] !== undefined && c !== prevPc[k][i]) view.pump(k, i, 1);
      });
    }
    prevPc = pc;
    const cm = meta.cm || [1, 1];
    for (const k of [0, 1]) { if (cm[k] > 1 && cm[k] > prevCm[k]) view.combo(k, cm[k]); }
    prevCm = cm;
    if (meta.ph === 'burst' && lastPh !== 'burst' && meta.rw) view.burst(meta.rw.w);
    const names = roster && roster.t ? roster.t : [[], []];
    const ac = meta.ac || ['', ''];
    view.set({
      ph: meta.ph, x: meta.x || 0, P: meta.P || [0, 0], turbo: !!meta.tb, rw: meta.rw || null, countN: meta.ph === 'count' ? meta.cn : null,
      teams: [0, 1].map((k) => (names[k] || []).map((name, i) => ({ name, active: ac[k] ? ac[k][i] !== '0' : true, me: !!asg && asg.team === k && asg.pos === i }))),
    });
    render();
  }

  function render() {
    if (!joined) return;
    const ph = meta ? meta.ph : 'lobby';
    const k = asg ? asg.team : -1;
    const T = k >= 0 ? TEAMS[k] : null;
    $('dw').dataset.team = k >= 0 ? k : '';
    $('dTeam').textContent = T ? `Team ${T.name}` : 'MEMBRAN-DUELL';
    $('dRound').textContent = meta && meta.rn ? meta.rn : '';
    $('dTimer').textContent = meta && ph === 'run' ? fmtTime(meta.tl) : '';
    $('dWins').innerHTML = meta && meta.wins ? `<b class="c0">${'★'.repeat(meta.wins[0]) || '☆'}</b> <span>:</span> <b class="c1">${'★'.repeat(meta.wins[1]) || '☆'}</b>` : '';
    const cm = meta && meta.cm && k >= 0 ? meta.cm[k] : 1;
    const c = $('dCombo');
    c.textContent = cm > 1 ? `COMBO ×${String(cm).replace('.', ',')}` : '';
    c.dataset.m = cm;
    let h = '';
    if (!meta || ph === 'lobby') h = `<h2>Du bist dabei!</h2><p>Gleich werden die Teams ausgelost – so funktioniert's:</p>${howto()}`;
    else if (!asg) h = `<h2>Du bist dabei!</h2><p>Du steigst zur nächsten Runde ein.</p>`;
    else if (ph === 'teams') h = `<p>Du pumpst für</p><h2 class="tname">Team ${T.name}</h2><p class="go">Geh auf die <b>${T.side} Raumseite</b>.</p>
      ${howto()}`;
    else if (ph === 'count' || ph === 'burst') h = '';
    else if (ph === 'result') {
      const w = meta.rw ? meta.rw.w : -1;
      h = w < 0 ? `<h2>Unentschieden!</h2><p>Die Runde wird wiederholt.</p>`
        : `<h2 class="tname" data-w="${w}">${w === k ? 'Runde gewonnen!' : 'Runde verloren!'}</h2><p>${w === k ? 'Die Membran ist beim Gegner geplatzt 💥' : 'Kopf hoch – nächste Runde!'}</p>`;
      if (lastPh === 'burst' || lastPh === 'run') { if (w === k) { sfx.win(); $('dw').classList.add('flash'); } else { sfx.overload(); $('dw').classList.add('crack'); } setTimeout(() => $('dw').classList.remove('flash', 'crack'), 900); }
    } else if (ph === 'final') {
      const w = meta.wins[0] > meta.wins[1] ? 0 : 1;
      h = `<h2 class="tname" data-w="${w}">Team ${TEAMS[w].name} gewinnt das Duell!</h2><p class="score"><b class="c0">${meta.wins[0]}</b> : <b class="c1">${meta.wins[1]}</b></p><p>${w === k ? 'Glückwunsch – ihr habt am stärksten gepumpt!' : 'Danke fürs Mitpumpen!'}</p>`;
      if (lastPh !== 'final' && w === k) confetti();
    }
    if (ph === 'run' && lastPh === 'count') { sfx.go(); last = -10; }
    if (meta && meta.rd !== lastRd) { lastRd = meta.rd; }
    lastPh = ph;
    if (ov.dataset.h === h) { ov.hidden = !h; return; } // Animation nicht bei jedem Update neu starten
    ov.dataset.h = h;
    ov.innerHTML = h ? `<div class="card ovc${h.includes('howto') ? ' wide' : ''}" data-team="${k >= 0 ? k : ''}">${h}</div>` : '';
    ov.hidden = !h;
  }

  const snd = $('dSnd');
  const sndLabel = () => { snd.textContent = soundOn() ? '🔊' : '🔇'; };
  snd.onclick = () => { toggleSound(); sndLabel(); };
  sndLabel();

  // Animation: Hebel, Bereitschafts-Ring, Membran-Balken
  const RING = 2 * Math.PI * 96;
  (function frame() {
    const now = performance.now() / 1000;
    const d = now - pressAt;
    const down = d < 0.08 ? d / 0.08 : Math.max(0, 1 - (d - 0.08) / (D.REFILL - 0.08));
    $('dHandle').setAttribute('transform', `translate(0 ${down * 95})`);
    const ready = Math.min(1, Math.max(0, (now - last - D.MIN) / (D.REFILL - D.MIN)));
    const ring = $('dRing');
    ring.style.strokeDasharray = `${ready * RING} ${RING}`;
    ring.dataset.full = ready >= 1 ? 1 : 0;
    requestAnimationFrame(frame);
  })();
}
