// Comandos e telas de finanças (Fase 3a). Separado do commands.js, que já está grande.
//
// O commands.js chama criarFinancas(h) e junta os `defs` daqui na lista dele (aparecem sozinhos no /ajuda e no Tab).
//   h = { S, term, ctx, usage, mem }  · S = estado do app · ctx.store grava (com histórico) · mem() = a memória do momento
//
// Números dos lançamentos: f1, f2... (da última lista; um lançamento novo entra no fim), como t1 nas tarefas.
// Perguntas de dinheiro não travam e não usam /sim: cada uma tem o seu comando (/cat, /forma), então aparecem na hora.

import { esc, hl, dayKey, CmdError } from './util.js';
import { fmtValor, parseValor, findValor } from './valores.js';
import { fmtDia, findDate } from './dates.js';
import { parseMonth } from './views.js';
import { seedId } from './tasks.js';
import { decidirCategoria } from './tipos-financas.js';
import { previa } from './interpretar.js';
import { saldoConta, investimentosPorLugar, devoNoCartao, chaveLugar, recorrentesDe, pendentesRecorrentes, lancamentoRecorrente, lembretesVariaveis, dataNoMes, eDaRecorrente, mesDe, cartoesDe, cartaoPadrao, cartaoDoGasto, vencimentoDa, proximaFatura, parcelasDe, parcelasNoMes, lerFinanca, seedCategorias, categoriasDe, acharCategoria, acharForma, FORMAS, FORMA_ROTULO, resumoMes, mesAnterior, fmtMes, variacao, barra, lancamentos } from './financas.js';

export const KINDS_FINANCAS = ['gasto', 'entrada', 'transferencia', 'rendimento'];
export const isFinanca = e => KINDS_FINANCAS.includes(e?.kind);

