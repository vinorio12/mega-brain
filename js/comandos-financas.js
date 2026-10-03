// Comandos e telas de finanças (Fase 3a). Separado do commands.js, que já está grande.
//
// O commands.js chama criarFinancas(h) e junta os `defs` daqui na lista dele (aparecem sozinhos no /ajuda e no Tab).
//   h = { S, term, ctx, usage, mem }  · S = estado do app · ctx.store grava (com histórico) · mem() = a memória do momento
//
// Números dos lançamentos: f1, f2... (da última lista; um lançamento novo entra no fim), como t1 nas tarefas.
// Perguntas de dinheiro não travam e não usam /sim: cada uma tem o seu comando (/cat, /forma), então aparecem na hora.

import { esc, hl, dayKey, CmdError } from './util.js';
import { fmtValor, parseValor } from './valores.js';
import { fmtDia, findDate } from './dates.js';
import { parseMonth } from './views.js';
import { seedId } from './tasks.js';
import { decidirCategoria } from './tipos-financas.js';
import { lerFinanca, seedCategorias, categoriasDe, acharCategoria, acharForma, FORMAS, FORMA_ROTULO, resumoMes, mesAnterior, fmtMes, variacao, barra, lancamentos } from './financas.js';

export const KINDS_FINANCAS = ['gasto', 'entrada', 'transferencia'];
export const isFinanca = e => KINDS_FINANCAS.includes(e?.kind);

