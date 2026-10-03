// Tipos de finanças (Fase 3a): gasto, entrada e transferência entre as suas contas.
//
//   gasto    { kind: 'gasto',   text: '<frase original>', tags, ts, day,
//              data: { valor (centavos), descricao, data: 'AAAA-MM-DD', categoria, forma?, lugar?, ref?, auto: { campos, fonte } } }
//   entrada  { kind: 'entrada', ... mesmo formato · ref = id do gasto que um estorno devolve }
//   transferencia { kind: 'transferencia', data: { valor, conta: 'poupança', sentido: 'para' | 'de', descricao, data } }  · não entra no saldo
//
// Qual tipo (tipoFinanceiro), nesta ordem:
//   futuro ("pagar o boleto de 120 amanhã") ou começa com verbo no infinitivo → não é dinheiro (vira tarefa)
//   transferência pra/da poupança, investimento… → transferencia 0.9
//   estorno/reembolso → entrada 0.9 · verbo (gastei, recebi, me pagou, deu 64…) → 0.9
//   pix pro João → gasto 0.85 · pix do Pedro → entrada 0.85
//   começa com palavra conhecida ("mercado 87", "uber 18,50", "salário 3.200") → 0.85
//   verbo desconhecido + pista em outro lugar ("abasteci 200 no posto") → gasto 0.6 (fraco: salva como nota e pergunta)
//   valor com R$/reais/centavos e nada mais → gasto 0.65 (fraco)
// Sem valor nunca é dinheiro ("comprei um livro" é nota).

import { REGISTRO } from './tipos.js';
import { tagsOf, dayKey } from './util.js';
import { findValor, fmtValor } from './valores.js';
import { findDate } from './dates.js';
import { comecaComVerbo } from './tipos-base.js';
import { lerFinanca, categoriaSemente, tipoDaPalavra, verbosAprendidos, acharEstornado, FORMAS } from './financas.js';
import { FINANCAS } from './config.js';

// "gastei 45 reais ontem no mercado" → { valor: 4500, descricao: 'mercado', data: ontem } (leitura simples da Fase 2)
const SOBRA = /^(?:gastei|paguei|comprei|torrei|desembolsei|recebi|ganhei|entrou|entraram|caiu|caíram|vendi|faturei|me\s+pagaram|pagaram|gasto|gastos|no|na|nos|nas|o|a|os|as|de|do|da|dos|das|com|em|pro|pra|para|por|um|uma)\s+/i;
export function lerMovimento(texto, now = new Date()) {
  const v = findValor(texto);
  if (!v) return null;
  const d = findDate(v.resto, now);
  let desc = d ? d.resto : v.resto;
  for (let i = 0; i < 6 && SOBRA.test(desc); i++) desc = desc.replace(SOBRA, '');
  return { valor: v.centavos, explicito: v.explicito || /,\d{2}\b/.test(v.trecho), descricao: desc.trim(), data: d ? d.data : dayKey(now), temData: !!d };
}

// Decide se a frase é dinheiro e de que tipo. → { tipo, confianca, f (a leitura) } | null
export function tipoFinanceiro(texto, ctx = {}) {
  const now = ctx.now || new Date();
  const f = lerFinanca(texto, { now, pessoas: ctx.pessoas || [], aprendidos: verbosAprendidos(ctx.records || []) });
  if (!f) return null;
  const conhecida = f.primeira ? tipoDaPalavra(f.primeira) : null;
  // futuro ou "pagar…", "comprar…" no começo: é tarefa, não dinheiro (a não ser que a 1ª palavra seja conhecida: "jantar 80")
  if (f.futuro || (!f.verbo && !conhecida && comecaComVerbo(texto))) return null;
  if (f.transferencia) return { tipo: 'transferencia', confianca: 0.9, f };
  if (f.estorno) return { tipo: 'entrada', confianca: 0.9, f };
  if (f.verbo) return { tipo: f.verbo.tipo, confianca: 0.9, f };
  if (f.forma === 'pix' && f.direcao) return { tipo: f.direcao === 'de' ? 'entrada' : 'gasto', confianca: 0.85, f };
  if (conhecida) return { tipo: conhecida, confianca: 0.85, f };
  if (categoriaSemente(texto, 'gasto', { lugar: f.lugar })) return { tipo: 'gasto', confianca: 0.6, f };
  if (f.explicito) return { tipo: 'gasto', confianca: 0.65, f };
  return null;
}

// a categoria de um gasto/entrada novo (etapa 2: só a semente · a memória entra na etapa 3)
function decidirCategoria(texto, tipo, f) {
  if (tipo === 'entrada' && f.estorno) return { categoria: 'reembolso', motivo: { tipo: 'estorno' } };
  const s = categoriaSemente(texto, tipo, { lugar: f.lugar });
  if (s) return { categoria: s.categoria, motivo: { tipo: 'semente', pista: s.palavra } };
  return { categoria: 'outros', motivo: { tipo: 'padrao' } };
}

const campoForma = { tipo: 'enum', valores: FORMAS };

