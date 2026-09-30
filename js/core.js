// Visualização geométrica do núcleo, desenhada em SVG.
// Cada elemento representa um dado real:
//   arco azul externo  → quanto do ano já passou
//   nós na órbita      → módulos (verde = ligado, vazado = fase futura)
//   pontos verdes      → entradas capturadas hoje (1 ponto cada, até 36)
//   pulsos             → eventos acontecendo agora
//   velocidade de giro → estado (mais rápido quando está trabalhando)

import { motionOK } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const SPEED = { boot: 5, busy: 6, ready: 1, degraded: .5, offline: .25 };

export function createCore(svg, modules) {
  const el = (tag, attrs, parent = svg) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    parent.appendChild(n);
    return n;
  };
  const polar = (r, deg) => {
    const a = (deg - 90) * Math.PI / 180;
    return [+(Math.cos(a) * r).toFixed(2), +(Math.sin(a) * r).toFixed(2)];
  };

  // gradiente do "radar"
  const defs = el('defs', {});
  const g = el('linearGradient', { id: 'sweep-g', x1: 0, y1: 0, x2: 0, y2: -1, gradientUnits: 'objectBoundingBox' }, defs);
  el('stop', { offset: '0', 'stop-color': 'var(--hud)', 'stop-opacity': '0' }, g);
  el('stop', { offset: '1', 'stop-color': 'var(--hud)', 'stop-opacity': '.55' }, g);

  el('circle', { r: 98, class: 'frame' });

  // anel de marcações (gira devagar)
  const gTicks = el('g', {});
  for (let i = 0; i < 120; i++) {
    const long = i % 10 === 0;
    const [x1, y1] = polar(long ? 88 : 91.5, i * 3);
    const [x2, y2] = polar(94, i * 3);
    el('line', { x1, y1, x2, y2, class: long ? 'tick tick-l' : 'tick' }, gTicks);
  }

  // arco do ano
  el('circle', { r: 83, class: 'arc-track' });
  const yearArc = el('path', { class: 'arc-year' });

  // linha de varredura
  const gSweep = el('g', {});
  el('line', { x1: 0, y1: 0, x2: 0, y2: -80, class: 'sweep' }, gSweep);

  // órbita dos módulos (gira no sentido contrário)
  const gOrbit = el('g', {});
  el('circle', { r: 66, class: 'ring' }, gOrbit);
  const pts = modules.map((_, i) => polar(66, i * 360 / modules.length));
  el('polygon', { points: pts.map(p => p.join(',')).join(' '), class: 'poly' }, gOrbit);
  const nodes = modules.map((m, i) => {
    const [x, y] = pts[i];
    if (m.on) el('line', { x1: 0, y1: 0, x2: x, y2: y, class: 'vec' }, gOrbit);
    return el('circle', { cx: x, cy: y, r: m.on ? 3.2 : 2.6, class: 'node' + (m.on ? ' is-on' : '') }, gOrbit);
  });

  // anel interno tracejado
  const gInner = el('g', {});
  el('circle', { r: 50, class: 'ring-l' }, gInner);
  el('circle', { r: 40, class: 'ring-d' });

  // pontos de hoje
  const gToday = el('g', {});

  // centro
  el('circle', { r: 20, class: 'ring' });
  el('circle', { r: 11, class: 'heart-r' });
  el('circle', { r: 5, class: 'heart' });
  const gPulse = el('g', {});

  /* ---------- dados ---------- */

  let lastToday = -1;
  function update({ yearPct, today }) {
    const p = Math.min(.9999, Math.max(0, yearPct));
    const [x, y] = polar(83, p * 360);
    yearArc.setAttribute('d', `M 0 -83 A 83 83 0 ${p > .5 ? 1 : 0} 1 ${x} ${y}`);

    if (today !== lastToday) {
      lastToday = today;
      gToday.innerHTML = '';
      const n = Math.min(today, 36);
      for (let i = 0; i < n; i++) {
        const [dx, dy] = polar(40, i * 10);
        el('circle', { cx: dx, cy: dy, r: 1.6, class: 'today' }, gToday);
      }
    }
  }

  /* ---------- movimento ---------- */

  let state = 'boot', speed = SPEED.boot, a = 0, last = performance.now(), running = false;

  function frame(now) {
    if (!running) return;
    const dt = Math.min(64, now - last) / 1000;
    last = now;
    speed += ((SPEED[state] ?? 1) - speed) * Math.min(1, dt * 2); // acelera/desacelera suave
    a += speed * dt;
    gTicks.setAttribute('transform', `rotate(${(a * 2) % 360})`);
    gSweep.setAttribute('transform', `rotate(${(a * 24) % 360})`);
    gOrbit.setAttribute('transform', `rotate(${(-a * 3) % 360})`);
    gInner.setAttribute('transform', `rotate(${(a * 6) % 360})`);
    requestAnimationFrame(frame);
  }

  function start() {
    if (running || !motionOK() || document.hidden) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
  const stop = () => { running = false; };
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  start();

  // anel que se expande do centro quando algo acontece
  function pulse(kind = 'hud') {
    if (!motionOK() || document.hidden) return;
    const c = el('circle', { r: 10, class: 'pulse ' + kind }, gPulse);
    const anim = c.animate(
      [{ transform: 'scale(1)', opacity: .9 }, { transform: 'scale(9.4)', opacity: 0 }],
      { duration: 1400, easing: 'cubic-bezier(.2,.7,.2,1)' });
    anim.onfinish = () => c.remove();
    if (kind === 'act') nodes.forEach(n => n.classList.contains('is-on') &&
      n.animate([{ r: 6 }, { r: 3.2 }], { duration: 600, easing: 'ease-out' }));
  }

  return {
    update,
    pulse,
    setState(s) { state = s; },
  };
}
