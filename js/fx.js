// Unter Druck – kleine Effekte: Toene, Konfetti, HTML-Helfer.

export const TEAMS = [
  { name: 'Blau', side: 'linke', color: '#2f8fff' },
  { name: 'Orange', side: 'rechte', color: '#ff8a1f' },
];
export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

let ctx = null;
let on = true;
try { on = localStorage.getItem('ud-sound') !== '0'; } catch { /* Standard: an */ }

export const soundOn = () => on;
export function toggleSound() {
  on = !on;
  try { localStorage.setItem('ud-sound', on ? '1' : '0'); } catch { /* egal */ }
  return on;
}

// Browser erlauben Ton erst nach einer Nutzeraktion.
addEventListener('pointerdown', () => {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* kein Ton */ } }
  if (ctx && ctx.state === 'suspended') ctx.resume();
}, { passive: true });

export function beep(freq = 660, dur = 0.12, type = 'sine', vol = 0.12, delay = 0) {
  if (!on || !ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  alarm: () => { beep(880, 0.1, 'square', 0.07); beep(660, 0.14, 'square', 0.07, 0.12); },
  ok: () => beep(520, 0.1, 'sine', 0.08),
  overload: () => { beep(140, 0.5, 'sawtooth', 0.14); beep(100, 0.5, 'sawtooth', 0.12, 0.1); },
  tick: () => beep(440, 0.08, 'sine', 0.1),
  go: () => beep(880, 0.35, 'sine', 0.14),
  end: () => { beep(660, 0.2, 'triangle', 0.14); beep(440, 0.45, 'triangle', 0.14, 0.2); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.3, 'triangle', 0.13, i * 0.14)),
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function confetti(colors = ['#2f8fff', '#ff8a1f', '#f5c211', '#2ecc71', '#ffffff']) {
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.appendChild(c);
  const g = c.getContext('2d');
  const W = (c.width = innerWidth), H = (c.height = innerHeight);
  const ps = Array.from({ length: 220 }, () => ({
    x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
    s: 5 + Math.random() * 7, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.3, c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(now) {
    g.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); g.restore();
    }
    if (now - t0 < 7000) requestAnimationFrame(frame); else c.remove();
  })(t0);
}
