// Membran-Duell – Einstieg: entscheidet, welche Ansicht gezeigt wird.
//   …/?host            → Moderator/Beamer (auch ?host=duell)
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
      <h1 class="logo">MEMBRAN-<span>DUELL</span></h1>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
      <form id="f">
        <label>Raumcode<input id="code" maxlength="4" autocomplete="off" placeholder="ABCD" autofocus></label>
        <button class="btn big">Mitspielen</button>
      </form>
      <p class="small"><a href="?host">Ich leite das Spiel (Moderator)</a></p>
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
  if (q.has('host')) (await import('./duell-host.js')).startDuellHost(db, app);
  else (await import('./duell-player.js')).startDuellPlayer(db, room, app, startScreen);
}

boot();
