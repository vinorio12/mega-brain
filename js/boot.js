// Sequência de boot do MB Core.
//
// Não é uma animação separada: é o MESMO núcleo da interface (o #field) nascendo em tela cheia.
//   1. tela preta → logs reais de inicialização (kernel, interface, memória, rede)
//   2. o núcleo nasce de um ponto: raios → reator → rede neural → órbitas → anel HUD → conectores
//   3. os satélites (CONTEXT, MEMORY, NETWORK, INPUT, PROCESS) aparecem ao redor
//   4. declaração: CORE ONLINE → INTELLIGENCE READY (ou MEMORY LOCKED)
//   5. o núcleo viaja até o lugar dele e a interface se monta em volta; o terminal entra por último
//
// Primeira abertura: completa (~5s). Depois: curta (~1,5s). Qualquer tecla ou toque pula.
// /boot repete a completa · /boot completo deixa sempre a completa.

import { pad, motionOK } from './util.js';
import { SATS } from './core.js';

const PREF_KEY = 'mb.boot.v1';    // 'auto' (padrão) | 'full'
const SEEN_KEY = 'mb.booted.v1';  // já fez o boot completo uma vez neste aparelho
const ONCE_KEY = 'mb.boot.once';  // /boot pediu a completa só na próxima abertura

export function bootMode() {
  if (!motionOK()) return 'none';
  let once = null, pref = 'auto', seen = false;
  try {
    once = sessionStorage.getItem(ONCE_KEY);
    sessionStorage.removeItem(ONCE_KEY);
    pref = localStorage.getItem(PREF_KEY) || 'auto';
    seen = !!localStorage.getItem(SEEN_KEY);
  } catch {}
  return once === 'full' || pref === 'full' || !seen ? 'full' : 'short';
}

