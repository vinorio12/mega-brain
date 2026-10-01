// Linguagem de comandos do Mega Brain.
// Não executa nada do sistema operacional: cada comando é uma função daqui.
//
// Pra criar um comando novo, adicione um objeto na lista `defs`:
//   name   nome usado depois da barra
//   alias  outros nomes aceitos
//   args   como usar (aparece no /ajuda)
//   desc   o que faz
//   async  true se demora (ganha ID de tarefa e pode ser cancelado com ctrl+c)
//   run    a função

import { esc, hl, dayKey, hhmm, ddmm, dur, lev, kb, tagsOf, uid, CmdError, VERSION, DOW } from './util.js';
import { geocode, locate, fetchWeather, savedPlace, describe } from './weather.js';
import { fmtDue, parseDue } from './dates.js';
import { isTask, doneAt, projName, parseTaskInput, newTask, groupTasks, doneHistory, projectsSummary, taskNumbers, taskStats } from './tasks.js';

export const PHASES = [
  ['0', 'esqueleto · terminal, hud, inbox', 'ok'],
  ['0.5', 'app próprio · pwa, nuvem, login', 'ok'],
  ['1', 'tarefas e projetos · hoje, tcc, weg, pessoal', 'wip'],
  ['2', 'ia intérprete · escrever sem decorar comando', ''],
  ['3', 'finanças · gastos, entradas, saldo do mês', ''],
  ['4', 'corpo e hábitos · treino, saúde, padrão semanal', ''],
  ['5', 'dashboards · gráficos e tendências', ''],
  ['6', 'coach · resumo do dia, revisão da semana', ''],
];

