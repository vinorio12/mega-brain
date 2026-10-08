// Tarefas e projetos: criar (/t e "- "), visões (/tarefas, /ver, /inicio, /overview), concluir e corrigir
// (/feito, /reabrir, /adiar, /editar, /mover), status, projetos, abas (/ir), histórico (/feitas, /mudancas).
// Uma das áreas da linguagem de comandos: js/commands.js junta todas (veja o comentário de lá).

import { esc, hl, dayKey, hhmm, ddmm, tagsOf, CmdError, DOW } from '../util.js';
import { fmtDue, parseDue } from '../dates.js';
import { VIEWS, viewName, viewGroups, calendarModel, parseVerArgs } from '../views.js';
import { isTask, doneAt, projName, parseTaskInput, groupTasks, doneHistory, projectsSummary, taskNumbers, taskStats, projectOf, statusChange, finalStatus, firstStatus, matchStatus, statusOf, prioOf, isFinalStatus, briefing } from '../tasks.js';
import { eventsOf } from '../historico.js';
import { previa } from '../interpretar.js';
import { pickTargets } from './dados.js';

export function criarTarefas(kit) {
  const { S, term, ctx, usage, ictx, fin } = kit;
  // de outras áreas: lidos na hora do uso (a ordem em que as áreas nascem não importa)
  const taskLine = (...a) => kit.taskLine(...a);
  const showTaskGroups = (...a) => kit.showTaskGroups(...a);
  const salvar = (...a) => kit.salvar(...a);
  const tagsNovas = (...a) => kit.tagsNovas(...a);
  const mostrarPergunta = (...a) => kit.mostrarPergunta(...a);
  const resumo = (...a) => kit.resumo(...a);

  // a linha "↳ auto": o que o app escolheu sozinho, pra você conferir e corrigir
  function autoLine(values, auto, n, fonte = 'regra') {
    if (!auto.length) return;
    const show = {
      projeto: `<span class="c-act">#${esc(values.projeto)}</span>`,
      status: `@${esc(values.status)}`,
      prioridade: `!${esc(values.prioridade)}`,
      prazo: values.prazo ? `>${esc(fmtDue(values.prazo))}` : '>sem prazo',
    };
    term.print(`<span class="c-int">↳ auto</span> <span class="dim">(${fonte})</span> · ${auto.map(k => show[k]).join(' · ')} <span class="dim">· /desfazer ou /editar t${n}</span>`, 'auto');
  }

  // erros de leitura da tarefa (prazo, prioridade, status) com dica do que dá pra usar
  function parseError(p) {
    if (p.error === 'prazo') return new CmdError('E_PRAZO', 'task', `não entendi o prazo ${p.token}`, 'use <span class="c-int">>hoje >amanhã >sex >15/10 >+3 >sem</span>');
    if (p.error === 'prioridade') return new CmdError('E_PRIO', 'task', `prioridade ${p.token} não existe`, 'use <span class="c-int">!alta !média !baixa</span> (ou !1 !2 !3)');
    if (p.error === 'status') return new CmdError('E_STATUS', 'task', `status ${p.token} não existe`, `use ${ctx.reg().statuses.map(s => '<span class="c-int">@' + esc(s.name.replace(/\s+/g, '')) + '</span>').join(' ')} · /status novo nome cria`);
    return null;
  }

  /* ---------- visões (/ver) ---------- */

  const VIEW_KEY = 'mb.view.v1';
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  // a visão atual fica no estado (S.view); o app carrega/salva no navegador (mb.view.v1)
  const currentView = () => viewName(S.view) || 'prazo';

  function showView(view, proj = S.ctx, month = null, status = null) {
    // kanban: tela própria no centro (o terminal encolhe embaixo) · as outras visões imprimem no terminal
    if (view === 'kanban') {
      ctx.ui.openStage('kanban', { proj, status });
      return term.say(`kanban aberto${proj ? ' · #' + esc(proj) : ''}${status ? ' · @' + esc(status) : ''} · os números t1, t2... valem pro /feito · <span class="c-int">esc</span> fecha`);
    }
    ctx.ui.closeStage();
    if (view === 'calendario') return showCalendar(proj, month);
    const { groups, list } = viewGroups(S.entries, view, { reg: ctx.reg(), proj, status });
    if (!list.length && (view !== 'kanban' || status)) {
      S.taskList = [];
      if (status) return term.say(`nenhuma tarefa <span class="c-int">@${esc(status)}</span> em ${esc(projLabel(proj))}.`);
      return term.say(`nenhuma tarefa em ${esc(projLabel(proj))}. crie com <span class="c-int">- revisar cap 2${proj ? ' #' + esc(proj) : ''} >sex</span>`);
    }
    term.print(`── ${view}${status ? ' · @' + esc(status) : ''} · ${esc(projLabel(proj))} ${'─'.repeat(10)}`, 'sep');
    showTaskGroups(groups, list, g => g.title, view === 'lista' ? ['projeto'] : view === 'status' ? ['status'] : []);
    term.print('<span class="dim">/feito t1 · /mover t1 fazendo · /editar t1 >sex · /ver muda a visão</span>');
  }

  function showCalendar(proj, month) {
    const now = new Date();
    const cal = calendarModel(S.entries, { reg: ctx.reg(), proj, now, month });
    S.taskList = cal.list;
    const num = new Map(cal.list.map((id, i) => [id, i + 1]));
    term.print(`── ${MONTHS[cal.month - 1]} ${cal.year} · ${esc(projLabel(proj))} ${'─'.repeat(8)}`, 'sep');
    if (!cal.total) term.say(`nenhuma tarefa com prazo em ${MONTHS[cal.month - 1]}${cal.late.length ? '' : ''}.`);

    // atrasadas de antes do mês: aparecem nos dois tamanhos de tela
    if (cal.late.length) {
      term.print(`atrasadas <span class="c-meta">${cal.late.length}</span>`, 'tgrp');
      cal.late.forEach(e => taskLine(num.get(e.id), e, now));
    }
    // PC: grade do mês
    const head = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map(d => `<div class="cal-h">${d}</div>`).join('');
    const cells = cal.weeks.flat().map(c => {
      const items = c.items.slice(0, 3).map(e => `<div class="cal-i${prioOf(e) === 'alta' ? ' is-high' : ''}" title="${esc(e.text)}"><span class="n">t${num.get(e.id)}</span> ${esc(e.text)}</div>`).join('');
      const more = c.items.length > 3 ? `<div class="cal-more">+${c.items.length - 3}</div>` : '';
      const cls = ['cal-c', c.inMonth ? '' : 'is-out', c.today ? 'is-today' : '', c.past && c.items.length ? 'is-late' : ''].filter(Boolean).join(' ');
      return `<div class="${cls}"><div class="cal-d">${c.day}</div>${items}${more}</div>`;
    }).join('');
    term.print(`<div class="cal-grid">${head}${cells}</div>`, 'block cal-wide');
    // celular: agenda dia a dia
    for (const d of cal.days) {
      const [y, m, dd] = d.key.split('-').map(Number);
      const dt = new Date(y, m - 1, dd);
      const isToday = d.key === dayKey(now);
      term.print(`${isToday ? 'hoje · ' : ''}${DOW[dt.getDay()]} ${ddmm(dt)} <span class="c-meta">${d.items.length}</span>`, 'tgrp cal-narrow');
      d.items.forEach(e => taskLine(num.get(e.id), e, now, { cls: 'cal-narrow' }));
    }
    term.print(`<span class="dim">/ver calendario +1 próximo mês · -1 anterior · 11/2026</span>`);
  }

  // a lista que os números t1, t2... estão usando agora (a última mostrada, ou a padrão da aba)
  function taskPool() {
    if (!S.taskList?.length) S.taskList = groupTasks(S.entries, { proj: S.ctx, projects: ctx.reg().projects }).list;
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

  // Cria a tarefa: o que você informou vale; o resto as regras decidem (e a linha "↳ auto" mostra).
  // (/t e "- "; o intérprete com o tipo tarefa forçado, então a data falada também vale: "/t ligar amanhã")
  async function addTask(raw, t) {
    const r = previa(raw, ictx({ forcar: 'tarefa' }));
    if (!r || r.erro?.codigo === 'vazio') throw usage('t', 'revisar cap 2 #tcc @fazendo >sex !alta');
    if (r.erro) throw parseError({ error: r.erro.codigo, token: r.erro.token });
    const { e, n, queued } = await salvar(r, t);
    // resposta curta (padrão) ou a linha "↳ auto" de antes (/detalhes)
    if (S.detalhes) autoLine(r.campos, r.auto, n.slice(1)); else resumo(r, e, n, { queued });
    S.perguntas = tagsNovas(r).map(tag => ({ tipo: 'projeto', tag, id: e.id }));
    mostrarPergunta();
  }

  // /editar e /mover: muda só os campos informados; o que você corrigir deixa de ser "auto"
  async function editTasks(targets, p, t, label) {
    const reg = ctx.reg();
    const change = e => {
      const d = {};
      if (p.projeto) d.projeto = p.projeto;
      if (p.prioridade) d.prioridade = p.prioridade;
      if (p.prazo !== null && p.prazo !== undefined) d.prazo = p.prazo || null;
      if (p.status) Object.assign(d, statusChange(reg, p.status));
      const campos = (e.data?.auto?.campos || []).filter(k => !(k in d) && !(k === 'status' && p.status));
      d.auto = campos.length ? { ...e.data.auto, campos } : null;
      return d;
    };
    const before = targets.map(x => x.e);
    for (const { e } of targets) {
      const next = { ...e, data: { ...(e.data || {}), ...change(e) } };
      if (p.text) next.text = p.text;
      if (p.projeto || p.text) next.tags = [...new Set([next.data.projeto, ...tagsOf(next.text)].filter(Boolean))];
      await ctx.store.restore(next);
    }
    S.undo.push({ label, items: before });
    S.lastLatency = t.elapsed();
  }

  const defs = [
    {
      name: 'overview', alias: ['ov', 'geral', 'tudo'], data: true,
      desc: 'o geral de tudo (tarefas, finanças, projetos, notas, acervo) numa tela própria · esc fecha',
      run() {
        const on = ctx.ui.toggleOverview();
        term.say(on ? 'overview aberto · os números t1, t2... valem pro /feito · <span class="c-int">esc</span> fecha' : 'overview fechado · núcleo de volta');
      },
    },
    {
      name: 'inicio', alias: ['home', 'i'], data: true, desc: 'o essencial: atrasadas, prioridade alta e as que vencem primeiro',
      run() {
        const now = new Date();
        const b = briefing(S.entries, { reg: ctx.reg(), now, proj: S.ctx });
        term.print(`── início · ${DOW[now.getDay()]} ${ddmm(now)}${S.ctx ? ' · #' + esc(S.ctx) : ''} ${'─'.repeat(8)}`, 'sep');
        if (!b.items.length) {
          S.taskList = [];
          return term.say(b.abertas ? `nada atrasado nem urgente · ${plural(b.abertas, 'tarefa')} sem prazo · <span class="c-int">/tarefas</span> mostra` : 'nenhuma tarefa aberta. respira. ✓');
        }
        S.taskList = b.items.map(e => e.id);
        b.items.forEach((e, i) => taskLine(i + 1, e, now));
        term.print(`<span class="dim">${plural(b.abertas, 'aberta')}` +
          (b.atrasadas ? ` · <span class="c-warn">${plural(b.atrasadas, 'atrasada')}</span>` : '') +
          (b.altas ? ` · ${b.altas} !alta` : '') + ' · /tarefas mostra tudo</span>');
      },
    },
    {
      name: 't', exec: true, alias: ['tarefa', 'todo'], data: true, async: true, args: '<texto> [#projeto] [@status] [>prazo] [!prioridade]',
      desc: 'cria tarefa · o que faltar o app decide (↳ auto) · ou comece a linha com "- "',
      async run(arg, signal, t) { await addTask(arg, t); },
    },
    {
      name: 'tarefas', alias: ['ts'], data: true, args: '[projeto | todas]',
      desc: 'tarefas na visão atual (/ver troca) · ex: /tarefas tcc',
      run(arg) {
        const a = String(arg).trim().toLowerCase();
        const proj = !a ? S.ctx : ['todas', 'tudo', '*', '~'].includes(a) ? null : projName(a);
        if (a && proj === null && !['todas', 'tudo', '*', '~'].includes(a)) throw usage('tarefas', '[projeto] · ex: /tarefas tcc');
        showView(currentView(), proj);
      },
    },
    {
      name: 'ver', alias: ['v', 'visao'], data: true, args: '[prazo | lista | status | kanban | calendario] [projeto] [mês]',
      desc: 'muda a visão das tarefas (fica salva) · ex: /ver kanban · /ver lista tcc · /ver calendario +1',
      run(arg) {
        const words = String(arg).trim().split(/\s+/).filter(Boolean);
        const reg = ctx.reg();
        const a = parseVerArgs(arg, { reg, ctx: S.ctx });
        if (a.erro) {
          throw new CmdError('E_ARG', 'task', `não conheço "${a.erro}" (não é visão, projeto nem status)`,
            `visões: ${VIEWS.map(v => `<span class="c-int">${v}</span>`).join(' ')} · projetos: ${reg.projects.map(p => `<span class="c-act">${esc(p)}</span>`).join(' ')} · status: ${reg.statuses.map(s => `<span class="c-int">${esc(s.name)}</span>`).join(', ')}`);
        }
        let { view, proj, month, status } = a;
        if (!words.length) {
          const cur = currentView();
          term.print(`── visões ${'─'.repeat(10)}`, 'sep');
          VIEWS.forEach(v => term.print(`<span class="k ${v === cur ? 'c-act' : 'c-int'}">${v === cur ? '▸ ' : '  '}${v}</span><span class="dim">${{ prazo: 'atrasadas · hoje · próximas · sem prazo', lista: 'agrupada por projeto', status: 'agrupada por status', kanban: 'colunas por status', calendario: 'mês por prazo (agenda no celular)' }[v]}</span>`, 'tbl'));
          return term.print('<span class="dim">/ver kanban troca · /ver fazendo filtra por status · /tarefas usa a visão atual</span>');
        }
        // só troca a visão salva quando você diz qual ("/ver fazendo" filtra sem mudar a visão)
        if (view) { S.view = view; try { localStorage.setItem(VIEW_KEY, view); } catch {} }
        view = view || currentView();
        if (status && view === 'calendario') view = 'status';
        showView(view, proj, month, status);
      },
    },
    {
      name: 'feito', exec: true, alias: ['ok', 'x', 'done'], data: true, async: true, args: '<t1 t2 | t1-t3 | texto>',
      desc: 'conclui tarefas (fica riscada até o fim do dia)',
      async run(arg, signal, t) {
        const targets = resolveTasks(arg, 'feito', 't1  ·  t1 t3  ·  t1-t4');
        if (!targets) return;
        const open = targets.filter(x => !doneAt(x.e));
        if (!open.length) return term.say('essas já estavam concluídas.');
        await updateTasks(open, () => statusChange(ctx.reg(), finalStatus(ctx.reg())), open.length === 1 ? 'conclusão' : `${open.length} conclusões`);
        S.lastLatency = t.elapsed();
        term.ok('task', `concluída${open.length > 1 ? 's ' + open.length : ''} · ${open.map(x => `t${x.n} ${hl(x.e.text)}`).join(' · ')} <span class="c-meta">· ${t.id} · ${S.lastLatency}ms</span>`);
        const s = taskStats(S.entries);
        if (s.abertas === 0) term.say('nenhuma tarefa aberta. respira. ✓');
        ctx.ui.pulse('act');
      },
    },
    {
      name: 'reabrir', exec: true, alias: ['reopen'], data: true, async: true, args: '<t1 ...>',
      desc: 'desfaz a conclusão de uma tarefa',
      async run(arg, signal, t) {
        const targets = resolveTasks(arg, 'reabrir', 't1');
        if (!targets) return;
        const done = targets.filter(x => doneAt(x.e));
        if (!done.length) return term.say('essas já estão abertas.');
        await updateTasks(done, () => statusChange(ctx.reg(), firstStatus(ctx.reg())), 'reabertura');
        term.ok('task', `reaberta${done.length > 1 ? 's ' + done.length : ''} · ${done.map(x => `t${x.n} ${hl(x.e.text)}`).join(' · ')} <span class="c-meta">· ${t.id}</span>`);
        ctx.ui.pulse('hud');
      },
    },
    {
      name: 'adiar', exec: true, alias: ['prazo'], data: true, async: true, args: '<t1 ...> <prazo | sem>',
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
        await editTasks(targets, { prazo: prazo || '' }, t, 'mudança de prazo');
        term.ok('task', `prazo ${prazo ? '→ <span class="c-int">' + esc(fmtDue(prazo)) + '</span>' : 'removido'} · ${targets.map(x => `t${x.n} ${hl(x.e.text)}`).join(' · ')} <span class="c-meta">· ${t.id}</span>`);
        ctx.ui.pulse('int');
      },
    },
    {
      name: 'editar', alias: ['ed', 'e'], exec: true, data: true, async: true,
      args: '<t1 ...> [#projeto] [@status] [>prazo] [!prioridade] [texto novo] · <f3> [valor] [forma] [data] [categoria] ["descrição"]',
      desc: 'corrige tarefas e lançamentos · muda só o que você escrever · ex: /editar t2 #weg !alta · /editar f3 45,90 ontem',
      async run(arg, signal, t) {
        // f3 = lançamento de dinheiro (js/comandos/financas.js)
        if (/^f\d+$/i.test(String(arg).trim().split(/\s+/)[0] || '')) return fin.editar(arg, t);
        const words = String(arg).trim().split(/\s+/).filter(Boolean);
        const nums = [];
        while (words.length && /^t?\d+(-t?\d+)?$/i.test(words[0])) nums.push(words.shift());
        if (!nums.length) throw usage('editar', 't2 #weg @fazendo >sex !alta  ·  t3 texto novo');
        const p = parseTaskInput(words.join(' '), { reg: ctx.reg(), allowEmpty: true });
        if (p.error) throw parseError(p);
        // "#faculdade" que não existe não pode virar o título novo da tarefa
        if (p.novas?.length) throw new CmdError('E_PROJ', 'task', `projeto #${p.novas[0]} não existe`, `crie com <span class="c-int">/projeto novo ${esc(p.novas[0])}</span> · ou use ${ctx.reg().projects.map(x => '<span class="c-int">#' + esc(x) + '</span>').join(' ')}`);
        if (p.text && nums.length > 1) throw new CmdError('E_ARG', 'task', 'texto novo só dá pra uma tarefa por vez', 'use um número só, ex: /editar t2 texto novo');
        if (!p.text && !p.projeto && !p.status && !p.prioridade && p.prazo === null) throw usage('editar', 't2 #weg @fazendo >sex !alta  ·  t3 texto novo');
        const targets = resolveTasks(nums.join(' '), 'editar', 't2 #weg');
        if (!targets) return;
        await editTasks(targets, p, t, 'edição');
        const what = [
          p.projeto && `<span class="c-act">#${esc(p.projeto)}</span>`, p.status && `@${esc(p.status)}`,
          p.prioridade && `!${esc(p.prioridade)}`, p.prazo !== null && (p.prazo ? `>${esc(fmtDue(p.prazo))}` : '>sem prazo'),
          p.text && `"${hl(p.text)}"`,
        ].filter(Boolean).join(' · ');
        term.ok('task', `editada${targets.length > 1 ? 's ' + targets.length : ''} · ${targets.map(x => 't' + x.n).join(' ')} → ${what} <span class="c-meta">· ${t.id} · /desfazer volta</span>`);
        ctx.ui.pulse('int');
      },
    },
    {
      name: 'mover', alias: ['mv'], exec: true, data: true, async: true, args: '<t1 ...> <status>',
      desc: 'muda o status · ex: /mover t3 fazendo · /mover t1 t2 esperando',
      async run(arg, signal, t) {
        const words = String(arg).trim().split(/\s+/).filter(Boolean);
        const nums = [];
        while (words.length && /^t?\d+(-t?\d+)?$/i.test(words[0])) nums.push(words.shift());
        const st = matchStatus(words.join(' ').replace(/^@/, ''), ctx.reg().statuses);
        if (!nums.length || !words.length) throw usage('mover', 't3 fazendo');
        if (!st) throw parseError({ error: 'status', token: '@' + words.join('') });
        const targets = resolveTasks(nums.join(' '), 'mover', 't3 fazendo');
        if (!targets) return;
        await editTasks(targets, { status: st, prazo: null }, t, 'mudança de status');
        term.ok('task', `${targets.map(x => 't' + x.n).join(' ')} → <span class="c-int">@${esc(st)}</span> <span class="c-meta">· ${t.id} · /desfazer volta</span>`);
        ctx.ui.pulse(isFinalStatus(ctx.reg(), st) ? 'act' : 'int');
      },
    },
    {
      name: 'status', alias: ['colunas'], data: true, async: true, exec: true,
      args: '[novo nome | renomear velho novo]',
      desc: 'status das tarefas: lista com contagem · cria ou renomeia',
      async run(arg, signal, t) {
        const raw = String(arg).trim();
        const [sub, ...rest] = raw.split(/\s+/);
        const reg = ctx.reg();
        const recOf = name => S.records.find(e => e.kind === 'status' && String(e.text).toLowerCase() === name);

        if (sub === 'novo' || sub === 'nova' || sub === 'criar') {
          const name = rest.join(' ').toLowerCase().trim();
          if (!name || name.length > 24 || !/^[\p{L}\p{N} _-]+$/u.test(name)) throw usage('status', 'novo nome (ex: /status novo revisão)');
          if (matchStatus(name, reg.statuses) && reg.statuses.some(s => s.name === name)) return term.say(`@${esc(name)} já existe.`);
          // entra antes do status final (feito)
          const fin = S.records.find(e => e.kind === 'status' && e.data?.final);
          const ordem = fin ? (fin.data.ordem ?? 99) - 0.5 : reg.statuses.length + 1;
          const e = await ctx.store.add({ kind: 'status', text: name, tags: [], ts: Date.now(), day: dayKey(new Date()), data: { ordem, final: false } });
          S.undo.push({ label: 'status criado', items: [], created: [e.id] });
          term.ok('task', `status criado · <span class="c-int">@${esc(name.replace(/\s+/g, ''))}</span> <span class="c-meta">· ${t.id}</span>`);
          return ctx.ui.pulse('act');
        }
        if (sub === 'renomear') {
          const [a, b] = rest;
          const from = a && matchStatus(a, reg.statuses);
          const to = (b || '').toLowerCase();
          const r = from && recOf(from);
          if (!r || !to) throw usage('status', 'renomear velho novo');
          if (reg.statuses.some(s => s.name === to)) throw new CmdError('E_ARG', 'task', `@${to} já existe`, 'escolha outro nome');
          const tasks = S.entries.filter(e => isTask(e) && statusOf(e) === from);
          S.undo.push({ label: 'status renomeado', items: [r, ...tasks] });
          await ctx.store.restore({ ...r, text: to });
          for (const e of tasks) await ctx.store.restore({ ...e, data: { ...(e.data || {}), status: to } });
          term.ok('task', `@${esc(from)} → <span class="c-int">@${esc(to)}</span> · ${plural(tasks.length, 'tarefa')} <span class="c-meta">· ${t.id}</span>`);
          return ctx.ui.pulse('act');
        }
        if (sub && sub !== 'lista') throw usage('status', '[novo nome | renomear velho novo]');

        term.print(`── status ${'─'.repeat(10)}`, 'sep');
        reg.statuses.forEach(s => {
          const n = S.entries.filter(e => isTask(e) && statusOf(e) === s.name).length;
          term.print(`<span class="k c-int">@${esc(s.name.replace(/\s+/g, ''))}</span><span>${plural(n, 'tarefa')}${s.final ? ' <span class="dim">· final (conta como concluída)</span>' : ''}</span>`, 'tbl');
        });
        term.print('<span class="dim">/mover t3 fazendo · /status novo revisão · a condição do sistema agora é /condition</span>');
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
        const h = doneHistory(S.entries, { proj, days, projects: ctx.reg().projects });
        if (!h.total) return term.say(`nenhuma tarefa concluída em ${esc(projLabel(proj))} nos últimos ${days} dias.`);
        term.print(`── feitas · ${esc(projLabel(proj))} · ${days} dias · ${h.total} ${'─'.repeat(6)}`, 'sep');
        const label = key => { const [y, m, d] = key.split('-').map(Number); const dt = new Date(y, m - 1, d); return `${DOW[dt.getDay()]} ${ddmm(dt)}`; };
        showTaskGroups(h.groups, h.list, g => label(g.key));
        term.print('<span class="dim">/reabrir t1 volta uma pra lista</span>');
      },
    },
    {
      name: 'mudancas', alias: ['mudanças', 'eventos'], data: true, args: '[t1]',
      desc: 'o que mudou nas tarefas (criada, status, prazo, concluída...) · ex: /mudancas · /mudancas t2',
      run(arg) {
        const a = String(arg).trim();
        let alvo = null, title = 'últimas mudanças';
        if (a) {
          const targets = resolveTasks(a, 'mudancas', 't1');
          if (!targets) return;
          alvo = targets[0].e.id;
          title = `t${targets[0].n} ${esc(targets[0].e.text)}`;
        }
        const evs = eventsOf(S.records || [], alvo).slice(0, alvo ? 50 : 15);
        if (!evs.length) return term.say(alvo ? 'essa tarefa ainda não tem mudanças registradas (o histórico começou em 02/10/2026).' : 'nenhuma mudança registrada ainda.');
        const val = (campo, v) => {
          if (v === null || v === undefined) return '—';
          if (campo === 'prazo') return esc(fmtDue(v));
          if (campo === 'feito_em') { const d = new Date(v); return `${hhmm(d)} ${ddmm(d)}`; }
          if (campo === 'pessoas') return esc((v || []).map(id => S.records.find(e => e.id === id)?.text || '?').join(', ') || '—');
          return esc(String(v).length > 40 ? String(v).slice(0, 39) + '…' : v);
        };
        term.print(`── mudanças · ${title} · ${evs.length} ${'─'.repeat(6)}`, 'sep');
        for (const ev of evs.slice().reverse()) {
          const d = new Date(ev.ts), x = ev.data || {};
          const muds = x.acao === 'alterada'
            ? Object.entries(x.mudancas || {}).map(([c, [de, para]]) => `${esc(c)} <span class="dim">${val(c, de)} →</span> ${val(c, para)}`).join(' · ')
            : '';
          const tone = x.acao === 'apagada' ? 'c-warn' : x.acao === 'alterada' ? 'c-int' : 'c-act';
          term.print(
            `<span class="c-meta">${ddmm(d)} ${hhmm(d)}</span> <span class="${tone}">${esc(x.acao || '?')}</span>` +
            (alvo ? '' : ` ${hl(x.texto || '')}`) + (muds ? ` · ${muds}` : '') +
            (x.origem && x.origem !== 'usuario' ? ` <span class="dim">(${esc(x.origem)})</span>` : ''));
        }
      },
    },
    {
      name: 'projeto', alias: ['projetos', 'proj'], data: true, async: true, exec: true,
      args: '[novo nome | renomear velho novo | arquivar nome]',
      desc: 'lista os projetos · cria, renomeia ou arquiva',
      async run(arg, signal, t) {
        const [sub, a, b] = String(arg).trim().toLowerCase().split(/\s+/);
        const reg = ctx.reg();
        const rec = name => S.records.find(e => e.kind === 'projeto' && e.text === name);

        if (sub === 'novo' || sub === 'criar') {
          const name = projName(a);
          if (!name) throw usage('projeto', 'novo nome');
          if (reg.projects.includes(name)) return term.say(`#${esc(name)} já existe.`);
          const e = await ctx.store.add({ kind: 'projeto', text: name, tags: [], ts: Date.now(), day: dayKey(new Date()), data: { ordem: reg.projects.length + 1, arquivado: false } });
          S.undo.push({ label: 'projeto criado', items: [], created: [e.id] });
          term.ok('task', `projeto criado · <span class="c-act">#${esc(name)}</span> <span class="c-meta">· ${t.id}</span>`);
          return ctx.ui.pulse('act');
        }
        if (sub === 'renomear') {
          const from = projName(a), to = projName(b);
          if (!from || !to) throw usage('projeto', 'renomear velho novo');
          const r = rec(from);
          if (!r) throw new CmdError('E_404', 'task', `projeto #${from} não existe`, 'veja a lista com <span class="c-int">/projeto</span>');
          if (reg.projects.includes(to)) throw new CmdError('E_ARG', 'task', `#${to} já existe`, 'escolha outro nome');
          const tasks = S.entries.filter(e => isTask(e) && projectOf(e, reg.projects) === from);
          S.undo.push({ label: 'projeto renomeado', items: [r, ...tasks] });
          await ctx.store.restore({ ...r, text: to });
          for (const e of tasks) await ctx.store.restore({ ...e, data: { ...(e.data || {}), projeto: to } });
          if (S.ctx === from) ctx.actions.setCtx(to, { quiet: true });
          term.ok('task', `#${esc(from)} → <span class="c-act">#${esc(to)}</span> · ${plural(tasks.length, 'tarefa')} movidas <span class="c-meta">· ${t.id}</span>`);
          return ctx.ui.pulse('act');
        }
        if (sub === 'arquivar') {
          const name = projName(a);
          const r = name && rec(name);
          if (!r) throw usage('projeto', 'arquivar nome');
          S.undo.push({ label: 'projeto arquivado', items: [r] });
          await ctx.store.restore({ ...r, data: { ...(r.data || {}), arquivado: true } });
          term.warn('task', `#${esc(name)} arquivado · as tarefas dele continuam existindo · /desfazer volta`);
          return ctx.ui.pulse('warn');
        }
        if (sub && sub !== 'lista') throw usage('projeto', '[novo nome | renomear velho novo | arquivar nome]');

        const { projects, tags } = projectsSummary(S.entries, new Date(), reg.projects);
        term.print(`── projetos ${'─'.repeat(10)}`, 'sep');
        projects.forEach(p => term.print(
          `<span class="k c-act">#${esc(p.proj)}</span><span>${plural(p.abertas, 'aberta')}` +
          (p.atrasadas ? ` · <span class="c-warn">${plural(p.atrasadas, 'atrasada')}</span>` : '') +
          ` <span class="dim">· ${plural(p.notas, 'nota')}${p.registrado ? '' : ' · não registrado'}</span></span>`, 'tbl'));
        if (tags.length) term.print(`<span class="dim">tags soltas: ${tags.slice(0, 12).map(x => '#' + esc(x.tag)).join(' ')}</span>`);
        term.print('<span class="dim">/tarefas tcc lista um projeto · /ir tcc entra nele · /projeto novo nome cria</span>');
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
  ];
  return { defs, autoLine, parseError, currentView, showView, showCalendar, taskPool, resolveTasks, updateTasks, projLabel, plural, addTask, editTasks };
}