// tempos em ms, contados do início
const TIMING = {
  full:  { lineGap: 160, birthAt: 550, birthDur: 1950, satAt: 2250, satGap: 130, declareAt: 3100, declare2: 380, hold: 300, fly: 650, gap: 90 },
  short: { lineGap: 25,  birthAt: 0,   birthDur: 450,  satAt: 300,  satGap: 30,  declareAt: 450,  declare2: 0,   hold: 120, fly: 380, gap: 40 },
  none:  { lineGap: 0,   birthAt: 0,   birthDur: 0,    satAt: 0,    satGap: 0,   declareAt: 0,    declare2: 0,   hold: 0,   fly: 0,   gap: 0 },
};
const TAG = { ok: ' OK ', warn: 'WARN', err: 'FAIL', int: ' .. ', lock: 'LOCK' };
const easeInOut = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function createBoot({ core, app, field, slot, mode }) {
  const T = TIMING[mode];
  const overlay = document.getElementById('boot');
  const logEl = document.getElementById('boot-log');
  const declEl = document.getElementById('boot-decl');
  const t0 = performance.now();
  const since = () => performance.now() - t0;
  let skipped = mode === 'none';

  // esperas que terminam na hora se o operador pular
  const waiters = new Set();
  const wait = ms => (skipped || ms <= 0 ? Promise.resolve() : new Promise(r => {
    const done = () => { clearTimeout(id); waiters.delete(done); r(); };
    const id = setTimeout(done, ms);
    waiters.add(done);
  }));
  const until = ms => wait(ms - since());

  function skip() {
    if (skipped) return;
    skipped = true;
    flushLines();
    core.setBirth(1);
    SATS.forEach(k => core.showSat(k, true));
    [...waiters].forEach(w => w());
  }

  /* ---------- começo: núcleo em tela cheia, ainda sem forma ---------- */
  app.classList.add('is-booting');
  if (mode === 'none') {
    overlay.remove();
    core.setBirth(1);
  } else {
    field.classList.add('is-boot');
    SATS.forEach(k => core.showSat(k, false));
    core.setBirth(0);
    addEventListener('keydown', skip, { once: true });
    addEventListener('pointerdown', skip, { once: true });

    // nascimento guiado pelo relógio
    const grow = () => {
      if (skipped) return core.setBirth(1);
      const p = Math.max(0, Math.min(1, (since() - T.birthAt) / T.birthDur));
      core.setBirth(easeInOut(p));
      if (p < 1) requestAnimationFrame(grow);
    };
    requestAnimationFrame(grow);

    // satélites, um de cada vez
    SATS.forEach((k, i) => until(T.satAt + i * T.satGap).then(() => core.showSat(k, true)));
  }

  /* ---------- logs de inicialização (cadenciados, mas reais) ---------- */
  const queue = [];
  let lastShown = 0, timer = null;
  function pump() {
    timer = null;
    if (!queue.length) return;
    const wait = Math.max(0, T.lineGap - (since() - lastShown));
    if (wait > 0 && !skipped) { timer = setTimeout(pump, wait); return; }
    logEl.insertAdjacentHTML('beforeend', queue.shift());
    lastShown = since();
    if (queue.length) timer = setTimeout(pump, skipped ? 0 : T.lineGap);
  }
  function flushLines() {
    clearTimeout(timer);
    logEl.insertAdjacentHTML('beforeend', queue.splice(0).join(''));
  }
  function push(html) {
    if (mode === 'none') return;
    queue.push(html);
    if (!timer) pump();
  }

  const head = (version, kind) => push(`<li class="b-head">MB <i>CORE</i><small>${version} · ${kind}</small></li>`);
  const step = (label, value = '', tone = 'ok') => push(
    `<li class="b-${tone}"><span class="bt">${pad(Math.round(since()), 4)}</span><span class="bs">[${TAG[tone] || TAG.ok}]</span>` +
    `<span class="bl">${label}</span><span class="bv">${value}</span></li>`);

  /* ---------- declaração + montagem da interface ---------- */
  async function finish({ locked = false, onOnline } = {}) {
    await until(T.declareAt);
    if (!skipped) await new Promise(r => { const chk = () => (queue.length && !skipped ? setTimeout(chk, 50) : r()); chk(); });
    core.setBirth(1);
    SATS.forEach(k => core.showSat(k, true));

    // 4. o núcleo declara que está online
    if (mode !== 'none') {
      declEl.innerHTML = 'CORE ONLINE';
      declEl.classList.add('is-on');
      core.pulse('int', 1.6);
    }
    onOnline?.();
    await wait(T.declare2);
    if (mode !== 'none') {
      declEl.innerHTML = locked
        ? 'MEMORY LOCKED<small>aguardando operador</small>'
        : 'INTELLIGENCE READY<small>aguardando operador</small>';
      declEl.classList.toggle('is-warn', locked);
      if (T.declare2) core.pulse(locked ? 'warn' : 'act', 1.4);
    }
    await wait(T.hold);

    // 5. a interface se monta: cabeçalho → laterais → núcleo vai pro lugar → terminal por último
    overlay?.classList.add('is-out');
    const regions = ['.head', '.cog', '.ctx', '.foot'].map(s => app.querySelector(s));
    for (const r of regions) { r.classList.add('in'); await wait(T.gap); }
    await fly();
    await wait(T.gap);
    app.querySelector('.term').classList.add('in');
    await wait(mode === 'none' ? 0 : 300);

    // limpeza: sai do modo boot, o núcleo continua vivo no lugar dele
    app.classList.remove('is-booting');
    app.querySelectorAll('.in').forEach(el => el.classList.remove('in'));
    overlay?.remove();
    removeEventListener('keydown', skip);
    removeEventListener('pointerdown', skip);
    try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch {}
  }

  // o campo do núcleo encolhe da tela cheia até o espaço dele na interface
  async function fly() {
    if (!field.classList.contains('is-boot')) return;
    const to = slot.getBoundingClientRect();
    if (to.height < 190) SATS.forEach(k => core.showSat(k, false)); // celular: a faixa não tem satélites
    if (!skipped && T.fly > 0) {
      const anim = field.animate([
        { top: '0px', left: '0px', width: innerWidth + 'px', height: innerHeight + 'px' },
        { top: to.top + 'px', left: to.left + 'px', width: to.width + 'px', height: to.height + 'px' },
      ], { duration: T.fly, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'forwards' });
      const stopOnSkip = () => anim.finish();
      waiters.add(stopOnSkip);
      await anim.finished.catch(() => {});
      waiters.delete(stopOnSkip);
    }
    field.classList.remove('is-boot');
    field.getAnimations().forEach(a => a.cancel());
    if (to.height < 190) SATS.forEach(k => core.showSat(k, true));
    core.resize();
  }

  return { head, step, finish, get skipped() { return skipped; } };
}
