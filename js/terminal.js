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

export function createTerminal({ out, input, form, hint, completions, privacy, onSubmit, onChange, clicavel = null, compacto = null, histKey = HIST_KEY }) {
  const log = [];
  const tasks = new Map();
  let seq = 0;
  let hist = [];
  try { hist = JSON.parse(localStorage.getItem(histKey)) || []; } catch {}
  let hi = hist.length;
  let draft = '';
  let flashTimer = null;

  /* ---------- saída ---------- */

  const nearBottom = () => out.scrollHeight - out.scrollTop - out.clientHeight < 60;

  // sugestão em ciano que só MOSTRA coisas ("/mes -1", "/tarefas tcc") vira clicável sozinha;
  // as que gravam só viram botão quando o código cria de propósito (chip), pra um toque sem querer não criar dados
  function linkify(d) {
    if (!clicavel) return;
    for (const s of d.querySelectorAll('span.c-int, span.c-hud')) {
      const v = s.textContent.trim();
      if (s.closest('[data-cmd], a, button') || !/^\/[a-zà-ú]/i.test(v) || /[<>[\]|…]/.test(v) || !clicavel(v)) continue;
      s.dataset.cmd = v;
      s.classList.add('cmdlink');
    }
  }

  function row(html, cls = '', force = false) {
    const stick = force || nearBottom(); // se você rolou pra cima pra ler, não puxa pra baixo
    const d = document.createElement('div');
    d.className = 'row ' + cls;
    d.innerHTML = html;
    linkify(d);
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

  // resposta curta (sem /detalhes): "✓ f2 · saúde · aprendi" no lugar de "16:48 OK fin f2 · saúde · aprendi · T0008"
  // (o log guarda a linha inteira; os erros aparecem sempre completos, o código E_… ajuda a entender)
  const MARCA = { OK: '✓', WRN: '!', INF: '·' };
  const semTecnico = html => html.replace(/\s*·\s*T\d{4}(?:\s*·\s*\d+ms)?/g, '').replace(/<span class="c-meta">\s*<\/span>/g, '');
  function emit(level, src, html, { show = true } = {}) {
    const e = { ts: Date.now(), level, src, html, text: toText(html) };
    log.push(e);
    if (show && compacto?.() && MARCA[level]) row(`<span class="mk">${MARCA[level]}</span> ${semTecnico(html)}`, 'lg-c lv-' + LEVEL_CLASS[level]);
    else if (show) row(fmt(e), 'lg lv-' + LEVEL_CLASS[level]);
    onChange('log', e);
    return e;
  }

  function say(html) {
    emit('AI', 'core', html, { show: false });
    row(html, 'say');
  }

  const print = (html, cls = '') => row(html, cls);

  function echo(text) {
    // um "desfazer" de antes desfaria outra coisa: some quando você manda o próximo comando
    out.querySelectorAll('.chip.is-undo:not(.is-used)').forEach(b => b.classList.add('is-used'));
    row(`<span class="ps-caret">›</span>${esc(text)}`, 'echo', true);
  }

  function error(err) {
    const code = err.code || 'E_INTERNAL';
    const src = err.src || 'core';
    const hintHtml = err.hint ? `<span class="hint">→ ${err.hint}</span>` : '';
    emit('ERR', src, `<b class="code">${esc(code)}</b> ${esc(err.message || 'erro inesperado')}${hintHtml}`);
    onChange('fault', err);
    if (!(err instanceof CmdError) && !err.code) console.error(err);
  }

  function clear() {
    out.innerHTML = '';
    print(`<span class="dim">visualização limpa · ${log.length} eventos continuam no log · /log mostra</span>`);
  }

  /* ---------- tarefas assíncronas (com ID e cancelamento) ---------- */

  // kind: 'proc' = processando (rede, leitura) · 'exec' = executando (grava na memória)
  async function task(label, fn, { announce = false, kind = 'proc' } = {}) {
    const id = 'T' + pad(++seq, 4);
    const ctrl = new AbortController();
    const t0 = performance.now();
    const t = { id, label, kind, t0, ctrl, elapsed: () => Math.round(performance.now() - t0) };
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
      changed();
    } else {
      print(hits.map(h => `<span class="c-hud">${esc(h)}</span>`).join('   '), 'opts');
    }
  }

  /* ---------- teclado ---------- */

  /* ---------- cursor de bloco (estilo Unix) ---------- */
  // Fonte monoespaçada: a posição do cursor é (letras antes dele × largura de uma letra).
  // Em tela de toque, ou quando não dá pra calcular, fica o cursor nativo do navegador.
  const cursor = form.querySelector('.cursor');
  const fine = matchMedia('(pointer: fine)').matches;
  let charW = 0;
  function measure() {
    const cs = getComputedStyle(input);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    charW = c.measureText('M').width;
  }
  function placeCursor() {
    if (!cursor || !fine) return;
    if (!charW) measure();
    const pos = input.selectionStart ?? input.value.length;
    const sel = input.selectionStart !== input.selectionEnd;
    const x = input.offsetLeft + pos * charW - input.scrollLeft;
    const fits = x >= input.offsetLeft && x <= input.offsetLeft + input.clientWidth - charW;
    cursor.style.transform = `translateX(${x}px)`;
    cursor.style.width = charW + 'px';
    const on = document.activeElement === input && !sel && fits;
    form.classList.toggle('block-cursor', on);
    // reinicia o piscar a cada movimento: o cursor fica aceso enquanto você digita
    cursor.classList.remove('blink');
    void cursor.offsetWidth;
    cursor.classList.add('blink');
  }
  if (fine) {
    for (const ev of ['input', 'click', 'focus', 'blur', 'select', 'keyup']) input.addEventListener(ev, placeCursor);
    input.addEventListener('keydown', () => requestAnimationFrame(placeCursor));
    addEventListener('resize', () => { charW = 0; placeCursor(); });
    document.fonts?.ready.then(() => { charW = 0; placeCursor(); });
  }

  // avisa o app quando você digita (o núcleo entra em LISTENING e reage às teclas)
  const changed = () => { onChange('input', input.value); placeCursor(); };
  input.addEventListener('input', changed);
  input.addEventListener('keydown', e => { if (e.key.length === 1 || e.key === 'Backspace') onChange('key'); });

  const setInput = v => {
    input.value = v;
    changed();
    requestAnimationFrame(() => { input.setSelectionRange(v.length, v.length); placeCursor(); });
  };

  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const v = input.value.trim();
    input.value = '';
    changed();
    if (!v) return;
    const priv = privacy?.(v); // 'mask' = esconde na tela · 'nohist' = só não guarda no histórico
    if (!priv && hist[hist.length - 1] !== v) {
      hist.push(v);
      hist = hist.slice(-200);
      try { localStorage.setItem(histKey, JSON.stringify(hist)); } catch {}
    }
    hi = hist.length;
    draft = '';
    echo(priv === 'mask' ? '•'.repeat(v.length) : v);
    onSubmit(v);
  });

  // Botões tocáveis: <button data-cmd="/forma pix f3"> roda o comando como se você tivesse digitado.
  // Um botão de uma pergunta respondida apaga os irmãos dela (não dá pra responder duas vezes).
  out.addEventListener('click', ev => {
    const b = ev.target.closest('[data-cmd]');
    if (!b || !out.contains(b)) return;
    ev.preventDefault();
    const v = b.dataset.cmd;
    b.closest('.chips')?.classList.add('is-used');
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
      changed();
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
      else if (input.value) { print(`<span class="dim">${esc(input.value)}^C</span>`); input.value = ''; changed(); }
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
    // { show: false } = só vai pro log (/log mostra), sem linha na tela (a resposta curta já disse o que importa)
    ok: (src, html, o) => emit('OK', src, html, o),
    info: (src, html, o) => emit('INF', src, html, o),
    warn: (src, html, o) => emit('WRN', src, html, o),
    history: () => hist,
    renderHint,
    placeCursor,
    focus: () => { input.focus({ preventScroll: true }); placeCursor(); },
  };
}
