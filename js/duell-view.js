// Membran-Duell – Arena-Zeichnung (Canvas). Wird vom Beamer UND von den Teilnehmenden genutzt.
//   const v = createView(canvas, { sound: true })
//   v.set({ ph, teams: [[{name, active, me}], …], x, P: [blau, orange], turbo, rw, countN })
//   v.pump(k, i, s)   – Pumpe i von Team k macht einen Hub (s = Staerke 0..1)
//   v.combo(k, mult)  – Combo-Einblendung
//   v.event(e)        – Ereignis {type, team}
//   v.burst(w)        – Membran platzt zugunsten von Team w
import { D, EVENTS } from './duell-sim.js';
import { TEAMS, beep } from './fx.js';

const COL = ['#3d8fe0', '#ff8a1f'];
const COL2 = ['#0a3d8f', '#b04f00'];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const FONT = 'system-ui, "Segoe UI", sans-serif';

export function createView(cv, opts = {}) {
  const g = cv.getContext('2d');
  const st = { ph: 'teams', teams: [[], []], x: 0, P: [0, 0], turbo: false, rw: null, countN: null };
  const parts = [], pops = [], anim = [[], []];
  let W = 0, H = 0, dpr = 1, S = 1, xs = 0, shake = 0, banner = null, burstAt = -1, burstW = -1, sirenAt = 0, countAt = 0, lastCombo = [0, 0];
  const pumpPos = [[], []];
  const cracks = Array.from({ length: 9 }, () => ({ u: 0.1 + 0.8 * Math.random(), len: 20 + Math.random() * 45, a: (Math.random() - 0.5) * 1.4, b: Math.random() }));

  function resize() {
    const b = cv.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = b.width; H = b.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    S = clamp(Math.min(W / 1100, H / 620), 0.42, 1.25);
  }
  function geo() {
    const vw = Math.min(W * 0.46, H * 1.15), vh = Math.min(H * 0.5, vw * 0.62);
    const cx = W / 2, cy = H * 0.57;
    const L = cx - vw / 2, R = cx + vw / 2, T = cy - vh / 2, B = cy + vh / 2;
    return { vw, vh, cx, cy, L, R, T, B, chamber: [(L + cx) / 2, (cx + R) / 2] };
  }
  function spark(x, y, c, sp) {
    const a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random());
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp * 0.4, life: 1, c, r: (2 + Math.random() * 3) * Math.max(0.6, S), g: 0.25 };
  }
  const say = (fn) => { if (opts.sound) fn(); };

  const api = {
    set(s) {
      if (s.countN !== undefined && s.countN !== st.countN && s.countN !== null) countAt = performance.now();
      if (s.ph && s.ph !== 'burst' && st.ph === 'burst') burstAt = -1;
      Object.assign(st, s);
    },
    pump(k, i, s) {
      anim[k][i] = performance.now();
      const p = pumpPos[k][i];
      if (p) for (let j = 0; j < 2 + s * 4; j++) parts.push(spark(p.x, p.y - p.h * 0.6, COL[k], 3 * S));
    },
    combo(k, m) {
      const now = performance.now();
      if (now - lastCombo[k] < 700 && m < 2) return;
      lastCombo[k] = now;
      pops.push({ k, txt: m >= 2 ? 'COMBO ×2!' : `COMBO ×${String(m).replace('.', ',')}`, t: now, big: m >= 2 });
      if (m >= 2) { say(() => { beep(784, 0.12, 'triangle', 0.1); beep(1047, 0.18, 'triangle', 0.1, 0.1); }); shake = Math.max(shake, 6 * S); }
      else say(() => beep(660, 0.1, 'triangle', 0.07));
      if (W) { const L = geo(); for (let i = 0; i < 30 * (m - 0.5); i++) parts.push(spark(L.chamber[k], L.cy, COL[k], 7 * S)); }
    },
    event(e) {
      banner = { e, t: performance.now() };
      if (e.type === 'stoss') shake = 22 * S;
    },
    burst(w) {
      burstAt = performance.now(); burstW = w;
      if (w >= 0) {
        shake = 26 * S;
        say(() => { beep(70, 0.9, 'sawtooth', 0.22); beep(45, 1.2, 'square', 0.16, 0.05); beep(900, 0.25, 'triangle', 0.08); });
      }
    },
  };

  function frame(nowMs) {
    const b = cv.getBoundingClientRect();
    if (Math.round(b.width) !== Math.round(W) || Math.round(b.height) !== Math.round(H)) resize();
    const now = nowMs / 1000;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!W || !H || st.ph === 'lobby') { requestAnimationFrame(frame); return; }
    const L = geo();
    xs += (st.x - xs) * 0.12;
    if (st.ph === 'run' && Math.abs(xs) > 0.8) shake = Math.max(shake, (3 + (Math.abs(xs) - 0.8) * 25) * S);
    shake *= 0.9;
    g.save();
    g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    const burst = burstAt >= 0 && burstW >= 0 ? (nowMs - burstAt) / 1000 : -1;
    drawPumps(L);
    drawVessel(L, now, burst);
    drawGauges(L, now);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life -= p.fade || 0.025;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.c;
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    if (parts.length > 900) parts.splice(0, parts.length - 900);
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i], a = (nowMs - p.t) / 1000;
      if (a > 1.2) { pops.splice(i, 1); continue; }
      const sc = (a < 0.15 ? a / 0.15 * 1.3 : 1.3 - Math.min(0.3, a - 0.15)) * S;
      g.save();
      g.translate(L.chamber[p.k], L.T + L.vh * 0.28 - a * 40 * S);
      g.scale(sc, sc);
      g.globalAlpha = a > 0.8 ? (1.2 - a) / 0.4 : 1;
      g.font = `900 ${p.big ? 46 : 32}px ${FONT}`;
      g.textAlign = 'center'; g.lineWidth = 6; g.strokeStyle = '#0d1014'; g.strokeText(p.txt, 0, 0);
      g.fillStyle = p.big ? '#fff35c' : COL[p.k]; g.fillText(p.txt, 0, 0);
      g.restore();
    }
    g.restore();
    if (banner) drawBanner(nowMs);
    if (st.ph === 'count' && st.countN !== null) drawText(st.countN > 0 ? String(st.countN) : 'PUMPEN!', st.countN > 0 ? '#ffffff' : '#ffd23f', H * 0.3, 150, Math.min(1, (nowMs - countAt) / 1000));
    if (st.ph === 'burst' && st.rw && burstAt >= 0) {
      const a = (nowMs - burstAt) / 1000;
      if (a < 0.25 && st.rw.w >= 0) { g.fillStyle = `rgba(255,255,255,${0.9 * (1 - a / 0.25)})`; g.fillRect(0, 0, W, H); }
      if (a > 0.5) {
        const txt = st.rw.w < 0 ? 'UNENTSCHIEDEN!' : `TEAM ${TEAMS[st.rw.w].name.toUpperCase()} GEWINNT DIE RUNDE!`;
        g.save(); g.translate(W / 2, H * 0.14);
        const sc = Math.min(1, (a - 0.5) / 0.25) * (1 + 0.06 * Math.sin(a * 8));
        g.font = `900 64px ${FONT}`;
        const fit = Math.min(1.2 * S, (W * 0.92) / g.measureText(txt).width);
        g.scale(sc * fit, sc * fit);
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 10; g.strokeStyle = '#0d1014'; g.strokeText(txt, 0, 0);
        g.fillStyle = st.rw.w < 0 ? '#fff' : COL[st.rw.w]; g.fillText(txt, 0, 0);
        g.restore();
      }
    }
    if (opts.sound && st.ph === 'run' && Math.abs(xs) > 0.82 && nowMs - sirenAt > 900) { sirenAt = nowMs; beep(980, 0.18, 'square', 0.05); beep(740, 0.18, 'square', 0.05, 0.2); }
    requestAnimationFrame(frame);
  }

  function drawText(txt, color, y, size, f) {
    g.save(); g.translate(W / 2, y);
    const sc = (0.6 + f * 0.6) * S; g.scale(sc, sc); g.globalAlpha = Math.min(1, (1 - f) * 2.5 + 0.2);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${size}px ${FONT}`;
    g.lineWidth = 12; g.strokeStyle = '#0d1014'; g.strokeText(txt, 0, 0); g.fillStyle = color; g.fillText(txt, 0, 0);
    g.restore();
  }

  function drawBanner(nowMs) {
    const a = (nowMs - banner.t) / 1000;
    if (a > 2.6) { banner = null; return; }
    const E = EVENTS[banner.e.type], t = banner.e.type;
    const sc = (a < 0.2 ? 0.5 + a / 0.2 * 0.6 : 1.1 - Math.min(0.1, a - 0.2)) * S;
    g.save(); g.globalAlpha = a > 2.1 ? (2.6 - a) / 0.5 : 1;
    g.fillStyle = t === 'turbo' ? 'rgba(255,200,0,.22)' : t === 'leak' ? 'rgba(255,60,60,.2)' : 'rgba(255,255,255,.15)';
    g.fillRect(0, H * 0.05, W, 120 * S);
    g.translate(W / 2, H * 0.05 + 62 * S); g.scale(sc, sc);
    g.textAlign = 'center'; g.font = `900 64px ${FONT}`;
    g.lineWidth = 8; g.strokeStyle = '#0d1014'; g.strokeText(E.label, 0, 0);
    g.fillStyle = t === 'turbo' ? '#ffd23f' : t === 'leak' ? '#ff5a5d' : '#ffffff'; g.fillText(E.label, 0, 0);
    g.font = `600 22px ${FONT}`; g.fillStyle = '#e8edf1';
    g.fillText(t === 'leak' ? `Team ${TEAMS[banner.e.team].name} verliert Druck!` : E.sub, 0, 38);
    g.restore();
  }

  function drawPumps(L) {
    for (const k of [0, 1]) {
      const list = st.teams[k] || [];
      pumpPos[k] = [];
      if (!list.length) continue;
      const areaL = k === 0 ? 10 : L.R + 34 * S, areaR = k === 0 ? L.L - 34 * S : W - 10;
      const aw = areaR - areaL, top = L.T - 30 * S, ah = L.B + 60 * S - top;
      const cols = Math.max(1, Math.min(list.length, Math.floor(aw / (72 * S)), Math.ceil(list.length / Math.max(1, Math.floor(ah / (100 * S))))));
      const rows = Math.ceil(list.length / cols);
      const cw = aw / cols, rh = Math.min(140 * S, ah / rows);
      const ph = Math.min(rh * 0.68, cw * 1.1);
      g.strokeStyle = '#59636b'; g.lineWidth = 10 * S; g.lineCap = 'round';
      g.beginPath(); g.moveTo(k === 0 ? areaL + 10 : areaR - 10, top + rows * rh - 6); g.lineTo(k === 0 ? areaR + 20 * S : areaL - 20 * S, top + rows * rh - 6); g.lineTo(k === 0 ? L.L : L.R, L.cy + L.vh * 0.32); g.stroke();
      list.forEach((p, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const x = areaL + cw * (c + 0.5), yb = top + rh * r + ph;
        pumpPos[k][i] = { x, y: yb, h: ph };
        const w = Math.min(cw * 0.5, ph * 0.42);
        const d = (performance.now() - (anim[k][i] || -1e9)) / 1000;
        const down = d < 0.08 ? d / 0.08 : Math.max(0, 1 - (d - 0.08) / (D.REFILL - 0.08));
        const off = p.active === false;
        if (p.me) {
          g.fillStyle = 'rgba(255,255,255,.12)'; g.strokeStyle = '#ffffff'; g.lineWidth = 2;
          g.beginPath(); g.roundRect(x - cw * 0.46, yb - ph * 1.05, cw * 0.92, ph * 1.05 + 22 * S, 8); g.fill(); g.stroke();
        }
        g.globalAlpha = off ? 0.35 : 1;
        const hy = yb - ph * 0.95 + down * ph * 0.42;
        g.fillStyle = '#c9d2d9'; g.fillRect(x - 2, hy, 4, yb - ph * 0.5 - hy);
        g.fillStyle = COL[k]; g.beginPath(); g.roundRect(x - w * 0.75, hy - 6 * S, w * 1.5, 10 * S, 5); g.fill();
        const gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
        gr.addColorStop(0, '#5d666e'); gr.addColorStop(0.4, '#eef2f5'); gr.addColorStop(1, '#5d666e');
        g.fillStyle = gr; g.beginPath(); g.roundRect(x - w / 2, yb - ph * 0.5, w, ph * 0.5, 4); g.fill();
        g.fillStyle = COL2[k]; g.fillRect(x - w / 2, yb - ph * 0.28, w, 5 * S);
        if (down > 0.5) { g.fillStyle = COL[k]; g.globalAlpha = (down - 0.5) * 1.6; g.beginPath(); g.arc(x, yb - ph * 0.5, w * 0.8, 0, 7); g.fill(); }
        g.globalAlpha = 1;
        g.fillStyle = off ? '#6c7780' : p.me ? '#ffffff' : '#e8edf1';
        g.font = `${p.me ? 800 : 600} ${Math.max(9, Math.min(14 * S + 2, cw / 6))}px ${FONT}`; g.textAlign = 'center';
        g.fillText(String(p.name).replace(/^Bot /, '').slice(0, 11), x, yb + 14 * S + 2);
      });
    }
  }

  function drawVessel(L, now, burst) {
    const { cx, cy, T, B, vw, vh } = L;
    const r = vh * 0.18, P = st.P;
    let gr = g.createLinearGradient(0, T - 24, 0, B + 24);
    gr.addColorStop(0, '#eef2f5'); gr.addColorStop(0.3, '#8d979f'); gr.addColorStop(0.55, '#dfe5e9'); gr.addColorStop(1, '#4b545c');
    const m = 22 * S;
    g.fillStyle = gr; g.beginPath(); g.roundRect(L.L - m, T - m, vw + 2 * m, vh + 2 * m, r + m * 0.8); g.fill();
    g.fillStyle = '#3a4046';
    for (const sx of [-1, 1]) for (const yy of [T - m / 2, B + m / 2]) { g.beginPath(); g.arc(cx + sx * 16 * S, yy, 5 * S, 0, 7); g.fill(); }
    g.save();
    g.beginPath(); g.roundRect(L.L, T, vw, vh, r); g.clip();
    g.fillStyle = '#001233'; g.fillRect(L.L, T, vw, vh);
    const maxB = vw / 2 - 18 * S;
    const wob = (Math.sin(now * 37) * Math.min(6, Math.min(P[0], P[1]) * 6) + Math.sin(now * 11) * 1.5) * S;
    const c = cx + (xs * maxB + wob) * 2;
    for (const k of [0, 1]) {
      const edge = k === 0 ? L.L : L.R;
      g.beginPath(); g.moveTo(edge, T); g.lineTo(cx, T); g.quadraticCurveTo(c, cy, cx, B); g.lineTo(edge, B); g.closePath();
      gr = g.createLinearGradient(edge, 0, cx, 0);
      gr.addColorStop(0, COL2[k]); gr.addColorStop(1, COL[k]);
      g.fillStyle = gr; g.fill();
      g.save(); g.clip();
      const sp = (40 + P[k] * 160) * S;
      g.strokeStyle = st.turbo ? 'rgba(255,240,120,.45)' : 'rgba(255,255,255,.16)'; g.lineWidth = 3 * S;
      for (let i = 0; i < 6; i++) {
        const ph = (now * sp + i * (vw / 12)) % (vw / 2 + 40);
        g.beginPath();
        if (k === 0) g.arc(L.L + ph - vh, cy, vh, -0.45, 0.45); else g.arc(L.R - ph + vh, cy, vh, Math.PI - 0.45, Math.PI + 0.45);
        g.stroke();
      }
      g.restore();
      if (st.ph === 'run' && Math.random() < 0.15 + P[k] * 0.5) {
        const bx = k === 0 ? L.L + Math.random() * (vw / 2 - 30) : L.R - Math.random() * (vw / 2 - 30);
        parts.push({ x: bx, y: B - 4, vx: (Math.random() - 0.5) * 0.4, vy: (-1 - Math.random() * 2 - P[k]) * S, g: -0.01, life: 1, fade: 0.012, c: 'rgba(255,255,255,.55)', r: (2 + Math.random() * 4) * S });
      }
    }
    if (burst >= 0) {
      const w = burstW, f = clamp((burst - 0.25) / 1.4, 0, 1), ease = 1 - (1 - f) ** 3;
      g.fillStyle = COL[w]; g.globalAlpha = 0.9;
      if (w === 0) g.fillRect(cx, T, (L.R - cx) * ease, vh); else g.fillRect(cx - (cx - L.L) * ease, T, (cx - L.L) * ease, vh);
      g.globalAlpha = 1;
      if (burst < 1.6) for (let i = 0; i < 14; i++) {
        const p = spark(cx, cy + (Math.random() - 0.5) * vh * 0.8, Math.random() < 0.7 ? COL[w] : '#ffffff', 9 * S);
        p.vx = Math.abs(p.vx) * (w === 0 ? 1 : -1) * 1.6; p.g = 0.15; p.fade = 0.02; parts.push(p);
      }
    }
    g.restore();
    g.lineCap = 'round';
    if (burst < 0) {
      g.strokeStyle = '#2a3036'; g.lineWidth = 12 * S;
      g.beginPath(); g.moveTo(cx, T); g.quadraticCurveTo(c, cy, cx, B); g.stroke();
      g.strokeStyle = '#d7dde2'; g.lineWidth = 6 * S;
      g.beginPath(); g.moveTo(cx, T); g.quadraticCurveTo(c, cy, cx, B); g.stroke();
      const ax = Math.abs(xs);
      if (ax > 0.65) {
        const n = Math.ceil((ax - 0.65) / 0.35 * cracks.length);
        g.strokeStyle = '#ff3b3b'; g.lineWidth = 2.2 * S;
        for (let i = 0; i < Math.min(n, cracks.length); i++) {
          const s = cracks[i], u = s.u;
          const px = (1 - u) * (1 - u) * cx + 2 * u * (1 - u) * c + u * u * cx;
          const py = (1 - u) * (1 - u) * T + 2 * u * (1 - u) * cy + u * u * B;
          const dir = Math.sign(xs), len = s.len * S;
          g.beginPath(); g.moveTo(px, py);
          let qx = px, qy = py;
          for (let j = 1; j <= 4; j++) { qx += dir * len / 4 * (0.6 + 0.4 * Math.sin(j + s.b * 9)); qy += (s.a + (j % 2 ? 0.5 : -0.5)) * len / 6; g.lineTo(qx, qy); }
          g.stroke();
        }
        const k = xs > 0 ? 1 : 0, blink = Math.sin(now * 14) > 0;
        const lx = k === 0 ? L.L + 24 * S : L.R - 24 * S;
        g.fillStyle = blink ? '#ff2a2a' : '#5a0b0d'; g.shadowColor = '#ff2a2a'; g.shadowBlur = blink ? 30 : 0;
        g.beginPath(); g.arc(lx, T + 24 * S, 13 * S, 0, 7); g.fill(); g.shadowBlur = 0;
      }
    } else {
      const dir = burstW === 0 ? 1 : -1, f = clamp(burst / 0.6, 0, 1), len = vh * 0.32;
      g.strokeStyle = '#d7dde2'; g.lineWidth = 6 * S;
      for (const [y0, sgn] of [[T, 1], [B, -1]]) {
        const a = (Math.PI / 2) * (1 - f * 0.85);
        g.beginPath(); g.moveTo(cx, y0);
        g.quadraticCurveTo(cx + dir * len * 0.6 * f, y0 + sgn * len * 0.5, cx + dir * Math.cos(a) * len, y0 + sgn * Math.sin(a) * len);
        g.stroke();
      }
    }
    g.fillStyle = 'rgba(255,255,255,.06)';
    g.beginPath(); g.roundRect(L.L + 10, T + 8, vw - 20, vh * 0.16, r); g.fill();
  }

  function drawGauges(L, now) {
    for (const k of [0, 1]) {
      const rr = Math.min(52 * S, L.vh * 0.22), x = L.chamber[k], y = L.T - 22 * S - rr - 34 * S;
      if (y - rr < 0) continue;
      g.fillStyle = '#c9d2d9'; g.beginPath(); g.arc(x, y, rr + 6 * S, 0, 7); g.fill();
      g.fillStyle = '#fbfbf7'; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
      const A0 = 0.75 * Math.PI, SW = 1.5 * Math.PI;
      g.lineWidth = rr * 0.16;
      g.strokeStyle = '#2ecc71'; g.beginPath(); g.arc(x, y, rr * 0.8, A0, A0 + SW * 0.55); g.stroke();
      g.strokeStyle = '#f5c211'; g.beginPath(); g.arc(x, y, rr * 0.8, A0 + SW * 0.55, A0 + SW * 0.8); g.stroke();
      g.strokeStyle = '#e5383b'; g.beginPath(); g.arc(x, y, rr * 0.8, A0 + SW * 0.8, A0 + SW); g.stroke();
      const v = clamp(st.P[k] / 2.4, 0, 1.04) + (st.P[k] > 0.1 ? Math.sin(now * 40 + k) * 0.015 : 0);
      const a = A0 + SW * v;
      g.strokeStyle = '#c1121f'; g.lineWidth = 3.5 * S; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * rr * 0.85, y + Math.sin(a) * rr * 0.85); g.stroke();
      g.fillStyle = '#3a4046'; g.beginPath(); g.arc(x, y, 5 * S, 0, 7); g.fill();
      g.fillStyle = '#8d979f'; g.fillRect(x - 4 * S, y + rr + 4 * S, 8 * S, L.T - 22 * S - (y + rr + 4 * S));
      g.fillStyle = COL[k]; g.font = `800 ${Math.max(10, 15 * S)}px ${FONT}`; g.textAlign = 'right';
      g.fillText(`TEAM ${TEAMS[k].name.toUpperCase()}`, x - rr - 12 * S, y + 5);
    }
  }

  resize();
  requestAnimationFrame(frame);
  return api;
}