// Decide quais entradas um "/apagar ..." está pedindo. Função pura (não apaga nada), testada em tests/.
//   números: "3", "1 2 3", "1,2,3", "1-4", "#2"  → { mode: 'num', targets: [{n, e}], bad: ['#9', ...] }
//   texto:   "comprar café"                      → { mode: 'text', targets: [{n, e}] }  (todas que contêm o texto)
export function pickTargets(raw, entries) {
  const tokens = String(raw).trim().split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) return { mode: 'empty', targets: [], bad: [] };

  if (tokens.every(x => /^#?\d+(-#?\d+)?$/.test(x))) {
    const nums = new Set(), bad = [];
    for (const tk of tokens) {
      const [a, b] = tk.replace(/#/g, '').split('-').map(Number);
      const lo = Math.min(a, b ?? a), hi = Math.min(Math.max(a, b ?? a), entries.length);
      if (lo < 1 || lo > hi) { bad.push(tk.replace(/#/g, '')); continue; }
      for (let n = lo; n <= hi; n++) nums.add(n);
      const top = Math.max(a, b ?? a), from = entries.length + 1;
      if (b != null && top >= from) bad.push(top === from ? String(from) : `${from}-${top}`);
    }
    const targets = [...nums].sort((x, y) => x - y).map(n => ({ n, e: entries[n - 1] }));
    return { mode: 'num', targets, bad };
  }

  const q = String(raw).trim().toLowerCase();
  const targets = entries.map((e, i) => ({ n: i + 1, e })).filter(({ e }) => String(e.text).toLowerCase().includes(q));
  return { mode: 'text', targets, bad: [] };
}

// Decide o que entra num /importar. Função pura, testada em tests/.
// Aceita o arquivo do /exportar ({ entries: [...] }) ou uma lista simples.
// Nunca sobrescreve: pula o que já existe (mesmo id, ou mesmo texto no mesmo horário).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function prepareImport(json, existing) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.entries) ? json.entries : null;
  if (!list) return null;
  const ids = new Set(existing.map(e => e.id));
  const sigs = new Set(existing.map(e => e.ts + '|' + e.text));
  const toAdd = [];
  let skipped = 0, invalid = 0;
  for (const r of list) {
    const text = typeof r?.text === 'string' ? r.text.trim() : '';
    const ts = Number(r?.ts);
    if (!text || text.length > 10000 || !Number.isFinite(ts) || ts <= 0) { invalid++; continue; }
    const sig = ts + '|' + text;
    if (ids.has(r.id) || sigs.has(sig)) { skipped++; continue; }
    const e = {
      id: UUID.test(r.id || '') ? r.id : uid(),
      text,
      tags: Array.isArray(r.tags) ? r.tags.map(String) : tagsOf(text),
      kind: typeof r.kind === 'string' ? r.kind : 'nota',
      ts,
      day: /^\d{4}-\d{2}-\d{2}$/.test(r.day || '') ? r.day : dayKey(new Date(ts)),
    };
    if (r.data && typeof r.data === 'object') e.data = r.data;
    ids.add(e.id);
    sigs.add(sig);
    toAdd.push(e);
  }
  return { toAdd, skipped, invalid };
}

export function createCommands(ctx) {
  const { S, term } = ctx;
  const usage = (name, args) => new CmdError('E_ARG', 'shell', 'argumento faltando ou inválido', `uso: <span class="c-hud">/${name} ${esc(args)}</span>`);

  const numberOf = () => new Map(S.entries.map((e, i) => [e.id, i + 1]));

  function list(items, title) {
    if (!items.length) return term.say(`nada em ${esc(title)}.`);
    term.print(`── ${esc(title)} ${'─'.repeat(10)}`, 'sep');
    const num = numberOf();
    for (const e of items) {
      const d = new Date(e.ts);
      // tarefas aparecem com a caixinha [ ] / [x]
      const box = isTask(e) ? (doneAt(e) ? '<span class="c-act">[x]</span> ' : '<span class="c-meta">[ ]</span> ') : '';
      term.print(`<span class="n">#${num.get(e.id)}</span><span class="d">${ddmm(d)} ${hhmm(d)}</span><span>${box}${hl(e.text)}</span>`, 'ent');
    }
  }

  const table = (rows, cls = '') => rows.forEach(([k, v]) => term.print(`<span class="k">${k}</span><span>${v}</span>`, 'tbl ' + cls));

  /* ---------- tarefas ---------- */

  // uma linha de tarefa: t3  [ ]  revisar cap 2 #tcc        sex 02.10
  function taskLine(n, e, now = new Date()) {
    const done = !!doneAt(e);
    const due = e.data?.prazo ? fmtDue(e.data.prazo, now) : '';
    const tone = done ? 'c-meta' : due.startsWith('atrasada') ? 'c-warn' : due === 'hoje' ? 'c-act' : 'c-meta';
    term.print(
      `<span class="n">t${n}</span>` +
      `<span class="bx">${done ? '<span class="c-act">[x]</span>' : '[ ]'}</span>` +
      `<span class="${done ? 'done' : ''}">${hl(e.text)}</span>` +
      `<span class="due ${tone}">${esc(due)}</span>`, 'task');
  }

  // mostra grupos de tarefas numerados t1, t2... e guarda essa numeração pros próximos comandos
  function showTaskGroups(groups, list, fmtTitle = g => g.title) {
    S.taskList = list;
    let n = 0;
    for (const g of groups) {
      term.print(`${esc(fmtTitle(g))} <span class="c-meta">${g.items.length}</span>`, 'tgrp');
      for (const e of g.items) taskLine(++n, e);
    }
  }

  // a lista que os números t1, t2... estão usando agora (a última mostrada, ou a padrão da aba)
  function taskPool() {
    if (!S.taskList?.length) S.taskList = groupTasks(S.entries, { proj: S.ctx }).list;
    const byId = new Map(S.entries.map(e => [e.id, e]));
    // mantém as posições: se uma tarefa sumiu, os números das outras não mudam
    return S.taskList.map(id => byId.get(id) || { id: null, text: '', missing: true });
  }

  // "t1 t3", "1-4" ou texto → [{ n, e }]. Texto ambíguo lista as opções e devolve null.
  function resolveTasks(raw, cmd, example) {
    const pool = taskPool();
    const nums = taskNumbers(raw);
    const pick = pickTargets(nums ?? raw, pool);
    if (pick.mode === 'empty') throw usage(cmd, example);
    const targets = pick.targets.filter(x => !x.e.missing);
    if (nums) {
      const bad = [...pick.bad, ...pick.targets.filter(x => x.e.missing).map(x => String(x.n))];
      if (!targets.length) throw new CmdError('E_ARG', 'task', 'nenhuma tarefa com esse número', 'os números (t1, t2...) aparecem no <span class="c-hud">/tarefas</span>');
      if (bad.length) term.warn('task', `ignoradas (não existem): ${bad.map(n => 't' + esc(n)).join(' ')}`);
      return targets;
    }
    if (!targets.length) throw new CmdError('E_404', 'task', `nenhuma tarefa da lista contém "${raw}"`, 'veja a lista com <span class="c-hud">/tarefas</span>');
    if (targets.length > 1) {
      term.print(`── "${esc(raw)}" bate com ${targets.length} tarefas`, 'sep');
      targets.forEach(({ n, e }) => taskLine(n, e));
      term.say(`não mexi em nada. escolha pelo número, ex: <span class="c-hud">/${cmd} t${targets[0].n}</span>`);
      return null;
    }
    return targets;
  }

  // grava novas versões das tarefas e guarda as antigas pro /desfazer
  async function updateTasks(targets, change, label) {
    const before = targets.map(x => x.e);
    for (const { e } of targets) await ctx.store.restore({ ...e, data: { ...(e.data || {}), ...change(e) } });
    S.undo.push({ label, items: before });
  }

  const projLabel = p => (p ? '#' + p : 'todas');
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  async function addTask(raw, t) {
    const p = parseTaskInput(raw, S.ctx);
    if (p.error === 'vazio') throw usage('t', 'revisar cap 2 #tcc >sex');
    if (p.error === 'prazo') throw new CmdError('E_PRAZO', 'task', `não entendi o prazo ${p.token}`, 'use <span class="c-hud">>hoje >amanhã >sex >15/10 >+3</span>');
    const e = await ctx.store.add(newTask(p));
    // entra no fim da lista atual, pra já ter um número
    if (!S.taskList?.length) S.taskList = groupTasks(S.entries, { proj: S.ctx }).list;
    else if (!S.taskList.includes(e.id)) S.taskList.push(e.id);
    const n = S.taskList.indexOf(e.id) + 1;
    S.lastLatency = t.elapsed();
    const queued = ctx.store.pending() > 0;
    term[queued ? 'warn' : 'ok']('task',
      `tarefa${queued ? ' na fila' : ''} <span class="c-meta">t${n}</span> · ${hl(e.text)}` +
      (p.prazo ? ` · <span class="c-hud">${esc(fmtDue(p.prazo))}</span>` : '') +
      ` <span class="c-meta">· ${t.id} · ${S.lastLatency}ms</span>`);
    ctx.ui.pulse(queued ? 'warn' : 'act');
  }

  const defs = [
    {
      name: 'ajuda', alias: ['help', '?'], args: '[comando]', desc: 'lista os comandos, ou detalha um',
      run(arg) {
        if (arg) {
          const c = get(arg.replace(/^\//, ''));
          if (!c) throw notFound(arg.replace(/^\//, ''));
          table([
            ['uso', `<span class="c-act">/${c.name}</span> ${esc(c.args || '')}`],
            ['faz', esc(c.desc)],
            ['atalhos', c.alias?.length ? c.alias.map(a => '/' + esc(a)).join(' ') : '<span class="dim">—</span>'],
            ['tipo', c.async ? 'assíncrono · ganha ID, ctrl+c cancela' : 'imediato'],
          ]);
          return;
        }
        table([['qualquer texto', 'captura na inbox · use #tags: <span class="dim">ler cap 2</span> <span class="c-act">#tcc</span>']], 'cmd');
        table([['- texto #proj >sex', 'cria tarefa (igual ao /t)']], 'cmd');
        const groups = [
          ['tarefas e projetos', c => ['t', 'tarefas', 'feito', 'reabrir', 'adiar', 'feitas', 'projetos', 'ir'].includes(c.name)],
          ['memória', c => c.data],
          ['conta', c => ['entrar', 'codigo', 'sair'].includes(c.name)],
          ['tela', c => ['painel', 'foco', 'limpar', 'log', 'historico'].includes(c.name)],
        ];
        const used = new Set();
        const section = (title, pick) => {
          const list = defs.filter(c => !used.has(c) && pick(c));
          if (!list.length) return;
          list.forEach(c => used.add(c));
          term.print(`── ${title}`, 'sep');
          table(list.map(c => [`/${c.name}${c.args ? ' ' + esc(c.args) : ''}`, esc(c.desc)]), 'cmd');
        };
        groups.forEach(([title, pick]) => section(title, pick));
        section('sistema', () => true);
        term.print('── teclado', 'sep');
        table([
          ['tab', 'completa /comandos e #tags'],
          ['↑ ↓', 'navega no histórico'],
          ['ctrl+c', 'cancela a tarefa em andamento'],
          ['ctrl+k', 'limpa a tela (o log continua)'],
          ['ctrl+.', 'mostra/esconde a telemetria'],
          ['alt+1..4', 'abas: ~ · tcc · weg · pessoal'],
          ['esc', 'apaga a linha'],
        ]);
      },
    },
    {
      name: 'inbox', data: true, alias: ['ls'], args: '[n]', desc: 'últimas n entradas (padrão 10)',
      run(arg) {
        const n = Math.max(1, Math.min(500, parseInt(arg, 10) || 10));
        const items = S.entries.slice(-n);
        list(items, `inbox · ${items.length} de ${S.entries.length}`);
      },
    },
    {
      name: 'hoje', data: true, desc: 'o que entrou hoje + tarefas de hoje e atrasadas',
      run() {
        const k = dayKey(new Date());
        list(S.entries.filter(e => e.day === k), 'entrou hoje');
        const { groups } = groupTasks(S.entries, { proj: S.ctx });
        const due = groups.filter(g => g.key === 'atrasadas' || g.key === 'hoje');
        if (due.length) {
          term.print(`── tarefas pra hoje ${'─'.repeat(10)}`, 'sep');
          showTaskGroups(due, due.flatMap(g => g.items.map(e => e.id)));
        }
      },
    },
    /* ---------- tarefas e projetos (Fase 1) ---------- */
    {
      name: 't', alias: ['tarefa', 'todo'], data: true, async: true, args: '<texto> [#projeto] [>prazo]',
      desc: 'cria tarefa · ex: revisar cap 2 #tcc >sex (ou comece a linha com "- ")',
      async run(arg, signal, t) { await addTask(arg, t); },
    },
    {
      name: 'tarefas', alias: ['ts'], data: true, args: '[projeto | todas]',
      desc: 'tarefas abertas: atrasadas, hoje, próximas, sem prazo, feitas hoje',
      run(arg) {
        const a = String(arg).trim().toLowerCase();
        const proj = !a ? S.ctx : ['todas', 'tudo', '*', '~'].includes(a) ? null : projName(a);
        if (a && proj === null && !['todas', 'tudo', '*', '~'].includes(a)) throw usage('tarefas', '[projeto] · ex: /tarefas tcc');
        const { groups, list: ids } = groupTasks(S.entries, { proj });
        if (!groups.length) {
          S.taskList = [];
          return term.say(`nenhuma tarefa em ${esc(projLabel(proj))}. crie com <span class="c-hud">- revisar cap 2${proj ? ' #' + esc(proj) : ''} >sex</span>`);
        }
        term.print(`── tarefas · ${esc(projLabel(proj))} ${'─'.repeat(10)}`, 'sep');
        showTaskGroups(groups, ids);
        term.print('<span class="dim">/feito t1 · /adiar t1 sex · /apagar t1 · /feitas histórico</span>');
      },
    },
    {
      name: 'feito', alias: ['ok', 'x', 'done'], data: true, async: true, args: '<t1 t2 | t1-t3 | texto>',
      desc: 'conclui tarefas (fica riscada até o fim do dia)',
      async run(arg, signal, t) {
        const targets = resolveTasks(arg, 'feito', 't1  ·  t1 t3  ·  t1-t4');
        if (!targets) return;
        const open = targets.filter(x => !doneAt(x.e));
        if (!open.length) return term.say('essas já estavam concluídas.');
        await updateTasks(open, () => ({ feito: Date.now() }), open.length === 1 ? 'conclusão' : `${open.length} conclusões`);
        S.lastLatency = t.elapsed();
        term.ok('task', `concluída${open.length > 1 ? 's ' + open.length : ''} · ${open.map(x => `t${x.n} ${hl(x.e.text)}`).join(' · ')} <span class="c-meta">· ${t.id} · ${S.lastLatency}ms</span>`);
        const s = taskStats(S.entries);
        if (s.abertas === 0) term.say('nenhuma tarefa aberta. respira. ✓');
        ctx.ui.pulse('act');
      },
    },
    {
      name: 'reabrir', alias: ['reopen'], data: true, async: true, args: '<t1 ...>',
      desc: 'desfaz a conclusão de uma tarefa',
      async run(arg, signal, t) {
        const targets = resolveTasks(arg, 'reabrir', 't1');
        if (!targets) return;
        const done = targets.filter(x => doneAt(x.e));
        if (!done.length) return term.say('essas já estão abertas.');
        await updateTasks(done, () => ({ feito: null }), 'reabertura');
        term.ok('task', `reaberta${done.length > 1 ? 's ' + done.length : ''} · ${done.map(x => `t${x.n} ${hl(x.e.text)}`).join(' · ')} <span class="c-meta">· ${t.id}</span>`);
        ctx.ui.pulse('hud');
      },
    },
    {
      name: 'adiar', alias: ['prazo'], data: true, async: true, args: '<t1 ...> <prazo | sem>',
      desc: 'muda o prazo · ex: /adiar t2 sex · /adiar t1 t3 +2 · /adiar t4 sem',
      async run(arg, signal, t) {
        const words = String(arg).trim().split(/\s+/);
        const when = (words.pop() || '').replace(/^>/, '');
        const which = words.join(' ');
        if (!which || !when) throw usage('adiar', 't2 sex  ·  t1 t3 +2  ·  t4 sem');
        const clear = ['sem', 'nenhum', '-', 'limpar'].includes(when.toLowerCase());
        const prazo = clear ? null : parseDue(when);
        if (!clear && !prazo) throw new CmdError('E_PRAZO', 'task', `não entendi o prazo ${when}`, 'use <span class="c-hud">hoje amanhã sex 15/10 +3</span> ou <span class="c-hud">sem</span>');
        const targets = resolveTasks(which, 'adiar', 't2 sex');
        if (!targets) return;
        await updateTasks(targets, () => ({ prazo }), 'mudança de prazo');
        term.ok('task', `prazo ${prazo ? '→ <span class="c-hud">' + esc(fmtDue(prazo)) + '</span>' : 'removido'} · ${targets.map(x => `t${x.n} ${hl(x.e.text)}`).join(' · ')} <span class="c-meta">· ${t.id}</span>`);
        ctx.ui.pulse('hud');
      },
    },
    {
      name: 'feitas', alias: ['concluidas'], data: true, args: '[projeto] [dias]',
      desc: 'histórico de tarefas concluídas · ex: /feitas · /feitas tcc 30',
      run(arg) {
        let proj = S.ctx, days = 7;
        for (const w of String(arg).trim().split(/\s+/).filter(Boolean)) {
          if (/^\d+$/.test(w)) days = Math.min(3650, Math.max(1, +w));
          else if (['todas', 'tudo', '*', '~'].includes(w.toLowerCase())) proj = null;
          else proj = projName(w);
        }
        const h = doneHistory(S.entries, { proj, days });
        if (!h.total) return term.say(`nenhuma tarefa concluída em ${esc(projLabel(proj))} nos últimos ${days} dias.`);
        term.print(`── feitas · ${esc(projLabel(proj))} · ${days} dias · ${h.total} ${'─'.repeat(6)}`, 'sep');
        const label = key => { const [y, m, d] = key.split('-').map(Number); const dt = new Date(y, m - 1, d); return `${DOW[dt.getDay()]} ${ddmm(dt)}`; };
        showTaskGroups(h.groups, h.list, g => label(g.key));
        term.print('<span class="dim">/reabrir t1 volta uma pra lista</span>');
      },
    },
    {
      name: 'projetos', alias: ['proj'], data: true, desc: 'cada #tag com tarefas abertas, atrasadas e notas',
      run() {
        const rows = projectsSummary(S.entries);
        if (!rows.length) return term.say('nenhum projeto ainda. use #tags: <span class="c-hud">- revisar cap 2 #tcc</span>');
        term.print(`── projetos ${'─'.repeat(10)}`, 'sep');
        rows.forEach(p => term.print(
          `<span class="k c-act">#${esc(p.proj)}</span><span>${plural(p.abertas, 'aberta')}` +
          (p.atrasadas ? ` · <span class="c-warn">${plural(p.atrasadas, 'atrasada')}</span>` : '') +
          ` <span class="dim">· ${plural(p.notas, 'nota')}</span></span>`, 'tbl'));
        term.print('<span class="dim">/tarefas tcc lista um projeto · /ir tcc entra nele</span>');
      },
    },
    {
      name: 'ir', alias: ['cd'], args: '<projeto | ~>', desc: 'entra numa aba (tudo ganha a #tag dela) · ~ volta pra inbox · alt+1..4',
      run(arg) {
        const a = String(arg).trim();
        if (!a || a === '~' || a === '/' || a === '..') return ctx.actions.setCtx(null);
        const p = projName(a);
        if (!p) throw usage('ir', 'tcc  ·  ~');
        ctx.actions.setCtx(p);
      },
    },
    {
      name: 'buscar', data: true, alias: ['grep', 'b'], args: '<termo>', desc: 'procura nas entradas (texto ou #tag)',
      run(arg) {
        if (!arg) throw usage('buscar', '<termo>');
        const q = arg.toLowerCase();
        const tag = q.startsWith('#') ? q.slice(1) : null;
        const hits = S.entries.filter(e => tag ? (e.tags || []).includes(tag) : String(e.text).toLowerCase().includes(q));
        list(hits, `busca "${arg}" · ${hits.length}`);
      },
    },
    {
      name: 'apagar', data: true, alias: ['rm'], args: '<n> | <n n n> | <n-n> | <texto>',
      desc: 'apaga por número (1 2 3 · 1-4) ou pelo texto (dá pra desfazer)', async: true,
      async run(arg, signal, t) {
        const raw = String(arg).trim();

        // números de tarefa (t1, t2-t4) usam a lista do /tarefas
        if (/^t\d/i.test(raw)) {
          const targets = resolveTasks(raw, 'apagar', 't1');
          if (!targets) return;
          for (const { e } of targets) await ctx.store.remove(e.id);
          S.undo.push({ label: targets.length === 1 ? 'tarefa apagada' : `${targets.length} tarefas apagadas`, items: targets.map(x => x.e) });
          S.lastLatency = t.elapsed();
          term.warn('task', `apagada${targets.length > 1 ? 's ' + targets.length : ''} · ${targets.map(x => `t${x.n} ${hl(x.e.text)}`).join(' · ')} <span class="c-meta">· ${t.id} · /desfazer recupera</span>`);
          ctx.ui.pulse('warn');
          return;
        }

        const pick = pickTargets(raw, S.entries);
        if (pick.mode === 'empty') throw usage('apagar', '1  ·  1 2 3  ·  1-4  ·  comprar café  ·  t2');
        const { targets } = pick;

        if (pick.mode === 'num') {
          if (!targets.length) throw new CmdError('E_ARG', 'shell', `nenhuma entrada com ${pick.bad.length > 1 ? 'esses números' : 'esse número'}`, 'os números aparecem no <span class="c-hud">/inbox</span>');
          if (pick.bad.length) term.warn('shell', `ignorados (não existem): ${pick.bad.map(n => '#' + esc(n)).join(' ')}`);
        } else {
          // pelo texto: só apaga sozinho se UMA entrada bater
          if (!targets.length) throw new CmdError('E_404', 'store', `nenhuma entrada contém "${raw}"`, 'confira com <span class="c-hud">/buscar</span>');
          if (targets.length > 1) {
            list(targets.map(h => h.e), `"${raw}" bate com ${targets.length} entradas`);
            term.say(`não apaguei nada, pra não sumir coisa errada. escolha pelos números, ex: <span class="c-hud">/apagar ${targets.slice(0, 3).map(h => h.n).join(' ')}</span>`);
            return;
          }
        }

        for (const { e } of targets) await ctx.store.remove(e.id);
        S.undo.push({ label: targets.length === 1 ? 'entrada apagada' : `${targets.length} entradas apagadas`, items: targets.map(x => x.e) }); // o lote inteiro volta com /desfazer
        S.lastLatency = t.elapsed();
        const meta = `<span class="c-meta">· ${t.id} · ${S.lastLatency}ms · /desfazer recupera</span>`;
        if (targets.length === 1) term.warn('store', `apagado #${targets[0].n} · ${hl(targets[0].e.text)} ${meta}`);
        else {
          term.warn('store', `apagadas ${targets.length} entradas ${meta}`);
          targets.forEach(({ n, e }) => term.print(`<span class="n">#${n}</span><span class="d"></span><span class="dim">${hl(e.text)}</span>`, 'ent'));
        }
        ctx.ui.pulse('warn');
      },
    },
    {
      name: 'desfazer', data: true, alias: ['undo'], desc: 'desfaz a última mudança (apagar, concluir, adiar...)', async: true,
      async run(arg, signal, t) {
        // cada item guarda as versões ANTERIORES; restaurar = voltar no tempo
        const step = S.undo.pop();
        if (!step) return term.say('nada pra desfazer.');
        for (const e of step.items) await ctx.store.restore(e);
        S.lastLatency = t.elapsed();
        const what = step.items.length === 1 ? hl(step.items[0].text) : `${step.items.length} itens`;
        term.ok('store', `desfeito · ${esc(step.label)} · ${what} <span class="c-meta">· ${t.id} · ${S.lastLatency}ms</span>`);
        ctx.ui.pulse('act');
      },
    },
    {
      name: 'status', alias: ['st'], desc: 'estado completo do sistema',
      run() {
        const k = dayKey(new Date());
        const state = ctx.ui.state();
        const wx = S.weather;
        const [memText, memTone] = ctx.ui.mem();
        const st = ctx.store?.status;
        table([
          ['estado', `<span class="${state === 'ready' ? 'c-act' : state === 'busy' ? 'c-hud' : 'c-warn'}">${state.toUpperCase()}</span>`],
          ['sessão', S.user ? esc(S.user.email) : S.locked ? '<span class="c-warn">bloqueada · digite seu e-mail</span>' : 'modo local'],
          ['memória', `<span class="${memTone === 'ok' ? 'c-act' : memTone === 'na' ? 'c-meta' : 'c-warn'}">${memText}</span>` +
            (ctx.store?.kind === 'local' ? ' <span class="dim">· só neste navegador</span>' : '') +
            (st?.lastSync ? ` <span class="dim">· último sync ${hhmm(new Date(st.lastSync))}</span>` : '') +
            (st?.lastError ? ` <span class="c-warn">· ${esc(st.lastError)}</span>` : '')],
          ['tempo real', st?.realtime ?? '<span class="dim">NA</span>'],
          ['tarefas', (s => `${s.abertas} abertas · hoje ${s.hoje}` + (s.atrasadas ? ` · <span class="c-warn">${s.atrasadas} atrasadas</span>` : '') + ` · feitas hoje ${s.feitasHoje}`)(taskStats(S.entries))],
          ['aba', S.ctx ? `<span class="c-act">~/${esc(S.ctx)}</span>` : '~ (inbox)'],
          ['entradas', `${S.entries.length} <span class="dim">· hoje ${S.entries.filter(e => e.day === k).length} · ${ctx.store ? kb(ctx.store.bytes()) : 'NA'}</span>`],
          ['rede', navigator.onLine ? '<span class="c-act">online</span>' : '<span class="c-err">offline</span>'],
          ['latência', S.lastLatency == null ? '<span class="dim">NA</span>' : `${S.lastLatency}ms <span class="dim">· última operação</span>`],
          ['clima', wx ? `${describe(wx.code).icon} ${Math.round(wx.temp)}° ${esc(wx.place.name)} <span class="dim">· ${hhmm(new Date(wx.at))}</span>` : '<span class="dim">NA · /clima ativa</span>'],
          ['tarefas', `${term.tasks.size} em execução`],
          ['sessão', dur(Date.now() - S.startedAt)],
          ['log', `${term.log.length} eventos`],
          ['versão', `${VERSION} · ${location.hostname || 'arquivo local'}`],
        ]);
      },
    },
    {
      name: 'clima', alias: ['wx'], args: '[cidade | aqui]', desc: 'clima agora · padrão jaraguá do sul · "aqui" usa sua localização', async: true, announce: true,
      async run(arg, signal, t) {
        const place = !arg ? savedPlace() : arg.toLowerCase() === 'aqui' ? await locate(signal) : await geocode(arg, signal);
        const w = await fetchWeather(place, signal);
        S.weather = w;
        const d = describe(w.code);
        table([
          ['local', `${esc(place.name)}${place.region ? ' <span class="dim">· ' + esc(place.region) + '</span>' : ''}`],
          ['agora', `${d.icon} ${d.text}`],
          ['temperatura', `${w.temp.toFixed(1)}° <span class="dim">· sensação ${Math.round(w.feels)}°</span>`],
          ['umidade', `${w.hum}%`],
          ['vento', `${Math.round(w.wind)} km/h`],
        ]);
        term.ok('wx', `clima atualizado · ${esc(place.name)} ${Math.round(w.temp)}° <span class="c-meta">· ${t.id} · ${t.elapsed()}ms · open-meteo</span>`);
        ctx.ui.render();
      },
    },
    {
      name: 'log', args: '[n]', desc: 'reimprime os últimos n eventos do log (padrão 40)',
      run(arg) {
        const n = Math.max(1, parseInt(arg, 10) || 40);
        const items = term.log.slice(-n);
        term.print(`── log · ${items.length} de ${term.log.length} ${'─'.repeat(10)}`, 'sep');
        items.forEach(term.replay);
      },
    },
    {
      name: 'historico', alias: ['history', 'h'], desc: 'comandos que você digitou',
      run() {
        const h = term.history().slice(-30);
        if (!h.length) return term.say('histórico vazio.');
        const start = term.history().length - h.length;
        h.forEach((c, i) => term.print(`<span class="n">${start + i + 1}</span><span class="d"></span><span>${esc(c)}</span>`, 'ent'));
      },
    },
    {
      name: 'exportar', data: true, alias: ['export'], desc: 'baixa uma cópia de todas as entradas (.json)',
      run() {
        const blob = new Blob([JSON.stringify({ app: 'mega-brain', version: VERSION, exportedAt: new Date().toISOString(), entries: S.entries }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `mega-brain-${dayKey(new Date())}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        term.ok('store', `exportadas ${S.entries.length} entradas · ${esc(a.download)}`);
      },
    },
    {
      name: 'entrar', alias: ['login'], desc: 'entra na sua conta (e-mail e senha)',
      run() { ctx.actions.login(); },
    },
    {
      name: 'codigo', alias: ['código', 'code'], desc: 'no login: manda um código pro e-mail em vez de usar senha', async: true,
      async run() { await ctx.actions.sendCode(); },
    },
    {
      name: 'sair', alias: ['logout'], desc: 'sai da conta e apaga a cópia deste aparelho', async: true,
      async run(arg, signal, t) { await ctx.actions.logout(t); },
    },
    {
      name: 'sync', desc: 'envia o que está na fila e busca a versão da nuvem', async: true, announce: true, data: true,
      async run(arg, signal, t) { await ctx.actions.sync(t); },
    },
    {
      name: 'migrar', desc: 'envia pra nuvem as notas que ficaram no modo local', async: true, announce: true, data: true,
      async run(arg, signal, t) { await ctx.actions.migrate(t); },
    },
    {
      name: 'instalar', alias: ['install'], desc: 'instala o Mega Brain como app neste aparelho',
      run() { ctx.actions.install(); },
    },
    {
      name: 'importar', alias: ['import'], data: true, desc: 'restaura notas de um backup .json (do /exportar) sem duplicar',
      run() {
        // o seletor de arquivo precisa abrir direto do Enter (o navegador exige um gesto seu)
        const pick = document.createElement('input');
        pick.type = 'file';
        pick.accept = '.json,application/json';
        pick.onchange = () => {
          const file = pick.files?.[0];
          if (!file) return;
          term.task(`/importar ${file.name}`, async (signal, t) => {
            let json;
            try { json = JSON.parse(await file.text()); }
            catch { throw new CmdError('E_IMPORT', 'store', 'o arquivo não é um JSON válido', 'use o arquivo gerado pelo <span class="c-hud">/exportar</span>'); }
            const plan = prepareImport(json, S.entries);
            if (!plan) throw new CmdError('E_IMPORT', 'store', 'não achei uma lista de entradas no arquivo', 'use o arquivo gerado pelo <span class="c-hud">/exportar</span>');
            for (const e of plan.toAdd) await ctx.store.restore(e);
            S.lastLatency = t.elapsed();
            term.ok('store', `importadas ${plan.toAdd.length} · já existiam ${plan.skipped}` +
              (plan.invalid ? ` · <span class="c-warn">ignoradas ${plan.invalid} inválidas</span>` : '') +
              ` <span class="c-meta">· ${esc(file.name)} · ${t.id} · ${S.lastLatency}ms</span>`);
            ctx.ui.pulse('act');
          }, { announce: true });
        };
        pick.click();
        term.say('escolha o arquivo .json do backup.');
      },
    },
    {
      name: 'roadmap', desc: 'fases do projeto',
      run() {
        PHASES.forEach(([n, t, s]) => {
          const mark = s === 'ok' ? '<span class="c-act">[ok]</span>' : s === 'wip' ? '<span class="c-hud">[..]</span>' : '<span class="dim">[  ]</span>';
          term.print(`${mark} <span class="${s ? 'c-tx' : 'dim'}">fase ${n.padEnd(3)}</span> ${esc(t)}`);
        });
      },
    },
    {
      name: 'painel', alias: ['tele'], desc: 'mostra/esconde a telemetria (ctrl+.)',
      run() {
        const on = ctx.ui.toggle('tele');
        term.say(on ? 'telemetria visível.' : 'telemetria escondida · <span class="c-hud">/painel</span> ou ctrl+. traz de volta.');
      },
    },
    {
      name: 'foco', alias: ['zen'], desc: 'deixa só o terminal na tela (de novo pra voltar)',
      run() {
        const on = ctx.ui.toggle('focus');
        term.say(on ? 'modo foco · <span class="c-hud">/foco</span> de novo traz os painéis.' : 'painéis de volta.');
      },
    },
    {
      name: 'limpar', alias: ['clear', 'cls'], desc: 'limpa a tela sem apagar o log (ctrl+k)',
      run() { term.clear(); },
    },
  ];

  const byName = new Map();
  defs.forEach(c => [c.name, ...(c.alias || [])].forEach(n => byName.set(n, c)));

  function get(name) { return byName.get(String(name).toLowerCase()); }

  function notFound(name) {
    const all = defs.map(c => c.name);
    const near = all
      .map(n => [n, n.startsWith(name.toLowerCase()) ? 0 : lev(name.toLowerCase(), n)])
      .filter(([, d]) => d <= 2)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3)
      .map(([n]) => `<span class="c-hud">/${n}</span>`);
    return new CmdError('E_CMD_404', 'shell', `comando desconhecido: /${name}`,
      (near.length ? `você quis dizer ${near.join(', ')}? · ` : '') + '<span class="c-hud">/ajuda</span> lista todos');
  }

  return {
    get,
    notFound,
    addTask,
    names: () => defs.map(c => c.name),
  };
}
