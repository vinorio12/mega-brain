// Terminal: saída, log da sessão, tarefas assíncronas e teclado.
//
// Três tipos de saída:
//   emit()  → linha de log técnica: horário · nível · origem · mensagem (fica no log da sessão)
//   say()   → resposta do núcleo em linguagem natural (azul)
//   print() → saída estruturada (listas, tabelas)

import { esc, hhmm, pad, CmdError } from './util.js';

const HIST_KEY = 'mb.hist.v1';
const LEVEL_CLASS = { OK: 'ok', INF: 'inf', WRN: 'wrn', ERR: 'err', AI: 'ai' };
const DEFAULT_HINT = 'tab completa · ↑↓ histórico · ctrl+k limpa';

export function createTerminal({ out, input, form, hint, completions, onSubmit, onChange }) {
  const log = [];
  const tasks = new Map();
  let seq = 0;
  let hist = [];
  try { hist = JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch {}
  let hi = hist.length;
  let draft = '';
  let flashTimer = null;

  /* ---------- saída ---------- */

  const nearBottom = () => out.scrollHeight - out.scrollTop - out.clientHeight < 60;

  function row(html, cls = '', force = false) {
    const stick = force || nearBottom(); // se você rolou pra cima pra ler, não puxa pra baixo
    const d = document.createElement('div');
    d.className = 'row ' + cls;
    d.innerHTML = html;
    out.appendChild(d);
    if (stick) out.scrollTop = out.scrollHeight;
    return d;
  }

  const toText = html => {
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content.textContent;
  };

  function fmt(e) {
    const d = new Date(e.ts);
    return `<span class="t">${hhmm(d)}<span class="s">:${pad(d.getSeconds())}</span></span>` +
      `<span class="lv">${e.level}</span><span class="src">${esc(e.src)}</span><span class="m">${e.html}</span>`;
  }

  function emit(level, src, html, { show = true } = {}) {
    const e = { ts: Date.now(), level, src, html, text: toText(html) };
    log.push(e);
    if (show) row(fmt(e), 'lg lv-' + LEVEL_CLASS[level]);
    onChange('log', e);
    return e;
  }

  function say(html) {
    emit('AI', 'core', html, { show: false });
    row(html, 'say');
  }

  const print = (html, cls = '') => row(html, cls);

  function echo(text) {
    row(`<span class="ps-caret">›</span>${esc(text)}`, 'echo', true);
  }

  function error(err) {
    const code = err.code || 'E_INTERNAL';
    const src = err.src || 'core';
    const hintHtml = err.hint ? `<span class="hint">→ ${err.hint}</span>` : '';
    emit('ERR', src, `<b class="code">${esc(code)}</b> ${esc(err.message || 'erro inesperado')}${hintHtml}`);
    if (!(err instanceof CmdError) && !err.code) console.error(err);
  }

  function clear() {
    out.innerHTML = '';
    print(`<span class="dim">visualização limpa · ${log.length} eventos continuam no log · /log mostra</span>`);
  }

  /* ---------- tarefas assíncronas (com ID e cancelamento) ---------- */

  async function task(label, fn, { announce = false } = {}) {
    const id = 'T' + pad(++seq, 4);
    const ctrl = new AbortController();
    const t0 = performance.now();
    const t = { id, label, t0, ctrl, elapsed: () => Math.round(performance.now() - t0) };
    tasks.set(id, t);
    onChange('task');
    if (announce) emit('INF', 'task', `<span class="c-meta">${id}</span> ▸ ${esc(label)} <span class="c-meta">· ctrl+c cancela</span>`);

    // se você der ctrl+c, a tarefa para de esperar na hora, mesmo que a rede ainda esteja respondendo
    const aborted = new Promise((_, reject) =>
      ctrl.signal.addEventListener('abort', () => reject(new DOMException('cancelado', 'AbortError')), { once: true }));
    try {
      return await Promise.race([fn(ctrl.signal, t), aborted]);
    } catch (e) {
      if (e?.name === 'AbortError') emit('WRN', 'task', `<span class="c-meta">${id}</span> cancelado · ${esc(label)}`);
      else error(e);
    } finally {
      tasks.delete(id);
      onChange('task');
    }
  }

  function cancelLast() {
    const last = [...tasks.values()].pop();
    if (last) last.ctrl.abort();
  }

  /* ---------- dica ao lado do prompt ---------- */

  function renderHint() {
    if (flashTimer) return;
    const last = [...tasks.values()].pop();
    hint.className = 'hint' + (last ? ' is-task' : '');
    hint.textContent = last ? `${last.id} ▸ ${last.label} · ctrl+c cancela` : DEFAULT_HINT;
  }

  function flash(msg) {
    clearTimeout(flashTimer);
    hint.className = 'hint is-flash';
    hint.textContent = msg;
    flashTimer = setTimeout(() => { flashTimer = null; renderHint(); }, 1800);
  }

  /* ---------- autocomplete (tab) ---------- */

  function commonPrefix(list) {
    let p = list[0];
    for (const s of list) while (!s.startsWith(p)) p = p.slice(0, -1);
    return p;
  }

  function complete() {
    const pos = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, pos);
    const after = input.value.slice(pos);
    let m, pool, prefix;
    if ((m = before.match(/^\/([\p{L}\w-]*)$/u))) {
      pool = completions.commands().map(n => '/' + n);
      prefix = '/' + m[1].toLowerCase();
    } else if ((m = before.match(/#([\p{L}\p{N}_-]*)$/u))) {
      pool = completions.tags().map(t => '#' + t);
      prefix = '#' + m[1].toLowerCase();
    } else {
      return flash('tab completa /comandos e #tags');
    }
    const hits = pool.filter(p => p.startsWith(prefix));
    if (!hits.length) return flash(`nada começa com ${prefix}`);
    const fill = hits.length === 1 ? hits[0] + ' ' : commonPrefix(hits);
    if (fill.length > prefix.length) {
      const head = before.slice(0, before.length - prefix.length) + fill;
      input.value = head + after;
      input.setSelectionRange(head.length, head.length);
    } else {
      print(hits.map(h => `<span class="c-hud">${esc(h)}</span>`).join('   '), 'opts');
    }
  }

  /* ---------- teclado ---------- */

  const setInput = v => {
    input.value = v;
    requestAnimationFrame(() => input.setSelectionRange(v.length, v.length));
  };

  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const v = input.value.trim();
    input.value = '';
    if (!v) return;
    if (hist[hist.length - 1] !== v) {
      hist.push(v);
      hist = hist.slice(-200);
      try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch {}
    }
    hi = hist.length;
    draft = '';
    echo(v);
    onSubmit(v);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp') {
      if (!hist.length) return;
      e.preventDefault();
      if (hi === hist.length) draft = input.value;
      hi = Math.max(0, hi - 1);
      setInput(hist[hi]);
    } else if (e.key === 'ArrowDown') {
      if (hi >= hist.length) return;
      e.preventDefault();
      hi++;
      setInput(hi === hist.length ? draft : hist[hi]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.key === 'Escape') {
      input.value = '';
    }
  });

  document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    // ctrl+k (ou ctrl+l): limpa só a visualização
    if ((e.ctrlKey || e.metaKey) && (k === 'k' || k === 'l')) {
      e.preventDefault();
      clear();
      input.focus();
      return;
    }
    // ctrl+c: se tiver texto selecionado, copia normal. Senão, cancela a tarefa ou a linha.
    if (e.ctrlKey && k === 'c' && !e.shiftKey && !e.altKey) {
      const sel = getSelection();
      const inInput = document.activeElement === input && input.selectionStart !== input.selectionEnd;
      if ((sel && sel.toString()) || inInput) return;
      e.preventDefault();
      if (tasks.size) cancelLast();
      else if (input.value) { print(`<span class="dim">${esc(input.value)}^C</span>`); input.value = ''; }
      return;
    }
    // digitou fora do prompt: volta o foco pra ele
    if (document.activeElement !== input && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      input.focus();
    }
  });

  // clicar no terminal (sem selecionar texto) foca o prompt
  out.parentElement.addEventListener('mouseup', () => {
    if (!getSelection().toString()) input.focus({ preventScroll: true });
  });

  renderHint();

  return {
    log, tasks,
    emit, say, print, echo, error, clear, task,
    replay: e => row(fmt(e), 'lg lv-' + LEVEL_CLASS[e.level]),
    ok: (src, html) => emit('OK', src, html),
    info: (src, html) => emit('INF', src, html),
    warn: (src, html) => emit('WRN', src, html),
    history: () => hist,
    renderHint,
    focus: () => input.focus({ preventScroll: true }),
  };
}