export function criarFinancas(h) {
  const { S, term, ctx, usage } = h;
  const cats = () => categoriasDe(S.records || []);
  const formaTxt = f => FORMA_ROTULO[f] || f;
  // as contas do mês precisam de todos os cartões (os arquivados também: os gastos deles continuam nas faturas)
  const opts = () => ({ cartoes: cartoesDe(S.records || [], { todos: true }) });

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

  // "3x de R$ 100,00" · com sobra de centavos: "3x (R$ 33,34 + 2× R$ 33,33)"
  const textoParcelas = (total, n) => {
    const p = parcelasDe(total, n);
    return p[0] === p[n - 1] ? `${n}x de ${fmtValor(p[0])}` : `${n}x (${fmtValor(p[0])} + ${n - 1}× ${fmtValor(p[n - 1])})`;
  };

  /* ---------- linha "↳ entendi" e perguntas ---------- */

  // por que essa categoria/forma: "(xpto: 4 de 4)" · "(fixado)"
  const porque = m => (m?.tipo === 'pista' ? ` <span class="dim">(${esc(m.pista)}: ${m.estado === 'fixado' ? 'fixado' : `${m.peso} de ${m.total}`})</span>` : '');

  function entendi(r, e, n) {
    const c = r.campos, A = k => (r.auto.includes(k) ? '<span class="dim">*</span>' : '');
    const nomes = (r.pessoas || []).map(id => (S.records || []).find(x => x.id === id)?.text).filter(Boolean);
    let partes;
    if (r.tipo === 'rendimento') {
      partes = [esc(fmtValor(c.valor)), `na <span class="c-act">${esc(c.lugar)}</span>`, '<span class="dim">soma no investimento · não é entrada do mês</span>', `${esc(fmtDia(c.data))}${A('data')}`];
    } else if (r.tipo === 'transferencia') {
      partes = [esc(fmtValor(c.valor)), c.conta ? `${c.sentido === 'de' ? 'da' : 'pra'} ${esc(c.conta)}` : '', '<span class="dim">não mexe no saldo</span>', `${esc(fmtDia(c.data))}${A('data')}`];
    } else {
      // o cartão: o escrito/aprendido, ou o padrão (que vale na hora de ler, sem gravar)
      const lista = cartoesDe(S.records || []);
      const cartao = c.cartao ? lista.find(x => x.id === c.cartao) : c.forma === 'credito' ? cartaoPadrao(lista) : null;
      const sufixo = cartao && !c.cartao ? ' <span class="dim">(padrão)</span>' : porque(r.motivos?.cartao);
      partes = [
        esc(fmtValor(c.valor)) + (c.parcelas ? ` <span class="c-int">${esc(textoParcelas(c.valor, c.parcelas))}</span>` : ''),
        c.categoria ? `<span class="c-act">${esc(c.categoria)}</span>${A('categoria')}${porque(r.motivos?.categoria)}` : '<span class="c-warn">sem categoria</span>',
        c.forma ? `${esc(formaTxt(c.forma))}${A('forma')}${porque(r.motivos?.forma)}${cartao ? ` <span class="c-act">${esc(cartao.nome)}</span>${sufixo}` : ''}` : '',
        c.lugar ? esc(c.lugar) : '', ...nomes.map(esc),
        `${esc(fmtDia(c.data))}${A('data')}`,
      ];
    }
    const rot = { gasto: 'gasto', entrada: 'entrada', transferencia: 'transferência', rendimento: 'rendimento' }[r.tipo];
    const corrigir = r.tipo === 'transferencia' ? '/tipo gasto' : r.tipo === 'rendimento' ? `/editar ${n}` : `/cat ${n}`;
    term.print(`<span class="c-int">↳ entendi</span> · ${rot} · ${partes.filter(Boolean).join(' · ')}` +
      ` <span class="dim">· ${r.auto.length ? '* auto · ' : ''}${esc(r.origem)} ${Math.round(r.confianca * 100)}% · /desfazer ou ${corrigir}</span>`, 'auto');
  }

  // perguntas logo depois de salvar: categoria (outros / dividida / conflito), forma (gasto sem forma), estorno ligado
  function perguntar(r, e, n) {
    S.ultimaFin = e.id; // o /cat e o /forma sem número valem pra este
    if (r.tipo === 'transferencia' || r.tipo === 'rendimento') return;
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
    // forma · cartão (o escrito, ou o padrão) · parcelas: "crédito nubank 3x"
    const lista = cartoesDe(S.records || [], { todos: true });
    const k = d.forma === 'credito' ? cartaoDoGasto(e, lista) : null;
    const forma = d.forma ? esc(formaTxt(d.forma)) + (k ? ' ' + esc(k.nome) : '') + (d.parcelas >= 2 ? ` <span class="c-int">${d.parcelas}x</span>` : '') : '<span class="dim">sem forma</span>';
    const meta = [d.categoria ? `<span class="c-act">${esc(d.categoria)}</span>` : '<span class="c-warn">sem categoria</span>', forma + (d.recorrente ? ' <span class="c-int" title="recorrente">↻</span>' : '')];
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
    const r = resumoMes(S.entries, mes, opts()), ant = resumoMes(S.entries, mesAnterior(mes), opts());
    const vs = variacao(r.gastos, ant.gastos);
    term.print(`── ${esc(fmtMes(mes, now))} · finanças ${'─'.repeat(10)}`, 'sep');
    if (!r.n.gastos && !r.n.entradas && !r.n.transferencias) {
      return term.say(`nada lançado em ${esc(fmtMes(mes, now))} · escreva normal: <span class="c-int">gastei 45 no ifood</span> · <span class="c-int">caiu o salário 3.200</span>`);
    }
    const comFatura = r.faturas.length > 0;
    h.table([
      ['saldo', `<span class="${r.saldo < 0 ? 'c-warn' : 'c-act'}">${esc(fmtValor(r.saldo))}</span> <span class="dim">entradas − ${comFatura ? 'à vista − faturas' : 'gastos'} · não é o saldo do banco</span>`],
      ['entradas', `${esc(fmtValor(r.entradas))} <span class="dim">· ${r.n.entradas}</span>`],
      ['gastos', `${esc(fmtValor(r.gastos))} <span class="dim">· ${r.n.gastos}${vs === null ? '' : ` · vs ${esc(fmtMes(mesAnterior(mes), now))} ${vs > 0 ? '+' : ''}${vs}%`}</span>`],
      ...(comFatura ? [
        ['à vista', `${esc(fmtValor(r.aVista))} <span class="dim">pix, débito, dinheiro, boleto</span>`],
        ...r.faturas.map(f => [`fatura ${esc(f.nome)}`, `${esc(fmtValor(f.total))} <span class="dim">vence ${esc(fmtDia(f.vence, now))} · ${f.itens} ${f.itens === 1 ? 'item' : 'itens'} · /fatura ${esc(f.nome)}</span>`]),
      ] : []),
    ]);
    if (r.porCategoria.length) {
      term.print('por categoria', 'tgrp');
      for (const [c, v] of r.porCategoria) {
        const f = r.gastos ? v / r.gastos : 0;
        term.print(`<span class="k">${esc(c)}</span><span>${esc(fmtValor(v))} <span class="c-int">${barra(f)}</span> <span class="dim">${Math.round(f * 100)}%</span></span>`, 'tbl');
      }
    }
    // recorrentes do mês (Fase 3c): o que o app lançou sozinho e as variáveis que faltam (só no mês atual)
    const recDoMes = S.entries.filter(e => e.kind === 'gasto' && e.data?.recorrente && mesDe(e) === mes);
    const lem = mes === dayKey(now).slice(0, 7) ? lembretesVariaveis(recorrentesDe(S.records || []), S.entries, now) : [];
    const notas = [
      recDoMes.length || lem.length ? `↻ recorrentes ${esc(fmtValor(recDoMes.reduce((s, e) => s + (e.data?.valor || 0), 0)))} (${recDoMes.length})${lem.length ? ` · <span class="c-warn">falta lançar: ${lem.map(l => esc(l.rec.nome)).join(', ')}</span>` : ''} · <span class="c-int">/recorrentes</span>` : '',
      r.provisorio ? `crédito ${esc(fmtValor(r.credito))} conta no mês da compra (provisório até cadastrar cartões · <span class="c-int">/cartao novo nubank fecha 3 vence 10</span>)` : '',
      r.semForma ? `${r.semForma} sem forma · <span class="c-int">/gastos</span> mostra · <span class="c-int">/forma f3 pix</span>` : '',
      r.semCategoria ? `${r.semCategoria} sem categoria · <span class="c-int">/cat f3 alimentação</span>` : '',
      r.transferencias.para || r.transferencias.de ? `transferências: ${r.transferencias.para ? esc(fmtValor(r.transferencias.para)) + ' guardado' : ''}${r.transferencias.para && r.transferencias.de ? ' · ' : ''}${r.transferencias.de ? esc(fmtValor(r.transferencias.de)) + ' resgatado' : ''} (não mexem no saldo)` : '',
    ].filter(Boolean);
    notas.forEach(n => term.print(`<span class="dim">${n}</span>`));
    term.print(`<span class="dim">/gastos [categoria] · /entradas · /mes -1 (mês passado)</span>`);
  }

  // /fatura [cartão] [mês]: sem cartão escrito e com vários, a próxima de cada um; com um cartão, a fatura inteira
  function mostrarFatura(raw) {
    const now = new Date();
    const ativos = cartoesDe(S.records || []);
    if (!ativos.length) return term.say('nenhum cartão ainda · <span class="c-int">/cartao novo nubank fecha 3 vence 10</span> cadastra · até lá, o crédito conta no mês da compra');
    let mes = null, nome = [];
    for (const w of String(raw).trim().split(/\s+/).filter(Boolean)) { const m = parseMonth(w, now); if (m) mes = m; else nome.push(w); }
    const c = nome.length ? cartoesDe(S.records || [], { todos: true }).find(x => x.id === regCartaoQualquer(nome.join(' ')).id) : ativos.length === 1 ? ativos[0] : null;
    if (!c) {
      term.print(`── faturas ${'─'.repeat(12)}`, 'sep');
      for (const k of ativos) {
        const mk = mes || proximaFatura(k, now), d = vencimentoDa(k, mk);
        const total = parcelasNoMes(S.entries, mk, opts().cartoes).filter(p => p.cartao.id === k.id).reduce((s, p) => s + p.valor, 0);
        term.print(`<span class="k c-act">${esc(k.nome)}</span><span>${esc(fmtValor(total))} <span class="dim">vence ${esc(fmtDia(d.vence, now))} · ${statusFatura(d, now)}</span></span>`, 'tbl');
      }
      return term.print('<span class="dim">/fatura nubank mostra os itens · /fatura nubank -1 (a anterior) · /fatura nubank +1 (a próxima)</span>');
    }
    // "+1"/"-1" contam a partir da próxima fatura do cartão, não do mês de hoje
    const base = proximaFatura(c, now);
    const rel = String(raw).match(/(?:^|\s)([+-]\d{1,2})(?=\s|$)/);
    const mk = rel ? parseMonth(rel[1], new Date(+base.slice(0, 4), +base.slice(5, 7) - 1, 1)) : mes || base;
    const d = vencimentoDa(c, mk);
    const itens = parcelasNoMes(S.entries, mk, opts().cartoes).filter(p => p.cartao.id === c.id).sort((a, b) => String(a.e.data?.data).localeCompare(String(b.e.data?.data)));
    const total = itens.reduce((s, p) => s + p.valor, 0);
    term.print(`── fatura ${esc(c.nome)} · vence ${esc(fmtDia(d.vence, now))} · ${statusFatura(d, now)} ${'─'.repeat(6)}`, 'sep');
    term.print(`<span class="dim">compras de ${esc(ddmmDe(d.de))} a ${esc(ddmmDe(dayKey(new Date(+d.fecha.slice(0, 4), +d.fecha.slice(5, 7) - 1, +d.fecha.slice(8, 10) - 1))))} · fecha ${esc(ddmmDe(d.fecha))}</span>`);
    if (!itens.length) return term.say('nada nessa fatura.');
    for (const p of itens) {
      const x = p.e.data || {};
      term.print(`<span class="n">${esc(numero(p.e))}</span><span class="d">${esc(ddmmDe(x.data || p.e.day))}</span><span class="v">${esc(fmtValor(p.valor))}</span>` +
        `<span><span class="tmeta">${x.categoria ? `<span class="c-act">${esc(x.categoria)}</span>` : '<span class="c-warn">sem categoria</span>'}${p.n > 1 ? ` · <span class="c-int">${p.k + 1}/${p.n}</span>` : ''}${x.recorrente ? ' <span class="c-int">↻</span>' : ''}</span> <span class="dim">${hl(p.e.text)}</span></span>`, 'fin');
    }
    term.print(`<span class="c-act">total ${esc(fmtValor(total))}</span> <span class="dim">· ${itens.length} ${itens.length === 1 ? 'item' : 'itens'} · /fatura ${esc(c.nome)} +1 (a próxima)</span>`);
  }
  // aberta (ainda entra compra) · fechada (esperando o vencimento) · vencida
  const statusFatura = (d, now) => { const hoje = dayKey(now); return hoje < d.fecha ? 'aberta' : hoje <= d.vence ? '<span class="c-warn">fechada</span>' : 'vencida'; };
  // acha o cartão pelo nome, inclusive arquivado (pra ver faturas antigas)
  function regCartaoQualquer(nome) {
    const k = String(nome).trim().toLowerCase();
    const r = (S.records || []).find(e => e.kind === 'cartao' && String(e.text).toLowerCase() === k);
    return r || regCartao(nome);
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
    if (nums.length !== 1) throw usage('editar', 'f3 45,90 · f3 débito · f3 ontem · f3 alimentação · f3 3x · f3 nubank · f3 "descrição"');
    const e = alvo(nums[0].toLowerCase());
    const muda = {};
    const lista = cats()[e.kind] || [];
    for (const w of ws.filter(x => x !== nums[0])) {
      const px = w.match(/^(\d{1,2})x$/i), k = cartoesDe(S.records || []).find(x => x.nome === w.toLowerCase());
      if (px && e.kind === 'gasto') { const n = +px[1]; if (n < 1 || n > 48) throw new CmdError('E_ARG', 'fin', `parcelas inválidas: ${w}`, 'de 1x (à vista) a 48x'); muda.parcelas = n >= 2 ? n : null; continue; }
      if (k && e.kind === 'gasto') { muda.cartao = k.id; muda.forma = 'credito'; continue; }
      const v = parseValor(w), f = acharForma(w), c = acharCategoria(w, lista), d = /^(?:hoje|ontem|anteontem|\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?)$/i.test(w) ? findDate(w, new Date()) : null;
      if (v !== null && !d) muda.valor = v;
      else if (f) muda.forma = f;
      else if (c && e.kind !== 'transferencia') muda.categoria = c;
      else if (d) muda.data = d.data;
      else throw new CmdError('E_ARG', 'fin', `não entendi "${w}"`, `valor (45,90), forma (${FORMAS.map(formaTxt).join(', ')}), data (ontem, 28/09), categoria (${lista.map(esc).join(', ')}) ou "descrição" entre aspas`);
    }
    if (desc) muda.descricao = desc[1].trim();
    if (!Object.keys(muda).length) throw usage('editar', 'f3 45,90 · f3 débito · f3 ontem · f3 alimentação · f3 3x · f3 nubank · f3 "descrição"');
    const campos = (e.data?.auto?.campos || []).filter(k => !(k in muda));
    const data = { ...(e.data || {}), ...muda, auto: campos.length ? { ...(e.data?.auto || {}), campos } : null };
    for (const k of ['auto', 'parcelas', 'cartao']) if (data[k] === null) delete data[k]; // "1x" tira as parcelas
    S.undo.push({ label: 'lançamento editado', items: [e] });
    await ctx.store.restore({ ...e, data });
    S.lastLatency = t.elapsed();
    const mostra = { valor: v => fmtValor(v), forma: formaTxt, data: v => fmtDia(v), categoria: v => v, descricao: v => `"${v}"`, parcelas: v => (v ? v + 'x' : 'à vista'), cartao: v => cartoesDe(S.records || []).find(x => x.id === v)?.nome || '?' };
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
    const r = resumoMes(S.entries, dayKey(new Date()).slice(0, 7), opts());
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

  /* ---------- recorrentes (Fase 3c) ---------- */

  // Lança o que falta (id fixo por recorrente + mês: celular e PC gravam a MESMA linha) e mostra os lembretes das variáveis.
  // Roda depois da leitura completa (boot, login, /sync), na virada do dia e logo depois de cadastrar uma.
  // Devolve os ids lançados (o /desfazer do cadastro leva junto).
  let lembreteDia = null;
  async function lancarRecorrentes({ lembretes = true } = {}) {
    const now = new Date();
    const recs = recorrentesDe(S.records || []);
    if (!recs.length) return [];
    const pend = pendentesRecorrentes(recs, S.entries, now, { owner: S.user?.id || 'local', seedId });
    const ids = [];
    for (const p of pend) { await ctx.store.restore(lancamentoRecorrente(p, now), { origem: 'regra' }); ids.push(p.id); }
    if (pend.length) {
      // agrupa por recorrente: "aluguel 3× (ago–out)" quando o app ficou meses fechado
      const por = new Map();
      for (const p of pend) por.set(p.rec.id, [...(por.get(p.rec.id) || []), p]);
      const partes = [...por.values()].map(ps => {
        const r = ps[0].rec;
        // número f… de cada lançamento: dá pra corrigir ou apagar direto (/editar f3, /apagar f3)
        const ns = ps.map(p => numero({ id: p.id }));
        const quando = ps.length > 1 ? `${ps.length}× (${fmtMes(ps[0].mes, now)}–${fmtMes(ps.at(-1).mes, now)})` : `(${ddmmDe(ps[0].data)})`;
        return `<span class="c-meta">${esc(ns.length > 1 ? `${ns[0]}–${ns.at(-1)}` : ns[0])}</span> <span class="c-act">${esc(r.nome)}</span> ${esc(fmtValor(r.valor))} <span class="dim">${esc(quando)}</span>`;
      });
      term.print(`<span class="c-int">↳ lancei</span> ${partes.join(' · ')} <span class="dim">· recorrentes · /recorrentes · /gastos</span>`, 'auto');
      ctx.ui.pulse('act');
    }
    // lembretes das contas variáveis: uma vez por dia
    const hoje = dayKey(now);
    const lem = lembretesVariaveis(recs, S.entries, now);
    if (lembretes && lem.length && lembreteDia !== hoje) {
      lembreteDia = hoje;
      term.print(`<span class="c-warn">↳ lembrete</span> ${lem.map(l => `${esc(l.rec.nome)} <span class="dim">(variável, vence ${esc(fmtDia(l.vence, now))})</span>`).join(' · ')} <span class="dim">· escreva "paguei 120 de ${esc(lem[0].rec.nome)}"</span>`, 'auto');
    }
    return ids;
  }

  // o próximo lançamento de uma recorrente ('AAAA-MM-DD'), ou null (pausada/cancelada)
  function proximoDe(r, now = new Date()) {
    if (r.status !== 'ativa') return null;
    const hoje = dayKey(now), mes = hoje.slice(0, 7);
    let m = r.desde > mes ? r.desde : mes;
    const lancado = mm => S.entries.some(e => mesDe(e) === mm && eDaRecorrente(e, r));
    for (let i = 0; i < 14; i++, m = mesSeguinte(m)) {
      if (r.pulados.includes(m) || lancado(m)) continue;
      return dataNoMes(m, r.dia);
    }
    return null;
  }
  const mesSeguinte = mes => { const d = new Date(+mes.slice(0, 4), +mes.slice(5, 7), 1); return dayKey(d).slice(0, 7); };
  // acha a recorrente pelo nome (as canceladas não)
  function regRecorrente(nome) {
    const k = String(nome || '').trim().toLowerCase();
    const recs = recorrentesDe(S.records || []);
    const r = recs.find(x => x.nome.toLowerCase() === k) || recs.find(x => acharCategoria(k, [x.nome]));
    if (!r) throw new CmdError('E_404', 'fin', `não conheço a recorrente "${nome}"`, 'veja as suas com <span class="c-int">/recorrentes</span> · cadastre escrevendo <span class="c-int">netflix 55,90 todo mês dia 15</span>');
    return S.records.find(e => e.id === r.id);
  }

  function listarRecorrentes() {
    const now = new Date();
    const recs = recorrentesDe(S.records || []);
    if (!recs.length) return term.say('nenhuma recorrente ainda · escreva <span class="c-int">netflix 55,90 todo mês dia 15</span> · <span class="c-int">aluguel 1.200 todo dia 5 no pix</span> · <span class="c-int">luz todo mês dia 10</span> (variável: eu só lembro)');
    const cartoes = cartoesDe(S.records || [], { todos: true });
    term.print(`── recorrentes · ${recs.length} ${'─'.repeat(10)}`, 'sep');
    for (const r of recs) {
      const prox = proximoDe(r, now);
      const forma = r.forma ? formaTxt(r.forma) + (r.cartao ? ' ' + (cartoes.find(c => c.id === r.cartao)?.nome || '') : '') : '';
      const st = r.status === 'pausada' ? '<span class="c-warn">pausada</span>' : prox ? `próximo ${esc(fmtDia(prox, now))}` : '';
      term.print(`<span class="k ${r.status === 'ativa' ? 'c-act' : 'dim'}">${esc(r.nome)}</span><span>${r.valor ? esc(fmtValor(r.valor)) : '<span class="c-warn">variável</span>'}${r.tipo === 'entrada' ? ' <span class="c-act">entrada</span>' : ''} <span class="dim">· dia ${r.dia}${r.categoria ? ' · ' + esc(r.categoria) : ''}${forma ? ' · ' + esc(forma.trim()) : ''} ·</span> ${st}</span>`, 'tbl');
    }
    const fixo = t => recs.filter(r => r.status === 'ativa' && r.tipo === t && r.valor).reduce((s, r) => s + r.valor, 0);
    term.print(`<span class="dim">fixo por mês: ${esc(fmtValor(fixo('gasto')))} de gastos${fixo('entrada') ? ` · ${esc(fmtValor(fixo('entrada')))} de entradas` : ''} · /recorrente pausar netflix · retomar · cancelar · /recorrente netflix 59,90 · dia 20</span>`);
  }

  async function recorrente(raw, t) {
    const txt = String(raw).trim();
    const [sub0, ...rest] = txt.split(/\s+/);
    const sub = (sub0 || '').toLowerCase();
    const done = (msg, tone = 'act') => { S.lastLatency = t.elapsed(); term.ok('fin', `${msg} <span class="c-meta">· /desfazer volta · ${t.id}</span>`); ctx.ui.pulse(tone); };
    const muda = async (r, data, label, text) => { S.undo.push({ label, items: [r] }); await ctx.store.restore({ ...r, ...(text ? { text } : {}), data: { ...r.data, ...data } }); };
    if (!sub || sub === 'lista') return listarRecorrentes();
    if (sub === 'nova' || sub === 'novo' || sub === 'criar') {
      const frase = `${rest.join(' ')} todo mês`;
      if (previa(frase, h.ictx())?.tipo !== 'recorrente') throw usage('recorrente', 'nova netflix 55,90 dia 15 [crédito] · nova luz dia 10 (variável)');
      return ctx.commands.capturar(frase, t);
    }
    if (sub === 'pausar') {
      const r = regRecorrente(rest.join(' '));
      if (r.data?.status === 'pausada') return term.say(`${esc(r.text)} já está pausada.`);
      await muda(r, { status: 'pausada' }, 'recorrente pausada');
      return done(`${esc(r.text)} pausada · não lanço até você <span class="c-int">/recorrente retomar ${esc(r.text)}</span>`, 'warn');
    }
    if (sub === 'retomar') {
      const r = regRecorrente(rest.join(' '));
      if (r.data?.status !== 'pausada') return term.say(`${esc(r.text)} não está pausada.`);
      // volta a partir deste mês: os meses pausados não são lançados
      const mes = dayKey(new Date()).slice(0, 7);
      await muda(r, { status: 'ativa', desde: (r.data?.desde || mes) > mes ? r.data.desde : mes }, 'recorrente retomada');
      done(`${esc(r.text)} de volta · a partir deste mês (os meses pausados não entram)`);
      const ids = await lancarRecorrentes({ lembretes: false });
      if (ids.length) S.undo.at(-1).created = ids;
      return;
    }
    if (sub === 'cancelar') {
      const r = regRecorrente(rest.join(' '));
      await muda(r, { status: 'cancelada' }, 'recorrente cancelada');
      return done(`${esc(r.text)} cancelada · não lanço mais · os que já lancei continuam`, 'warn');
    }
    if (sub === 'renomear') {
      const i = rest.join(' ').search(/\s*(?:=|\bpara\b|\bpra\b)\s*/);
      if (i < 0) throw usage('recorrente', 'renomear netflix = netflix premium');
      const de = rest.join(' ').slice(0, i), para = rest.join(' ').slice(i).replace(/^\s*(?:=|para|pra)\s*/, '').trim();
      const r = regRecorrente(de);
      if (!para) throw usage('recorrente', 'renomear netflix = netflix premium');
      await muda(r, {}, 'recorrente renomeada', para);
      return done(`${esc(r.text)} → <span class="c-act">${esc(para)}</span>`);
    }
    // "/recorrente netflix 59,90 dia 20 nubank": edita (vale do próximo lançamento em diante)
    const ws = txt.split(/\s+/);
    let r = null, k = ws.length;
    for (; k > 0 && !r; k--) { try { r = regRecorrente(ws.slice(0, k).join(' ')); } catch { r = null; } }
    if (!r) return regRecorrente(txt); // erro com a dica
    const tokens = ws.slice(k + 1), novo = {};
    const tipo = r.data?.tipo === 'entrada' ? 'entrada' : 'gasto';
    for (let i = 0; i < tokens.length; i++) {
      const w = tokens[i];
      if (/^dia$/i.test(w) && /^\d{1,2}$/.test(tokens[i + 1] || '')) { novo.dia = Math.min(31, Math.max(1, +tokens[++i])); continue; }
      if (/^vari[aá]vel$/i.test(w)) { novo.valor = null; continue; }
      const card = cartoesDe(S.records || []).find(c => c.nome === w.toLowerCase());
      if (card) { novo.cartao = card.id; novo.forma = 'credito'; continue; }
      const v = parseValor(w), f = acharForma(w), c = acharCategoria(w, cats()[tipo] || []);
      if (v !== null) novo.valor = v;
      else if (f) novo.forma = f;
      else if (c) novo.categoria = c;
      else throw new CmdError('E_ARG', 'fin', `não entendi "${w}"`, 'valor (59,90), dia 20, forma (pix, crédito…), cartão, categoria ou variável');
    }
    if (!Object.keys(novo).length) { const x = recorrentesDe([r])[0]; return term.print(`<span class="k c-act">${esc(x.nome)}</span><span>${x.valor ? esc(fmtValor(x.valor)) : 'variável'} · dia ${x.dia} · ${esc(x.status)}</span>`, 'tbl'); }
    await muda(r, novo, 'recorrente editada');
    const mostra = { valor: v => (v ? fmtValor(v) : 'variável'), dia: v => 'dia ' + v, forma: formaTxt, categoria: v => v, cartao: v => cartoesDe(S.records || []).find(c => c.id === v)?.nome || '' };
    return done(`${esc(r.text)} · ${Object.entries(novo).map(([kk, v]) => `<span class="c-act">${esc(mostra[kk](v))}</span>`).join(' · ')} <span class="dim">· vale do próximo lançamento em diante</span>`);
  }

  // /apagar f3 (e "f1 f3"): apaga lançamentos de dinheiro · se é de uma recorrente, anota o mês em "pulados" (senão o lançador recriaria)
  async function apagar(raw, t) {
    const nums = String(raw).trim().split(/[\s,]+/).filter(Boolean);
    if (!nums.length || !nums.every(w => /^f\d+$/i.test(w))) throw usage('apagar', 'f3 · f1 f4');
    const alvos = [...new Set(nums.map(w => alvo(w.toLowerCase())))];
    const items = [];
    const recsMudados = new Map();
    for (const e of alvos) {
      items.push(e);
      const rid = e.data?.recorrente;
      const rec = rid && (recsMudados.get(rid) || S.records.find(x => x.id === rid));
      if (rec) {
        if (!recsMudados.has(rid)) items.push(rec);
        const mes = mesDe(e);
        recsMudados.set(rid, { ...rec, data: { ...rec.data, pulados: [...new Set([...(rec.data?.pulados || []), mes])] } });
      }
    }
    S.undo.push({ label: 'lançamento apagado', items });
    for (const e of alvos) await ctx.store.remove(e.id);
    for (const r of recsMudados.values()) await ctx.store.restore(r);
    S.lastLatency = t.elapsed();
    term.ok('fin', `apagado${alvos.length > 1 ? 's ' + alvos.length : ''} · ${alvos.map(e => hl(e.text)).join(' · ')}${recsMudados.size ? ' <span class="dim">· a recorrente pula esse mês</span>' : ''} <span class="c-meta">· /desfazer volta · ${t.id}</span>`);
    ctx.ui.pulse('warn');
  }

  // "↳ entendi · recorrente · netflix · R$ 55,90 · todo dia 15 · assinaturas* · crédito · começa em out"
  function entendiRecorrente(r, e) {
    const c = r.campos, A = k => (r.auto.includes(k) ? '<span class="dim">*</span>' : '');
    const now = new Date(), desde = e.data?.desde;
    const comeca = desde === dayKey(now).slice(0, 7)
      ? (dataNoMes(desde, c.dia) === dayKey(now) ? 'lança hoje' : `começa dia ${c.dia}`)
      : `começa em ${fmtMes(desde, now)} <span class="dim">(dia ${c.dia} já passou este mês: se ainda não lançou, escreva normal)</span>`;
    const partes = [
      `<span class="c-act">${esc(c.nome)}</span>`, c.tipo === 'entrada' ? 'entrada' : '',
      c.valor ? esc(fmtValor(c.valor)) : '<span class="c-warn">variável</span> <span class="dim">(eu lembro, você lança o valor)</span>',
      `todo dia ${c.dia}${A('dia')}`, c.categoria ? `${esc(c.categoria)}${A('categoria')}` : '', c.forma ? esc(formaTxt(c.forma)) : '', comeca,
    ];
    term.print(`<span class="c-int">↳ entendi</span> · recorrente · ${partes.filter(Boolean).join(' · ')} <span class="dim">· /desfazer · /recorrentes</span>`, 'auto');
  }

  /* ---------- os três saldos (Fase 3d) ---------- */

  // o que eu calculava antes de você me dizer o valor novo (sem a âncora que acabou de entrar)
  function achava(onde, semId) {
    const recs = (S.records || []).filter(e => e.id !== semId);
    if (chaveLugar(onde) === 'conta') return saldoConta(S.entries, recs, new Date())?.valor ?? null;
    const i = investimentosPorLugar(S.entries, recs).find(x => x.lugar === chaveLugar(onde));
    return i ? i.valor : null;
  }
  // "↳ conta R$ 2.500,00 · eu achava R$ 2.480,00 · diferença +R$ 20,00"
  function entendiSaldo(r, e) {
    const onde = r.campos.onde, antes = achava(onde, e.id), dif = antes === null ? null : r.campos.valor - antes;
    const nome = chaveLugar(onde) === 'conta' ? 'conta' : onde;
    const resto = antes === null
      ? '<span class="dim">daqui pra frente eu somo o que você lançar</span>'
      : dif === 0 ? '<span class="dim">bate com o que eu calculava ✓</span>'
        : `<span class="dim">eu achava ${esc(fmtValor(antes))} · diferença</span> <span class="${dif < 0 ? 'c-warn' : 'c-act'}">${dif > 0 ? '+' : ''}${esc(fmtValor(dif))}</span>${dif < 0 ? ' <span class="dim">(algo não foi lançado?)</span>' : ''}`;
    term.print(`<span class="c-int">↳ saldo</span> · ${esc(nome)} <span class="c-act">${esc(fmtValor(r.campos.valor))}</span> · ${resto} <span class="dim">· /saldo · /desfazer</span>`, 'auto');
  }
  // "↳ fatura nubank (vence 10.11) paga · R$ 420,00 saiu da conta"
  function entendiFatura(r) {
    const now = new Date(), c = cartoesDe(S.records || [], { todos: true }).find(x => x.id === r.campos.cartao);
    if (!c) return;
    const total = parcelasNoMes(S.entries, r.campos.mes, opts().cartoes).filter(p => p.cartao.id === c.id).reduce((s, p) => s + p.valor, 0);
    term.print(`<span class="c-int">↳ fatura</span> <span class="c-act">${esc(c.nome)}</span> <span class="dim">(vence ${esc(fmtDia(vencimentoDa(c, r.campos.mes).vence, now))})</span> paga · ${esc(fmtValor(total))} saiu da conta <span class="dim">· não é gasto (as compras já contaram) · /desfazer</span>`, 'auto');
  }

  // /saldo 2.500 · /saldo poupança 5.000 · /saldo xp 3.000 (qualquer lugar)
  async function ajustarSaldo(raw, t) {
    const v = findValor(raw);
    if (!v) throw usage('saldo', '2.500 (a conta) · poupança 5.000 · tesouro 8 mil');
    const onde = (v.resto || '').replace(/^(?:na|no|em|da|do|a|o)\s+/i, '').trim().toLowerCase() || 'conta';
    const e = await ctx.store.add({ kind: 'saldo', text: onde, tags: [], ts: Date.now(), day: dayKey(new Date()), data: { onde: chaveLugar(onde), valor: v.centavos, data: dayKey(new Date()) } });
    S.undo.push({ label: 'saldo', items: [], created: [e.id] });
    S.lastLatency = t.elapsed();
    term.ok('fin', `saldo · ${esc(onde)} ${esc(fmtValor(v.centavos))} <span class="c-meta">· ${t.id}</span>`);
    entendiSaldo({ campos: { onde, valor: v.centavos } }, e);
    ctx.ui.pulse('act');
  }

  // /saldo: os três, com o detalhe
  function mostrarSaldos() {
    const now = new Date();
    const conta = saldoConta(S.entries, S.records || [], now);
    const inv = investimentosPorLugar(S.entries, S.records || []);
    const cards = devoNoCartao(S.entries, S.records || [], now);
    const totalInv = inv.reduce((s, i) => s + i.valor, 0), devo = cards.reduce((s, c) => s + c.devo, 0);
    const livres = cards.filter(c => c.livre != null), livre = livres.reduce((s, c) => s + c.livre, 0);
    term.print(`── saldos ${'─'.repeat(12)}`, 'sep');
    h.table([
      ['conta', conta ? `<span class="${conta.valor < 0 ? 'c-warn' : 'c-act'}">${esc(fmtValor(conta.valor))}</span> <span class="dim">· você disse ${esc(fmtValor(conta.ancora.valor))} em ${esc(fmtDia(conta.ancora.data, now))}, eu somei o que veio depois</span>`
        : '<span class="dim">NA · diga quanto tem:</span> <span class="c-int">/saldo 2.500</span>'],
      ['investido', inv.length ? `<span class="c-act">${esc(fmtValor(totalInv))}</span>` : '<span class="dim">NA · <span class="c-int">/saldo poupança 5.000</span> ou "transferi 200 pra poupança"</span>'],
      ...inv.map(i => [`&nbsp;&nbsp;${esc(i.nome)}`, `${esc(fmtValor(i.valor))}${i.ancora ? '' : ' <span class="dim">(desde que comecei a contar · /saldo ' + esc(i.nome) + ' valor)</span>'}`]),
      ['cartões', cards.length ? `deve <span class="c-warn">${esc(fmtValor(devo))}</span>${livres.length ? ` · livre <span class="c-act">${esc(fmtValor(livre))}</span>` : ''}` : '<span class="dim">NA · /cartao novo nubank fecha 3 vence 10 limite 5.000</span>'],
      ...cards.map(c => [`&nbsp;&nbsp;${esc(c.nome)}`, `deve ${esc(fmtValor(c.devo))}${c.livre != null ? ` · livre ${esc(fmtValor(c.livre))} de ${esc(fmtValor(c.limite))}` : ' <span class="dim">· sem limite: /cartao ' + esc(c.nome) + ' limite 5.000</span>'}`]),
    ]);
    term.print('<span class="dim">o saldo do mês (entradas − gastos) continua no /mes · "paguei a fatura" tira da conta antes do vencimento · /investimentos</span>');
  }

  function listarInvestimentos() {
    const inv = investimentosPorLugar(S.entries, S.records || []);
    if (!inv.length) return term.say('nenhum investimento ainda · <span class="c-int">/saldo poupança 5.000</span> marca quanto tem · "transferi 200 pra poupança" e "rendeu 32 na poupança" atualizam');
    term.print(`── investimentos · ${esc(fmtValor(inv.reduce((s, i) => s + i.valor, 0)))} ${'─'.repeat(8)}`, 'sep');
    const rend = l => S.entries.filter(e => e.kind === 'rendimento' && chaveLugar(e.data?.lugar) === l).reduce((s, e) => s + (e.data?.valor || 0), 0);
    h.table(inv.map(i => [esc(i.nome), `<span class="c-act">${esc(fmtValor(i.valor))}</span>${rend(i.lugar) ? ` <span class="dim">· rendeu ${esc(fmtValor(rend(i.lugar)))}</span>` : ''}${i.ancora ? ` <span class="dim">· marcado em ${esc(fmtDia(i.ancora.data, new Date()))}</span>` : ' <span class="dim">· sem valor inicial</span>'}`]));
    term.print('<span class="dim">/saldo poupança 5.000 corrige · "transferi 200 pra poupança" · "resgatei 300 do cdb" · "rendeu 32 na poupança"</span>');
  }

  /* ---------- cartões (Fase 3b) ---------- */

  const regsCartao = () => (S.records || []).filter(e => e.kind === 'cartao' && !e.data?.arquivado);
  function regCartao(nome) {
    const k = String(nome || '').trim().toLowerCase();
    const r = regsCartao().find(e => String(e.text).toLowerCase() === k) || regsCartao().find(e => acharCategoria(k, [String(e.text)]));
    if (!r) throw new CmdError('E_404', 'fin', `não conheço o cartão "${nome}"`, `cadastre com <span class="c-int">/cartao novo ${esc(k || 'nubank')} fecha 3 vence 10</span> · veja os seus com <span class="c-int">/cartoes</span>`);
    return r;
  }
  // "nubank fecha 3 vence 10 padrão" → { nome: 'nubank', fechamento: 3, vencimento: 10, padrao: true }
  function lerCartao(txt) {
    let t = ` ${String(txt).toLowerCase()} `;
    const pega = re => { const m = t.match(re); if (!m) return null; t = t.replace(m[0], ' '); return +m[1]; };
    const fechamento = pega(/\s(?:fecha(?:mento)?|fecho)\s+(?:dia\s+|no\s+dia\s+)?(\d{1,2})(?=\s)/);
    const vencimento = pega(/\s(?:vence|vencimento)\s+(?:dia\s+|no\s+dia\s+)?(\d{1,2})(?=\s)/);
    const padrao = /\spadr[aã]o\s/.test(t);
    t = t.replace(/\spadr[aã]o\s/, ' ');
    // "limite 5.000", "limite de R$ 5 mil" (Fase 3d)
    let limite = null;
    const lm = t.match(/\slimite\s+(?:de\s+)?((?:r\$\s*)?[\d.,]+(?:\s*mil)?(?:\s*reais)?)(?=\s)/);
    if (lm) { limite = parseValor(lm[1].trim()); t = t.replace(lm[0], ' '); if (!limite) throw new CmdError('E_ARG', 'fin', `limite inválido: ${lm[1].trim()}`, 'ex: limite 5.000'); }
    for (const [n, v] of [['fechamento', fechamento], ['vencimento', vencimento]]) {
      if (v !== null && (v < 1 || v > 31)) throw new CmdError('E_ARG', 'fin', `dia de ${n} inválido: ${v}`, 'use um dia de 1 a 31');
    }
    return { nome: t.replace(/\s+/g, ' ').trim(), fechamento, vencimento, padrao, limite };
  }
  const descCartao = c => `<span class="c-act">${esc(c.text)}</span> <span class="dim">fecha dia ${c.data?.fechamento} · vence dia ${c.data?.vencimento}${c.data?.limite ? ' · limite ' + esc(fmtValor(c.data.limite)) : ''}${c.data?.padrao ? ' · padrão' : ''}</span>`;

  async function cartao(raw, t) {
    const txt = String(raw).trim();
    const [sub0, ...rest] = txt.split(/\s+/);
    const sub = (sub0 || '').toLowerCase();
    const done = (msg, tone = 'act') => { S.lastLatency = t.elapsed(); term.ok('fin', `${msg} <span class="c-meta">· /desfazer volta · ${t.id}</span>`); ctx.ui.pulse(tone); };
    // marcar um como padrão desmarca os outros (tudo num passo do /desfazer)
    const tirarPadrao = async (exceto, items) => {
      for (const e of regsCartao().filter(x => x.id !== exceto && x.data?.padrao)) { items.push(e); await ctx.store.restore({ ...e, data: { ...e.data, padrao: false } }); }
    };
    if (!sub || sub === 'lista') return listarCartoes();
    if (sub === 'novo' || sub === 'nova' || sub === 'criar') {
      const c = lerCartao(rest.join(' '));
      if (!c.nome || c.fechamento === null || c.vencimento === null) throw usage('cartao', 'novo nubank fecha 3 vence 10 [padrão]');
      if (regsCartao().some(e => String(e.text).toLowerCase() === c.nome)) return term.say(`o cartão ${esc(c.nome)} já existe · pra mudar os dias: <span class="c-int">/cartao ${esc(c.nome)} fecha 5 vence 12</span>`);
      const padrao = c.padrao || !regsCartao().length; // o primeiro já nasce padrão
      const items = [];
      if (padrao) await tirarPadrao(null, items);
      const e = await ctx.store.add({ kind: 'cartao', text: c.nome, tags: [], ts: Date.now(), day: dayKey(new Date()), data: { fechamento: c.fechamento, vencimento: c.vencimento, padrao, arquivado: false, ...(c.limite ? { limite: c.limite } : {}) } });
      S.undo.push({ label: 'cartão criado', items, created: [e.id] });
      return done(`cartão novo · ${descCartao(e)}${padrao ? ' <span class="dim">· "no cartão" e "no crédito" vão pra ele</span>' : ''}`);
    }
    if (sub === 'padrao' || sub === 'padrão') {
      const r = regCartao(rest.join(' '));
      if (r.data?.padrao) return term.say(`${esc(r.text)} já é o padrão.`);
      const items = [r];
      await tirarPadrao(r.id, items);
      await ctx.store.restore({ ...r, data: { ...r.data, padrao: true } });
      S.undo.push({ label: 'cartão padrão', items });
      return done(`padrão agora é <span class="c-act">${esc(r.text)}</span> <span class="dim">· crédito sem cartão escrito vai pra ele</span>`);
    }
    if (sub === 'renomear') {
      const i = rest.join(' ').search(/\s*(?:=|\bpara\b|\bpra\b)\s*/);
      if (i < 0) throw usage('cartao', 'renomear nubank = roxinho');
      const de = rest.join(' ').slice(0, i), para = rest.join(' ').slice(i).replace(/^\s*(?:=|para|pra)\s*/, '').trim().toLowerCase();
      const r = regCartao(de);
      if (!para) throw usage('cartao', 'renomear nubank = roxinho');
      S.undo.push({ label: 'cartão renomeado', items: [r] });
      await ctx.store.restore({ ...r, text: para });
      return done(`${esc(r.text)} → <span class="c-act">${esc(para)}</span> <span class="dim">· os gastos continuam ligados a ele</span>`);
    }
    if (sub === 'arquivar') {
      const r = regCartao(rest.join(' '));
      S.undo.push({ label: 'cartão arquivado', items: [r] });
      await ctx.store.restore({ ...r, data: { ...r.data, arquivado: true, padrao: false } });
      return done(`${esc(r.text)} arquivado · some das sugestões · os gastos dele continuam nas faturas`, 'warn');
    }
    // "/cartao nubank fecha 5 vence 12" ou "/cartao nubank": edita ou mostra
    const c = lerCartao(txt);
    const r = regCartao(c.nome);
    if (c.fechamento === null && c.vencimento === null && !c.padrao && !c.limite) return term.print(descCartao(r));
    const items = [r];
    if (c.padrao) await tirarPadrao(r.id, items);
    await ctx.store.restore({ ...r, data: { ...r.data, ...(c.fechamento !== null ? { fechamento: c.fechamento } : {}), ...(c.vencimento !== null ? { vencimento: c.vencimento } : {}), ...(c.padrao ? { padrao: true } : {}), ...(c.limite ? { limite: c.limite } : {}) } });
    S.undo.push({ label: 'cartão editado', items });
    return done(`cartão · ${descCartao(S.records.find(e => e.id === r.id) || r)}`);
  }

  function listarCartoes() {
    const lista = cartoesDe(S.records || []);
    if (!lista.length) return term.say('nenhum cartão ainda · <span class="c-int">/cartao novo nubank fecha 3 vence 10</span> cadastra (o primeiro vira o padrão)');
    const now = new Date(), padrao = cartaoPadrao(lista);
    const devo = new Map(devoNoCartao(S.entries, S.records || [], now).map(d => [d.cartao, d]));
    term.print(`── cartões · ${lista.length} ${'─'.repeat(10)}`, 'sep');
    for (const c of lista) {
      const prox = vencimentoDa(c, proximaFatura(c, now)), d = devo.get(c.id);
      term.print(`<span class="k c-act">${esc(c.nome)}</span><span>deve ${esc(fmtValor(d?.devo || 0))}${d?.livre != null ? ` · livre <span class="${d.livre < 0 ? 'c-warn' : 'c-act'}">${esc(fmtValor(d.livre))}</span> de ${esc(fmtValor(d.limite))}` : ' · <span class="dim">limite NA</span>'} <span class="dim">· fecha dia ${c.fechamento} · vence dia ${c.vencimento}${c.id === padrao?.id ? ' · padrão' : ''} · próxima fatura vence ${esc(fmtDia(prox.vence, now))}</span></span>`, 'tbl');
    }
    term.print('<span class="dim">/cartao nubank limite 5.000 · /cartao novo inter fecha 28 vence 5 · /cartao padrao inter · /cartao nubank fecha 5 vence 12 · renomear · arquivar</span>');
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
      name: 'fatura', alias: ['faturas'], data: true, args: '[cartão] [mês | +1 | -1]',
      desc: 'a fatura do cartão: o que entra, as parcelas (2/3), o total e quando vence · sem cartão: a próxima de cada um',
      run(arg) { mostrarFatura(arg); },
    },
    {
      name: 'saldo', alias: ['saldos'], data: true, async: true, exec: true, args: '[valor | lugar valor]',
      desc: 'os três saldos: conta, investimentos e cartões · /saldo 2.500 diz quanto tem na conta · /saldo poupança 5.000',
      async run(arg, signal, t) { if (String(arg).trim()) await ajustarSaldo(arg, t); else mostrarSaldos(); },
    },
    {
      name: 'investimentos', alias: ['investido', 'investimento'], data: true, desc: 'quanto tem em cada lugar (poupança, tesouro, CDB…) e quanto rendeu',
      run() { listarInvestimentos(); },
    },
    {
      name: 'recorrentes', data: true, desc: 'contas fixas e assinaturas: valor (ou variável), dia, próximo lançamento e o fixo por mês',
      run() { listarRecorrentes(); },
    },
    {
      name: 'recorrente', data: true, async: true, exec: true,
      args: 'nova netflix 55,90 dia 15 | pausar netflix | retomar netflix | cancelar netflix | netflix 59,90 [dia 20] | renomear a = b',
      desc: 'cadastra, pausa, retoma, cancela ou edita uma recorrente · ou escreva normal: "netflix 55,90 todo mês dia 15"',
      async run(arg, signal, t) { await recorrente(arg, t); },
    },
    {
      name: 'cartoes', alias: ['cartões'], data: true, desc: 'os seus cartões: fechamento, vencimento, o padrão e a próxima fatura',
      run() { listarCartoes(); },
    },
    {
      name: 'cartao', alias: ['cartão'], data: true, async: true, exec: true,
      args: 'novo nubank fecha 3 vence 10 [padrão] | padrao inter | nubank fecha 5 vence 12 | renomear nubank = roxinho | arquivar inter',
      desc: 'cadastra e edita cartões de crédito · o primeiro vira o padrão ("no cartão", "no crédito")',
      async run(arg, signal, t) { await cartao(arg, t); },
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

  return { defs, entendi, perguntar, numero, pool, alvo, editar, apagar, mostrarMes, lancarRecorrentes, entendiRecorrente, entendiSaldo, entendiFatura };
}
