// Membran-Duell – Spiellogik (kein DOM, kein Netzwerk).
// x = Membranposition: -1 = Anschlag bei Team Blau, +1 = Anschlag bei Team Orange.
// Team Blau (0) drueckt nach +1, Team Orange (1) nach -1.

export const D = {
  REFILL: 0.8,     // s bis der Pumpenhebel wieder oben ist (voller Hub)
  MIN: 0.3,        // darunter stottert die Pumpe
  WIN: 0.25,       // Fensterbreite fuer den Gleichtakt-Bonus (s)
  ROUND: 30,       // Rundendauer (s)
  K: 0.8,          // Membran-Geschwindigkeit bei voller relativer Ueberlegenheit (1/s)
  TAU: 1.0,        // Glaettung der Teamkraft (s)
  LATE: 1.0,       // spaeter eintreffende Huebe zaehlen ohne Bonus (s)
};

export const EVENTS = {
  turbo: { dur: 5, label: 'TURBO!', sub: '5 Sekunden doppelter Druck für alle!' },
  leak: { dur: 4, label: 'LECK!', sub: 'Beim führenden Team geht Druck verloren!' },
  stoss: { dur: 0.6, label: 'DRUCKSTOSS!', sub: 'Die Membran wird zurückgeworfen!' },
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hubstaerke aus der Zeit seit dem letzten eigenen Hub
export function strength(since) {
  if (since < D.MIN) return 0.1;
  return Math.min(1, 0.1 + 0.9 * (since - D.MIN) / (D.REFILL - D.MIN));
}

export const multOf = (frac) => (frac >= 0.8 ? 2 : frac >= 0.6 ? 1.5 : frac >= 0.4 ? 1.25 : 1);

// Ereignisplan: 1-2 Ereignisse zwischen Sekunde 8 und 25
export function makeEvents(seed, round) {
  const r = rng(seed * 977 + round * 131 + 3);
  const kinds = ['turbo', 'leak', 'stoss'];
  const n = r() < 0.5 ? 1 : 2;
  const out = [];
  let t = 8 + r() * 6;
  for (let i = 0; i < n; i++) {
    out.push({ t: Math.round(t * 10) / 10, type: kinds[Math.floor(r() * kinds.length)] });
    t += 7 + r() * 5;
    if (t > 25) break;
  }
  return out;
}

// Zustand einer Runde. sizes = [aktive Blau, aktive Orange] wird laufend aktualisiert.
export function makeRound(seed, round, events = true) {
  return {
    t: 0, x: 0, v: 0, P: [0, 0], imp: [0, 0], ev: events ? makeEvents(seed, round) : [], evOn: null,
    win: [new Map(), new Map()], // Fenster-Index -> Set(uid)
    pending: [], best: [1, 1], mult: [1, 1], strokes: [0, 0], over: null,
  };
}

const evFactor = (R, k) => {
  const e = R.evOn;
  if (!e || R.t > e.t + EVENTS[e.type].dur) return 1;
  if (e.type === 'turbo') return 2;
  if (e.type === 'leak' && e.team === k) return 0.6;
  return 1;
};

// Ein Hub kommt beim Moderator an. t = Rundenzeit des Hubs (s), now = aktuelle Rundenzeit.
// Liefert die sofort wirksame Kraft (fuer Animation und Statistik).
export function addStroke(R, k, uid, t, s, active) {
  const f = evFactor(R, k);
  const base = s * f / Math.max(1, active);
  R.imp[k] += base;
  R.strokes[k]++;
  if (R.t - t <= D.LATE) {
    const w = Math.floor(t / D.WIN);
    let set = R.win[k].get(w);
    if (!set) R.win[k].set(w, (set = new Set()));
    set.add(uid);
    R.pending.push({ k, w, base });
  }
  return base;
}

// Zeitschritt. sizes = aktive Mitglieder je Team. Liefert {combos:[{k,mult}], event, over}
export function stepRound(R, dt, sizes) {
  const out = { combos: [], event: null };
  R.t += dt;
  // Ereignisse
  for (const e of R.ev) {
    if (e.t > R.t - dt && e.t <= R.t) {
      R.evOn = { ...e, team: R.x > 0 ? 0 : 1 }; // Leck trifft den Fuehrenden
      out.event = R.evOn;
      if (e.type === 'stoss') R.v -= R.x * 1.6;
    }
  }
  // Gleichtakt-Bonus fuer abgeschlossene Fenster nachreichen
  const done = Math.floor((R.t - 0.35) / D.WIN) - 1; // Fenster w ist fertig, wenn w+1 vorbei ist (+ Netzverzug)
  const rest = [];
  const bonus = [new Map(), new Map()];
  for (const p of R.pending) {
    if (p.w > done) { rest.push(p); continue; }
    let m = bonus[p.k].get(p.w);
    if (m === undefined) {
      const ids = new Set();
      for (const d of [-1, 0, 1]) { const s = R.win[p.k].get(p.w + d); if (s) s.forEach((u) => ids.add(u)); }
      m = multOf(ids.size / Math.max(1, sizes[p.k]));
      bonus[p.k].set(p.w, m);
      if (m > 1) out.combos.push({ k: p.k, mult: m });
    }
    R.imp[p.k] += p.base * (m - 1);
  }
  R.pending = rest;
  for (const k of [0, 1]) {
    for (const w of R.win[k].keys()) if (w < done - 3) R.win[k].delete(w);
    const ms = [...bonus[k].values()];
    if (ms.length) { R.mult[k] = Math.max(...ms); R.best[k] = Math.max(R.best[k], R.mult[k]); } else R.mult[k] = Math.max(1, R.mult[k] - dt);
  }
  // Teamkraft glaetten (Impulse pro Sekunde)
  const a = Math.min(1, dt / D.TAU);
  for (const k of [0, 1]) { R.P[k] += (R.imp[k] / dt - R.P[k]) * a; R.imp[k] = 0; }
  const sum = R.P[0] + R.P[1];
  const target = sum > 0.05 ? D.K * (R.P[0] - R.P[1]) / Math.max(sum, 0.6) : 0;
  R.v += (target - R.v) * Math.min(1, dt * 4);
  R.x += R.v * dt;
  if (R.x >= 1 || R.x <= -1) { R.x = Math.sign(R.x); R.over = { w: R.x > 0 ? 0 : 1, why: 'burst' }; }
  else if (R.t >= D.ROUND) R.over = Math.abs(R.x) < 0.05 ? { w: -1, why: 'draw' } : { w: R.x > 0 ? 0 : 1, why: 'time' };
  out.over = R.over;
  return out;
}

// Test-Bot: pumpt mit eigenem, leicht schwankendem Takt
export function botNext(bot, r, beat) {
  const per = bot.per || (bot.per = 0.75 + 0.35 * r());
  if (beat && r() < 0.6) return Math.ceil((bot.last + per * 0.9) / beat) * beat + (r() - 0.5) * 0.12;
  return bot.last + per * (0.85 + 0.3 * r());
}
