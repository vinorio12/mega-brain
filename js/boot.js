// Tela de boot: aparece ao abrir o app, mostra as checagens reais e se desfaz.
// Qualquer tecla ou toque pula. Com "reduzir movimento" ligado no sistema, é instantânea.

import { esc, motionOK, pad } from './util.js';

const MIN_MS = 1500; // tempo mínimo na tela, pra animação respirar

export function createBootScreen(totalSteps) {
  const el = document.getElementById('boot');
  const log = document.getElementById('boot-log');
  const bar = document.getElementById('boot-bar');
  const app = document.getElementById('app');
  const t0 = performance.now();
  let n = 0;
  let skip = !motionOK();
  let wake = null;

  const onSkip = () => { skip = true; wake?.(); };
  addEventListener('keydown', onSkip, { once: true });
  el.addEventListener('pointerdown', onSkip, { once: true });

  // uma linha de checagem: [ OK ] rótulo ········ valor
  function step(label, value = '', tone = 'ok') {
    n++;
    const tag = { ok: ' OK ', warn: 'WARN', err: 'FAIL', hud: ' .. ' }[tone];
    const ms = pad(Math.round(performance.now() - t0), 4);
    const li = document.createElement('li');
    li.className = 'bk-' + tone;
    li.innerHTML = `<span class="bk-t">${ms}</span><span class="bk-s">[${tag}]</span><span class="bk-l">${esc(label)}</span><span class="bk-v">${esc(value)}</span>`;
    log.appendChild(li);
    bar.style.width = Math.min(100, (n / totalSteps) * 100) + '%';
  }

  async function done() {
    bar.style.width = '100%';
    const left = MIN_MS - (performance.now() - t0);
    if (!skip && left > 0) await new Promise(r => { wake = r; setTimeout(r, left); });
    removeEventListener('keydown', onSkip);
    el.classList.add('is-out');
    app.classList.add('is-in');
    await new Promise(r => setTimeout(r, skip ? 0 : 520));
    el.remove();
  }

  return { step, done };
}
