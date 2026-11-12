// Unter Druck – Simulation (reine Logik, kein DOM, kein Netzwerk).
// Eine Rohrleitungs-Kette pro Team: Pumpe -> Station 1 -> ... -> Station N -> Verbraucher.
// Station i besitzt das Ventil zwischen sich und dem Nachfolger:
// Oeffnen senkt den eigenen Druck und hebt den des Nachfolgers.

export const CFG = {
  PS: 9,        // Pumpendruck im Normalbetrieb (bar)
  POUT: 1,      // Gegendruck am Verbraucher (bar)
  P1: 7,        // Solldruck der ersten Station
  GREEN: 0.4,   // +/- bar um den Sollwert = gruen
  YELLOW: 1.0,  // +/- bar = gelb, darueber rot
  OVER: 2.5,    // so viel ueber Soll: Membran ueberlastet
  PMAX: 10,     // Skalenende
  LOCK: 3,      // Sperrzeit nach Ueberlast (s)
  HIST_DT: 0.5, // Abtastung fuer das Replay (s)
};

export const ROUNDS = [
  { name: 'Proberunde', dur: 60, gap: 13, amp: 0.6, scored: false },
  { name: 'Runde 1', dur: 90, gap: 11, amp: 0.8, scored: true },
  { name: 'Runde 2', dur: 90, gap: 8.5, amp: 1.0, scored: true },
  { name: 'Runde 3', dur: 90, gap: 6.5, amp: 1.2, scored: true },
];