function registrarMovimento(r, id, rotulo, exemplos) {
  r.registrar({
    id, rotulo,
    campos: {
      valor: { tipo: 'centavos', obrigatorio: true }, descricao: { tipo: 'texto' }, data: { tipo: 'data' },
      categoria: { tipo: 'texto' }, forma: campoForma, lugar: { tipo: 'texto' }, ref: { tipo: 'texto' }, tags: { tipo: 'lista' },
    },
    rastrear: ['valor', 'descricao', 'data', 'categoria', 'forma', 'lugar', 'pessoas', 'ref'],
    exemplos,
    reconhecer(texto, ctx) {
      const now = ctx?.now || new Date();
      const forcado = ctx?.forcar === id;
      const t = tipoFinanceiro(texto, ctx);
      // forçado (/tipo gasto, /sim do "era gasto?"): basta ter valor
      const f = t?.f || (forcado ? lerFinanca(texto, { now, pessoas: ctx?.pessoas || [] }) : null);
      if (!f || (!forcado && t.tipo !== id)) return null;
      const auto = [];
      if (!f.temData) auto.push('data');
      const cat = decidirCategoria(texto, id, f);
      if (cat.motivo.tipo !== 'estorno') auto.push('categoria');
      let forma = f.forma;
      if (!forma && FINANCAS.formaPadrao) { forma = FINANCAS.formaPadrao; auto.push('forma'); }
      const ref = id === 'entrada' && f.estorno ? acharEstornado(texto, f.valor, ctx?.entries || [], { now })?.id : null;
      return {
        confianca: forcado ? 1 : t.confianca,
        campos: { valor: f.valor, descricao: f.descricao, data: f.data, categoria: cat.categoria, forma, lugar: f.lugar, ref, tags: tagsOf(texto) },
        auto,
        motivos: { categoria: cat.motivo },
      };
    },
    montar: (i, ctx) => {
      const now = ctx?.now || new Date();
      const c = i.campos;
      const data = { valor: c.valor, descricao: c.descricao || '', data: c.data || dayKey(now), categoria: c.categoria || 'outros' };
      for (const k of ['forma', 'lugar', 'ref']) if (c[k]) data[k] = c[k];
      if (i.auto?.length) data.auto = { campos: i.auto, fonte: i.origem };
      return { kind: id, text: i.texto, tags: c.tags || tagsOf(i.texto), ts: now.getTime(), day: dayKey(now), data };
    },
    // uma linha pro montarContexto: "gastos 7d: R$ 230,00 (5)"
    resumo(list, { desde, dias }) {
      const de = dayKey(new Date(desde));
      const no = list.filter(e => (e.data?.data || e.day) >= de);
      if (!no.length) return null;
      return `${rotulo}s ${dias}d: ${fmtValor(no.reduce((s, e) => s + (e.data?.valor || 0), 0))} (${no.length})`;
    },
  });
}

export function registrarTiposFinancas(r = REGISTRO) {
  registrarMovimento(r, 'gasto', 'gasto', ['gastei 45 no ifood', 'mercado 87', 'fiz um pix de 50 pro João', 'almoço 32 no débito']);
  registrarMovimento(r, 'entrada', 'entrada', ['caiu o salário 3.200', 'o João me pagou 30', 'estorno de 45 do ifood']);
  r.registrar({
    id: 'transferencia', rotulo: 'transferência',
    campos: { valor: { tipo: 'centavos', obrigatorio: true }, conta: { tipo: 'texto' }, sentido: { tipo: 'enum', valores: ['para', 'de'] }, descricao: { tipo: 'texto' }, data: { tipo: 'data' }, tags: { tipo: 'lista' } },
    rastrear: ['valor', 'conta', 'sentido', 'data'],
    exemplos: ['transferi 200 pra poupança', 'resgatei 300 da poupança'],
    reconhecer(texto, ctx) {
      const t = tipoFinanceiro(texto, ctx);
      const forcado = ctx?.forcar === 'transferencia';
      const f = t?.f || (forcado ? lerFinanca(texto, { now: ctx?.now || new Date() }) : null);
      if (!f || (!forcado && t.tipo !== 'transferencia')) return null;
      const tr = f.transferencia || { sentido: 'para', conta: null };
      return {
        confianca: forcado ? 1 : t.confianca,
        campos: { valor: f.valor, conta: tr.conta, sentido: tr.sentido, descricao: f.descricao, data: f.data, tags: tagsOf(texto) },
        auto: f.temData ? [] : ['data'],
      };
    },
    montar: (i, ctx) => {
      const now = ctx?.now || new Date();
      const c = i.campos;
      return {
        kind: 'transferencia', text: i.texto, tags: c.tags || tagsOf(i.texto), ts: now.getTime(), day: dayKey(now),
        data: { valor: c.valor, conta: c.conta || '', sentido: c.sentido || 'para', descricao: c.descricao || '', data: c.data || dayKey(now) },
      };
    },
  });
  return r;
}

registrarTiposFinancas(REGISTRO);