export function criarFinancas(h) {
  const { S, term, ctx, usage } = h;
  const cats = () => categoriasDe(S.records || []);
  const formaTxt = f => FORMA_ROTULO[f] || f;

  /* ---------- números f1, f2... ---------- */

  function pool() {
    if (!S.finList) S.finList = [];
    const byId = new Map(S.entries.map(e => [e.id, e]));
    return S.finList.map(id => byId.get(id) || { id: null, missing: true });
  }
  // o número de um lançamento (entra no fim da lista se ainda não tem)
  function numero(e) {
    if (!S.finList) S.finList = [];
    if (!S.finList.includes(e.id)) S.finList.push(e.id);
    return 'f' + (S.finList.indexOf(e.id) + 1);
  }
  // "f3" → o lançamento · sem alvo → o último que você escreveu
  function alvo(token) {
    if (token) {
      const e = pool()[+token.slice(1) - 1];
      if (!e || e.missing) throw new CmdError('E_404', 'fin', `lançamento ${token} não existe`, 'os números f1, f2... aparecem quando você lança um gasto ou uma entrada');
      return e;
    }
    const e = S.entries.find(x => x.id === S.ultimaFin);
    if (!e) throw new CmdError('E_ARG', 'fin', 'não sei qual lançamento corrigir', 'diga o número: <span class="c-int">/cat f2 alimentação</span>');
    return e;
  }

  /* ---------- linha "↳ entendi" e perguntas ---------- */

  // por que essa categoria/forma: "(xpto: 4 de 4)" · "(fixado)"
  const porque = m => (m?.tipo === 'pista' ? ` <span class="dim">(${esc(m.pista)}: ${m.estado === 'fixado' ? 'fixado' : `${m.peso} de ${m.total}`})</span>` : '');

  function entendi(r, e, n) {
    const c = r.campos, A = k => (r.auto.includes(k) ? '<span class="dim">*</span>' : '');
    const nomes = (r.pessoas || []).map(id => (S.records || []).find(x => x.id === id)?.text).filter(Boolean);
    let partes;
    if (r.tipo === 'transferencia') {
      partes = [esc(fmtValor(c.valor)), c.conta ? `${c.sentido === 'de' ? 'da' : 'pra'} ${esc(c.conta)}` : '', '<span class="dim">não mexe no saldo</span>', `${esc(fmtDia(c.data))}${A('data')}`];
    } else {
      partes = [
        esc(fmtValor(c.valor)),
        c.categoria ? `<span class="c-act">${esc(c.categoria)}</span>${A('categoria')}${porque(r.motivos?.categoria)}` : '<span class="c-warn">sem categoria</span>',
        c.forma ? `${esc(formaTxt(c.forma))}${A('forma')}${porque(r.motivos?.forma)}` : '',
        c.lugar ? esc(c.lugar) : '', ...nomes.map(esc),
        `${esc(fmtDia(c.data))}${A('data')}`,
      ];
    }
    const rot = { gasto: 'gasto', entrada: 'entrada', transferencia: 'transferência' }[r.tipo];
    const corrigir = r.tipo === 'transferencia' ? '/tipo gasto' : `/cat ${n}`;
    term.print(`<span class="c-int">↳ entendi</span> · ${rot} · ${partes.filter(Boolean).join(' · ')}` +
      ` <span class="dim">· ${r.auto.length ? '* auto · ' : ''}${esc(r.origem)} ${Math.round(r.confianca * 100)}% · /desfazer ou ${corrigir}</span>`, 'auto');
  }

  // perguntas logo depois de salvar: categoria (outros / dividida / conflito), forma (gasto sem forma), estorno ligado
  function perguntar(r, e, n) {
    S.ultimaFin = e.id; // o /cat e o /forma sem número valem pra este
    if (r.tipo === 'transferencia') return;
    const mc = r.motivos?.categoria, lista = cats()[r.tipo] || [];
    const sugestoes = lista.filter(x => x !== 'outros').slice(0, 6).map(x => `<span class="c-int">${esc(x)}</span>`).join(' · ');
    if (mc?.tipo === 'padrao') {
      term.print(`<span class="c-warn">↳ categoria?</span> <span class="dim">salvei em outros · qual é?</span> <span class="c-int">/cat</span> ${sugestoes}${lista.length > 7 ? ' <span class="dim">…</span>' : ''}`, 'auto');
    } else if (mc?.tipo === 'dividida') {
      term.print(`<span class="c-warn">↳ categoria?</span> ${esc(mc.pista)} aparece em ${mc.porValor.map(([v, w]) => `<span class="c-act">${esc(v)}</span> ${w}`).join(' · ')} <span class="dim">· não chutei ·</span> <span class="c-int">/cat ${esc(mc.porValor[0]?.[0] || '')}</span>`, 'auto');
    } else if (mc?.tipo === 'conflito') {
      term.print(`<span class="c-warn">↳ categoria?</span> ${mc.pistas.map(p => `${esc(p.pista)} → <span class="c-act">${esc(p.valor)}</span>`).join(' · ')} <span class="dim">· não chutei ·</span> <span class="c-int">/cat ${esc(mc.pistas[0]?.valor || '')}</span>`, 'auto');
    }
    if (r.tipo === 'gasto' && !r.campos.forma) {
      term.print(`<span class="c-warn">↳ forma?</span> <span class="c-int">/forma</span> ${FORMAS.map(f => `<span class="c-int">${esc(formaTxt(f))}</span>`).join(' · ')} <span class="dim">· eu aprendo pro próximo</span>`, 'auto');
    }
    if (r.tipo === 'entrada' && /estorno|reembolso|devolu|cashback/i.test(r.texto)) {
      const g = r.campos.ref && S.entries.find(x => x.id === r.campos.ref);
      term.print(g
        ? `<span class="c-int">↳ devolve</span> o gasto de ${esc(fmtDia(g.data?.data || g.day))} · ${hl(g.text)} <span class="c-act">${esc(fmtValor(g.data?.valor))}</span>`
        : '<span class="dim">↳ não achei o gasto que ele devolve (mesma palavra, até 60 dias) · fica como entrada solta</span>', 'auto');
    }
  }

  /* ---------- corrigir: categoria e forma ---------- */

  // grava a mudança de um campo (o que você escolhe deixa de ser "auto") · entra no /desfazer e no histórico
  async function mudar(e, campo, valor, t, label) {
    const campos = (e.data?.auto?.campos || []).filter(k => k !== campo);
    const data = { ...(e.data || {}), [campo]: valor, auto: campos.length ? { ...e.data.auto, campos } : null };
    if (!data.auto) delete data.auto;
    S.undo.push({ label, items: [e] });
    await ctx.store.restore({ ...e, data });
    S.lastLatency = t.elapsed();
  }
  // "/cat f3 alimentação" ou "/cat alimentação f3" ou "/cat alimentação" (o último lançamento)
  const separa = raw => {
    const ws = String(raw).trim().split(/\s+/).filter(Boolean);
    const num = ws.find(w => /^f\d+$/i.test(w));
    return { num: num?.toLowerCase(), resto: ws.filter(w => w !== num).join(' ') };
  };

  /* ---------- ver: o mês e as listas ---------- */

  // uma linha de lançamento:  f3  28.09  R$ 45,00  alimentação · pix  gastei 45 no ifood
  function linha(e) {
    const d = e.data || {};
    const meta = [d.categoria ? `<span class="c-act">${esc(d.categoria)}</span>` : '<span class="c-warn">sem categoria</span>', d.forma ? esc(formaTxt(d.forma)) : '<span class="dim">sem forma</span>'];
    term.print(`<span class="n">${esc(numero(e))}</span><span class="d">${esc(ddmmDe(d.data || e.day))}</span><span class="v${e.kind === 'entrada' ? ' c-act' : ''}">${esc(fmtValor(d.valor))}</span>` +
      `<span><span class="tmeta">${meta.join(' · ')}</span> <span class="dim">${hl(e.text)}</span></span>`, 'fin');
  }
  const ddmmDe = k => (k ? `${k.slice(8, 10)}.${k.slice(5, 7)}` : '');
  // "/gastos alimentação -1" → { mes, categoria } · mês: -1, 9, 09/2026, 2026-09 · categoria: qualquer cadastrada
  function filtros(raw, kind) {
    const now = new Date();
    let mes = dayKey(now).slice(0, 7), categoria = null;
    const lista = cats()[kind] || [];
    const ws = String(raw).trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < ws.length; i++) {
      const m = parseMonth(ws[i], now);
      if (m) { mes = m; continue; }
      const c = acharCategoria(ws.slice(i).join(' '), lista) || acharCategoria(ws[i], lista) || (/^sem$/i.test(ws[i]) && /^categoria$/i.test(ws[i + 1] || '') ? 'sem categoria' : null);
      if (!c) throw new CmdError('E_ARG', 'fin', `não entendi "${ws[i]}"`, `mês (-1, 9, 2026-09) ou categoria: ${lista.map(esc).join(', ')}`);
      categoria = c;
      if (c === 'sem categoria' || ws.slice(i).join(' ').toLowerCase() === c) break;
    }
    return { mes, categoria };
  }

  function mostrarMes(mes) {
    const now = new Date();
    const r = resumoMes(S.entries, mes), ant = resumoMes(S.entries, mesAnterior(mes));
    const vs = variacao(r.gastos, ant.gastos);
    term.print(`── ${esc(fmtMes(mes, now))} · finanças ${'─'.repeat(10)}`, 'sep');
    if (!r.n.gastos && !r.n.entradas && !r.n.transferencias) {
      return term.say(`nada lançado em ${esc(fmtMes(mes, now))} · escreva normal: <span class="c-int">gastei 45 no ifood</span> · <span class="c-int">caiu o salário 3.200</span>`);
    }
    h.table([
      ['saldo', `<span class="${r.saldo < 0 ? 'c-warn' : 'c-act'}">${esc(fmtValor(r.saldo))}</span> <span class="dim">entradas − gastos · não é o saldo do banco</span>`],
      ['entradas', `${esc(fmtValor(r.entradas))} <span class="dim">· ${r.n.entradas}</span>`],
      ['gastos', `${esc(fmtValor(r.gastos))} <span class="dim">· ${r.n.gastos}${vs === null ? '' : ` · vs ${esc(fmtMes(mesAnterior(mes), now))} ${vs > 0 ? '+' : ''}${vs}%`}</span>`],
    ]);
    if (r.porCategoria.length) {
      term.print('por categoria', 'tgrp');
      for (const [c, v] of r.porCategoria) {
        const f = r.gastos ? v / r.gastos : 0;
        term.print(`<span class="k">${esc(c)}</span><span>${esc(fmtValor(v))} <span class="c-int">${barra(f)}</span> <span class="dim">${Math.round(f * 100)}%</span></span>`, 'tbl');
      }
    }
    const notas = [
      r.credito ? `crédito ${esc(fmtValor(r.credito))} conta no mês da compra (provisório até cadastrar cartões)` : '',
      r.semForma ? `${r.semForma} sem forma · <span class="c-int">/gastos</span> mostra · <span class="c-int">/forma f3 pix</span>` : '',
      r.semCategoria ? `${r.semCategoria} sem categoria · <span class="c-int">/cat f3 alimentação</span>` : '',
      r.transferencias.para || r.transferencias.de ? `transferências: ${r.transferencias.para ? esc(fmtValor(r.transferencias.para)) + ' guardado' : ''}${r.transferencias.para && r.transferencias.de ? ' · ' : ''}${r.transferencias.de ? esc(fmtValor(r.transferencias.de)) + ' resgatado' : ''} (não mexem no saldo)` : '',
    ].filter(Boolean);
    notas.forEach(n => term.print(`<span class="dim">${n}</span>`));
    term.print(`<span class="dim">/gastos [categoria] · /entradas · /mes -1 (mês passado)</span>`);
  }

  function mostrarLista(kind, raw) {
    const now = new Date();
    const { mes, categoria } = filtros(raw, kind);
    const items = lancamentos(S.entries, { mes, kind, categoria });
    const titulo = `${kind === 'gasto' ? 'gastos' : 'entradas'}${categoria ? ' · ' + categoria : ''} · ${fmtMes(mes, now)}`;
    if (!items.length) return term.say(`nenhum lançamento em ${esc(titulo)}.`);
    S.finList = []; // os números passam a ser os desta lista
    term.print(`── ${esc(titulo)} · ${items.length} ${'─'.repeat(8)}`, 'sep');
    items.forEach(linha);
    term.print(`<span class="dim">total ${esc(fmtValor(items.reduce((s, e) => s + (e.data?.valor || 0), 0)))} · /cat f1 lazer · /forma f1 pix · /editar f1 45,90 ontem</span>`);
  }

  // "/editar f3 45,90 débito ontem alimentação "almoço com a equipe"": cada pedaço é lido pelo jeito
  async function editar(raw, t) {
    const txt = String(raw).trim();
    const desc = txt.match(/["“](.+?)["”]/);
    const ws = txt.replace(/["“].+?["”]/, ' ').split(/\s+/).filter(Boolean);
    const nums = ws.filter(w => /^f\d+$/i.test(w));
    if (nums.length !== 1) throw usage('editar', 'f3 45,90 · f3 débito · f3 ontem · f3 alimentação · f3 "descrição"');
    const e = alvo(nums[0].toLowerCase());
    const muda = {};
    const lista = cats()[e.kind] || [];
    for (const w of ws.filter(x => x !== nums[0])) {
      const v = parseValor(w), f = acharForma(w), c = acharCategoria(w, lista), d = /^(?:hoje|ontem|anteontem|\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?)$/i.test(w) ? findDate(w, new Date()) : null;
      if (v !== null && !d) muda.valor = v;
      else if (f) muda.forma = f;
      else if (c && e.kind !== 'transferencia') muda.categoria = c;
      else if (d) muda.data = d.data;
      else throw new CmdError('E_ARG', 'fin', `não entendi "${w}"`, `valor (45,90), forma (${FORMAS.map(formaTxt).join(', ')}), data (ontem, 28/09), categoria (${lista.map(esc).join(', ')}) ou "descrição" entre aspas`);
    }
    if (desc) muda.descricao = desc[1].trim();
    if (!Object.keys(muda).length) throw usage('editar', 'f3 45,90 · f3 débito · f3 ontem · f3 alimentação · f3 "descrição"');
    const campos = (e.data?.auto?.campos || []).filter(k => !(k in muda));
    const data = { ...(e.data || {}), ...muda, auto: campos.length ? { ...(e.data?.auto || {}), campos } : null };
    if (!data.auto) delete data.auto;
    S.undo.push({ label: 'lançamento editado', items: [e] });
    await ctx.store.restore({ ...e, data });
    S.lastLatency = t.elapsed();
    const mostra = { valor: v => fmtValor(v), forma: formaTxt, data: v => fmtDia(v), categoria: v => v, descricao: v => `"${v}"` };
    term.ok('fin', `${esc(numero(e))} · ${Object.entries(muda).map(([k, v]) => `<span class="c-act">${esc(mostra[k](v))}</span>`).join(' · ')} · ${hl(e.text)} <span class="c-meta">· /desfazer volta · ${t.id}</span>`);
    ctx.ui.pulse('int');
  }

  /* ---------- categorias por comando ---------- */

  const regsCat = () => (S.records || []).filter(e => e.kind === 'categoria');
  // garante que as padrão existem como registro antes de mexer (o boot já semeia; isto é só por segurança)
  async function semear() {
    for (const e of seedCategorias(S.records || [], S.user?.id || 'local', new Date(), seedId)) await ctx.store.restore(e);
  }
  // acha o registro de uma categoria pelo nome · tipo: 'gasto' | 'entrada' | null (procura nos dois)
  function regCat(nome, tipo = null) {
    const achados = regsCat().filter(e => !e.data?.arquivada && (!tipo || (e.data?.tipo || 'gasto') === tipo) && acharCategoria(nome, [String(e.text)]));
    if (achados.length > 1) throw new CmdError('E_AMBIGUO', 'fin', `"${nome}" existe em gasto e em entrada`, `diga qual: <span class="c-int">/categoria … ${esc(nome)} entrada</span>`);
    if (!achados.length) throw new CmdError('E_404', 'fin', `categoria "${nome}" não existe${tipo ? ' em ' + tipo : ''}`, 'veja as categorias com <span class="c-int">/categorias</span>');
    return achados[0];
  }
  // "... entrada" no fim diz o tipo
  const tipoNoFim = ws => (/^entradas?$/i.test(ws[ws.length - 1] || '') ? ['entrada', ws.slice(0, -1)] : /^gastos?$/i.test(ws[ws.length - 1] || '') ? ['gasto', ws.slice(0, -1)] : [null, ws]);

  async function categoria(raw, t) {
    const [sub0, ...rest] = String(raw).trim().split(/\s+/);
    const sub = (sub0 || '').toLowerCase();
    const done = (msg, tone = 'act') => { S.lastLatency = t.elapsed(); term.ok('fin', `${msg} <span class="c-meta">· /desfazer volta · ${t.id}</span>`); ctx.ui.pulse(tone); };
    await semear();
    if (sub === 'nova' || sub === 'novo' || sub === 'criar') {
      const [tipo0, ws] = tipoNoFim(rest);
      const tipo = tipo0 || 'gasto';
      const nome = ws.join(' ').trim().toLowerCase();
      if (!nome) throw usage('categoria', 'nova pets [entrada]');
      if (acharCategoria(nome, cats()[tipo])) return term.say(`${esc(nome)} já existe em ${tipo}.`);
      const arq = regsCat().find(e => e.data?.arquivada && (e.data?.tipo || 'gasto') === tipo && acharCategoria(nome, [String(e.text)]));
      if (arq) { // já existiu: desarquiva
        S.undo.push({ label: 'categoria', items: [arq] });
        await ctx.store.restore({ ...arq, data: { ...arq.data, arquivada: false } });
        return done(`categoria <span class="c-act">${esc(arq.text)}</span> voltou (${tipo})`);
      }
      const ordem = Math.max(0, ...regsCat().map(e => e.data?.ordem || 0)) + 1;
      const e = await ctx.store.add({ kind: 'categoria', text: nome, tags: [], ts: Date.now(), day: dayKey(new Date()), data: { tipo, ordem, arquivada: false } });
      S.undo.push({ label: 'categoria criada', items: [], created: [e.id] });
      return done(`categoria nova · <span class="c-act">${esc(nome)}</span> (${tipo})`);
    }
    if (sub === 'renomear') {
      const txt = rest.join(' ');
      const i = txt.search(/\s*(?:=|\bpara\b|\bpra\b)\s*/);
      if (i < 0) throw usage('categoria', 'renomear mercado = supermercado [entrada]');
      const de = txt.slice(0, i).trim(), [tipo0, ws] = tipoNoFim(txt.slice(i).replace(/^\s*(?:=|para|pra)\s*/, '').split(/\s+/));
      const para = ws.join(' ').trim().toLowerCase();
      if (!de || !para) throw usage('categoria', 'renomear mercado = supermercado [entrada]');
      const r = regCat(de, tipo0);
      const tipo = r.data?.tipo || 'gasto';
      if (String(r.text).toLowerCase() === 'outros') throw new CmdError('E_ARG', 'fin', '"outros" não muda de nome', 'é pra onde vai o que o app não sabe');
      if (acharCategoria(para, cats()[tipo])) throw new CmdError('E_ARG', 'fin', `${para} já existe em ${tipo}`, 'escolha outro nome');
      const velho = String(r.text);
      // os lançamentos e as decisões da memória com o nome velho passam pro novo (tudo num passo só do /desfazer)
      const lancs = S.entries.filter(e => e.kind === tipo && e.data?.categoria === velho);
      const mems = (S.records || []).filter(e => e.kind === 'memoria' && e.data?.campo === 'categoria:' + tipo && e.data?.valor === velho);
      S.undo.push({ label: 'categoria renomeada', items: [r, ...lancs, ...mems] });
      await ctx.store.restore({ ...r, text: para });
      for (const e of lancs) await ctx.store.restore({ ...e, data: { ...e.data, categoria: para } }, { origem: 'regra' });
      for (const e of mems) await ctx.store.restore({ ...e, data: { ...e.data, valor: para } });
      return done(`${esc(velho)} → <span class="c-act">${esc(para)}</span> · ${lancs.length} ${lancs.length === 1 ? 'lançamento' : 'lançamentos'}`);
    }
    if (sub === 'arquivar') {
      const [tipo0, ws] = tipoNoFim(rest);
      const r = regCat(ws.join(' '), tipo0);
      if (String(r.text).toLowerCase() === 'outros') throw new CmdError('E_ARG', 'fin', '"outros" não pode ser arquivada', 'é pra onde vai o que o app não sabe');
      S.undo.push({ label: 'categoria arquivada', items: [r] });
      await ctx.store.restore({ ...r, data: { ...r.data, arquivada: true } });
      return done(`${esc(r.text)} arquivada · some das sugestões · os lançamentos continuam como estão`, 'warn');
    }
    if (sub && sub !== 'lista') throw usage('categoria', 'nova pets [entrada] · renomear mercado = supermercado · arquivar pets');
    listarCategorias();
  }

  function listarCategorias() {
    const r = resumoMes(S.entries, dayKey(new Date()).slice(0, 7));
    const noMes = new Map([...r.porCategoria, ...r.entradasPorCategoria.map(([c, v]) => ['e:' + c, v])]);
    for (const tipo of ['gasto', 'entrada']) {
      term.print(`── categorias de ${tipo} ${'─'.repeat(10)}`, 'sep');
      for (const c of cats()[tipo]) {
        const v = noMes.get(tipo === 'gasto' ? c : 'e:' + c);
        term.print(`<span class="k">${esc(c)}</span><span>${v ? esc(fmtValor(v)) + ' <span class="dim">este mês</span>' : '<span class="dim">—</span>'}</span>`, 'tbl');
      }
    }
    term.print('<span class="dim">/categoria nova pets [entrada] · renomear mercado = supermercado · arquivar pets</span>');
  }

  /* ---------- lançamentos antigos sem categoria ---------- */

  let filaCat = [];
  function proximaCategoria() {
    filaCat = filaCat.filter(id => S.entries.some(e => e.id === id && !e.data?.categoria));
    const e = S.entries.find(x => x.id === filaCat[0]);
    if (!e) return;
    const sug = (cats()[e.kind] || []).filter(x => x !== 'outros').slice(0, 5).map(x => `<span class="c-int">${esc(x)}</span>`).join(' · ');
    term.print(`<span class="c-warn">↳ categoria?</span> <span class="c-meta">${esc(numero(e))}</span> ${hl(e.text)} <span class="c-act">${esc(fmtValor(e.data?.valor))}</span> <span class="dim">·</span> <span class="c-int">/cat ${esc(numero(e))}</span> ${sug} <span class="dim">· ${filaCat.length > 1 ? `depois tem mais ${filaCat.length - 1}` : 'é o último'}</span>`, 'auto');
  }
  async function categorizar(t) {
    const velhos = S.entries.filter(e => (e.kind === 'gasto' || e.kind === 'entrada') && !e.data?.categoria);
    if (!velhos.length) return term.say('todos os lançamentos já têm categoria. ✓');
    const certos = [], duvida = [];
    for (const e of velhos) {
      const f = lerFinanca(e.text, { pessoas: h.ictx().pessoas }) || { lugar: null, estorno: false };
      const d = decidirCategoria(e.text, e.kind, f, h.ictx());
      if (d.categoria && d.motivo.tipo !== 'padrao') certos.push([e, d.categoria]);
      else duvida.push(e);
    }
    if (certos.length) {
      S.undo.push({ label: 'categorizar', items: certos.map(([e]) => e) });
      for (const [e, c] of certos) {
        const campos = [...new Set([...(e.data?.auto?.campos || []), 'categoria'])];
        await ctx.store.restore({ ...e, data: { ...e.data, categoria: c, auto: { ...(e.data?.auto || { fonte: 'regra' }), campos } } }, { origem: 'regra' });
      }
    }
    S.lastLatency = t.elapsed();
    term.ok('fin', `${certos.length} ${certos.length === 1 ? 'ganhou' : 'ganharam'} categoria pela memória${duvida.length ? ` · ${duvida.length} sem certeza: pergunto um por vez` : ''} <span class="c-meta">· a frase original não muda · /desfazer volta · ${t.id}</span>`);
    for (const [e, c] of certos.slice(0, 8)) term.print(`<span class="c-meta">${esc(numero(e))}</span> ${hl(e.text)} → <span class="c-act">${esc(c)}</span><span class="dim">*</span>`);
    if (certos.length > 8) term.print(`<span class="dim">… e mais ${certos.length - 8}</span>`);
    filaCat = duvida.map(e => e.id);
    proximaCategoria();
    ctx.ui.pulse('act');
  }

  const defs = [
    {
      name: 'mes', alias: ['mês', 'fin', 'financas', 'finanças', 'grana'], data: true, args: '[mês: -1 | 9 | 2026-09]',
      desc: 'o mês em dinheiro: saldo, entradas, gastos por categoria e comparação com o mês passado · ex: /mes · /mes -1',
      run(arg) {
        const a = String(arg).trim();
        const mes = a ? parseMonth(a, new Date()) : dayKey(new Date()).slice(0, 7);
        if (!mes) throw usage('mes', '-1 | 9 | 2026-09');
        mostrarMes(mes);
      },
    },
    {
      name: 'gastos', alias: ['gasto'], data: true, args: '[categoria] [mês]',
      desc: 'os gastos do mês, numerados f1, f2... · filtra por categoria · ex: /gastos · /gastos alimentação · /gastos -1',
      run(arg) { mostrarLista('gasto', arg); },
    },
    {
      name: 'entradas', alias: ['entrada', 'receitas'], data: true, args: '[categoria] [mês]',
      desc: 'as entradas do mês, numeradas f1, f2... · ex: /entradas · /entradas salário',
      run(arg) { mostrarLista('entrada', arg); },
    },
    {
      name: 'cat', data: true, async: true, exec: true, args: '<categoria> [f3]',
      desc: 'diz a categoria de um lançamento (o último, ou f3) · eu aprendo pro próximo · ex: /cat alimentação',
      async run(arg, signal, t) {
        const { num, resto } = separa(arg);
        if (!resto) throw usage('cat', 'alimentação [f3]');
        const e = alvo(num);
        if (!['gasto', 'entrada'].includes(e.kind)) throw new CmdError('E_TIPO', 'fin', `${num || 'o último lançamento'} é ${e.kind}: não tem categoria`, 'categoria é de gasto e de entrada');
        const lista = cats()[e.kind];
        const cat = acharCategoria(resto, lista);
        if (!cat) throw new CmdError('E_404', 'fin', `categoria "${resto}" não existe em ${e.kind}`, `as de ${e.kind}: ${lista.map(esc).join(', ')}`);
        if (e.data?.categoria === cat && !(e.data?.auto?.campos || []).includes('categoria')) return term.say(`já está em ${esc(cat)}.`);
        await mudar(e, 'categoria', cat, t, 'categoria');
        term.ok('fin', `${esc(numero(e))} · <span class="c-act">${esc(cat)}</span>${e.data?.categoria && e.data.categoria !== cat ? ` <span class="dim">(era ${esc(e.data.categoria)})</span>` : ''} · ${hl(e.text)} <span class="c-meta">· aprendi · /desfazer volta · ${t.id}</span>`);
        ctx.ui.pulse('act');
        proximaCategoria(); // /categorizar: o próximo antigo sem categoria
      },
    },
    {
      name: 'categorias', data: true, desc: 'as categorias de gasto e de entrada, com o total do mês',
      run() { listarCategorias(); },
    },
    {
      name: 'categoria', data: true, async: true, exec: true, args: 'nova pets [entrada] | renomear mercado = supermercado | arquivar pets',
      desc: 'cria, renomeia ou arquiva categorias · renomear muda nos lançamentos também',
      async run(arg, signal, t) { await categoria(arg, t); },
    },
    {
      name: 'categorizar', data: true, async: true, exec: true,
      desc: 'dá categoria aos gastos e entradas antigos que não têm · a memória decide; o que ela não sabe, pergunto um por vez',
      async run(arg, signal, t) { await categorizar(t); },
    },
    {
      name: 'forma', alias: ['pagamento', 'pagou'], data: true, async: true, exec: true, args: '<pix|crédito|débito|dinheiro|boleto> [f3]',
      desc: 'diz como você pagou um lançamento (o último, ou f3) · eu aprendo pro próximo · ex: /forma pix',
      async run(arg, signal, t) {
        const { num, resto } = separa(arg);
        if (!resto) throw usage('forma', 'pix | crédito | débito | dinheiro | boleto [f3]');
        const e = alvo(num);
        if (!['gasto', 'entrada'].includes(e.kind)) throw new CmdError('E_TIPO', 'fin', `${num || 'o último lançamento'} é ${e.kind}: não tem forma de pagamento`, 'forma é de gasto e de entrada');
        const f = acharForma(resto);
        if (!f) throw new CmdError('E_ARG', 'fin', `não conheço a forma "${resto}"`, `use ${FORMAS.map(formaTxt).join(', ')}`);
        if (e.data?.forma === f && !(e.data?.auto?.campos || []).includes('forma')) return term.say(`já está em ${esc(formaTxt(f))}.`);
        await mudar(e, 'forma', f, t, 'forma de pagamento');
        term.ok('fin', `${esc(numero(e))} · <span class="c-act">${esc(formaTxt(f))}</span>${e.data?.forma && e.data.forma !== f ? ` <span class="dim">(era ${esc(formaTxt(e.data.forma))})</span>` : ''} · ${hl(e.text)} <span class="c-meta">· aprendi · /desfazer volta · ${t.id}</span>`);
        ctx.ui.pulse('act');
      },
    },
  ];

  return { defs, entendi, perguntar, numero, pool, alvo, editar, mostrarMes };
}