// Globale Stoerungen (Pumpe, Verbraucher) bleiben bis zur naechsten gleichen Art bestehen,
// lokale (Temperatur, Leckage, Verstopfung) dauern "dur" Sekunden und enden dann wieder.
export const EVENT_INFO = {
  pumpUp: { label: 'Pumpe dreht hoch', msg: 'Pumpe dreht hoch – vorne steigt der Druck!' },
  pumpDown: { label: 'Pumpe drosselt', msg: 'Pumpe drosselt – vorne fällt der Druck!' },
  consUp: { label: 'Verbraucher schaltet zu', msg: 'Verbraucher schaltet zu – hinten wird abgesaugt!' },
  consDown: { label: 'Verbraucher schaltet ab', msg: 'Verbraucher schaltet ab – hinten staut es sich!' },
  temp: { dur: 16, label: 'Temperatursprung', msg: 'Temperatursprung – deine Füllflüssigkeit dehnt sich aus!', end: 'Temperatur wieder normal.' },
  leak: { dur: 16, label: 'Leckage', msg: 'Leckage an deiner Messstelle – Druck entweicht!', end: 'Leck abgedichtet.' },
  clog: { dur: 14, label: 'Verstopfung', msg: 'Verstopfung – dein Ventil wirkt nur noch halb!', end: 'Ventil wieder frei.' },
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

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// Stoerungsplan einer Runde. Identisch fuer beide Teams (gleicher Seed).
// f = Position in der Kette als Anteil 0..1, damit es bei ungleichen Teamgroessen passt.
export function makeSchedule(round, seed) {
  const R = ROUNDS[round];
  const r = rng(seed * 7919 + round * 104729 + 1);
  const kinds = ['pump', 'cons', 'temp', 'leak', 'clog', 'temp', 'leak'];
  const ev = [];
  let t = 4, last = '', ps = CFG.PS, po = CFG.POUT;
  while (t < R.dur - 8) {
    let kind;
    do kind = kinds[Math.floor(r() * kinds.length)]; while (kind === last);
    last = kind;
    const e = { t: Math.round(t * 10) / 10, f: 0.08 + 0.84 * r(), amp: R.amp * (0.85 + 0.3 * r()) };
    if (kind === 'pump') {
      const d = 1.2 * e.amp;
      const up = ps + d > 10.6 ? false : ps - d < 7.8 ? true : r() < 0.5;
      ps += up ? d : -d;
      e.type = up ? 'pumpUp' : 'pumpDown'; e.level = ps;
    } else if (kind === 'cons') {
      const d = 0.6 * e.amp;
      const down = po - d < 0 ? false : po + d > 1.3 ? true : r() < 0.5; // "zu" = Druck hinten faellt
      po += down ? -d : d;
      e.type = down ? 'consUp' : 'consDown'; e.level = po;
    } else { e.type = kind; e.dur = EVENT_INFO[kind].dur; }
    ev.push(e);
    t += R.gap * (0.7 + 0.6 * r());
  }
  return ev;
}

// Neue Anlage fuer ein Team mit n Stationen.
export function makeTeam(n, round, seed) {
  const r = rng(seed * 31337 + round * 613 + 7);
  // Druckabfall je Ventil: zufaellig gewichtet, Summe = P1 - POUT
  const w = [];
  let ws = 0;
  for (let i = 0; i < n; i++) { const x = i === n - 1 ? 1.25 : 0.75 + 0.5 * r(); w.push(x); ws += x; }
  const span = CFG.P1 - CFG.POUT;
  const Q = 0.5 * span / n;              // so liegt die Normalstellung der Ventile um 50 %
  const tgt = [], v0 = [];
  let p = CFG.P1;
  for (let i = 0; i < n; i++) { const d = span * w[i] / ws; tgt.push(p); v0.push(Q / d); p -= d; }
  // Zeitkonstante je Kettenlaenge normieren, damit 8..12 Stationen sich gleich anfuehlen
  const tau1 = clamp(0.6 * (10 / n) ** 2, 0.3, 1.4);
  return {
    n, round, t: 0, Q, G0: Q / (CFG.PS - CFG.P1), C: 0.5 * tau1,
    p: tgt.slice(), tgt, v: v0.slice(), v0,
    lock: new Array(n).fill(0), green: new Array(n).fill(0),
    score: 0, hist: [], histT: 0, overloads: 0,
  };
}

const AMP_L = 0.65; // Staerke von Leckage/Temperatursprung als Anteil des Durchflusses
const isLocal = (e) => e.dur !== undefined;
export const stationOf = (ev, n) => Math.min(n - 1, Math.floor(ev.f * n));

// Welche Stationen bekommen die Meldung zu einer Stoerung?
export function affected(ev, n) {
  if (ev.type.startsWith('pump')) return n > 2 ? [0, 1] : [0];
  if (ev.type.startsWith('cons')) return n > 2 ? [n - 1, n - 2] : [n - 1];
  return [stationOf(ev, n)];
}

// 0 = gruen, 1 = gelb, 2 = rot
export function status(T, i) {
  if (T.lock[i] > 0) return 2;
  const d = Math.abs(T.p[i] - T.tgt[i]);
  return d <= CFG.GREEN ? 0 : d <= CFG.YELLOW ? 1 : 2;
}

// Einen Zeitschritt rechnen. Liefert neu gestartete/beendete Stoerungen und Ueberlast-Stationen.
export function step(T, dt, sched, scored) {
  const n = T.n, t0 = T.t, t1 = t0 + dt;
  const started = [], ended = [];
  let ps = CFG.PS, po = CFG.POUT;
  const src = new Array(n).fill(0), eff = new Array(n).fill(1);
  for (const e of sched) {
    if (e.t > t1) break;
    if (e.t > t0) started.push(e);
    const x = t1 - e.t;
    if (!isLocal(e)) {
      const a = Math.min(1, x / 1.5);
      if (e.type.startsWith('pump')) ps += (e.level - ps) * a; else po += (e.level - po) * a;
      continue;
    }
    if (e.t + e.dur > t0 && e.t + e.dur <= t1) ended.push(e);
    const a = x < 1.5 ? x / 1.5 : x < e.dur ? 1 : Math.max(0, 1 - (x - e.dur) / 1.5);
    if (!a) continue;
    const k = stationOf(e, n);
    if (e.type === 'temp') src[k] += AMP_L * e.amp * a * T.Q;
    else if (e.type === 'leak') src[k] -= AMP_L * e.amp * a * T.Q;
    else eff[k] *= 1 - 0.5 * a;
  }
  const SUB = 5, h = dt / SUB, p = T.p;
  for (let s = 0; s < SUB; s++) {
    let qin = T.G0 * (ps - p[0]);
    const np = new Array(n);
    for (let i = 0; i < n; i++) {
      const down = i < n - 1 ? p[i + 1] : po;
      const qout = T.v[i] * eff[i] * (p[i] - down);
      np[i] = p[i] + h * (qin - qout + src[i]) / T.C;
      qin = qout;
    }
    for (let i = 0; i < n; i++) p[i] = Math.max(0, np[i]);
  }
  const over = [];
  let greens = 0;
  for (let i = 0; i < n; i++) {
    if (T.lock[i] > 0) {
      T.lock[i] = Math.max(0, T.lock[i] - dt);
      p[i] = T.tgt[i]; // gesperrte Station wird auf Mitte gehalten
    } else if (p[i] > Math.min(CFG.PMAX, T.tgt[i] + CFG.OVER)) {
      T.lock[i] = CFG.LOCK; p[i] = T.tgt[i]; T.overloads++; over.push(i);
    }
    if (status(T, i) === 0) { greens++; if (scored) T.green[i] += dt; }
  }
  if (scored) T.score += dt * (10 * greens / n + (greens === n ? 5 : 0));
  T.t = t1;
  T.histT += dt;
  if (T.histT >= CFG.HIST_DT - 1e-9) {
    T.histT = 0;
    T.hist.push(p.map((x, i) => (T.lock[i] > 0 ? 99 : Math.round((x - T.tgt[i]) * 100) / 100)));
  }
  return { started, ended, over };
}

// "Automatik" fuer verwaiste Stationen: gedaempfter PI-Regler, haelt die Mitte.
export function autoStep(T, i, dt) {
  const err = T.p[i] - T.tgt[i];
  const pe = T.pe || (T.pe = new Array(T.n).fill(0));
  T.v[i] = clamp(T.v[i] + 0.05 * err * dt + 0.3 * (err - pe[i]), 0.03, 1);
  pe[i] = err;
}

// Test-Bots: regeln wie Menschen – verzoegert, ungenau und manchmal gar nicht.
export function botStep(T, i, bot, r) {
  if (T.t < bot.next) return;
  const wait = 0.5 + 1.0 * r();
  bot.next = T.t + wait;
  const err = T.p[i] - T.tgt[i];
  const d = err - (bot.pe || 0);
  bot.pe = err;
  if (r() < 0.15 || Math.abs(err) < 0.15) return;
  T.v[i] = clamp(T.v[i] + clamp((0.06 * err * wait + 0.22 * d) * (0.5 + r()), -0.15, 0.15), 0.03, 1);
}
