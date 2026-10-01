// Intelligence Core: o núcleo visual do MB Core, desenhado em canvas.
//
// É UM motor só, usado no boot (nascimento) e na interface (vivo). Tudo reage a dados reais:
//   estado      → cor de destaque, energia (velocidade, brilho, quantidade de sinais)
//   satélites   → CONTEXT · MEMORY · NETWORK · INPUT · PROCESS: o conector acende quando o subsistema trabalha
//   teclas      → cada tecla manda uma faísca do INPUT para o núcleo
//   pulsos      → anéis que saem do centro quando algo acontece (captura, erro, sync)
//   anel externo→ progresso do dia (hora atual)
//
// Camadas, de dentro pra fora: nucleus · raios · anel do reator · rede neural · órbitas · anel HUD · conectores.
// birth (0→1) controla o nascimento: cada camada aparece numa faixa desse valor.

import { motionOK } from './util.js';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// estado → cor de destaque (token do CSS) e energia (0 parado · 1 máximo)
export const MODES = {
  initializing: { tone: 'int', energy: 0.7 },
  locked:       { tone: 'warn', energy: 0.18 },
  ready:        { tone: 'int', energy: 0.3 },
  listening:    { tone: 'int', energy: 0.55 },
  processing:   { tone: 'int', energy: 0.92 },
  executing:    { tone: 'act', energy: 0.85 },
  degraded:     { tone: 'warn', energy: 0.4 },
  offline:      { tone: 'meta', energy: 0.16 },
  fault:        { tone: 'err', energy: 1 },
};

