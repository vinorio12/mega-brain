// Desenhos que várias áreas usam: números das notas (#3) e do acervo (a2), diário de notas,
// cartões do acervo, linha de tarefa (t1), grupos de tarefas, tabela e busca agrupada por tipo.
// Uma das áreas da linguagem de comandos: js/commands.js junta todas (veja o comentário de lá).

import { esc, hl, dayKey, hhmm, ddmm, DOW } from '../util.js';
import { fmtDue } from '../dates.js';
import { isLink, isAcervo, safeUrl, shortUrl } from '../acervo.js';
import { isTask, doneAt, projectOf, firstStatus, statusOf, prioOf, isNoteKind } from '../tasks.js';
import { fmtValor } from '../valores.js';

export function criarTela(kit) {
  const { S, term, ctx } = kit;

  // Números por módulo (estáveis, em ordem de criação): notas #1 #2 · acervo a1 a2 · tarefas t1 t2 (da última lista)
  const isNote = isNoteKind; // só nota de verdade (kinds novos, como gasto, não entram no /inbox)
  const notesPool = () => S.entries.filter(isNote);
  const acervoPool = () => S.entries.filter(isAcervo);
  function nums() {
    const m = new Map();
    let n = 0, a = 0;
    for (const e of S.entries) {
      if (isNote(e)) m.set(e.id, '#' + ++n);
      else if (isAcervo(e)) m.set(e.id, 'a' + ++a);
    }
    return m;
  }

  /* ---------- cada módulo com a sua cara ---------- */

  // NOTAS: diário, separado por dia · hora · texto · número discreto à direita
  function noteRows(items) {
    const num = nums(), now = new Date();
    const today = dayKey(now), yest = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    let lastDay = null;
    for (const e of items.slice().sort((a, b) => a.ts - b.ts)) {
      const d = new Date(e.ts), k = dayKey(d);
      if (k !== lastDay) {
        lastDay = k;
        term.print(`${k === today ? 'hoje · ' : k === yest ? 'ontem · ' : ''}${DOW[d.getDay()]} ${ddmm(d)}`, 'nday');
      }
      term.print(`<span class="nt">${hhmm(d)}</span><span class="nx">${hl(e.text)}</span><span class="nn">${num.get(e.id) || ''}</span>`, 'note');
    }
  }

  // ACERVO: cartões · link com o domínio em destaque · texto como citação
  function acervoCards(items) {
    const num = nums();
    const when = e => { const d = new Date(e.ts); return `${ddmm(d)} ${hhmm(d)}`; };
    const cards = items.map(e => {
      const n = num.get(e.id) || '';
      if (isLink(e)) {
        const url = safeUrl(e.data?.url);
        let host = '', path = '';
        try { const u = new URL(url); host = u.hostname.replace(/^www\./, ''); path = shortUrl(url, 60).slice(host.length) || '/'; } catch { host = shortUrl(e.text); }
        const ctxText = e.data?.contexto || '';
        const inner = `<span class="ah"><b>↗ ${esc(host)}</b><span class="an">${n}</span></span><span class="ap">${esc(path)}</span>` +
          (ctxText ? `<span class="ac">${hl(ctxText)}</span>` : '') + `<span class="ad">${when(e)}</span>`;
        return url ? `<a class="acard is-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<div class="acard is-link">${inner}</div>`;
      }
      return `<div class="acard is-snip"><span class="ah"><b>» texto</b><span class="an">${n}</span></span><span class="aq">${hl(e.text)}</span><span class="ad">${when(e)}</span></div>`;
    }).join('');
    term.print(`<div class="acv">${cards}</div>`, 'block');
  }

  // genérico: escolhe o desenho pelo tipo (usado pela busca e quando algo é ambíguo)
  function list(items, title) {
    if (!items.length) return term.say(`nada em ${esc(title)}.`);
    term.print(`── ${esc(title)} ${'─'.repeat(10)}`, 'sep');
    showByType(items);
  }
  function showByType(items) {
    const tasks = items.filter(isTask), notes = items.filter(isNote), acv = items.filter(isAcervo);
    if (tasks.length) { S.taskList = tasks.map(e => e.id); tasks.forEach((e, i) => taskLine(i + 1, e)); }
    if (notes.length) noteRows(notes);
    if (acv.length) acervoCards(acv);
    // gasto, entrada, treino: só o dado bruto por enquanto (telas nas Fases 3 e 4)
    for (const e of items.filter(e => !isTask(e) && !isNote(e) && !isAcervo(e))) {
      const d = e.data || {};
      const extra = d.valor !== undefined ? fmtValor(d.valor) : [d.duracao_min ? d.duracao_min + 'min' : '', d.distancia_km ? d.distancia_km + 'km' : ''].filter(Boolean).join(' ');
      const dt = d.data ? d.data.slice(8, 10) + '.' + d.data.slice(5, 7) : '';
      term.print(`<span class="c-meta">${esc(dt)}</span> <span class="c-int">${esc(e.kind)}</span> ${hl(e.text)}${extra ? ` <span class="c-act">${esc(extra)}</span>` : ''}`);
    }
  }

  // link clicável (sempre http/https, abre em aba nova sem acesso ao app) + contexto
  function linkHtml(e) {
    const url = safeUrl(e.data?.url);
    if (!url) return hl(e.text);
    const ctxText = e.data?.contexto || '';
    return `<a class="lnk" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(shortUrl(url, 32))}</a>${ctxText ? ' ' + hl(ctxText) : ''}`;
  }

  // busca e acervo: um grupo por tipo, cada um com a sua cara
  function showSearch(res, title) {
    if (!res.total) return term.say(`nada encontrado${res.q ? ` pra "${esc(res.q)}"` : ''}${res.tipo ? ' em ' + esc(res.tipo) : ''}.`);
    term.print(`── ${esc(title)} · ${res.total} ${'─'.repeat(8)}`, 'sep');
    for (const g of res.groups) {
      term.print(`${esc(g.title)} <span class="c-meta">${g.items.length}</span>`, 'tgrp');
      showByType(g.items);
    }
  }

  const table = (rows, cls = '') => rows.forEach(([k, v]) => term.print(`<span class="k">${k}</span><span>${v}</span>`, 'tbl ' + cls));

  // uma linha de tarefa:  t3  [~]  revisar cap 2  #tcc !alta @fazendo        sex 02.10
  //   caixa: [ ] primeiro status · [~] em andamento (outros abertos) · [x] concluída
  //   opts.hide: campos que a visão já mostra no título do grupo (ex: 'projeto' na lista por projeto)
  function taskLine(n, e, now = new Date(), opts = {}) {
    const reg = ctx.reg();
    const done = !!doneAt(e);
    const st = statusOf(e), pr = prioOf(e), proj = projectOf(e, reg.projects);
    const due = e.data?.prazo ? fmtDue(e.data.prazo, now) : '';
    const tone = done ? 'c-meta' : due.startsWith('atrasada') ? 'c-warn' : due === 'hoje' ? 'c-act' : 'c-meta';
    const box = done ? '<span class="c-act">[x]</span>' : st === firstStatus(reg) ? '[ ]' : '<span class="c-int">[~]</span>';
    const hide = new Set(opts.hide || []);
    const meta = [
      proj && !hide.has('projeto') ? `<span class="c-act">#${esc(proj)}</span>` : '',
      pr === 'alta' && !done ? '<span class="c-warn">!alta</span>' : pr === 'baixa' && !done ? '<span class="dim">!baixa</span>' : '',
      !done && st !== firstStatus(reg) && !hide.has('status') ? `<span class="c-int">@${esc(st)}</span>` : '',
    ].filter(Boolean).join(' ');
    // o texto sem a #tag do projeto (ela já aparece no meta)
    const text = proj ? e.text.replace(new RegExp(`\\s*#${proj}(?![\\p{L}\\p{N}_-])`, 'giu'), '') : e.text;
    term.print(
      `<span class="n">t${n}</span>` +
      `<span class="bx">${box}</span>` +
      `<span class="${done ? 'done' : ''}">${hl(text)}${meta ? ` <span class="tmeta">${meta}</span>` : ''}</span>` +
      `<span class="due ${tone}">${esc(due)}</span>`, 'task' + (opts.cls ? ' ' + opts.cls : ''));
  }

  // mostra grupos de tarefas numerados t1, t2... e guarda essa numeração pros próximos comandos
  //   hide: campos que o título do grupo já mostra (não repetem em cada linha)
  function showTaskGroups(groups, list, fmtTitle = g => g.title, hide = []) {
    S.taskList = list;
    let n = 0;
    for (const g of groups) {
      term.print(`${esc(fmtTitle(g))} <span class="c-meta">${g.items.length}</span>`, 'tgrp');
      for (const e of g.items) taskLine(++n, e, new Date(), { hide });
    }
  }

  const defs = [];
  return { defs, isNote, notesPool, acervoPool, nums, noteRows, acervoCards, list, showByType, linkHtml, showSearch, table, taskLine, showTaskGroups };
}
