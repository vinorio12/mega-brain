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
import { fmtDue, fmtDia, parseDue } from './dates.js';
import { VIEWS, viewName, viewGroups, calendarModel, parseMonth, parseVerArgs } from './views.js';
import { isLink, isSnippet, isAcervo, safeUrl, parseLink, parseSnippet, shortUrl, searchAll } from './acervo.js';
import {
  isTask, doneAt, projName, parseTaskInput, newTask, groupTasks, doneHistory, projectsSummary, taskNumbers, taskStats,
  projectOf, statusChange, finalStatus, firstStatus, fillByRules, matchStatus, statusOf, prioOf, isFinalStatus, briefing, isNoteKind, editPalavras,
} from './tasks.js';
import { eventsOf } from './historico.js';
import { fmtValor } from './valores.js';
import { verboCandidato, categoriasDe, acharCategoria, acharForma, cartoesDe, FORMA_ROTULO } from './financas.js';
import { criarFinancas, isFinanca } from './comandos-financas.js';
import { REGISTRO } from './tipos.js';
import { previa, interpretar } from './interpretar.js';
import { registroAprendizado, resumoAprendizado, exportarFrases } from './aprendizado.js';
import { montarContexto, estimarTokens } from './contexto.js';
import { pessoasDe, acharPessoa, editApelidos, juntarPessoas, fold, resumoPessoa } from './pessoas.js';
import { memoriaDe, chavePalavra, campoCategoria } from './memoria.js';

