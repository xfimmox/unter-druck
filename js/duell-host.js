// Membran-Duell – Moderator/Beamer: Ablauf und Spiellogik. Gezeichnet wird mit duell-view.js.
import { D, EVENTS, makeRound, stepRound, addStroke, strength, botNext, rng } from './duell-sim.js';
import { createView } from './duell-view.js';
import { TEAMS, esc, sfx, soundOn, toggleSound, confetti } from './fx.js';

const BOT_NAMES = ['Pascal', 'Bernoulli', 'Torricelli', 'Boyle', 'Bourdon', 'Mariotte', 'Venturi', 'Reynolds', 'Newton', 'Kelvin',
  'Celsius', 'Watt', 'Joule', 'Hooke', 'Euler', 'Darcy', 'Stokes', 'Prandtl', 'Mach', 'Carnot'];
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } } };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const r2 = (x) => Math.round(x * 100) / 100;

export async function startDuellHost(db, app) {
  // ---------- Raum ----------
  let code = ls.get('ud-duell-room');
  let G = null;
  if (code && (await db.get(`rooms/${code}/host`).catch(() => null)) !== db.uid) code = null;
  if (code) { try { G = JSON.parse(await db.get(`rooms/${code}/hs`)); } catch { G = null; } }
  while (!code) {
    const c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
    if (await db.get(`rooms/${c}/host`).catch(() => null)) continue;
    await db.set(`rooms/${c}`, { host: db.uid, meta: { ph: 'lobby', game: 'duell' } });
    code = c;
    ls.set('ud-duell-room', c);
  }
  const base = `rooms/${code}`;
  const fresh = () => ({ ph: 'lobby', rd: 0, played: 0, wins: [0, 0], seed: Math.floor(Math.random() * 1e6) + 1, roster: {}, order: [[], []], bots: {}, evOn: true, results: [], pz: false, rw: null, kings: {} });
  if (!G || !G.ph || G.ph === 'lobby' || G.ph === 'final') G = fresh(); // nur laufende Spiele wieder aufnehmen
  if (['count', 'run', 'burst'].includes(G.ph)) { G.ph = G.played ? 'result' : 'teams'; G.rw = null; } // nach Neuladen: Runde neu starten

  let players = {}, R = null, t0 = 0, tl = 0, evk = 0, lastEv = null, countEnd = 0, countN = null;
  const lastId = {}, lastStrokeAt = {}, power = {}, botSt = {}, pc = {};
  const botRand = rng(Date.now() % 100000);

  const joinUrl = location.origin + location.pathname + '?room=' + code;
  app.innerHTML = `
  <div class="h-wrap dh" id="hw">
    <header class="h-head">
      <h1 class="logo sm">MEMBRAN-<span>DUELL</span></h1>
      <div class="h-round" id="hRound"></div>
      <div class="d-wins big" id="hWins"></div>
      <div class="h-timer" id="hTimer"></div>
      <div class="h-room">Raum <b>${code}</b></div>
    </header>
    <main class="h-main dh-main"><canvas id="cv"></canvas><div class="dh-layer" id="hLayer"></div></main>
    <footer class="h-ctl">
      <span class="h-warn">⚠ Diesen Tab im Vordergrund lassen – hier läuft das Duell. <small>Version ${window.UD_VERSION || '?'}</small></span>
      <label class="dh-chk"><input type="checkbox" id="cEv"> Ereignisse</label>
      <button class="btn ghost" id="cBots">+5 Bots</button>
      <button class="btn ghost" id="cSnd"></button>
      <button class="btn ghost" id="cReset">Zurücksetzen</button>
      <button class="btn ghost" id="cRestart">Runde wiederholen</button>
      <button class="btn ghost" id="cPause">Pause</button>
      <button class="btn big" id="cNext">Weiter</button>
    </footer>
  </div>`;
  const $ = (id) => app.querySelector('#' + id);
  const layer = $('hLayer');
  const view = createView($('cv'), { sound: true });

  // ---------- Personen & Teams ----------
  const people = () => {
    const o = {};
    for (const [u, p] of Object.entries(players)) if (p && p.name) o[u] = { name: String(p.name).slice(0, 20), bot: false };
    for (const [u, n] of Object.entries(G.bots)) o[u] = { name: n, bot: true };
    return o;
  };
  const nameOf = (u) => (G.roster[u] ? G.roster[u].name : '?');
  const isActive = (u) => G.roster[u].bot || (players[u] && players[u].online) || performance.now() - (lastStrokeAt[u] || -1e9) < 5000;
  const activeCount = (k) => Math.max(1, G.order[k].filter(isActive).length);
  // Teamlisten fuer alle Bildschirme
  function writeAssign() {
    const upd = { roster: { t: G.order.map((list) => list.map(nameOf)) } };
    G.order.forEach((list, k) => list.forEach((u, i) => { G.roster[u].team = k; if (!G.roster[u].bot) upd[`assign/${u}`] = { team: k, pos: i }; }));
    db.update(base, upd);
  }
  function drawTeams() {
    const P = people(), ids = Object.keys(P);
    if (ids.length < 2) return;
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    G.roster = {}; G.order = [[], []];
    ids.forEach((u, i) => { G.roster[u] = { ...P[u] }; G.order[i % 2].push(u); });
    writeAssign();
    setPhase('teams');
  }
  function absorb() {
    if (G.ph === 'lobby') return false;
    let ch = false;
    for (const [u, p] of Object.entries(people())) {
      if (G.roster[u]) continue;
      G.roster[u] = { ...p };
      G.order[G.order[0].length <= G.order[1].length ? 0 : 1].push(u);
      ch = true;
    }
    if (ch) writeAssign();
    return ch;
  }
  function addBots(n) {
    const used = new Set(Object.values(G.bots));
    for (const nm of BOT_NAMES) { if (n <= 0) break; if (!used.has('Bot ' + nm)) { G.bots['b' + nm] = 'Bot ' + nm; n--; } }
    if (G.ph !== 'lobby') absorb();
    renderLayer();
  }

  // ---------- Ablauf ----------
  const label = () => (['count', 'run', 'burst'].includes(G.ph) && G.rn ? G.rn : roundName());
  const roundName = () => (G.played > 0 && G.results.length && G.results[G.results.length - 1].w < 0 ? `Runde ${G.rd + 1} (Wiederholung)` : `Runde ${G.rd + 1}`);
  function setPhase(ph) { G.ph = ph; renderLayer(); publish(); snapshot(); }
  function startRound() {
    absorb();
    G.rn = roundName();
    R = makeRound(G.seed + G.played * 101, G.rd, G.evOn);
    for (const u of Object.keys(G.roster)) { power[u] = 0; if (G.roster[u].bot) botSt[u] = { last: -1, next: 0.2 + Math.random() * 0.8 }; }
    countEnd = performance.now() + 3500;
    countN = 3; tl = D.ROUND;
    db.set(`${base}/strokes`, null);
    for (const u in lastId) lastId[u] = 0;
    setPhase('count');
  }
  function endRound(over) {
    G.played++;
    const king = [0, 1].map((k) => G.order[k].slice().sort((a, b) => (power[b] || 0) - (power[a] || 0))[0]);
    for (const k of [0, 1]) if (king[k]) G.kings[king[k]] = (G.kings[king[k]] || 0) + (power[king[k]] || 0);
    G.results.push({ w: over.w, why: over.why, strokes: R.strokes.slice(), best: R.best.slice(), king: king.map((u) => (u ? nameOf(u) : '')) });
    G.rw = over;
    if (over.w >= 0) { G.wins[over.w]++; G.rd++; }
    view.burst(over.w);
    setPhase('burst');
    setTimeout(() => { if (G.ph === 'burst') setPhase('result'); }, over.w >= 0 ? 3800 : 2200);
  }
  function next() {
    if (G.ph === 'lobby') drawTeams();
    else if (G.ph === 'teams') startRound();
    else if (G.ph === 'run') { if (confirm('Runde jetzt beenden? Gewinner ist, wer gerade vorne liegt.')) endRound(Math.abs(R.x) < 0.05 ? { w: -1, why: 'draw' } : { w: R.x > 0 ? 0 : 1, why: 'time' }); }
    else if (G.ph === 'result') { if (G.wins[0] >= 2 || G.wins[1] >= 2) { setPhase('final'); confetti(); sfx.win(); } else startRound(); }
  }
  function reset() {
    if (!confirm('Duell zurücksetzen? Teams und Punkte gehen verloren, die Teilnehmenden bleiben im Raum.')) return;
    G = fresh(); R = null;
    db.update(base, { assign: null, strokes: null, roster: null });
    $('cEv').checked = G.evOn;
    setPhase('lobby');
  }

  // ---------- Huebe ----------
  function onStroke(u, k, t, s) {
    const f = addStroke(R, k, u, t, s, activeCount(k));
    power[u] = (power[u] || 0) + f;
    pc[u] = ((pc[u] || 0) + 1) % 1000;
    lastStrokeAt[u] = performance.now();
    view.pump(k, G.order[k].indexOf(u), s);
  }
  db.on(`${base}/strokes`, (all) => {
    if (!all || !R || G.ph !== 'run') return;
    for (const [u, js] of Object.entries(all)) {
      const r = G.roster[u];
      if (!r || r.bot) continue;
      let list;
      try { list = JSON.parse(js); } catch { continue; }
      for (const [id, t, s] of list) {
        if (id <= (lastId[u] || 0)) continue;
        lastId[u] = id;
        if (t < -0.5 || t > D.ROUND + 2) continue;
        onStroke(u, r.team, clamp(t, 0, R.t), clamp(+s || 0, 0, 1));
      }
    }
  });
  db.on(`${base}/players`, (p) => {
    players = p || {};
    if (G.ph === 'lobby') renderLayer();
    else if (absorb()) renderLayer();
  });

  // ---------- Takt (10 Hz Logik) ----------
  setInterval(() => {
    const now = performance.now();
    if (G.ph === 'count' && !G.pz) {
      const left = Math.ceil((countEnd - now) / 1000) - 1;
      if (left !== countN && left >= 0) { countN = left; if (left > 0) sfx.tick(); }
      if (now >= countEnd) { t0 = db.serverNow(); R.t = 0; tl = D.ROUND; sfx.go(); setPhase('run'); }
    } else if (G.ph === 'run' && R && !G.pz) {
      const nt = (db.serverNow() - t0) / 1000;
      const dt = nt - R.t;
      if (dt > 0) {
        for (const k of [0, 1]) for (const u of G.order[k]) {
          if (!G.roster[u].bot) continue;
          const b = botSt[u];
          if (nt >= b.next) { onStroke(u, k, nt, strength(nt - b.last)); b.last = nt; b.next = botNext(b, botRand, k ? 0.9 : 0.85); }
        }
        const res = stepRound(R, dt, [activeCount(0), activeCount(1)]);
        for (const c of res.combos) view.combo(c.k, c.mult);
        if (res.event) { lastEv = { type: res.event.type, team: res.event.team }; evk++; view.event(lastEv); sfx.alarm(); }
        tl = Math.max(0, Math.ceil(D.ROUND - R.t));
        if (res.over) endRound(res.over);
      }
    }
    publish();
  }, 100);

  const turbo = () => !!(R && R.evOn && R.evOn.type === 'turbo' && R.t < R.evOn.t + EVENTS.turbo.dur && G.ph === 'run');
  function publish() {
    const teams = G.order.map((list) => list.map((u) => ({ name: nameOf(u), active: isActive(u) })));
    view.set({ ph: G.ph, teams, x: R ? R.x : 0, P: R ? R.P : [0, 0], turbo: turbo(), rw: G.rw, countN: G.ph === 'count' ? countN : null });
    $('hTimer').textContent = G.ph === 'run' ? `0:${String(tl).padStart(2, '0')}` : '';
    $('hTimer').classList.toggle('hot', G.ph === 'run' && tl <= 5);
    db.update(base, {
      meta: {
        game: 'duell', ph: G.ph, rd: G.rd, rn: label(), tl, pz: G.pz, wins: G.wins, t0, cn: G.ph === 'count' ? countN : null,
        x: R ? Math.round(R.x * 1000) / 1000 : 0, P: R ? R.P.map(r2) : [0, 0], cm: R ? R.mult.map((m) => Math.round(m * 4) / 4) : [1, 1], tb: turbo(),
        pc: G.order.map((list) => list.map((u) => pc[u] || 0)), ac: G.order.map((list) => list.map((u) => (isActive(u) ? 1 : 0)).join('')),
        ev: lastEv, evk, rw: G.rw,
      },
    });
  }
  let snapT = 0;
  function snapshot() { db.set(`${base}/hs`, JSON.stringify(G)); snapT = performance.now(); }
  setInterval(() => { if (performance.now() - snapT > 5000) snapshot(); }, 5000);

  // ---------- DOM-Schicht (Lobby, Texte, Ergebnisse) ----------
  function renderLayer() {
    const ph = G.ph;
    $('hw').dataset.ph = ph;
    $('hRound').textContent = ph === 'lobby' ? 'Lobby' : ph === 'teams' ? 'Teams' : ph === 'final' ? 'Siegerehrung' : label();
    const nx = $('cNext');
    const decided = G.wins[0] >= 2 || G.wins[1] >= 2;
    const few = Object.keys(people()).length < 2;
    nx.textContent = ph === 'lobby' ? (few ? 'Teams auslosen (mind. 2 Personen)' : 'Teams auslosen') : ph === 'teams' ? 'Runde 1 starten' : ph === 'run' ? 'Runde beenden' : ph === 'result' ? (decided ? 'Zur Siegerehrung' : `${roundName()} starten`) : ph === 'final' ? 'Fertig' : '…';
    nx.disabled = (ph === 'lobby' && Object.keys(people()).length < 2) || ph === 'count' || ph === 'burst' || ph === 'final';
    nx.classList.toggle('big', ph !== 'run'); nx.classList.toggle('ghost', ph === 'run');
    $('cPause').hidden = ph !== 'run';
    $('cRestart').hidden = !(ph === 'run' || ph === 'result');
    $('hWins').innerHTML = ph === 'lobby' ? '' : `<b class="c0">${'★'.repeat(G.wins[0])}${'☆'.repeat(2 - Math.min(2, G.wins[0]))}</b> <span>:</span> <b class="c1">${'★'.repeat(G.wins[1])}${'☆'.repeat(2 - Math.min(2, G.wins[1]))}</b>`;
    let h = '';
    if (ph === 'lobby') {
      const P = Object.values(people());
      h = `<div class="h-lobby dh-card"><div class="h-join"><div id="qr"></div><div class="h-link">${esc(joinUrl)}</div><p>Link öffnen oder QR-Code scannen – Raumcode <b>${code}</b></p></div>
        <div class="h-people"><h2>Schon dabei: ${P.length}</h2><div class="chips">${P.map((p) => `<span class="chip${p.bot ? ' bot' : ''}">${esc(p.name)}</span>`).join('') || '<span class="small">Noch niemand – Link öffnen und Namen eingeben.</span>'}</div>
        <p class="small">Allein testen? <button class="btn ghost" id="cBots20">2 × 10 Bots hinzufügen</button></p></div></div>`;
    } else if (ph === 'teams') {
      h = `<div class="dh-intro"><h2>Die Teams stehen!</h2><p><b class="c0">Team Blau</b> nach <b>links</b>, <b class="c1">Team Orange</b> nach <b>rechts</b>.</p>
        <ul class="rules"><li>Leertaste, Enter oder Klick = <b>Pumpen</b>.</li><li>Der Hebel braucht 0,8 s, um wieder oben zu sein – <b>Hämmern bringt nichts</b>.</li>
        <li>Pumpt das ganze Team <b>gleichzeitig</b>, gibt es <b>COMBO ×2</b>. Ruft euch den Takt zu!</li><li>Drückt die Membran zum Gegner, bis sie <b>platzt</b>. Best of 3.</li></ul></div>`;
    } else if (ph === 'result' || ph === 'final') {
      const rs = G.results.map((r, i) => `<tr><td>${i + 1}</td><td>${r.w < 0 ? 'Unentschieden' : `<b class="c${r.w}">Team ${TEAMS[r.w].name}</b>${r.why === 'burst' ? ' 💥' : ' (Zeit)'}`}</td>
        <td>${r.strokes[0]} : ${r.strokes[1]}</td><td>×${String(r.best[0]).replace('.', ',')} : ×${String(r.best[1]).replace('.', ',')}</td><td><span class="c0">${esc(r.king[0])}</span> / <span class="c1">${esc(r.king[1])}</span></td></tr>`).join('');
      const table = `<table class="dh-tab"><tr><th>#</th><th>Sieger</th><th>Hübe</th><th>Beste Combo</th><th>Pumpenkönig:in</th></tr>${rs}</table>`;
      if (ph === 'result') {
        const r = G.results[G.results.length - 1];
        h = `<div class="dh-card dh-res"><h2>${r && r.w >= 0 ? `<span class="c${r.w}">Team ${TEAMS[r.w].name}</span> gewinnt die Runde!` : 'Unentschieden – die Runde wird wiederholt.'}</h2>${table}</div>`;
      } else {
        const w = G.wins[0] > G.wins[1] ? 0 : 1;
        const kings = [0, 1].map((k) => G.order[k].slice().sort((a, b) => (G.kings[b] || 0) - (G.kings[a] || 0))[0]);
        h = `<div class="dh-card dh-final"><p class="cup">🏆</p><h2 class="c${w}">Team ${TEAMS[w].name} gewinnt das Duell!</h2><div class="h-fscore"><b class="c0">${G.wins[0]}</b> : <b class="c1">${G.wins[1]}</b></div>
          ${kings.map((u, k) => (u ? `<p class="mvp">Pumpenkönig:in Team ${TEAMS[k].name}: <b>${esc(nameOf(u))}</b></p>` : '')).join('')}${table}</div>`;
      }
    }
    layer.innerHTML = h;
    layer.hidden = !h;
    if (ph === 'lobby') {
      if (window.QRCode) { try { new window.QRCode($('qr'), { text: joinUrl, width: 260, height: 260 }); } catch { /* nur Link */ } }
      $('cBots20').onclick = () => addBots(20);
    }
  }

  // ---------- Bedienung ----------
  $('cNext').onclick = next;
  $('cPause').onclick = () => {
    G.pz = !G.pz;
    if (G.pz) G.pzAt = db.serverNow(); else t0 += db.serverNow() - G.pzAt; // Pausenzeit herausrechnen
    $('cPause').textContent = G.pz ? 'Fortsetzen' : 'Pause';
    publish();
  };
  $('cRestart').onclick = () => {
    if (!confirm('Runde wiederholen? Ein Sieg dieser Runde wird zurückgenommen.')) return;
    if (G.ph === 'result' && G.results.length) { const r = G.results.pop(); if (r.w >= 0) { G.wins[r.w]--; G.rd--; } G.played--; }
    startRound();
  };
  $('cReset').onclick = reset;
  $('cBots').onclick = () => addBots(5);
  $('cEv').checked = G.evOn;
  $('cEv').onchange = (e) => { G.evOn = e.target.checked; };
  const snd = $('cSnd');
  const sndLabel = () => { snd.textContent = soundOn() ? '🔊 Ton an' : '🔇 Ton aus'; };
  snd.onclick = () => { toggleSound(); sndLabel(); };
  sndLabel();

  if (G.ph !== 'lobby') writeAssign(); // nach Neuladen Teamlisten erneut verteilen
  renderLayer();
  publish();
}
