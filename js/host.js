// Unter Druck – Moderator/Beamer: rechnet die Simulation und steuert den Ablauf.
import { CFG, ROUNDS, EVENT_INFO, makeSchedule, makeTeam, step, status, affected, stationOf, autoStep, botStep, rng } from './sim.js';
import { TEAMS, fmtTime, esc, sfx, soundOn, toggleSound, confetti } from './fx.js';

const BOT_NAMES = ['Pascal', 'Bernoulli', 'Torricelli', 'Boyle', 'Bourdon', 'Mariotte', 'Venturi', 'Reynolds', 'Newton', 'Kelvin',
  'Celsius', 'Watt', 'Joule', 'Hooke', 'Euler', 'Darcy', 'Stokes', 'Prandtl', 'Mach', 'Carnot'];
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const COUNTDOWN = 5;
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } } };

export async function startHost(db, app) {
  // ---------- Raum anlegen oder wieder aufnehmen ----------
  let code = ls.get('ud-host-room');
  let G = null;
  if (code && (await db.get(`rooms/${code}/host`).catch(() => null)) !== db.uid) code = null;
  if (code) { try { G = JSON.parse(await db.get(`rooms/${code}/hs`)); } catch { G = null; } }
  while (!code) {
    const c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
    if (await db.get(`rooms/${c}/host`).catch(() => null)) continue;
    await db.set(`rooms/${c}`, { host: db.uid, meta: { ph: 'lobby' } });
    code = c;
    ls.set('ud-host-room', c);
  }
  const base = `rooms/${code}`;
  const fresh = () => ({ ph: 'lobby', rd: 0, seed: Math.floor(Math.random() * 1e6) + 1, tl: 0, pz: false, roster: {}, order: [[], []], scores: [null, null, null, null], T: null, sched: [], ticker: [], rid: 0, green: {}, bots: {} });
  if (!G || !G.ph) G = fresh();

  let players = {}, valves = {};
  const offSince = {}, msgs = {}, botSt = {};
  const botRand = rng(Date.now() % 100000);
  let replayT0 = 0, finalShown = false;

  const joinUrl = location.origin + location.pathname + '?room=' + code;
  app.innerHTML = `
  <div class="h-wrap" id="hw">
    <header class="h-head">
      <h1 class="logo sm">UNTER <span>DRUCK</span></h1>
      <div class="h-round" id="hRound"></div>
      <div class="h-timer" id="hTimer"></div>
      <div class="h-room">Raum <b>${code}</b></div>
    </header>
    <main class="h-main" id="hMain"></main>
    <footer class="h-ctl">
      <span class="h-warn">⚠ Diesen Tab im Vordergrund lassen – hier läuft die Anlage.</span>
      <button class="btn ghost" id="cBots" title="Testmodus">+5 Bots</button>
      <button class="btn ghost" id="cSnd"></button>
      <button class="btn ghost" id="cReset">Zurücksetzen</button>
      <button class="btn ghost" id="cRestart">Runde neu starten</button>
      <button class="btn ghost" id="cPause">Pause</button>
      <button class="btn big" id="cNext">Weiter</button>
    </footer>
  </div>`;
  const $ = (id) => app.querySelector('#' + id);
  const main = $('hMain');

  // ---------- Personen ----------
  const people = () => {
    const o = {};
    for (const [u, p] of Object.entries(players)) if (p && p.name) o[u] = { name: String(p.name).slice(0, 20), bot: false };
    for (const [u, n] of Object.entries(G.bots)) o[u] = { name: n, bot: true };
    return o;
  };
  const nameOf = (u) => (G.roster[u] ? G.roster[u].name : '?');
  const orphan = (u) => !players[u] || (!players[u].online && Date.now() - (offSince[u] || 0) > 5000);
  const totals = () => {
    const t = [0, 0];
    G.scores.forEach((s) => { if (s) { t[0] += s[0]; t[1] += s[1]; } });
    if (G.ph === 'run' && ROUNDS[G.rd].scored && G.T) { t[0] += Math.round(G.T[0].score); t[1] += Math.round(G.T[1].score); }
    return t;
  };

  function writeAssign() {
    const upd = {};
    G.order.forEach((list, k) => list.forEach((u, i) => {
      Object.assign(G.roster[u], { team: k, pos: i });
      if (G.roster[u].bot) return;
      upd[`assign/${u}`] = { team: k, pos: i, n: list.length, prev: i ? nameOf(list[i - 1]) : 'Die Pumpe', next: i < list.length - 1 ? nameOf(list[i + 1]) : 'Der Verbraucher' };
    }));
    if (Object.keys(upd).length) db.update(base, upd);
  }
  function drawTeams() {
    const P = people();
    const ids = Object.keys(P);
    if (ids.length < 2) return;
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    G.roster = {}; G.order = [[], []];
    ids.forEach((u, i) => { G.roster[u] = { ...P[u] }; G.order[i % 2].push(u); });
    writeAssign();
    setPhase('teams');
  }
  // Spaet Beitretende ans Ende des kleineren Teams haengen
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
    for (const nm of BOT_NAMES) {
      if (n <= 0) break;
      if (used.has('Bot ' + nm)) continue;
      G.bots['b' + nm] = 'Bot ' + nm; n--;
    }
    if (G.ph === 'teams') absorb();
    renderMain();
  }

  // ---------- Ablauf ----------
  function setPhase(ph) {
    G.ph = ph;
    if (ph === 'result') replayT0 = performance.now();
    renderMain(); publish(); snapshot();
  }
  function startRound(rd) {
    absorb();
    G.rd = rd; G.scores[rd] = null; G.rid++; G.tl = COUNTDOWN; G.pz = false; G.ticker = [];
    G.T = G.order.map((list) => makeTeam(list.length, rd, G.seed));
    G.sched = makeSchedule(rd, G.seed);
    const upd = {};
    G.order.forEach((list, k) => list.forEach((u, i) => {
      if (G.roster[u].bot) { botSt[u] = { next: 1 + Math.random() }; return; }
      const v = Math.round(G.T[k].v0[i] * 1000) / 1000;
      valves[u] = v; upd[`valves/${u}`] = v;
    }));
    if (Object.keys(upd).length) db.update(base, upd);
    setPhase('count');
  }
  function endRound() {
    if (ROUNDS[G.rd].scored) {
      G.scores[G.rd] = [Math.round(G.T[0].score), Math.round(G.T[1].score)];
      G.order.forEach((list, k) => list.forEach((u, i) => { G.green[u] = (G.green[u] || 0) + G.T[k].green[i]; }));
    }
    sfx.end();
    setPhase('result');
  }
  function next() {
    if (G.ph === 'lobby') drawTeams();
    else if (G.ph === 'teams') startRound(0);
    else if (G.ph === 'run') { if (confirm('Runde jetzt vorzeitig beenden?')) endRound(); }
    else if (G.ph === 'result') { if (G.rd < ROUNDS.length - 1) startRound(G.rd + 1); else { finalShown = false; setPhase('final'); } }
  }
  function reset() {
    if (!confirm('Spiel wirklich zurücksetzen? Punkte und Teams gehen verloren, die Teilnehmenden bleiben im Raum.')) return;
    G = fresh();
    db.update(base, { assign: null, st: null, valves: null });
    valves = {};
    setPhase('lobby');
  }

  function deliver(k, i, text, kind) {
    const u = G.order[k][i];
    msgs[u] = { m: text, mk: ((msgs[u] && msgs[u].mk) || 0) + 1, mt: kind };
  }
  function tick(dt) {
    if (G.pz) return;
    if (G.ph === 'count') {
      const before = Math.ceil(G.tl);
      G.tl -= dt;
      if (G.tl <= 0) { G.tl = ROUNDS[G.rd].dur; sfx.go(); setPhase('run'); } else if (Math.ceil(G.tl) !== before) sfx.tick();
      return;
    }
    if (G.ph !== 'run') return;
    G.T.forEach((T, k) => {
      G.order[k].forEach((u, i) => {
        if (i >= T.n) return;
        if (G.roster[u].bot) botStep(T, i, botSt[u] || (botSt[u] = { next: 0 }), botRand);
        else if (orphan(u)) autoStep(T, i, dt);
        else if (typeof valves[u] === 'number') T.v[i] = Math.min(1, Math.max(0, valves[u]));
      });
      const res = step(T, dt, G.sched, ROUNDS[G.rd].scored);
      for (const e of res.started) {
        affected(e, T.n).forEach((i) => deliver(k, i, EVENT_INFO[e.type].msg, 1));
        if (k === 0) G.ticker.unshift({ t: e.t, txt: EVENT_INFO[e.type].label, k: 1 });
      }
      for (const e of res.ended) deliver(k, stationOf(e, T.n), EVENT_INFO[e.type].end, 0);
      for (const i of res.over) {
        deliver(k, i, 'Membran überlastet! Station kurz gesperrt.', 2);
        G.ticker.unshift({ t: T.t, txt: `💥 Membran überlastet bei ${nameOf(G.order[k][i])} (Team ${TEAMS[k].name})`, k: 2 });
        sfx.overload();
      }
    });
    G.tl -= dt;
    if (G.tl <= 0) endRound();
  }

  // ---------- Veroeffentlichen ----------
  const r2 = (x) => Math.round(x * 100) / 100;
  function publish() {
    const sc = totals();
    const upd = {
      meta: { ph: G.ph, rd: G.rd, nm: ROUNDS[G.rd].name, tl: Math.max(0, Math.ceil(G.tl)), pz: G.pz, sc, rs: G.ph === 'result' && G.scores[G.rd] ? G.scores[G.rd] : null },
    };
    if ((G.ph === 'count' || G.ph === 'run') && G.T) {
      G.T.forEach((T, k) => G.order[k].forEach((u, i) => {
        if (i >= T.n || G.roster[u].bot) return;
        const m = msgs[u] || { m: '', mk: 0, mt: 0 };
        upd[`st/${u}`] = { p: r2(T.p[i]), t: r2(T.tgt[i]), s: status(T, i), lk: T.lock[i] > 0, m: m.m, mk: m.mk, mt: m.mt, rid: G.rid, vr: Math.round(T.v0[i] * 1000) / 1000 };
      }));
    }
    db.update(base, upd);
    updateLive(sc);
  }
  let snapN = 0;
  function snapshot() { snapN = 0; db.set(`${base}/hs`, JSON.stringify(G)); }

  // ---------- Darstellung ----------
  const pipe = (k, lamps) => `
    <section class="h-team" data-team="${k}">
      <div class="h-thead"><span>Team ${TEAMS[k].name}</span>${lamps ? `<b class="h-score" id="sc${k}">0</b>` : `<em>${TEAMS[k].side} Raumseite</em>`}</div>
      <div class="pipe">
        <div class="pend">▼ Pumpe</div>
        ${G.order[k].map((u, i) => `<div class="stn" id="s${k}_${i}" data-s="${lamps ? 0 : ''}"><i class="lamp"></i><span class="num">${i + 1}</span><span class="nm">${esc(nameOf(u))}</span><em class="tag"></em></div>`).join('')}
        <div class="pend">▼ Verbraucher</div>
      </div>
    </section>`;

  function renderMain() {
    const ph = G.ph;
    $('hw').dataset.ph = ph;
    $('hRound').textContent = ph === 'lobby' ? 'Lobby' : ph === 'teams' ? 'Teams' : ph === 'final' ? 'Siegerehrung' : ROUNDS[G.rd].name;
    const nx = $('cNext');
    const nP = Object.keys(people()).length;
    nx.textContent = ph === 'lobby' ? 'Teams auslosen' : ph === 'teams' ? 'Proberunde starten' : ph === 'count' ? 'Gleich geht’s los …' : ph === 'run' ? 'Runde beenden' : ph === 'result' ? (G.rd < ROUNDS.length - 1 ? `${ROUNDS[G.rd + 1].name} starten` : 'Zur Siegerehrung') : 'Fertig';
    nx.disabled = (ph === 'lobby' && nP < 2) || ph === 'count' || ph === 'final';
    nx.classList.toggle('big', ph !== 'run');
    nx.classList.toggle('ghost', ph === 'run');
    $('cPause').hidden = !(ph === 'run' || ph === 'count');
    $('cRestart').hidden = !(ph === 'run' || ph === 'result');
    if (ph === 'lobby') {
      main.innerHTML = `<div class="h-lobby">
        <div class="h-join"><div id="qr"></div><div class="h-link">${esc(joinUrl)}</div><p>Link öffnen oder QR-Code scannen – Raumcode <b>${code}</b></p></div>
        <div class="h-people"><h2>Schon dabei: <span id="hCount">0</span></h2><div class="chips" id="hChips"></div>
        <p class="small">Allein testen? <button class="btn ghost" id="cBots20">2 × 10 Bots hinzufügen</button></p></div></div>`;
      if (window.QRCode) { try { new window.QRCode($('qr'), { text: joinUrl, width: 280, height: 280 }); } catch { /* nur Link */ } }
      $('cBots20').onclick = () => addBots(20);
      renderPeople();
    } else if (ph === 'teams') {
      main.innerHTML = `<div class="h-run"><div>${pipe(0, false)}</div>
        <div class="h-mid"><h2>Die Teams stehen!</h2><p><b class="c0">Team Blau</b> geht auf die <b>linke</b> Raumseite,<br><b class="c1">Team Orange</b> auf die <b>rechte</b>. Laptop mitnehmen!</p>
        <ul class="rules"><li>Jede Person ist eine Station der Rohrleitung und sieht <b>nur ihr eigenes Manometer</b>.</li>
        <li>Ziel: Zeiger im <b class="g">grünen Bereich</b> halten.</li>
        <li>Ventil <b>auf</b>: dein Druck sinkt – beim Nachfolger steigt er.</li>
        <li>Also: <b>Redet mit euren Nachbarn!</b></li></ul></div>
        <div>${pipe(1, false)}</div></div>`;
    } else if (ph === 'count' || ph === 'run') {
      main.innerHTML = `<div class="h-run"><div>${pipe(0, true)}</div>
        <div class="h-mid"><div class="h-big" id="hBig"></div><div class="h-sub" id="hSub"></div><ul class="ticker" id="hTick"></ul></div>
        <div>${pipe(1, true)}</div></div>`;
    } else if (ph === 'result') {
      const s = G.scores[G.rd], t = totals();
      main.innerHTML = `<div class="h-result">
        <div class="h-rhead">${s ? `<span>${ROUNDS[G.rd].name}</span> <b class="c0">${s[0]}</b> : <b class="c1">${s[1]}</b> <span class="tot">Gesamt <b class="c0">${t[0]}</b> : <b class="c1">${t[1]}</b></span>` : '<span>Proberunde – ohne Wertung. Wer hat hier was verschlafen?</span>'}</div>
        <div class="h-replays">${[0, 1].map((k) => `<section class="h-team" data-team="${k}"><div class="h-thead"><span>Team ${TEAMS[k].name}</span><em>Druckverlauf (Abweichung vom Soll)</em></div><canvas class="replay" id="rp${k}"></canvas></section>`).join('')}</div></div>`;
    } else if (ph === 'final') {
      const t = totals();
      const w = t[0] === t[1] ? -1 : t[0] > t[1] ? 0 : 1;
      const scoredTime = ROUNDS.filter((r) => r.scored).reduce((a, r) => a + r.dur, 0);
      const mvp = (k) => {
        const best = G.order[k].slice().sort((a, b) => (G.green[b] || 0) - (G.green[a] || 0))[0];
        return best ? `<p class="mvp">MVP Team ${TEAMS[k].name}: <b>${esc(nameOf(best))}</b> – ${Math.round(100 * (G.green[best] || 0) / scoredTime)} % der Zeit im grünen Bereich</p>` : '';
      };
      main.innerHTML = `<div class="h-final"><p>🏆</p><h2 class="${w < 0 ? '' : 'c' + w}">${w < 0 ? 'Unentschieden!' : `Team ${TEAMS[w].name} gewinnt!`}</h2>
        <div class="h-fscore"><b class="c0">${t[0]}</b> : <b class="c1">${t[1]}</b></div>${mvp(0)}${mvp(1)}</div>`;
      if (!finalShown) { finalShown = true; confetti(); sfx.win(); }
    }
    updateLive(totals());
  }
  function renderPeople() {
    if (G.ph !== 'lobby' || !$('hChips')) return;
    const P = Object.values(people());
    $('hCount').textContent = P.length;
    $('hChips').innerHTML = P.map((p) => `<span class="chip${p.bot ? ' bot' : ''}">${esc(p.name)}</span>`).join('') || '<span class="small">Noch niemand – Link öffnen und Namen eingeben.</span>';
    $('cNext').disabled = P.length < 2;
  }
  let tickSig = '';
  function updateLive(sc) {
    const ph = G.ph;
    $('hTimer').textContent = ph === 'run' ? fmtTime(Math.ceil(G.tl)) : '';
    $('cPause').textContent = G.pz ? 'Fortsetzen' : 'Pause';
    if (ph !== 'count' && ph !== 'run') return;
    if (!G.T) return;
    $('hBig').textContent = ph === 'count' ? Math.ceil(G.tl) : G.pz ? 'Pause' : fmtTime(Math.ceil(G.tl));
    $('hSub').textContent = ph === 'count' ? `${ROUNDS[G.rd].name} startet …` : ROUNDS[G.rd].scored ? 'Punkte für jede Station im grünen Bereich' : 'Proberunde – ohne Wertung';
    G.T.forEach((T, k) => {
      const el = $('sc' + k);
      if (el) el.textContent = sc[k];
      G.order[k].forEach((u, i) => {
        const row = $(`s${k}_${i}`);
        if (!row || i >= T.n) return;
        row.dataset.s = status(T, i);
        row.querySelector('.tag').textContent = G.roster[u].bot ? 'BOT' : orphan(u) ? 'AUTOMATIK' : '';
      });
    });
    const sig = G.ticker.length + '|' + (G.ticker[0] ? G.ticker[0].txt : '');
    if (sig !== tickSig) {
      tickSig = sig;
      $('hTick').innerHTML = G.ticker.slice(0, 7).map((x) => `<li data-k="${x.k}"><time>${fmtTime(x.t)}</time> ${esc(x.txt)}</li>`).join('');
    }
  }

  // Replay: Verlaufskurve je Station (Abweichung vom Soll), Stoerungen als Markierungen
  function drawReplay(k, prog) {
    const cv = $('rp' + k), T = G.T && G.T[k];
    if (!cv || !T) return;
    const dpr = window.devicePixelRatio || 1;
    const bw = cv.clientWidth, bh = cv.clientHeight;
    if (cv.width !== Math.round(bw * dpr) || cv.height !== Math.round(bh * dpr)) { cv.width = Math.round(bw * dpr); cv.height = Math.round(bh * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, bw, bh);
    const L = 118, top = 34, n = T.n, rowH = (bh - top - 4) / n, W = bw - L - 8;
    const dur = ROUNDS[G.rd].dur, RANGE = 1.5;
    const X = (t) => L + (t / dur) * W;
    g.font = '12px system-ui, "Segoe UI", sans-serif';
    g.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const y0 = top + i * rowH, mid = y0 + rowH / 2, half = rowH / 2 - 2;
      g.fillStyle = i % 2 ? '#20262d' : '#1b2026'; g.fillRect(0, y0, bw, rowH);
      g.fillStyle = 'rgba(46,204,113,.30)'; g.fillRect(L, mid - half * CFG.GREEN / RANGE, W, 2 * half * CFG.GREEN / RANGE);
      g.fillStyle = '#c9d2d9'; g.textAlign = 'left';
      g.fillText(`${i + 1}  ${nameOf(G.order[k][i])}`.slice(0, 17), 6, mid);
      const cnt = Math.floor(T.hist.length * prog);
      let px = null, py = null;
      for (let j = 0; j < cnt; j++) {
        const d = T.hist[j][i];
        const x = X((j + 1) * CFG.HIST_DT);
        if (d === undefined) continue;
        if (d === 99) { g.fillStyle = '#e5383b'; g.fillRect(x - W / (dur / CFG.HIST_DT), y0 + 2, W / (dur / CFG.HIST_DT) + 1, rowH - 4); px = null; continue; }
        const y = mid - Math.max(-1, Math.min(1, d / RANGE)) * half;
        if (px !== null) {
          const a = Math.abs(d);
          g.strokeStyle = a <= CFG.GREEN ? '#2ecc71' : a <= CFG.YELLOW ? '#f5c211' : '#ff5a5d';
          g.lineWidth = 2; g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
        }
        px = x; py = y;
      }
    }
    g.textAlign = 'center'; g.font = '11px system-ui, "Segoe UI", sans-serif';
    G.sched.forEach((e, idx) => {
      if (e.t > dur * prog) return;
      const x = X(e.t);
      g.strokeStyle = 'rgba(255,255,255,.28)'; g.setLineDash([3, 4]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, top); g.lineTo(x, bh); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#9fb0bd';
      g.fillText(EVENT_INFO[e.type].label.replace('Verbraucher schaltet', 'Verbr.').replace('Pumpe ', 'Pumpe '), Math.max(L + 30, Math.min(bw - 40, x)), idx % 2 ? 24 : 10);
      if (e.dur !== undefined) { // betroffene Station markieren
        const i = stationOf(e, n);
        g.fillStyle = 'rgba(255,255,255,.75)';
        g.beginPath(); g.arc(x, top + i * rowH + rowH / 2, 3.5, 0, 7); g.fill();
      }
    });
  }

  // ---------- Bedienung ----------
  $('cNext').onclick = next;
  $('cPause').onclick = () => { G.pz = !G.pz; publish(); };
  $('cRestart').onclick = () => { if (confirm(`${ROUNDS[G.rd].name} neu starten? Die Punkte dieser Runde verfallen.`)) startRound(G.rd); };
  $('cReset').onclick = reset;
  $('cBots').onclick = () => addBots(5);
  const snd = $('cSnd');
  const sndLabel = () => { snd.textContent = soundOn() ? '🔊 Ton an' : '🔇 Ton aus'; };
  snd.onclick = () => { toggleSound(); sndLabel(); };
  sndLabel();

  db.on(`${base}/players`, (p) => {
    players = p || {};
    for (const [u, x] of Object.entries(players)) {
      if (x && x.online) delete offSince[u]; else if (!offSince[u]) offSince[u] = Date.now();
    }
    if (G.ph === 'lobby') renderPeople();
    else if (G.ph === 'teams' && absorb()) renderMain();
  });
  db.on(`${base}/valves`, (v) => { valves = v || {}; });

  // ---------- Takt ----------
  let last = performance.now(), acc = 0, n = 0;
  setInterval(() => {
    const now = performance.now();
    acc = Math.min(3, acc + (now - last) / 1000);
    last = now;
    while (acc >= 0.1) { tick(0.1); acc -= 0.1; }
    if (++n % 2 === 0) publish();
    if (++snapN >= 30) snapshot();
  }, 100);
  (function anim() {
    if (G.ph === 'result') { const p = Math.min(1, (performance.now() - replayT0) / 8000); drawReplay(0, p); drawReplay(1, p); }
    requestAnimationFrame(anim);
  })();
  addEventListener('resize', () => { if (G.ph === 'result') replayT0 = 0; });

  renderMain();
  publish();
}
