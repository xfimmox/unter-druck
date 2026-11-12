// Unter Druck – Ansicht der Teilnehmenden: eigenes Manometer + eigenes Ventil.
import { CFG } from './sim.js';
import { TEAMS, fmtTime, esc, sfx, soundOn, toggleSound, confetti } from './fx.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export async function startPlayer(db, code, app, startScreen) {
  const base = `rooms/${code}`;
  const hostUid = await db.get(`${base}/host`).catch(() => null);
  if (!hostUid) return startScreen(`Raum „${code}“ nicht gefunden. Code prüfen.`);

  const me = `${base}/players/${db.uid}`;
  let meta = null, asg = null, st = null;
  let v = 0.5, vSent = -1, rid = -1, shownP = 5, lastMk = null, lastPhase = '', joined = false;

  app.innerHTML = `
  <div class="p-wrap" id="pw">
    <header class="p-head">
      <div class="p-team" id="pTeam">UNTER DRUCK</div>
      <div class="p-round" id="pRound"></div>
      <div class="p-timer" id="pTimer"></div>
      <div class="p-score" id="pScore"></div>
      <button class="btn ghost" id="pSnd" title="Ton an/aus"></button>
    </header>
    <main class="p-main">
      <div class="p-side" id="pPrev"></div>
      <div class="p-gauge"><canvas id="gauge"></canvas><div class="p-lock" id="pLock" hidden>MEMBRAN ÜBERLASTET!<small>Station kurz gesperrt …</small></div></div>
      <div class="p-valve">
        <div class="wheel" id="wheel" title="Im Kreis ziehen">
          <svg viewBox="-100 -100 200 200" id="wheelSvg">
            <circle r="86" class="w-ring"/><circle r="86" class="w-ring2"/>
            ${[0, 72, 144, 216, 288].map((a) => `<rect x="-7" y="-84" width="14" height="70" rx="5" class="w-spoke" transform="rotate(${a})"/>`).join('')}
            <circle r="24" class="w-hub"/><circle r="9" class="w-nut"/>
            <circle cx="0" cy="-86" r="9" class="w-mark"/>
          </svg>
        </div>
        <div class="p-open">Ventil-Öffnung <b id="pOpen">50 %</b></div>
        <div class="p-btns">
          <button class="btn steel" id="bZu">↻ Zu</button>
          <button class="btn steel" id="bAuf">Auf ↺</button>
        </div>
        <p class="p-hint" id="pHint"></p>
      </div>
      <div class="p-side" id="pNext"></div>
    </main>
    <div class="p-toast" id="pToast" hidden></div>
    <div class="p-overlay" id="pOv"></div>
  </div>`;
  const $ = (id) => app.querySelector('#' + id);
  const ov = $('pOv');

  // ---------- Beitritt / Wiederverbinden ----------
  const existing = await db.get(me).catch(() => null);
  if (existing && existing.name) join(existing.name);
  else {
    let saved = '';
    try { saved = localStorage.getItem('ud-name') || ''; } catch { /* egal */ }
    ov.innerHTML = `<div class="card"><h1 class="logo">UNTER <span>DRUCK</span></h1>
      <p class="sub">Raum ${esc(code)}</p>
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
      // Reihenfolge wichtig: Die Regeln lassen "online" erst zu, wenn der Eintrag mit Namen existiert.
      Promise.resolve(db.set(me, { name, online: true, ts: Date.now() })).then(() => db.onDisconnect(`${me}/online`, false));
    });
    db.get(`${base}/valves/${db.uid}`).then((x) => { if (typeof x === 'number' && rid < 0) v = x; }).catch(() => {});
    db.on(`${base}/meta`, (m) => { meta = m; render(); });
    db.on(`${base}/assign/${db.uid}`, (a) => { asg = a; render(); });
    db.on(`${base}/st/${db.uid}`, (s) => { st = s; onState(); });
    render();
  }

  // ---------- Zustand vom Moderator ----------
  function onState() {
    if (!st) return;
    if (st.rid !== rid) { rid = st.rid; v = st.vr; vSent = v; shownP = st.p; }
    if (st.mk !== lastMk) {
      if (lastMk !== null && st.m) toast(st.m, st.mt);
      lastMk = st.mk;
    }
    $('pLock').hidden = !st.lk;
    $('pw').dataset.s = st.s;
  }

  let toastT = 0;
  function toast(text, kind) {
    const t = $('pToast');
    t.textContent = text; t.dataset.k = kind; t.hidden = false;
    if (kind === 2) sfx.overload(); else if (kind === 1) sfx.alarm(); else sfx.ok();
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, 5000);
  }

  function render() {
    if (!joined) return;
    const ph = meta ? meta.ph : 'lobby';
    const T = asg ? TEAMS[asg.team] : null;
    $('pw').dataset.team = asg ? asg.team : '';
    $('pTeam').textContent = T ? `Team ${T.name} · Station ${asg.pos + 1} von ${asg.n}` : 'UNTER DRUCK';
    $('pRound').textContent = meta && ph !== 'lobby' && ph !== 'teams' ? meta.nm : '';
    $('pTimer').textContent = meta && (ph === 'run' || ph === 'count') ? fmtTime(meta.tl) : '';
    $('pScore').innerHTML = meta && meta.sc ? `<b class="c0">${meta.sc[0]}</b> : <b class="c1">${meta.sc[1]}</b>` : '';
    if (asg) {
      $('pPrev').innerHTML = `<span>▲ vor dir</span><b>${esc(asg.prev)}</b><small>${asg.pos === 0 ? 'drückt von vorne' : 'Station ' + asg.pos}</small>`;
      $('pNext').innerHTML = `<span>▼ nach dir</span><b>${esc(asg.next)}</b><small>${asg.pos === asg.n - 1 ? 'nimmt hinten ab' : 'Station ' + (asg.pos + 2)}</small>`;
      $('pHint').innerHTML = `<b>Auf:</b> dein Druck sinkt, bei <b>${esc(asg.next)}</b> steigt er.<br><b>Zu:</b> dein Druck steigt.`;
    }
    const where = asg ? `<p class="where">Station <b>${asg.pos + 1}</b> von ${asg.n} · vor dir <b>${esc(asg.prev)}</b> · nach dir <b>${esc(asg.next)}</b></p>` : '';
    let h = '';
    if (!meta || ph === 'lobby') h = `<h2>Du bist dabei!</h2><p>Gleich werden die Teams ausgelost …</p>`;
    else if (!asg) h = `<h2>Du bist dabei!</h2><p>Das Spiel läuft schon – du steigst zur nächsten Runde ein.</p>`;
    else if (ph === 'teams') h = `<p>Du spielst in</p><h2 class="tname">Team ${T.name}</h2><p class="go">Geh auf die <b>${T.side} Raumseite</b> und nimm deinen Laptop mit.</p>${where}
      <p class="rule">Halte dein Manometer im <b class="g">grünen Bereich</b>. Du siehst nur deine Messstelle – redet miteinander!</p>`;
    else if (ph === 'count') h = `<p>${esc(meta.nm)} startet in</p><h2 class="count">${meta.tl}</h2>${where}`;
    else if (ph === 'run' && meta.pz) h = `<h2>Pause</h2>`;
    else if (ph === 'result') h = `<h2>${esc(meta.nm)} vorbei</h2>${meta.rs ? `<p class="score"><b class="c0">${meta.rs[0]}</b> : <b class="c1">${meta.rs[1]}</b></p>` : '<p>Das war nur zum Üben – jetzt wird es ernst.</p>'}<p>Schau auf den Beamer für das Replay.</p>`;
    else if (ph === 'final') {
      const w = meta.sc[0] === meta.sc[1] ? -1 : meta.sc[0] > meta.sc[1] ? 0 : 1;
      h = `<h2 class="tname" data-w="${w}">${w < 0 ? 'Unentschieden!' : `Team ${TEAMS[w].name} gewinnt!`}</h2><p class="score"><b class="c0">${meta.sc[0]}</b> : <b class="c1">${meta.sc[1]}</b></p><p>${w === asg.team ? 'Glückwunsch – starke Teamleistung!' : 'Danke fürs Mitspielen!'}</p>`;
      if (lastPhase !== 'final' && w === asg.team) { confetti(); sfx.win(); }
    }
    if (ph === 'run' && lastPhase === 'count') sfx.go();
    if (ph === 'result' && lastPhase === 'run') sfx.end();
    lastPhase = ph;
    ov.innerHTML = h ? `<div class="card ovc" data-team="${asg ? asg.team : ''}">${h}</div>` : '';
    ov.hidden = !h;
  }

  // ---------- Ventil-Bedienung ----------
  const active = () => meta && meta.ph === 'run' && !meta.pz && st && !st.lk;
  const setV = (x) => { if (active()) v = clamp(x, 0, 1); };
  const wheel = $('wheel');
  let dragA = null;
  const ang = (e) => { const r = wheel.getBoundingClientRect(); return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2); };
  wheel.addEventListener('pointerdown', (e) => { dragA = ang(e); wheel.setPointerCapture(e.pointerId); e.preventDefault(); });
  wheel.addEventListener('pointermove', (e) => {
    if (dragA === null) return;
    const a = ang(e);
    let d = a - dragA;
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
    dragA = a;
    setV(v - d / (3 * Math.PI)); // 1,5 Umdrehungen gegen den Uhrzeigersinn = ganz auf
  });
  const endDrag = () => { dragA = null; };
  wheel.addEventListener('pointerup', endDrag);
  wheel.addEventListener('pointercancel', endDrag);
  const hold = (btn, d) => {
    let iv = 0;
    const stop = () => { clearInterval(iv); iv = 0; };
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); setV(v + d); stop(); iv = setInterval(() => setV(v + d), 110); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => btn.addEventListener(n, stop));
  };
  hold($('bAuf'), 0.03);
  hold($('bZu'), -0.03);
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { setV(v + 0.02); e.preventDefault(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { setV(v - 0.02); e.preventDefault(); }
  });
  setInterval(() => {
    const r = Math.round(v * 1000) / 1000;
    if (joined && rid >= 0 && r !== vSent) { vSent = r; db.set(`${base}/valves/${db.uid}`, r); }
  }, 100);

  const snd = $('pSnd');
  const sndLabel = () => { snd.textContent = soundOn() ? '🔊' : '🔇'; };
  snd.onclick = () => { toggleSound(); sndLabel(); };
  sndLabel();

  // ---------- Zeichnen ----------
  const cv = $('gauge');
  const g = cv.getContext('2d');
  const A0 = 0.75 * Math.PI, SW = 1.5 * Math.PI; // 270-Grad-Skala
  const aOf = (bar) => A0 + SW * clamp(bar / CFG.PMAX, 0, 1);
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const box = cv.parentElement.getBoundingClientRect();
    const size = Math.floor(Math.min(box.width, box.height));
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(size * dpr)) { cv.width = cv.height = Math.round(size * dpr); cv.style.width = cv.style.height = size + 'px'; }
    if (st) shownP += (st.p - shownP) * Math.min(1, dt * 9);
    drawGauge(size * dpr);
    $('wheelSvg').style.transform = `rotate(${-v * 540}deg)`;
    $('pOpen').textContent = Math.round(v * 100) + ' %';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function arc(R, w, from, to, color) {
    g.beginPath(); g.arc(0, 0, R, aOf(from), aOf(to)); g.lineWidth = w; g.strokeStyle = color; g.stroke();
  }
  function drawGauge(S) {
    const R = S / 2;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);
    g.translate(R, R);
    // Gehaeuse aus Edelstahl
    let gr = g.createLinearGradient(-R, -R, R, R);
    gr.addColorStop(0, '#f2f5f7'); gr.addColorStop(0.35, '#8d979f'); gr.addColorStop(0.6, '#dfe5e9'); gr.addColorStop(1, '#5d666e');
    g.beginPath(); g.arc(0, 0, R * 0.98, 0, 7); g.fillStyle = gr; g.fill();
    g.beginPath(); g.arc(0, 0, R * 0.9, 0, 7); g.fillStyle = '#fbfbf7'; g.fill();
    g.lineWidth = R * 0.012; g.strokeStyle = '#3a4046'; g.stroke();
    // Farbbereiche
    const t = st ? st.t : 5;
    const RB = R * 0.74, WB = R * 0.1;
    g.lineCap = 'butt';
    arc(RB, WB, 0, CFG.PMAX, '#e5383b');
    arc(RB, WB, t - CFG.YELLOW, t + CFG.YELLOW, '#f5c211');
    arc(RB, WB, t - CFG.GREEN, t + CFG.GREEN, '#2ecc71');
    const ovl = Math.min(CFG.PMAX, t + CFG.OVER);
    arc(RB, WB, ovl, CFG.PMAX, '#5a0b0d');
    // Skala
    g.fillStyle = '#20252a'; g.strokeStyle = '#20252a';
    g.font = `600 ${R * 0.085}px system-ui, "Segoe UI", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let b = 0; b <= CFG.PMAX * 2; b++) {
      const a = aOf(b / 2), major = b % 2 === 0;
      const r1 = R * 0.86, r2 = R * (major ? 0.795 : 0.825);
      g.beginPath(); g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      g.lineWidth = R * (major ? 0.014 : 0.007); g.stroke();
      if (major) g.fillText(String(b / 2), Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6);
    }
    g.font = `600 ${R * 0.075}px system-ui, "Segoe UI", sans-serif`;
    g.fillStyle = '#59636b';
    g.fillText('bar', 0, -R * 0.3);
    g.font = `${R * 0.055}px system-ui, "Segoe UI", sans-serif`;
    g.fillText(asg ? `Druckmittler · Station ${asg.pos + 1}` : 'Druckmittler', 0, R * 0.3);
    // Digitalanzeige
    const sCol = ['#2ecc71', '#f5c211', '#ff5a5d'][st ? st.s : 0];
    g.fillStyle = '#14181d';
    const bw = R * 0.5, bh = R * 0.2;
    g.beginPath(); g.roundRect(-bw / 2, R * 0.42, bw, bh, R * 0.03); g.fill();
    g.fillStyle = sCol;
    g.font = `700 ${R * 0.14}px ui-monospace, Consolas, monospace`;
    g.fillText(shownP.toFixed(1).replace('.', ','), 0, R * 0.42 + bh / 2 + R * 0.005);
    // Zeiger
    const a = aOf(shownP);
    g.save(); g.rotate(a);
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = R * 0.03; g.shadowOffsetY = R * 0.01;
    g.beginPath(); g.moveTo(-R * 0.14, -R * 0.022); g.lineTo(R * 0.78, 0); g.lineTo(-R * 0.14, R * 0.022); g.closePath();
    g.fillStyle = '#c1121f'; g.fill();
    g.restore();
    gr = g.createRadialGradient(-R * 0.02, -R * 0.02, 0, 0, 0, R * 0.08);
    gr.addColorStop(0, '#eef1f3'); gr.addColorStop(1, '#5d666e');
    g.beginPath(); g.arc(0, 0, R * 0.07, 0, 7); g.fillStyle = gr; g.fill();
  }
}
