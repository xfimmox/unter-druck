// Unter Druck – Einstieg: entscheidet, welche Ansicht gezeigt wird.
//   …/?host            → Moderator/Beamer „Unter Druck“
//   …/?host=duell      → Moderator/Beamer „Membran-Duell“
//   …/?room=ABCD       → Teilnehmende
//   …/                 → Startbildschirm
import { connect } from './net.js';
import { esc, aip } from './fx.js';

const app = document.getElementById('app');
const q = new URLSearchParams(location.search);

function startScreen(msg = '') {
  app.innerHTML = `
    <div class="center"><div class="card">
      ${aip('xl')}
      <p class="sub">Workshop-Spiele: Unter Druck · Membran-Duell</p>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
      <form id="f">
        <label>Raumcode<input id="code" maxlength="4" autocomplete="off" placeholder="ABCD" autofocus></label>
        <button class="btn big">Mitspielen</button>
      </form>
      <p class="small">Spiel leiten: <a href="?host">Unter Druck</a> · <a href="?host=duell">Membran-Duell</a></p>
    </div></div>`;
  app.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    const c = app.querySelector('#code').value.trim().toUpperCase();
    if (c) location.search = '?room=' + encodeURIComponent(c);
  };
}

async function boot() {
  const room = (q.get('room') || '').trim().toUpperCase();
  if (!q.has('host') && !room) return startScreen();
  let db;
  try { db = await connect(); } catch (e) {
    console.error(e);
    return startScreen('Verbindung fehlgeschlagen. Internet/Firewall prüfen und Seite neu laden.');
  }
  if (db.demo) {
    const b = document.createElement('div');
    b.className = 'demo-banner';
    b.textContent = 'Demo-Modus ohne Firebase – funktioniert nur zwischen Tabs dieses Browsers';
    document.body.appendChild(b);
  }
  if (q.get('host') === 'duell') (await import('./duell-host.js')).startDuellHost(db, app);
  else if (q.has('host')) (await import('./host.js')).startHost(db, app);
  else {
    const game = await db.get(`rooms/${room}/meta/game`).catch(() => null);
    if (game === 'duell') (await import('./duell-player.js')).startDuellPlayer(db, room, app, startScreen);
    else (await import('./player.js')).startPlayer(db, room, app, startScreen);
  }
}

boot();