export const PHASES = [
  ['0', 'esqueleto · terminal, hud, inbox', 'ok'],
  ['0.5', 'app próprio · pwa, nuvem, login', 'ok'],
  ['1', 'tarefas e projetos · hoje, tcc, weg, pessoal', 'ok'],
  ['2', 'intérprete · escreva do seu jeito (regras; ia encaixável, desligada) · histórico · contexto', 'ok'],
  ['2.5', 'pessoas e memória · nomes na frase, projeto aprendido pelo uso', 'ok'],
  ['3', 'finanças · 3a lançamento, categorias, mês · 3b cartões e parcelas · 3c recorrentes', 'wip'],
  ['4', 'corpo e hábitos · treino, saúde, padrão semanal', ''],
  ['5', 'dashboards · gráficos e tendências', ''],
  ['6', 'coach · ia lê tudo e sugere próximos passos, resumo do dia, revisão da semana', ''],
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

  /* ---------- intérprete: tudo o que é escrito passa por aqui ---------- */

  // o que o intérprete precisa saber: projetos e status, entradas (histórico de projetos), aba atual
  const ictx = (extra = {}) => ({ reg: ctx.reg(), entries: S.entries, records: S.records || [], aba: S.ctx, now: new Date(), pessoas: pessoasDe(S.records || []), ignorarPessoas: ignorados(), ...extra });
  // a memória do momento (pessoas/palavras → projeto); recalcula só quando os dados mudam
  const mem = () => memoriaDe(S.entries, S.records || [], { reg: ctx.reg(), pessoas: pessoasDe(S.records || []) });
  // decisão sua sobre uma pista (/memoria, /palavras): registro que só cresce, o mais novo vale
  // (campo projeto: o valor fica em data.projeto, como na 2.5 · outros campos: { campo: 'categoria:gasto', valor: 'alimentação' })
  const gravarMemoria = (chave, acao, projeto, rotulo, outro = null) => ctx.store.add({
    kind: 'memoria', text: String(rotulo || chave), tags: [], ts: Date.now(), day: dayKey(new Date()),
    data: outro ? { chave, acao, campo: outro.campo, valor: outro.valor ?? null } : { chave, acao, projeto: projeto || null },
  });
  // finanças (js/comandos-financas.js): números f1…, linha "↳ entendi" de dinheiro, perguntas, /cat, /forma
  const fin = criarFinancas({ S, term, ctx, usage, mem, ictx, table: (...a) => table(...a) });
  // palavras que você disse que não são pessoa (/nao): ficam no aprendizado
  const ignorados = () => (S.records || []).filter(e => e.kind === 'interpretacao' && e.data?.naoPessoa).map(e => e.data.naoPessoa);

  // Grava o que o intérprete entendeu (qualquer tipo registrado) e mostra a confirmação. Tudo entra no /desfazer.
  async function salvar(interp, t) {
    const tipo = REGISTRO.get(interp.tipo);
    const doc = tipo.montar(interp, ictx());
    // quem aparece na frase fica ligado à entrada (o texto continua como foi escrito)
    if (interp.pessoas?.length) doc.data = { ...(doc.data || {}), pessoas: interp.pessoas };
    const e = await ctx.store.add(doc);
    S.lastLatency = t.elapsed();
    const queued = ctx.store.pending() > 0;
    const meta = `<span class="c-meta">· ${t.id} · ${S.lastLatency}ms</span>`;
    let n = null;
    if (interp.tipo === 'tarefa') {
      S.undo.push({ label: 'tarefa criada', items: [], created: [e.id] });
      // entra no fim da lista atual, pra já ter um número
      if (!S.taskList?.length) S.taskList = groupTasks(S.entries, { proj: S.ctx, projects: ctx.reg().projects }).list;
      else if (!S.taskList.includes(e.id)) S.taskList.push(e.id);
      n = 't' + (S.taskList.indexOf(e.id) + 1);
      term[queued ? 'warn' : 'ok']('task', `tarefa${queued ? ' na fila' : ''} <span class="c-meta">${n}</span> · ${hl(e.text)} ${meta}`);
    } else if (interp.tipo === 'link') {
      S.undo.push({ label: 'link guardado', items: [], created: [e.id] });
      n = nums().get(e.id) || '';
      term.ok('acervo', `link guardado <span class="c-meta">${n}</span> · ${linkHtml(e)} <span class="c-meta">· ${t.id} · /acervo lista</span>`);
    } else if (interp.tipo === 'trecho') {
      S.undo.push({ label: 'texto guardado', items: [], created: [e.id] });
      n = nums().get(e.id) || '';
      term.ok('acervo', `texto guardado <span class="c-meta">${n}</span> · ${hl(e.text)} <span class="c-meta">· ${t.id} · /acervo lista</span>`);
    } else if (interp.tipo === 'nota') {
      S.undo.push({ label: 'nota capturada', items: [], created: [e.id] });
      n = nums().get(e.id) || '';
      const tagHtml = e.tags?.length ? ' · ' + e.tags.map(x => `<span class="c-act">#${esc(x)}</span>`).join(' ') : '';
      term[queued ? 'warn' : 'ok']('store', `${queued ? 'capturado · na fila, sobe quando a rede voltar' : 'capturado'} <span class="c-meta">${esc(n)}</span>${tagHtml} ${meta}`);
    } else if (e.kind === 'recorrente') {
      // o cadastro (Fase 3c): os gastos de cada mês quem lança é o lançador
      S.undo.push({ label: 'recorrente cadastrada', items: [], created: [e.id] });
      term[queued ? 'warn' : 'ok']('fin', `recorrente cadastrada${queued ? ' na fila' : ''} · ${hl(e.text)} ${meta}`);
    } else if (isFinanca(e)) {
      // gasto, entrada, transferência: número f1, f2...
      S.undo.push({ label: `${tipo.rotulo} lançado`, items: [], created: [e.id] });
      n = fin.numero(e);
      term[queued ? 'warn' : 'ok']('fin', `${esc(tipo.rotulo)} ${/a$/.test(tipo.rotulo) ? 'lançada' : 'lançado'}${queued ? ' na fila' : ''} <span class="c-meta">${n}</span> · ${hl(e.text)} ${meta}`);
    } else {
      // treino...: só o dado bruto por enquanto
      S.undo.push({ label: `${tipo.rotulo} guardado`, items: [], created: [e.id] });
      term[queued ? 'warn' : 'ok']('store', `${esc(tipo.rotulo)} ${/a$/.test(tipo.rotulo) ? 'guardada' : 'guardado'}${queued ? ' na fila' : ''} · ${hl(e.text)} ${meta}`);
    }
    ctx.ui.pulse(queued ? 'warn' : 'act');
    return { e, n };
  }

  // Texto livre digitado no terminal (sem "/"): o intérprete decide o que é.
  //   "- " = tarefa, sempre · o resto: interpretar() (regras → IA, se ligada → nota com pergunta)
  async function capturar(text, t) {
    if (/^-\s+\S/.test(text)) return addTask(text.replace(/^-\s+/, ''), t);
    const r = await interpretar(text, ictx());
    const { e, n } = await salvar(r, t);
    S.ultima = { id: e.id, texto: text }; // o /tipo sem alvo corrige esta
    entendiLine(r, e, n);
    if (isFinanca(e)) fin.perguntar(r, e, n);
    // recorrente nova com o dia de hoje: já lança (e o /desfazer do cadastro leva o lançamento junto)
    if (e.kind === 'recorrente') {
      const ids = await fin.lancarRecorrentes({ lembretes: false });
      if (ids.length && S.undo.at(-1)?.created?.includes(e.id)) S.undo.at(-1).created.push(...ids);
    }
    if (r.pergunta) aprender({ texto: text, palpite: r.palpite, confianca: r.confianca, origem: r.origem, era: 'nota' });
    // perguntas pendentes (/sim, /nao respondem a primeira) · escrever outra coisa troca a fila
    S.perguntas = [
      ...(r.pergunta && r.palpite ? [{ tipo: 'tipo', palpite: r.palpite, id: e.id, texto: text, mostrada: true }] : []),
      ...(r.pessoasNovas || []).map(nome => ({ tipo: 'pessoa', nome, id: e.id, texto: text })),
    ];
    mostrarPergunta();
    return { e, n };
  }

  // mostra a primeira pergunta da fila (se ainda não apareceu)
  function mostrarPergunta() {
    const q = S.perguntas?.[0];
    if (!q || q.mostrada) return;
    q.mostrada = true;
    const mais = S.perguntas.length > 1 ? ` <span class="dim">· depois tem mais ${S.perguntas.length - 1}</span>` : '';
    if (q.tipo === 'pessoa') {
      term.print(`<span class="c-int">↳ ${esc(q.nome)} é uma pessoa?</span> <span class="c-int">/sim</span> <span class="dim">cadastra e liga ·</span> <span class="c-int">/nao</span> <span class="dim">não pergunto mais</span>${mais}`, 'auto');
    } else if (q.tipo === 'verbo') {
      term.print(`<span class="c-int">↳ aprender "${esc(q.palavra)}" como ${esc(q.valor)}?</span> <span class="c-int">/sim</span> <span class="dim">da próxima vez já entendo ·</span> <span class="c-int">/nao</span>${mais}`, 'auto');
    }
  }

  // /sim e /nao: respondem a pergunta mais antiga da fila
  async function responder(sim, t) {
    const q = S.perguntas?.[0];
    if (!q) return term.say('nada pra responder agora.');
    S.perguntas.shift();
    if (q.tipo === 'tipo') {
      if (sim) {
        S.ultima = { id: q.id, texto: q.texto };
        await get('tipo').run(q.palpite, null, t);
        // "abasteci 200 no posto" virou gasto: oferece aprender o verbo (só entra com outro /sim, nunca sozinho)
        const w = ['gasto', 'entrada'].includes(q.palpite) && verboCandidato(q.texto);
        if (w) S.perguntas.unshift({ tipo: 'verbo', palavra: w, valor: q.palpite });
      } else { aprender({ texto: q.texto, era: 'nota', corrigido: 'nota' }); term.ok('store', 'fica como nota · anotado no /aprendizado'); }
    } else if (q.tipo === 'verbo') {
      if (sim) {
        const e = await gravarMemoria('verbo:' + q.palavra, 'fixar', null, q.palavra, { campo: 'tipo', valor: q.valor });
        S.undo.push({ label: 'verbo aprendido', items: [], created: [e.id] });
        term.ok('fin', `aprendi · "<span class="c-act">${esc(q.palavra)}</span>" agora é ${esc(q.valor)} <span class="c-meta">· /memoria mostra · /desfazer volta</span>`);
        ctx.ui.pulse('act');
      } else term.ok('fin', `ok · "${esc(q.palavra)}" continua sem significado pra mim`);
    } else if (q.tipo === 'pessoa') {
      if (sim) {
        const p = await ctx.store.add({ kind: 'pessoa', text: q.nome, tags: [], ts: Date.now(), day: dayKey(new Date()), data: { apelidos: [], arquivada: false, juntada_em: null } });
        const entry = S.entries.find(x => x.id === q.id);
        if (entry) await ctx.store.restore({ ...entry, data: { ...(entry.data || {}), pessoas: [...new Set([...(entry.data?.pessoas || []), p.id])] } });
        S.undo.push({ label: 'pessoa cadastrada', items: entry ? [entry] : [], created: [p.id] });
        term.ok('pessoa', `pessoa cadastrada · <span class="c-act">${esc(q.nome)}</span>${entry ? ' · ligada à entrada' : ''} <span class="c-meta">· /pessoa ${esc(q.nome)} · /desfazer volta</span>`);
        ctx.ui.pulse('act');
      } else {
        aprender({ texto: q.nome, naoPessoa: q.nome });
        term.ok('pessoa', `ok · não pergunto mais sobre <span class="c-act">${esc(q.nome)}</span>`);
      }
    }
    mostrarPergunta();
  }

  // guarda pro /aprendizado (frase não entendida ou corrigida). Nunca atrapalha a captura.
  function aprender(dados) {
    const reg = registroAprendizado(dados);
    if (reg) Promise.resolve(ctx.store.add(reg)).catch(e => console.warn('aprendizado', e));
  }
  // rótulo do processo que aparece enquanto grava
  const rotuloCaptura = text => (/^-\s+\S/.test(text) ? 'nova tarefa'
    : { link: 'guardar link', trecho: 'guardar texto', tarefa: 'nova tarefa', gasto: 'novo gasto', entrada: 'nova entrada', transferencia: 'transferência', recorrente: 'nova recorrente', treino: 'novo treino' }[previa(text, ictx())?.tipo] || 'captura');

  // cartão de uma pessoa: nome, apelidos e o que está ligado a ela
  function mostrarPessoa(r) {
    const res = resumoPessoa(r.id, S.entries, S.records || [], { projetos: ctx.reg().projects });
    const ap = (r.data?.apelidos || []).length ? ` <span class="dim">· ${r.data.apelidos.map(esc).join(', ')}</span>` : '';
    term.print(`── ${esc(r.text)}${ap} · ${res.total} ligadas ${'─'.repeat(8)}`, 'sep');
    if (!res.total) return term.say(`nada ligado a ${esc(r.text)} ainda · escreva normal ("falar com ${esc(r.text.split(' ')[0])} amanhã") que o app liga sozinho.`);
    if (res.projetos.length) term.print(`<span class="k">projetos</span><span>${res.projetos.map(([p, n]) => `<span class="c-act">#${esc(p)}</span> ${n}`).join(' · ')}</span>`, 'tbl');
    // tarefas numeradas t1, t2... (dá pra usar /feito t1 direto daqui)
    const grupos = [
      { key: 'esperando', title: `esperando ${r.text.split(' ')[0]}`, items: res.esperando },
      { key: 'abertas', title: 'abertas', items: res.abertas },
      { key: 'feitas', title: 'feitas em 30 dias', items: res.feitas },
    ].filter(g => g.items.length);
    if (grupos.length) showTaskGroups(grupos, grupos.flatMap(g => g.items.map(e => e.id)), g => g.title);
    if (res.notas.length) { term.print(`notas <span class="c-meta">${res.notas.length}</span>`, 'tgrp'); noteRows(res.notas.slice(0, 5)); }
    if (res.outros.length) { term.print(`outros <span class="c-meta">${res.outros.length}</span>`, 'tgrp'); showByType(res.outros.slice(0, 5)); }
    if (res.eventos.length) {
      term.print('últimas mudanças', 'tgrp');
      for (const ev of res.eventos.slice(0, 4)) term.print(`<span class="c-meta">${ddmm(new Date(ev.ts))}</span> ${esc(ev.data?.acao || '')} · ${hl(ev.data?.texto || '')}${ev.data?.acao === 'alterada' ? ` <span class="dim">(${Object.keys(ev.data.mudancas || {}).map(esc).join(', ')})</span>` : ''}`);
    }
  }

  // A linha curta "↳ entendi": o que o app concluiu sozinho, pra conferir e corrigir.
  // Só aparece quando o tipo foi deduzido (tarefa, gasto...) ou quando ficou em dúvida. Nota comum não ganha linha.
  function entendiLine(r, e, n) {
    if (r.pergunta) {
      const outros = ['tarefa', 'gasto', 'entrada', 'treino'].filter(x => x !== r.palpite);
      term.print(`<span class="c-warn">↳ salvei como nota</span> <span class="dim">· não tive certeza ·</span> era ${esc(r.palpite || 'outra coisa')}? ` +
        `<span class="c-int">/sim</span> <span class="dim">·</span> <span class="c-int">/nao</span> <span class="dim">(é nota) · ou /tipo ${outros.map(esc).join(', ')}</span>`, 'auto');
      return;
    }
    if (['nota', 'link', 'trecho'].includes(r.tipo)) return ambiguas(r);
    if (isFinanca({ kind: r.tipo })) { fin.entendi(r, e, n); return ambiguas(r); }
    if (r.tipo === 'recorrente') return fin.entendiRecorrente(r, e);
    const c = r.campos, A = k => (r.auto.includes(k) ? '<span class="dim">*</span>' : '');
    // por que esse projeto: "(João: 8 de 9 na weg)" · "(planilha: fixado)"
    const mp = r.motivos?.projeto;
    const porque = mp?.tipo === 'pista' ? ` <span class="dim">(${esc(mp.pista)}: ${mp.estado === 'fixado' ? 'fixado' : `${mp.peso} de ${mp.total}`})</span>` : '';
    const partes = {
      tarefa: () => [c.projeto ? `<span class="c-act">#${esc(c.projeto)}</span>${A('projeto')}${porque}` : '<span class="c-warn">sem projeto</span>', `${c.prazo ? '>' + esc(fmtDue(c.prazo)) : '>sem prazo'}${A('prazo')}`, `!${esc(c.prioridade || 'média')}${A('prioridade')}`],
      treino: () => [c.duracao_min ? c.duracao_min + 'min' : '', c.distancia_km ? c.distancia_km + 'km' : '', `${esc(fmtDia(c.data))}${A('data')}`],
    };
    const campos = (partes[r.tipo]?.() || []).filter(Boolean);
    const corrigir = r.tipo === 'tarefa' ? `/editar ${n}` : '/tipo nota';
    term.print(`<span class="c-int">↳ entendi</span> · ${esc(REGISTRO.get(r.tipo)?.rotulo || r.tipo)} · ${campos.join(' · ')}` +
      ` <span class="dim">· ${r.auto.length ? '* auto · ' : ''}${esc(r.origem)} ${Math.round(r.confianca * 100)}% · /desfazer ou ${corrigir}</span>`, 'auto');
    // a memória não chutou o projeto: mostra as pistas e como resolver
    if (r.tipo === 'tarefa' && !c.projeto && mp && ['dividida', 'conflito'].includes(mp.tipo)) {
      const det = mp.tipo === 'dividida'
        ? `${esc(mp.pista)} aparece em ${mp.porProjeto.map(([p, w]) => `<span class="c-act">#${esc(p)}</span> ${w}`).join(' · ')}`
        : mp.pistas.map(x => `${esc(x.pista)} → <span class="c-act">#${esc(x.projeto)}</span>`).join(' · ');
      const sug = mp.tipo === 'dividida' ? mp.porProjeto[0]?.[0] : mp.pistas[0]?.projeto;
      term.print(`<span class="c-warn">↳ projeto?</span> ${det} <span class="dim">· não chutei ·</span> <span class="c-int">/editar ${esc(n)} #${esc(sug || 'projeto')}</span>`, 'auto');
    }
    ambiguas(r);
  }
  // "joão" com dois cadastros e sem como decidir: avisa (o texto fica salvo, só não liga a ninguém)
  function ambiguas(r) {
    if (!r.pessoasAmbiguas?.length) return;
    const nomes = id => S.records.find(e => e.id === id)?.text || '?';
    term.print(`<span class="c-warn">↳ qual?</span> ${r.pessoasAmbiguas.map(a => `${esc(a.trecho)}: ${a.ids.map(nomes).map(esc).join(' ou ')}`).join(' · ')} <span class="dim">· escreva o nome completo ou use um apelido</span>`, 'auto');
  }

  // Acervo: guardar link e texto (mesma fila, nuvem e desfazer de tudo)
  async function addLink(line, t) {
    const r = previa(String(line).trim(), ictx());
    if (r?.tipo !== 'link') throw new CmdError('E_LINK', 'acervo', 'link inválido', 'só http:// e https://');
    await salvar(r, t);
  }
  async function addSnippet(text, t) {
    const r = previa('"' + String(text).trim().replace(/^["“”]/, ''), ictx());
    if (r?.tipo !== 'trecho') throw usage('guardar', 'texto curto pra guardar');
    await salvar(r, t);
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

  /* ---------- tarefas ---------- */

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

  /* ---------- visões (/ver) ---------- */

  const VIEW_KEY = 'mb.view.v1';
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  // a visão atual fica no estado (S.view); o app carrega/salva no navegador (mb.view.v1)
  const currentView = () => viewName(S.view) || 'prazo';

  function showView(view, proj = S.ctx, month = null, status = null) {
    if (view === 'calendario') return showCalendar(proj, month);
    const { groups, list } = viewGroups(S.entries, view, { reg: ctx.reg(), proj, status });
    if (!list.length && (view !== 'kanban' || status)) {
      S.taskList = [];
      if (status) return term.say(`nenhuma tarefa <span class="c-int">@${esc(status)}</span> em ${esc(projLabel(proj))}.`);
      return term.say(`nenhuma tarefa em ${esc(projLabel(proj))}. crie com <span class="c-int">- revisar cap 2${proj ? ' #' + esc(proj) : ''} >sex</span>`);
    }
    term.print(`── ${view}${status ? ' · @' + esc(status) : ''} · ${esc(projLabel(proj))} ${'─'.repeat(10)}`, 'sep');
    if (view === 'kanban') showKanban(groups, list);
    else showTaskGroups(groups, list, g => g.title, view === 'lista' ? ['projeto'] : view === 'status' ? ['status'] : []);
    term.print('<span class="dim">/feito t1 · /mover t1 fazendo · /editar t1 >sex · /ver muda a visão</span>');
  }

  // um cartão do kanban
  function card(n, e, now) {
    const reg = ctx.reg(), done = !!doneAt(e), proj = projectOf(e, reg.projects), pr = prioOf(e);
    const due = e.data?.prazo ? fmtDue(e.data.prazo, now) : '';
    const tone = done ? 'c-meta' : due.startsWith('atrasada') ? 'c-warn' : due === 'hoje' ? 'c-act' : 'c-meta';
    const text = proj ? e.text.replace(new RegExp(`\\s*#${proj}(?![\\p{L}\\p{N}_-])`, 'giu'), '') : e.text;
    const meta = [proj ? `<span class="c-act">#${esc(proj)}</span>` : '', pr === 'alta' && !done ? '<span class="c-warn">!alta</span>' : '', due ? `<span class="${tone}">${esc(due)}</span>` : ''].filter(Boolean).join(' ');
    return `<div class="kcard${done ? ' is-done' : ''}"><span class="n">t${n}</span><span class="kt">${hl(text)}</span>${meta ? `<span class="km">${meta}</span>` : ''}</div>`;
  }

  function showKanban(groups, list) {
    S.taskList = list;
    const now = new Date();
    let n = 0;
    const cols = groups.map(g => {
      const cards = g.items.map(e => card(++n, e, now)).join('') || '<div class="kempty">—</div>';
      return `<section class="kcol${g.final ? ' is-final' : ''}"><header><span>${esc(g.title)}</span><b>${g.items.length}</b></header>${cards}</section>`;
    }).join('');
    term.print(`<div class="kanban">${cols}</div>`, 'block');
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
    const { n } = await salvar(r, t);
    autoLine(r.campos, r.auto, n.slice(1));
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
        table([['- texto #proj @status >prazo !prio', 'cria tarefa (igual ao /t) · o que faltar vira ↳ auto'], ['gastei 45 no ifood · caiu o salário 3.200', 'lança gasto ou entrada (categoria e forma aprendem pelo uso) · /mes mostra o mês'], ['https://… contexto', 'guarda o link no acervo'], ['"texto', 'guarda o texto no acervo']], 'cmd');
        const groups = [
          ['tarefas e projetos', c => ['overview', 'inicio', 't', 'tarefas', 'ver', 'feito', 'mover', 'editar', 'reabrir', 'adiar', 'feitas', 'projeto', 'status', 'ir'].includes(c.name)],
          ['pessoas', c => ['pessoas', 'pessoa', 'sim', 'nao'].includes(c.name)],
          ['finanças', c => fin.defs.includes(c)],
          ['intérprete', c => ['tipo', 'memoria', 'palavras', 'aprendizado', 'mudancas', 'contexto'].includes(c.name)],
          ['acervo', c => ['acervo', 'guardar', 'buscar'].includes(c.name)],
          ['memória', c => c.data],
          ['conta', c => ['entrar', 'codigo', 'sair'].includes(c.name)],
          ['tela', c => ['painel', 'foco', 'limpar', 'log', 'historico', 'boot'].includes(c.name)],
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
          ['ctrl+.', 'mostra/esconde o painel de contexto'],
          ['alt+1..4', 'abas: ~ · tcc · weg · pessoal'],
          ['esc', 'apaga a linha'],
        ]);
      },
    },
    {
      name: 'inbox', data: true, alias: ['ls', 'notas'], args: '[n]', desc: 'suas notas, em diário (últimas n, padrão 15)',
      run(arg) {
        const n = Math.max(1, Math.min(500, parseInt(arg, 10) || 15));
        const all = notesPool();
        if (!all.length) return term.say('nenhuma nota ainda. escreva qualquer coisa pra capturar.');
        const items = all.slice(-n);
        term.print(`── inbox · notas · ${items.length} de ${all.length} ${'─'.repeat(8)}`, 'sep');
        noteRows(items);
        term.print('<span class="dim">tarefas: /tarefas · links e textos: /acervo · tudo: /overview</span>');
      },
    },
    {
      name: 'hoje', data: true, desc: 'notas de hoje + tarefas de hoje e atrasadas',
      run() {
        const k = dayKey(new Date());
        const notes = notesPool().filter(e => e.day === k);
        if (notes.length) { term.print(`── notas de hoje ${'─'.repeat(10)}`, 'sep'); noteRows(notes); }
        else term.say('nenhuma nota hoje.');
        const { groups } = groupTasks(S.entries, { proj: S.ctx, projects: ctx.reg().projects });
        const due = groups.filter(g => g.key === 'atrasadas' || g.key === 'hoje');
        if (due.length) {
          term.print(`── tarefas pra hoje ${'─'.repeat(10)}`, 'sep');
          showTaskGroups(due, due.flatMap(g => g.items.map(e => e.id)));
        }
      },
    },
    {
      name: 'overview', alias: ['ov', 'geral', 'tudo'], data: true,
      desc: 'o geral de tudo (tarefas, notas, acervo, projetos) no lugar do núcleo · esc fecha',
      run() {
        const on = ctx.ui.toggleOverview();
        term.say(on ? 'overview aberto no lugar do núcleo · os números t1, t2... valem pro /feito · <span class="c-int">esc</span> fecha' : 'overview fechado · núcleo de volta');
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
    /* ---------- tarefas e projetos (Fase 1) ---------- */
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
        // f3 = lançamento de dinheiro (js/comandos-financas.js)
        if (/^f\d+$/i.test(String(arg).trim().split(/\s+/)[0] || '')) return fin.editar(arg, t);
        const words = String(arg).trim().split(/\s+/).filter(Boolean);
        const nums = [];
        while (words.length && /^t?\d+(-t?\d+)?$/i.test(words[0])) nums.push(words.shift());
        if (!nums.length) throw usage('editar', 't2 #weg @fazendo >sex !alta  ·  t3 texto novo');
        const p = parseTaskInput(words.join(' '), { reg: ctx.reg(), allowEmpty: true });
        if (p.error) throw parseError(p);
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
      name: 'palavras', alias: ['palavra', 'keywords'], data: true, async: true, exec: true, args: '[projeto] [+palavra] [-palavra]',
      desc: 'palavras-chave que puxam a tarefa pro projeto · ex: /palavras tcc +orientador +banca · /palavras tcc -banca',
      // (atalho do /memoria: "+palavra" fixa a palavra no projeto, "-palavra" solta)
      async run(arg, signal, t) {
        const [first, ...rest] = String(arg).trim().split(/\s+/).filter(Boolean);
        const reg = ctx.reg();
        const fixadas = p => mem().todas('projeto').filter(i => i.chave.startsWith('palavra:') && i.estado === 'fixado' && i.dominante === p).map(i => i.rotulo);
        const show = p => `<span class="k c-act">#${esc(p)}</span><span>${fixadas(p).map(esc).join(', ') || '<span class="dim">nenhuma</span>'}</span>`;
        if (!first) {
          term.print(`── palavras-chave ${'─'.repeat(10)}`, 'sep');
          reg.projects.forEach(p => term.print(show(p), 'tbl'));
          return term.print('<span class="dim">/palavras tcc +orientador ensina · a tarefa que tiver a palavra vai pro projeto · /memoria mostra o que o app aprendeu sozinho</span>');
        }
        const name = projName(first);
        if (!name || !reg.projects.includes(name)) throw new CmdError('E_404', 'task', `projeto #${first} não existe`, 'veja os projetos com <span class="c-int">/projeto</span> · cria com <span class="c-int">/projeto novo nome</span>');
        if (!rest.length) return term.print(show(name), 'tbl');
        const criadas = [];
        // "+banca de defesa" vale como uma expressão só: junta as palavras até o próximo + ou -
        const itens = rest.join(' ').split(/\s+(?=[+-])/).map(s => s.trim()).filter(Boolean);
        for (const it of itens) {
          const tira = it.startsWith('-'), w = it.replace(/^[+-]/, '').replace(/^#/, '').trim();
          if (!w) continue;
          const atual = mem().info(chavePalavra(w));
          if (tira && !(atual.estado === 'fixado' && atual.dominante === name)) continue;
          if (!tira && atual.estado === 'fixado' && atual.dominante === name) continue;
          criadas.push(await gravarMemoria(chavePalavra(w), tira ? 'desafixar' : 'fixar', name, w));
        }
        if (!criadas.length) return term.say('nada mudou.');
        S.undo.push({ label: 'palavras-chave', items: [], created: criadas.map(e => e.id) });
        term.ok('task', `palavras de <span class="c-act">#${esc(name)}</span> · ${fixadas(name).map(esc).join(', ') || 'nenhuma'} <span class="c-meta">· /desfazer volta · ${t.id}</span>`);
        ctx.ui.pulse('act');
      },
    },
    {
      name: 'memoria', alias: ['memória', 'pistas', 'associar'], data: true, async: true, exec: true,
      args: '[pista] [= projeto | categoria | forma] [-valor | solta | limpar]',
      desc: 'o que o app aprendeu (pessoa/palavra → projeto, categoria, forma) · ex: /memoria · /memoria João · /memoria planilha = weg · /memoria ifood = alimentação',
      async run(arg, signal, t) {
        const raw = String(arg).trim();
        const reg = ctx.reg();
        const m = mem();
        const cats = categoriasDe(S.records || []);
        // campo e valor pelo que foi escrito depois do "=": projeto, categoria (gasto ou entrada) ou forma
        const campoDe = v => {
          if (reg.projects.includes(v.toLowerCase())) return { campo: 'projeto', valor: v.toLowerCase() };
          for (const tipo of ['gasto', 'entrada']) { const c = acharCategoria(v, cats[tipo]); if (c) return { campo: campoCategoria(tipo), valor: c }; }
          const f = acharForma(v);
          if (f) return { campo: 'forma', valor: f };
          const k = cartoesDe(S.records || []).find(x => x.nome === v.toLowerCase()); // Fase 3b: /memoria ifood = nubank
          return k ? { campo: 'cartao', valor: k.id } : null;
        };
        const NOME = { projeto: 'projeto', 'categoria:gasto': 'categoria', 'categoria:entrada': 'categoria de entrada', forma: 'forma', cartao: 'cartão', tipo: 'verbo' };
        const val = (campo, v) => (campo === 'projeto' ? '#' + v : campo === 'forma' ? FORMA_ROTULO[v] || v : campo === 'cartao' ? (S.records || []).find(e => e.id === v)?.text || '?' : v);
        const pct = i => (i.total ? Math.round(((i.peso || 0) / i.total) * 100) : 0);
        const linha = (i, mostraCampo = false) => {
          const V = v => esc(val(i.campo, v));
          const por = i.porProjeto.map(([p, w]) => `<span class="c-act">${V(p)}</span> ${w}`).join(' · ') || '<span class="dim">sem aparições</span>';
          const est = { fixado: `<span class="c-int">fixada em ${V(i.dominante)}</span>`, dominante: `<span class="c-act">→ ${V(i.dominante)}</span> <span class="dim">${pct(i)}%</span>`,
            dividida: '<span class="c-warn">dividida (não vota)</span>', pouca: '<span class="dim">pouca evidência</span>', nada: '<span class="dim">nada ainda</span>' }[i.estado];
          const k = mostraCampo ? esc(NOME[i.campo] || i.campo) : esc(i.rotulo);
          return `<span class="k">${k}</span><span>${est}${i.campo === 'tipo' ? '' : ' · ' + por}${i.bloqueados.length ? ` · <span class="dim">bloqueada em ${i.bloqueados.map(V).join(', ')}</span>` : ''}</span>`;
        };
        if (!raw) {
          const todas = m.todas().filter(i => i.estado !== 'nada' && i.estado !== 'pouca');
          if (!todas.length) return term.say('ainda não aprendi nada · conforme você cria e corrige tarefas e lançamentos, eu vou ligando pessoas e palavras a projetos, categorias e formas.');
          term.print(`── memória · o que eu aprendi ${'─'.repeat(8)}`, 'sep');
          const dom = (filtro, n = 12) => todas.filter(i => i.estado === 'dominante' && filtro(i)).sort((a, b) => b.peso - a.peso).slice(0, n);
          const grupos = [
            ['fixadas por você', todas.filter(i => i.estado === 'fixado' && i.campo !== 'tipo')],
            ['pessoas', todas.filter(i => i.campo === 'projeto' && i.chave.startsWith('pessoa:') && i.estado !== 'fixado')],
            ['palavras que puxam projeto', dom(i => i.campo === 'projeto' && i.chave.startsWith('palavra:'))],
            ['categorias', dom(i => i.campo.startsWith('categoria:'))],
            ['formas', dom(i => i.campo === 'forma', 8)],
            ['cartões', dom(i => i.campo === 'cartao', 8)],
            ['verbos que você ensinou', todas.filter(i => i.campo === 'tipo' && i.estado === 'fixado')],
          ].filter(([, l]) => l.length);
          for (const [titulo, l] of grupos) { term.print(titulo, 'tgrp'); l.forEach(i => term.print(linha(i), 'tbl')); }
          return term.print('<span class="dim">/memoria planilha = weg · ifood = alimentação · ifood = crédito fixa · -valor bloqueia · solta · limpar esquece · só vota quem tem ≥70%</span>');
        }
        // "<pista> = valor" · "<pista> -valor" · "<pista> solta" · "<pista> limpar"
        let pista = raw, acao = null, alvo = null;
        let mm;
        if ((mm = raw.match(/^(.+?)\s*=\s*#?(\S+)$/))) { pista = mm[1]; acao = 'fixar'; alvo = mm[2]; }
        else if ((mm = raw.match(/^(.+?)\s+-#?(\S+)$/))) { pista = mm[1]; acao = 'bloquear'; alvo = mm[2]; }
        else if ((mm = raw.match(/^(.+?)\s+(solta|soltar|desafixar)$/i))) { pista = mm[1]; acao = 'desafixar'; }
        else if ((mm = raw.match(/^(.+?)\s+(limpar|esquecer|zerar)$/i))) { pista = mm[1]; acao = 'limpar'; }
        const cv = alvo ? campoDe(alvo) : null;
        if (alvo && !cv) throw new CmdError('E_404', 'memoria', `não conheço "${alvo}"`, `projeto (${reg.projects.map(p => '#' + esc(p)).join(' ')}), categoria (${cats.gasto.map(esc).join(', ')}) ou forma (pix, crédito, débito, dinheiro, boleto)`);
        const p = acharPessoa(pista, pessoasDe(S.records || []));
        if (p.ambiguo) throw new CmdError('E_AMBIGUO', 'pessoa', `"${pista}" bate com ${p.ambiguo.map(x => x.nome).join(', ')}`, 'use o nome completo');
        const chave = p.pessoa ? 'pessoa:' + p.pessoa.id : chavePalavra(pista);
        const verbo = 'verbo:' + chavePalavra(pista).slice(8);
        // o que a memória sabe dessa pista em cada campo (o verbo ensinado também)
        const campos = ['projeto', campoCategoria('gasto'), campoCategoria('entrada'), 'forma', 'cartao'];
        const sabe = mm2 => [...campos.map(c => mm2.info(chave, c)), mm2.info(verbo, 'tipo')].filter(i => i.estado !== 'nada' || i.bloqueados.length);
        if (!acao) {
          term.print(`── memória · ${esc(pista)} ${'─'.repeat(8)}`, 'sep');
          const l = sabe(m);
          if (!l.length) return term.print(`<span class="k">${esc(pista)}</span><span class="dim">nada ainda</span>`, 'tbl');
          return l.forEach(i => term.print(linha(i, true), 'tbl'));
        }
        const rot = p.pessoa ? p.pessoa.nome : pista;
        // fixar/bloquear valem pro campo do valor · soltar/limpar valem pra tudo que a pista tem
        const alvos = cv ? [{ chave, campo: cv.campo }] : sabe(m).map(i => ({ chave: i.chave, campo: i.campo }));
        if (!alvos.length) return term.say(`não sei nada de ${esc(pista)} ainda.`);
        const criadas = [];
        for (const a of alvos) {
          criadas.push(await (a.campo === 'projeto'
            ? gravarMemoria(a.chave, acao, cv?.valor, rot)
            : gravarMemoria(a.chave, acao, null, rot, { campo: a.campo, valor: cv?.valor })));
        }
        S.undo.push({ label: 'memória', items: [], created: criadas.map(e => e.id) });
        S.lastLatency = t.elapsed();
        const depois = mem();
        term.ok('memoria', `${{ fixar: 'fixado', bloquear: 'bloqueado', desafixar: 'solto', limpar: 'esquecido' }[acao]} · ${alvos.map(a => linha(depois.info(a.chave, a.campo), true)).join(' · ')} <span class="c-meta">· ${esc(rot)} · /desfazer volta · ${t.id}</span>`);
        ctx.ui.pulse('act');
      },
    },
    {
      name: 'sim', alias: ['s', 'yes'], data: true, async: true, exec: true, desc: 'responde sim à última pergunta do app (é uma pessoa? era tarefa?)',
      async run(arg, signal, t) { await responder(true, t); },
    },
    {
      name: 'nao', alias: ['não', 'n', 'no'], data: true, async: true, exec: true, desc: 'responde não à última pergunta do app (não é pessoa / é nota mesmo)',
      async run(arg, signal, t) { await responder(false, t); },
    },
    {
      name: 'pessoas', alias: ['gente', 'contatos'], data: true, desc: 'quem está cadastrado, com quantas coisas ligadas',
      run() {
        const pes = pessoasDe(S.records || []);
        if (!pes.length) return term.say('ninguém cadastrado ainda · <span class="c-int">/pessoa nova Ana</span> cadastra (ou escreva normal: o app pergunta quando vir um nome novo)');
        term.print(`── pessoas · ${pes.length} ${'─'.repeat(10)}`, 'sep');
        for (const p of pes.sort((a, b) => a.nome.localeCompare(b.nome))) {
          const ligadas = S.entries.filter(e => (e.data?.pessoas || []).includes(p.id));
          const abertas = ligadas.filter(e => isTask(e) && !doneAt(e)).length;
          term.print(`<span class="k c-act">${esc(p.nome)}</span><span>${p.apelidos.length ? `<span class="dim">${p.apelidos.map(esc).join(', ')} · </span>` : ''}${ligadas.length} ligadas${abertas ? ` · ${abertas} abertas` : ''}</span>`, 'tbl');
        }
        term.print('<span class="dim">/pessoa João mostra tudo dela · /pessoa nova · apelido · renomear · juntar · arquivar</span>');
      },
    },
    {
      name: 'pessoa', data: true, async: true, exec: true,
      args: '<nome> | nova Ana [+apelido] | apelido João +jão -joca | renomear Jão = João Silva | juntar Jão com João | arquivar Ana',
      desc: 'vê ou edita uma pessoa · juntar = os dois cadastros viram um só',
      async run(arg, signal, t) {
        const raw = String(arg).trim();
        const [sub0, ...rest] = raw.split(/\s+/);
        const sub = (sub0 || '').toLowerCase();
        const pes = pessoasDe(S.records || []);
        const rec = id => S.records.find(e => e.id === id);
        // acha o cadastro pelo nome digitado (ou explica o que deu errado)
        const qual = nome => {
          const r = acharPessoa(nome, pes);
          if (r.pessoa) return rec(r.pessoa.id);
          if (r.ambiguo) throw new CmdError('E_AMBIGUO', 'pessoa', `"${nome}" bate com ${r.ambiguo.length} pessoas: ${r.ambiguo.map(p => p.nome).join(', ')}`, 'use o nome completo');
          throw new CmdError('E_404', 'pessoa', `não conheço "${nome}"`, 'veja quem está cadastrado com <span class="c-int">/pessoas</span> · <span class="c-int">/pessoa nova Nome</span> cadastra');
        };
        const separa = (txt, re) => { const i = txt.search(re); return i < 0 ? null : [txt.slice(0, i).trim(), txt.slice(i).replace(re, '').trim()]; };
        const done = (msg, tone = 'act') => { S.lastLatency = t.elapsed(); term.ok('pessoa', `${msg} <span class="c-meta">· /desfazer volta · ${t.id}</span>`); ctx.ui.pulse(tone); };

        if (!sub) return defs.find(c => c.name === 'pessoas').run('');
        if (sub === 'nova' || sub === 'novo' || sub === 'criar') {
          const words = rest.filter(w => !w.startsWith('+'));
          const nome = words.join(' ').trim();
          if (!nome) throw usage('pessoa', 'nova Ana [+aninha]');
          if (pes.some(p => fold(p.nome) === fold(nome))) return term.say(`${esc(nome)} já está cadastrada.`);
          const apelidos = editApelidos([], rest.filter(w => w.startsWith('+')), nome);
          const e = await ctx.store.add({ kind: 'pessoa', text: nome, tags: [], ts: Date.now(), day: dayKey(new Date()), data: { apelidos, arquivada: false, juntada_em: null } });
          S.undo.push({ label: 'pessoa cadastrada', items: [], created: [e.id] });
          return done(`pessoa cadastrada · <span class="c-act">${esc(nome)}</span>${apelidos.length ? ' · ' + apelidos.map(esc).join(', ') : ''}`);
        }
        if (sub === 'apelido' || sub === 'apelidos') {
          const nome = rest.filter(w => !/^[+-]/.test(w)).join(' ');
          const r = qual(nome);
          const apelidos = editApelidos(r.data?.apelidos || [], rest.filter(w => /^[+-]/.test(w)), r.text);
          S.undo.push({ label: 'apelidos', items: [r] });
          await ctx.store.restore({ ...r, data: { ...(r.data || {}), apelidos } });
          return done(`apelidos de <span class="c-act">${esc(r.text)}</span> · ${apelidos.map(esc).join(', ') || 'nenhum'}`);
        }
        if (sub === 'renomear') {
          const par = separa(rest.join(' '), /\s*(?:=|\bpara\b|\bpra\b)\s*/);
          if (!par || !par[0] || !par[1]) throw usage('pessoa', 'renomear Jão = João Silva');
          const r = qual(par[0]);
          if (pes.some(p => p.id !== r.id && fold(p.nome) === fold(par[1]))) throw new CmdError('E_ARG', 'pessoa', `${par[1]} já existe`, `pra virar um cadastro só, use <span class="c-int">/pessoa juntar ${esc(r.text)} com ${esc(par[1])}</span>`);
          // o nome antigo vira apelido: o app continua reconhecendo do jeito que você escrevia
          const apelidos = editApelidos(r.data?.apelidos || [], ['+' + r.text], par[1]);
          S.undo.push({ label: 'pessoa renomeada', items: [r] });
          await ctx.store.restore({ ...r, text: par[1], data: { ...(r.data || {}), apelidos } });
          return done(`${esc(r.text)} → <span class="c-act">${esc(par[1])}</span> (o nome antigo virou apelido)`);
        }
        if (sub === 'juntar' || sub === 'mesclar' || sub === 'unir') {
          const par = separa(rest.join(' '), /\s*(?:\bcom\b|\bem\b|=)\s*/);
          if (!par || !par[0] || !par[1]) throw usage('pessoa', 'juntar Jão com João  (o primeiro some, tudo dele vai pro segundo)');
          const de = qual(par[0]), para = qual(par[1]);
          if (de.id === para.id) return term.say('é a mesma pessoa.');
          const { novoPara, novoDe, religadas } = juntarPessoas(de, para, S.entries);
          S.undo.push({ label: 'pessoas juntadas', items: [de, para, ...S.entries.filter(e => religadas.some(r => r.id === e.id))] });
          await ctx.store.restore(novoPara);
          await ctx.store.restore(novoDe);
          for (const e of religadas) await ctx.store.restore(e);
          return done(`<span class="c-act">${esc(de.text)}</span> juntado em <span class="c-act">${esc(para.text)}</span> · ${religadas.length} ${religadas.length === 1 ? 'entrada religada' : 'entradas religadas'} · apelidos: ${novoPara.data.apelidos.map(esc).join(', ')}`);
        }
        if (sub === 'arquivar') {
          const r = qual(rest.join(' '));
          S.undo.push({ label: 'pessoa arquivada', items: [r] });
          await ctx.store.restore({ ...r, data: { ...(r.data || {}), arquivada: true } });
          return done(`${esc(r.text)} arquivada · o app para de reconhecer · as entradas continuam como estão`, 'warn');
        }
        // /pessoa João: o cartão da pessoa (a visão completa vem na etapa 5)
        const r = qual(raw);
        mostrarPessoa(r);
      },
    },
    {
      name: 'tipo', alias: ['era', 'corrigir'], data: true, async: true, exec: true, args: '<tarefa|nota|gasto|entrada|transferência|treino|link|texto> [#3 | t2 | a1]',
      desc: 'corrige o que o app entendeu · sem alvo, vale pra última coisa que você escreveu · ex: /tipo tarefa · /tipo nota t4',
      async run(arg, signal, t) {
        const [rawTipo, alvo] = String(arg).trim().toLowerCase().split(/\s+/);
        const ALIAS = { texto: 'trecho', textos: 'trecho', tarefas: 'tarefa', notas: 'nota', gastos: 'gasto', entradas: 'entrada', treinos: 'treino', 'transferência': 'transferencia', transferir: 'transferencia' };
        const tipo = ALIAS[rawTipo] || rawTipo;
        if (!tipo || !REGISTRO.get(tipo)) throw usage('tipo', `${REGISTRO.ids().map(x => (x === 'trecho' ? 'texto' : x)).join('|')} [#3 | t2]`);
        // qual entrada: a última escrita, ou a do número (#3 nota, a2 acervo, t1 tarefa)
        let e = null, frase = null;
        if (!alvo) {
          e = S.entries.find(x => x.id === S.ultima?.id) || null;
          frase = S.ultima?.texto;
          if (!e) throw new CmdError('E_ARG', 'store', 'não sei qual corrigir', 'diga o número: <span class="c-int">/tipo tarefa #3</span> (nota) · <span class="c-int">t2</span> (tarefa) · <span class="c-int">a1</span> (acervo)');
        } else if (/^t\d+$/.test(alvo)) {
          e = taskPool()[+alvo.slice(1) - 1];
          if (!e || e.missing) throw new CmdError('E_404', 'task', `tarefa ${alvo} não existe`, 'os números aparecem no <span class="c-hud">/tarefas</span>');
        } else {
          const label = /^\d+$/.test(alvo) ? '#' + alvo : alvo;
          const id = [...nums()].find(([, v]) => v === label)?.[0];
          e = id && S.entries.find(x => x.id === id);
          if (!e) throw new CmdError('E_404', 'store', `${alvo} não existe`, 'os números aparecem no <span class="c-hud">/inbox</span> (#3) e no <span class="c-hud">/acervo</span> (a1)');
        }
        if (e.kind === tipo) return term.say(`já é ${esc(REGISTRO.get(tipo).rotulo)}.`);
        // relê a frase original com o tipo forçado
        const texto = frase || e.data?.frase || e.text;
        const r = tipo === 'tarefa' ? previa(texto.replace(/^-\s+/, ''), ictx({ forcar: 'tarefa' })) : previa(texto, ictx({ forcar: tipo }));
        if (!r || r.tipo !== tipo || r.erro) {
          const dica = { gasto: 'precisa de um valor, ex: <span class="c-int">gastei 30 no almoço</span>', entrada: 'precisa de um valor, ex: <span class="c-int">recebi 1.500 de salário</span>',
            link: 'precisa começar com http:// ou https://', trecho: 'use <span class="c-int">/guardar texto</span>' }[tipo] || 'escreva de novo de outro jeito';
          throw new CmdError('E_TIPO', 'store', `não consegui ler "${texto}" como ${REGISTRO.get(tipo).rotulo}`, dica + ' · <span class="c-hud">/desfazer</span> apaga o que foi salvo');
        }
        // troca: apaga a versão antiga e grava a nova · /desfazer volta as duas coisas de uma vez
        await ctx.store.remove(e.id);
        const { e: novo, n } = await salvar(r, t);
        S.undo.pop(); // o salvar empilhou só a criação; o passo certo inclui a antiga
        S.undo.push({ label: `virou ${REGISTRO.get(tipo).rotulo}`, items: [e], created: [novo.id] });
        S.ultima = { id: novo.id, texto };
        // perguntas que falavam da versão antiga passam a falar da nova; a do tipo já foi respondida
        S.perguntas = (S.perguntas || []).filter(q => !(q.tipo === 'tipo' && q.id === e.id)).map(q => (q.id === e.id ? { ...q, id: novo.id } : q));
        aprender({ texto, era: e.kind, corrigido: tipo });
        entendiLine({ ...r, pergunta: false }, novo, n);
        if (isFinanca(novo)) fin.perguntar(r, novo, n);
      },
    },
    {
      name: 'contexto', alias: ['ctx'], data: true, args: '[dias]',
      desc: 'o resumo do seu estado que a IA vai ler (Fase 6) · ex: /contexto · /contexto 14',
      run(arg) {
        const d = Math.min(60, Math.max(1, parseInt(arg, 10) || 7));
        const texto = montarContexto(S.entries, S.records || [], { reg: ctx.reg(), dias: d, pessoas: pessoasDe(S.records || []) });
        term.print(`── contexto · ${d} dias · ${texto.length} caracteres · ≈ ${estimarTokens(texto)} tokens ${'─'.repeat(4)}`, 'sep');
        texto.split('\n').forEach(l => term.print(`<span class="${l.startsWith('  ') ? '' : 'c-int'}">${esc(l).replace(/^ +/, m => '&nbsp;'.repeat(m.length))}</span>`));
        term.print('<span class="dim">é isto (e só isto) que o Coach vai ler · curto de propósito pra gastar pouco</span>');
      },
    },
    {
      name: 'aprendizado', alias: ['aprender'], data: true, args: '[exportar]',
      desc: 'frases que o app não entendeu e as que você corrigiu com /tipo · exportar = formato da régua de testes',
      run(arg) {
        const res = resumoAprendizado(S.records || []);
        if (!res.total && !res.naoPessoas.length) return term.say('nada ainda · quando o app ficar em dúvida ou você usar /tipo, a frase aparece aqui.');
        if (/^export/i.test(String(arg).trim())) {
          term.print(`── aprendizado · cole em tests/frases.js ${'─'.repeat(6)}`, 'sep');
          exportarFrases(res).forEach(l => term.print(`<span class="${l.trimStart().startsWith('//') ? 'dim' : ''}">${esc(l)}</span>`));
          return term.print('<span class="dim">corrigidas viram teste · as comentadas (//) precisam do tipo certo antes</span>');
        }
        term.print(`── aprendizado · ${res.total} frases · ${res.corrigidas.length} corrigidas · ${res.semResposta.length} sem resposta ${'─'.repeat(4)}`, 'sep');
        const linha = (i, extra) => term.print(`<span class="c-meta">${ddmm(new Date(i.ts))}</span> ${hl(i.texto)} ${extra}${i.vezes > 1 ? ` <span class="dim">· ${i.vezes}x</span>` : ''}`);
        if (res.corrigidas.length) {
          term.print('corrigidas', 'tgrp');
          res.corrigidas.slice(0, 15).forEach(i => linha(i, `<span class="dim">${esc(i.era || '?')} →</span> <span class="c-act">${esc(i.corrigido)}</span>`));
        }
        if (res.semResposta.length) {
          term.print('sem resposta', 'tgrp');
          res.semResposta.slice(0, 15).forEach(i => linha(i, `<span class="dim">palpite: ${esc(i.palpite || '—')}</span>`));
        }
        if (res.naoPessoas.length) term.print(`<span class="dim">não são pessoa (/nao):</span> ${res.naoPessoas.map(esc).join(', ')}`);
        term.print('<span class="dim">/aprendizado exportar gera as linhas pra régua de testes</span>');
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
    {
      name: 'buscar', data: true, alias: ['grep', 'b'], args: '<termo | #tag> [tipo:link|texto|tarefa|nota]',
      desc: 'procura em tudo (notas, tarefas, links, textos) · ex: /buscar rag tipo:link',
      run(arg) {
        if (!String(arg).trim()) throw usage('buscar', 'rag  ·  #tcc  ·  rag tipo:link');
        showSearch(searchAll(S.entries, arg), `busca "${arg}"`);
      },
    },
    {
      name: 'acervo', alias: ['ac'], data: true, args: '[links | textos] [termo]',
      desc: 'links e textos guardados · cole um link pra guardar · /guardar texto',
      run(arg) {
        const words = String(arg).trim().split(/\s+/).filter(Boolean);
        const tipo = { links: 'link', link: 'link', textos: 'trecho', texto: 'trecho', trechos: 'trecho' }[(words[0] || '').toLowerCase()];
        if (tipo) words.shift();
        const pool = S.entries.filter(e => isAcervo(e) && (!tipo || (tipo === 'link' ? isLink(e) : isSnippet(e))));
        if (!pool.length) {
          return term.say('acervo vazio. cole um link (<span class="c-int">https://… contexto #tag</span>) ou use <span class="c-int">/guardar texto</span>.');
        }
        showSearch(searchAll(pool.slice().reverse(), words.join(' ')), `acervo${tipo ? ' · ' + (tipo === 'link' ? 'links' : 'textos') : ''}`);
        term.print('<span class="dim">toque no cartão pra abrir · /apagar a2 remove · /buscar termo procura em tudo</span>');
      },
    },
    {
      name: 'guardar', alias: ['g', 'salvar'], exec: true, data: true, async: true, args: '<texto>',
      desc: 'guarda um texto curto no acervo (ou comece a linha com aspas ")',
      async run(arg, signal, t) {
        if (!String(arg).trim()) throw usage('guardar', 'texto curto pra guardar');
        const l = parseLink(arg);
        return l ? addLink(arg, t) : addSnippet(arg, t);
      },
    },
    {
      name: 'apagar', exec: true, data: true, alias: ['rm'], args: '<3 | a2 | t1 | f3 | 1-4 | texto>',
      desc: 'apaga: 3 = nota · a2 = acervo · t1 = tarefa · f3 = lançamento · ou pelo texto (dá pra desfazer)', async: true,
      async run(arg, signal, t) {
        const raw = String(arg).trim();

        // lançamentos de dinheiro (f3): js/comandos-financas.js (recorrente apagado pula o mês)
        if (/^f\d/i.test(raw)) return fin.apagar(raw, t);

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

        // acervo: a1 · a1 a3 · a2-a4  ·  notas: 3 · #3 · 1 2 · 1-4  ·  texto: procura em tudo
        const isAcv = /^a\d/i.test(raw);
        const numeric = s => s.split(/[\s,;]+/).filter(Boolean).every(x => /^#?\d+(-#?\d+)?$/.test(x));
        let pick, prefix = '#';
        if (isAcv) {
          const n = raw.replace(/a/gi, '');
          if (!numeric(n)) throw usage('apagar', 'a1  ·  a1 a3  ·  a2-a4');
          pick = pickTargets(n, acervoPool());
          prefix = 'a';
        } else {
          pick = pickTargets(raw, numeric(raw) ? notesPool() : S.entries);
        }
        if (pick.mode === 'empty') throw usage('apagar', '3 (nota)  ·  a2 (acervo)  ·  t1 (tarefa)  ·  texto');
        const { targets } = pick;
        const label = e => nums().get(e.id) || (isTask(e) ? 'tarefa' : '');

        if (pick.mode === 'num') {
          if (!targets.length) throw new CmdError('E_ARG', 'shell', `nada com ${pick.bad.length > 1 ? 'esses números' : 'esse número'}`, isAcv ? 'os números a1, a2... aparecem no <span class="c-int">/acervo</span>' : 'os números das notas aparecem no <span class="c-int">/inbox</span> · acervo usa a1 · tarefa usa t1');
          if (pick.bad.length) term.warn('shell', `ignorados (não existem): ${pick.bad.map(n => prefix + esc(n)).join(' ')}`);
        } else {
          // pelo texto: só apaga sozinho se UMA coisa bater
          if (!targets.length) throw new CmdError('E_404', 'store', `nada contém "${raw}"`, 'confira com <span class="c-int">/buscar</span>');
          if (targets.length > 1) {
            list(targets.map(h => h.e), `"${raw}" bate com ${targets.length}`);
            term.say('não apaguei nada, pra não sumir coisa errada. escolha pelo número: <span class="c-int">/apagar 3</span> (nota) · <span class="c-int">a2</span> (acervo) · <span class="c-int">t1</span> (tarefa)');
            return;
          }
        }

        for (const { e } of targets) await ctx.store.remove(e.id);
        S.undo.push({ label: targets.length === 1 ? 'apagado' : `${targets.length} apagados`, items: targets.map(x => x.e) }); // o lote inteiro volta com /desfazer
        S.lastLatency = t.elapsed();
        const meta = `<span class="c-meta">· ${t.id} · ${S.lastLatency}ms · /desfazer recupera</span>`;
        if (targets.length === 1) term.warn('store', `apagado ${esc(isAcv ? 'a' + targets[0].n : pick.mode === 'num' ? '#' + targets[0].n : label(targets[0].e))} · ${hl(targets[0].e.text)} ${meta}`);
        else {
          term.warn('store', `apagados ${targets.length} ${meta}`);
          targets.forEach(({ n, e }) => term.print(`<span class="nt">${esc(prefix + n)}</span><span class="nx dim">${hl(e.text)}</span><span class="nn"></span>`, 'note'));
        }
        ctx.ui.pulse('warn');
      },
    },
    {
      name: 'desfazer', exec: true, data: true, alias: ['undo'], desc: 'desfaz a última mudança (apagar, concluir, adiar...)', async: true,
      async run(arg, signal, t) {
        // cada passo guarda as versões ANTERIORES (items) e o que foi criado (created);
        // desfazer = restaurar as versões antigas e apagar o que foi criado
        const step = S.undo.pop();
        if (!step) return term.say('nada pra desfazer.');
        for (const id of step.created || []) await ctx.store.remove(id, { origem: 'desfazer' });
        for (const e of step.items) await ctx.store.restore(e, { origem: 'desfazer' });
        S.lastLatency = t.elapsed();
        const n = step.items.length + (step.created?.length || 0);
        const what = step.items.length === 1 && !step.created?.length ? hl(step.items[0].text) : `${n} ${n === 1 ? 'item' : 'itens'}`;
        term.ok('store', `desfeito · ${esc(step.label)} · ${what} <span class="c-meta">· ${t.id} · ${S.lastLatency}ms</span>`);
        ctx.ui.pulse('act');
      },
    },
    {
      name: 'condition', alias: ['sys', 'sistema'], desc: 'condição completa do sistema (estado, memória, rede, sessão)',
      run() {
        const k = dayKey(new Date());
        const state = ctx.ui.state();
        const wx = S.weather;
        const [memText, memTone] = ctx.ui.mem();
        const st = ctx.store?.status;
        table([
          ['estado', `<span class="${state === 'ready' ? 'c-act' : state === 'busy' ? 'c-hud' : 'c-warn'}">${state.toUpperCase()}</span>`],
          ['sessão', S.user ? esc((S.operator ? S.operator + ' · ' : '') + S.user.email) : S.locked ? '<span class="c-warn">bloqueada · digite a senha</span>' : 'modo local'],
          ['memória', `<span class="${memTone === 'ok' ? 'c-act' : memTone === 'na' ? 'c-meta' : 'c-warn'}">${memText}</span>` +
            (ctx.store?.kind === 'local' ? ' <span class="dim">· só neste navegador</span>' : '') +
            (st?.lastSync ? ` <span class="dim">· último sync ${hhmm(new Date(st.lastSync))}</span>` : '') +
            (st?.lastError ? ` <span class="c-warn">· ${esc(st.lastError)}</span>` : '')],
          ['tempo real', st?.realtime ?? '<span class="dim">NA</span>'],
          ['leitura', st?.modo ? `${st.modo === 'leve' ? 'leve (só o que mudou)' : 'completa'} · ${st.linhas ?? 0} linhas` : '<span class="dim">NA</span>'],
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
        const blob = new Blob([JSON.stringify({ app: 'mega-brain', version: VERSION, exportedAt: new Date().toISOString(), entries: [...S.entries, ...(S.records || [])] }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `mega-brain-${dayKey(new Date())}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        term.ok('store', `exportadas ${S.entries.length} entradas · ${esc(a.download)}`);
      },
    },
    {
      name: 'entrar', alias: ['login'], args: '[outro]', desc: 'entra na conta (usuário e senha) · "outro" troca de usuário',
      run(arg) { ctx.actions.login(String(arg).trim().toLowerCase()); },
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
      name: 'migrar', exec: true, desc: 'envia pra nuvem as notas que ficaram no modo local', async: true, announce: true, data: true,
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
            const plan = prepareImport(json, [...S.entries, ...(S.records || [])]);
            if (!plan) throw new CmdError('E_IMPORT', 'store', 'não achei uma lista de entradas no arquivo', 'use o arquivo gerado pelo <span class="c-hud">/exportar</span>');
            for (const e of plan.toAdd) await ctx.store.restore(e, { origem: 'importar' });
            S.lastLatency = t.elapsed();
            term.ok('store', `importadas ${plan.toAdd.length} · já existiam ${plan.skipped}` +
              (plan.invalid ? ` · <span class="c-warn">ignoradas ${plan.invalid} inválidas</span>` : '') +
              ` <span class="c-meta">· ${esc(file.name)} · ${t.id} · ${S.lastLatency}ms</span>`);
            ctx.ui.pulse('act');
          }, { announce: true, kind: 'exec' });
        };
        pick.click();
        term.say('escolha o arquivo .json do backup.');
      },
    },
    {
      name: 'boot', args: '[completo | curto]', desc: 'repete a inicialização completa · "completo" deixa sempre a longa',
      run(arg) {
        const a = String(arg).trim().toLowerCase();
        if (a === 'completo' || a === 'longo') {
          try { localStorage.setItem('mb.boot.v1', 'full'); } catch {}
          return term.say('a inicialização completa (~5s) vai rodar sempre que o MB Core abrir. <span class="c-int">/boot curto</span> volta pra rápida.');
        }
        if (a === 'curto' || a === 'rapido' || a === 'rápido') {
          try { localStorage.setItem('mb.boot.v1', 'auto'); } catch {}
          return term.say('inicialização rápida (~1,5s) a partir da próxima abertura.');
        }
        if (a) throw usage('boot', '[completo | curto]');
        try { sessionStorage.setItem('mb.boot.once', 'full'); } catch {}
        term.say('reiniciando o núcleo…');
        setTimeout(() => location.reload(), 350);
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
      name: 'painel', alias: ['tele'], desc: 'mostra/esconde o painel de contexto (ctrl+.)',
      run() {
        const on = ctx.ui.toggle('tele');
        term.say(on ? 'telemetria visível.' : 'telemetria escondida · <span class="c-hud">/painel</span> ou ctrl+. traz de volta.');
      },
    },
    {
      name: 'foco', alias: ['zen'], desc: 'só núcleo e terminal na tela (de novo pra voltar)',
      run() {
        const on = ctx.ui.toggle('focus');
        term.say(on ? 'modo foco · <span class="c-hud">/foco</span> de novo traz os painéis.' : 'painéis de volta.');
      },
    },
    {
      name: 'limpar', alias: ['clear', 'cls'], desc: 'limpa a tela sem apagar o log (ctrl+k)',
      run() { term.clear(); },
    },
    // finanças: os comandos ficam em js/comandos-financas.js
    ...fin.defs,
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
    capturar,
    rotuloCaptura,
    salvar,
    // recorrentes (Fase 3c): o app.js chama depois da leitura completa e na virada do dia
    lancarRecorrentes: o => fin.lancarRecorrentes(o),
    addLink,
    addSnippet,
    // lista leve dos comandos (nome, atalhos, uso, descrição) pro painel de contexto
    catalog: () => defs.map(c => ({ name: c.name, alias: c.alias || [], args: c.args || '', desc: c.desc })),
    names: () => defs.map(c => c.name),
  };
}
