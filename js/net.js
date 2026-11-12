// Unter Druck – Netzwerkschicht.
// Mit Firebase-Konfiguration (config.js): Firebase Realtime Database + anonyme Anmeldung.
// Ohne Konfiguration: Demo-Modus, der nur zwischen Tabs desselben Browsers synchronisiert.
//
// Einheitliche Schnittstelle:
//   db.uid, db.demo
//   db.set(path, value)            – Wert schreiben (null = loeschen)
//   db.update(path, {key: value})  – mehrere Unterpfade auf einmal (key darf "a/b" sein)
//   db.get(path)                   – einmal lesen
//   db.on(path, cb)                – auf Aenderungen hoeren, liefert Abmelde-Funktion
//   db.onDisconnect(path, value)   – Wert, der beim Verbindungsabbruch gesetzt wird
//   db.onConnected(cb)             – cb(true/false) bei Verbindungswechsel

const FB_VERSION = '10.12.2';

export async function connect() {
  const cfg = window.UD_CONFIG;
  return cfg && cfg.databaseURL ? firebaseBackend(cfg) : demoBackend();
}

async function firebaseBackend(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [appM, authM, m] = await Promise.all([
    import(base + 'firebase-app.js'),
    import(base + 'firebase-auth.js'),
    import(base + 'firebase-database.js'),
  ]);
  const app = appM.initializeApp(cfg);
  const cred = await authM.signInAnonymously(authM.getAuth(app));
  const d = m.getDatabase(app);
  const R = (p) => m.ref(d, p);
  const warn = (what) => (e) => console.warn(`Firebase (${what}):`, e.message || e);
  return {
    uid: cred.user.uid,
    demo: false,
    set: (p, v) => m.set(R(p), v).catch(warn('set ' + p)),
    update: (p, o) => m.update(R(p), o).catch(warn('update ' + p)),
    get: async (p) => (await m.get(R(p))).val(),
    on: (p, cb) => m.onValue(R(p), (s) => cb(s.val()), warn('lesen ' + p)),
    onDisconnect: (p, v) => m.onDisconnect(R(p)).set(v).catch(warn('onDisconnect ' + p)),
    onConnected: (cb) => m.onValue(R('.info/connected'), (s) => cb(!!s.val())),
  };
}

function demoBackend() {
  const KEY = 'ud-demo-tree';
  let tree = {};
  try { tree = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* leer starten */ }
  let uid = null;
  try {
    uid = sessionStorage.getItem('ud-uid');
    if (!uid) { uid = 'd' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('ud-uid', uid); }
  } catch { uid = 'd' + Math.random().toString(36).slice(2, 10); }
  const ch = 'BroadcastChannel' in window ? new BroadcastChannel('ud-demo') : null;
  const listeners = new Set();
  const disc = [];
  const parts = (p) => p.split('/').filter(Boolean);
  const read = (p) => {
    let n = tree;
    for (const k of parts(p)) { if (n == null || typeof n !== 'object') return null; n = n[k]; }
    return n === undefined ? null : n;
  };
  const write = (p, v) => {
    const ks = parts(p);
    let n = tree;
    for (let i = 0; i < ks.length - 1; i++) {
      if (n[ks[i]] == null || typeof n[ks[i]] !== 'object') { if (v === null) return; n[ks[i]] = {}; }
      n = n[ks[i]];
    }
    if (v === null) delete n[ks[ks.length - 1]]; else n[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  let saveT = 0;
  const save = () => {
    if (saveT) return;
    saveT = setTimeout(() => { saveT = 0; try { localStorage.setItem(KEY, JSON.stringify(tree)); } catch { /* egal */ } }, 400);
  };
  const notify = (p) => {
    for (const l of listeners) {
      if (p !== null && !(p.startsWith(l.path) || l.path.startsWith(p))) continue;
      const val = read(l.path);
      const js = JSON.stringify(val);
      if (js === l.last) continue;
      l.last = js;
      queueMicrotask(() => l.cb(val === null ? null : JSON.parse(js)));
    }
  };
  const apply = (ws, local) => {
    for (const [p, v] of ws) write(p, v);
    if (local && ch) ch.postMessage({ t: 'w', ws });
    for (const [p] of ws) notify(p);
    save();
  };
  if (ch) {
    ch.onmessage = (e) => {
      const msg = e.data;
      if (msg.t === 'w') apply(msg.ws, false);
      else if (msg.t === 'hello' && Object.keys(tree).length) ch.postMessage({ t: 'tree', tree });
      else if (msg.t === 'tree') { tree = msg.tree; notify(null); }
    };
    ch.postMessage({ t: 'hello' });
  }
  addEventListener('pagehide', () => { if (disc.length) apply(disc, true); try { localStorage.setItem(KEY, JSON.stringify(tree)); } catch { /* egal */ } });
  return {
    uid,
    demo: true,
    set: async (p, v) => apply([[p, v]], true),
    update: async (p, o) => apply(Object.entries(o).map(([k, v]) => [p + '/' + k, v]), true),
    get: async (p) => { await new Promise((r) => setTimeout(r, 150)); return read(p); },
    on: (p, cb) => {
      const l = { path: p, cb, last: undefined };
      listeners.add(l);
      const val = read(p);
      l.last = JSON.stringify(val);
      queueMicrotask(() => cb(val));
      return () => listeners.delete(l);
    },
    onDisconnect: async (p, v) => { disc.push([p, v]); },
    onConnected: (cb) => { queueMicrotask(() => cb(true)); },
  };
}