// ordem dos satélites e de que lado ficam (no layout largo)
export const SATS = ['context', 'memory', 'network', 'process', 'input'];

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const hex = name => {
    const v = cs.getPropertyValue(name).trim() || '#888888';
    const n = parseInt(v.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  return { int: hex('--int'), act: hex('--act'), warn: hex('--warn'), err: hex('--err'), meta: hex('--meta'), tx: hex('--tx') };
}

// gerador pseudo-aleatório com semente: a rede neural tem sempre o mesmo desenho
function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

// Geometria: onde fica o núcleo e os satélites, conforme o tamanho da área
export function layout(w, h) {
  if (h < 190) {
    const R = h * 0.4;
    return { mode: 'strip', cx: R + 14, cy: h / 2, R, sats: null };
  }
  if (w < 560) {
    // celular em pé (boot): núcleo um pouco abaixo do meio, deixando o topo pros logs
    const R = Math.min(w * 0.26, h * 0.14);
    const cx = w / 2, cy = h * 0.52, sx = Math.min(w * 0.3, w / 2 - 16);
    return {
      mode: 'tall', cx, cy, R, sats: {
        context: [cx - sx, cy - R * 1.8, 'top'], network: [cx + sx, cy - R * 1.8, 'top'],
        memory: [cx - sx, cy + R * 1.8, 'bottom'], process: [cx + sx, cy + R * 1.8, 'bottom'],
        input: [cx, cy + R * 2.4, 'bottom'],
      },
    };
  }
  // reserva ~56px embaixo pro rótulo do INPUT (2 linhas)
  const R = Math.min((h - 76) / 2.25, w * 0.16);
  const cx = w / 2, cy = (h - 46) / 2;
  const dx = Math.min(R * 2.35, w / 2 - 170);
  return {
    mode: 'wide', cx, cy, R, sats: {
      context: [cx - dx, cy - R * 0.55, 'left'], memory: [cx - dx, cy + R * 0.55, 'left'],
      network: [cx + dx, cy - R * 0.55, 'right'], process: [cx + dx, cy + R * 0.55, 'right'],
      input: [cx, cy + R + 16, 'bottom'],
    },
  };
}

export function createCore(canvas, satEls = {}) {
  const ctx = canvas.getContext('2d');
  let C = readColors();
  let W = 0, H = 0, dpr = 1, G = layout(1, 1);

  // estado animado (tudo se aproxima suavemente do alvo)
  let mode = 'initializing';
  let accent = [...C.int];
  let energy = 0.5;
  let birth = 1;              // 0..1 no boot; 1 = núcleo completo
  let rot = 0, rotIn = 0, orb = 0, t = 0;
  let flash = 0;              // brilho extra do centro (teclas, eventos)
  let dayP = 0;               // progresso do dia (0..1)
  const active = Object.fromEntries(SATS.map(k => [k, 0]));   // brilho atual de cada conector
  const target = Object.fromEntries(SATS.map(k => [k, false]));
  const shown = Object.fromEntries(SATS.map(k => [k, true]));  // satélite visível (o boot liga um a um)
  const signals = [];         // pacotes viajando por linhas
  const pulses = [];          // anéis saindo do centro

  // rede neural: nós num anel irregular + conexões
  const rand = rng(7);
  const NODES = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * TAU + (rand() - 0.5) * 0.25;
    const r = 0.7 + (rand() - 0.5) * 0.1;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  const EDGES = [];
  NODES.forEach((_, i) => {
    EDGES.push([i, (i + 1) % 14]);
    if (i % 2 === 0) EDGES.push([i, (i + 5) % 14]);
    if (i % 3 === 0) EDGES.push([i, -1]); // -1 = ponto no anel do reator, na mesma direção
  });
  const edgePts = ([a, b]) => {
    const p = NODES[a];
    if (b >= 0) return [p, NODES[b]];
    const ang = Math.atan2(p[1], p[0]);
    return [p, [Math.cos(ang) * 0.48, Math.sin(ang) * 0.48]];
  };

  /* ---------- tamanho ---------- */

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    G = layout(W, H);
    placeSats();
    if (!running) draw(0);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // posiciona os rótulos HTML dos satélites onde o conector termina
  function placeSats() {
    for (const k of SATS) {
      const el = satEls[k];
      if (!el) continue;
      const s = G.sats?.[k];
      if (!s) { el.hidden = true; continue; }
      el.hidden = false;
      el.dataset.side = s[2];
      el.style.left = s[0] + 'px';
      el.style.top = s[1] + 'px';
    }
  }

  /* ---------- desenho ---------- */

  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a)})`;
  const stage = (a, d) => clamp((birth - a) / d);

  function circle(r, color, a, lw = 1, sweep = 1, start = -Math.PI / 2) {
    if (sweep <= 0 || a <= 0) return;
    ctx.beginPath();
    ctx.arc(G.cx, G.cy, r, start, start + TAU * sweep);
    ctx.strokeStyle = rgba(color, a);
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  function draw(dt) {
    const { cx, cy, R } = G;
    const m = MODES[mode] || MODES.ready;
    const k = clamp(dt * 3);

    // aproxima cor e energia do alvo
    const tc = C[m.tone] || C.int;
    for (let i = 0; i < 3; i++) accent[i] = lerp(accent[i], tc[i], k);
    energy = lerp(energy, m.energy, clamp(dt * 2));
    for (const s of SATS) active[s] = lerp(active[s], target[s] ? 1 : 0, clamp(dt * 5));
    flash = Math.max(0, flash - dt * 2.2);

    // velocidades: mais energia, mais rápido. DEGRADED gagueja.
    const stutter = mode === 'degraded' ? (Math.sin(t * 7) > 0.6 ? 0.1 : 1) : 1;
    const lockedHold = mode === 'locked' ? 0.15 : 1;
    rot += dt * (0.05 + energy * 0.25) * stutter * lockedHold;
    rotIn += dt * (0.25 + energy * 2.2) * stutter * lockedHold;
    orb += dt * (0.12 + energy * 0.5) * stutter;
    t += dt;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (birth <= 0) return;

    const A = accent, breathe = 0.5 + 0.5 * Math.sin(t * (1.2 + energy * 3));

    // brilho de fundo (o "campo")
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6);
    glow.addColorStop(0, rgba(A, (0.05 + energy * 0.07) * stage(0, 0.3)));
    glow.addColorStop(1, rgba(A, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // anel HUD externo: marcações + progresso do dia
    const sHud = stage(0.66, 0.2);
    if (sHud > 0) {
      circle(R, C.meta, 0.22 * sHud, 1, sHud);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot * 0.3);
      const n = G.mode === 'strip' ? 36 : 90;
      for (let i = 0; i < n * sHud; i++) {
        const a = (i / n) * TAU, long = i % (n / 6) === 0;
        const r1 = R * (long ? 0.94 : 0.965);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
        ctx.strokeStyle = rgba(long ? A : C.meta, long ? 0.5 : 0.22);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
      circle(R * 1.06, A, 0.55 * sHud, 1.5, dayP * sHud);
      circle(R * 1.06, C.meta, 0.08 * sHud, 1.5, 1);
    }

    // órbitas inclinadas, com um nó viajando em cada
    const sOrb = stage(0.54, 0.2);
    if (sOrb > 0 && G.mode !== 'strip') {
      for (let j = 0; j < 2; j++) {
        const tilt = j ? 0.9 : -0.5, rx = R * (j ? 0.9 : 0.84), ry = R * (j ? 0.32 : 0.42);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt + rot * (j ? -0.6 : 0.4));
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, TAU * sOrb);
        ctx.strokeStyle = rgba(C.meta, 0.18 * sOrb);
        ctx.lineWidth = 1;
        ctx.stroke();
        const a = orb * (j ? 1.3 : 1) + j * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rx, Math.sin(a) * ry, 2.2, 0, TAU);
        ctx.fillStyle = rgba(A, 0.8 * sOrb);
        ctx.fill();
        ctx.restore();
      }
    }

    // rede neural: conexões e nós (giram devagar junto com o anel)
    const sNodes = stage(0.32, 0.18), sEdges = stage(0.42, 0.2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    if (sEdges > 0) {
      ctx.lineWidth = 1;
      EDGES.forEach((e, i) => {
        const vis = clamp(sEdges * EDGES.length - i);
        if (vis <= 0) return;
        const [p, q] = edgePts(e);
        const flick = mode === 'degraded' && (i * 13 + Math.floor(t * 3)) % 7 === 0 ? 0.2 : 1;
        ctx.beginPath();
        ctx.moveTo(p[0] * R, p[1] * R);
        ctx.lineTo(lerp(p[0], q[0], vis) * R, lerp(p[1], q[1], vis) * R);
        ctx.strokeStyle = rgba(A, (0.1 + energy * 0.12) * flick);
        ctx.stroke();
      });
    }
    if (sNodes > 0) {
      NODES.forEach((p, i) => {
        const vis = clamp(sNodes * NODES.length - i);
        if (vis <= 0) return;
        ctx.beginPath();
        ctx.arc(p[0] * R, p[1] * R, (G.mode === 'strip' ? 1.2 : 2) * vis, 0, TAU);
        ctx.fillStyle = rgba(A, 0.45 + 0.35 * energy);
        ctx.fill();
      });
    }
    // sinais viajando pela rede
    for (const s of signals) {
      if (s.edge == null) continue;
      const [p, q] = edgePts(EDGES[s.edge]);
      const [a, b] = s.rev ? [q, p] : [p, q];
      const x = lerp(a[0], b[0], s.p) * R, y = lerp(a[1], b[1], s.p) * R;
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, TAU);
      ctx.fillStyle = rgba(s.color || A, 0.95 * (1 - s.p * 0.3));
      ctx.fill();
    }
    ctx.restore();

    // anel do reator: círculo + 3 segmentos girando (travados no LOCKED)
    const sRing = stage(0.18, 0.18);
    if (sRing > 0) {
      circle(R * 0.48, C.meta, 0.25 * sRing, 1, sRing);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(mode === 'locked' ? 0 : rotIn);
      for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * TAU;
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.48, a0, a0 + (mode === 'locked' ? 0.5 : 0.9) * sRing);
        ctx.strokeStyle = rgba(A, 0.75);
        ctx.lineWidth = G.mode === 'strip' ? 1.5 : 2.4;
        ctx.stroke();
      }
      ctx.restore();
      circle(R * 0.56, C.meta, 0.12 * sRing, 1);
    }

    // raios do centro até o reator (os de baixo acendem quando escutando)
    const sSpk = stage(0.06, 0.16);
    if (sSpk > 0) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-rot * 0.5);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        const toward = Math.max(0, Math.sin(a - rot * -0.5)); // ~1 pra baixo (onde fica o INPUT)
        const lit = mode === 'listening' ? toward * 0.5 : 0;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * R * 0.13, Math.sin(a) * R * 0.13);
        ctx.lineTo(Math.cos(a) * R * lerp(0.13, 0.4, sSpk), Math.sin(a) * R * lerp(0.13, 0.4, sSpk));
        ctx.strokeStyle = rgba(A, 0.1 + energy * 0.1 + lit);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }

    // nucleus: brilho + ponto central que respira
    const sNuc = stage(0, 0.08);
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.26);
    halo.addColorStop(0, rgba(A, (0.25 + energy * 0.3 + flash * 0.4) * sNuc));
    halo.addColorStop(1, rgba(A, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.26, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.5, R * (0.045 + breathe * 0.012 * (1 + energy) + flash * 0.02)) * sNuc, 0, TAU);
    ctx.fillStyle = rgba(mode === 'offline' ? C.meta : [lerp(A[0], 255, 0.35), lerp(A[1], 255, 0.35), lerp(A[2], 255, 0.35)], sNuc);
    ctx.fill();

    // pulsos saindo do centro
    for (const p of pulses) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * lerp(0.08, 1.15, p.p), 0, TAU);
      ctx.strokeStyle = rgba(p.color, 0.6 * (1 - p.p));
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // conectores até os satélites
    const sCon = stage(0.84, 0.16);
    if (G.sats && sCon > 0) {
      for (const k of SATS) {
        if (!shown[k]) continue;
        const [sx, sy] = G.sats[k];
        const ang = Math.atan2(sy - cy, sx - cx);
        const x0 = cx + Math.cos(ang) * R * 1.1, y0 = cy + Math.sin(ang) * R * 1.1;
        const len = sCon;
        const a = 0.14 + active[k] * 0.55;
        const off = k === 'network' && mode === 'offline';
        ctx.beginPath();
        ctx.setLineDash(off ? [3, 5] : []);
        ctx.moveTo(x0, y0);
        ctx.lineTo(lerp(x0, sx, len), lerp(y0, sy, len));
        ctx.strokeStyle = rgba(active[k] > 0.05 ? A : C.meta, off ? 0.18 : a);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(sx, sy, 2.2, 0, TAU);
        ctx.fillStyle = rgba(active[k] > 0.05 ? A : C.meta, 0.35 + active[k] * 0.6);
        ctx.fill();
        // pacotes no conector
        for (const s of signals) {
          if (s.sat !== k) continue;
          const pp = s.rev ? 1 - s.p : s.p;
          ctx.beginPath();
          ctx.arc(lerp(x0, sx, pp), lerp(y0, sy, pp), 1.8, 0, TAU);
          ctx.fillStyle = rgba(s.color || A, 0.95);
          ctx.fill();
        }
      }
    }
  }

  /* ---------- vida: sinais, pulsos e laço de animação ---------- */

  function spawn(dt) {
    // sinais na rede: poucos parado, muitos processando
    const rate = { processing: 7, executing: 4, listening: 1.2, initializing: 3, fault: 2, degraded: 0.6, ready: 0.35, locked: 0, offline: 0.1 }[mode] ?? 0.3;
    if (birth >= 0.45 && Math.random() < rate * dt) {
      signals.push({ edge: (Math.random() * EDGES.length) | 0, p: 0, v: 0.6 + Math.random() * 0.9 + energy, rev: Math.random() < 0.5 });
    }
    // conectores ativos mandam pacotes (sentido: entrada → núcleo, saída → satélite)
    for (const k of SATS) {
      if (target[k] && G.sats && Math.random() < 3 * dt) {
        signals.push({ sat: k, p: 0, v: 1.4, rev: k === 'input' || k === 'context' || (k === 'network' && Math.random() < 0.5) });
      }
    }
  }

  function step(dt) {
    spawn(dt);
    for (let i = signals.length - 1; i >= 0; i--) {
      signals[i].p += dt * signals[i].v;
      if (signals[i].p >= 1) signals.splice(i, 1);
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      pulses[i].p += dt / pulses[i].d;
      if (pulses[i].p >= 1) pulses.splice(i, 1);
    }
    if (signals.length > 120) signals.splice(0, signals.length - 120);
  }

  let running = false, last = 0, frameHook = null;
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw(dt);
    frameHook?.(dt);
    requestAnimationFrame(frame);
  }
  function start() {
    if (running || document.hidden) return;
    if (!motionOK()) { draw(1); return; }
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
  const stop = () => { running = false; };
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  resize();
  start();

  const redrawIfStill = () => { if (!running) { energy = (MODES[mode] || MODES.ready).energy; draw(1); } };

  return {
    setState(m) { if (MODES[m] && m !== mode) { mode = m; redrawIfStill(); } },
    get state() { return mode; },
    setBirth(b) { birth = clamp(b); redrawIfStill(); },
    get birth() { return birth; },
    setDay(p) { dayP = clamp(p); },
    // liga/desliga o brilho do conector de um satélite
    activate(k, on) { if (k in target) target[k] = !!on; },
    showSat(k, on) { if (k in shown) { shown[k] = !!on; satEls[k]?.classList.toggle('is-on', !!on); } },
    pulse(tone = 'int', d = 1.3) {
      if (!motionOK()) return;
      pulses.push({ p: 0, d, color: C[tone] || C.int });
      flash = Math.min(1, flash + 0.5);
    },
    keystroke() {
      if (!motionOK() || !G.sats) return;
      flash = Math.min(1, flash + 0.25);
      signals.push({ sat: 'input', p: 0, v: 2.6, rev: true });
    },
    refreshColors() { C = readColors(); },
    resize,
    onFrame(fn) { frameHook = fn; },
    layout: () => G,
  };
}
