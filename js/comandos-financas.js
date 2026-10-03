// Comandos e telas de finanças (Fase 3a). Separado do commands.js, que já está grande.
//
// O commands.js chama criarFinancas(h) e junta os `defs` daqui na lista dele (aparecem sozinhos no /ajuda e no Tab).
//   h = { S, term, ctx, usage, mem }  · S = estado do app · ctx.store grava (com histórico) · mem() = a memória do momento
//
// Números dos lançamentos: f1, f2... (da última lista; um lançamento novo entra no fim), como t1 nas tarefas.
// Perguntas de dinheiro não travam e não usam /sim: cada uma tem o seu comando (/cat, /forma), então aparecem na hora.

import { esc, hl, CmdError } from './util.js';
import { fmtValor } from './valores.js';
import { fmtDia } from './dates.js';
import { categoriasDe, acharCategoria, acharForma, FORMAS, FORMA_ROTULO } from './financas.js';

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

  const defs = [
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
      },
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

  return { defs, entendi, perguntar, numero, pool, alvo };
}
