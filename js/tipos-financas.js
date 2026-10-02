// Tipos de finanças (Fase 2: só o dado bruto · a Fase 3 traz categorias, saldo do mês e telas).
//
//   gasto   { kind: 'gasto',   text, tags, ts, day, data: { valor (centavos), descricao, data: 'AAAA-MM-DD' } }
//   entrada { kind: 'entrada', ... mesmo formato }
//
// Reconhece: palavra de gasto/entrada + valor → 0.9 ("gastei 30 no almoço", "recebi 1.500 de salário")
//            valor com R$/reais ou com centavos, sem palavra nenhuma → 0.65 (fraco: pergunta "era gasto?")
// Sem valor, não é gasto nem entrada ("comprei um livro" é nota).

import { REGISTRO } from './tipos.js';
import { tagsOf, dayKey } from './util.js';
import { findValor } from './valores.js';
import { findDate } from './dates.js';

const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PALAVRAS = {
  gasto: ['gastei', 'paguei', 'comprei', 'torrei', 'desembolsei', 'gasto', 'gastos'],
  entrada: ['recebi', 'ganhei', 'entrou', 'entraram', 'caiu', 'cairam', 'vendi', 'faturei', 'pagaram', 'salario', 'freela', 'reembolso', 'rendimento'],
};
const temPalavra = (texto, lista) => new RegExp(`(?<![a-z])(?:${lista.join('|')})(?![a-z])`).test(fold(texto));
// palavras que sobram no começo da descrição depois de tirar valor e data
const SOBRA = /^(?:gastei|paguei|comprei|torrei|desembolsei|recebi|ganhei|entrou|entraram|caiu|caíram|vendi|faturei|me\s+pagaram|pagaram|gasto|gastos|no|na|nos|nas|o|a|os|as|de|do|da|dos|das|com|em|pro|pra|para|por|um|uma)\s+/i;

// "gastei 45 reais ontem no mercado" → { valor: 4500, descricao: 'mercado', data: ontem }
export function lerMovimento(texto, now = new Date()) {
  const v = findValor(texto);
  if (!v) return null;
  const d = findDate(v.resto, now);
  let desc = d ? d.resto : v.resto;
  for (let i = 0; i < 6 && SOBRA.test(desc); i++) desc = desc.replace(SOBRA, '');
  return { valor: v.centavos, explicito: v.explicito || /,\d{2}\b/.test(v.trecho), descricao: desc.trim(), data: d ? d.data : dayKey(now), temData: !!d };
}

function registrarMovimento(r, id, rotulo, exemplos) {
  r.registrar({
    id, rotulo,
    campos: { valor: { tipo: 'centavos', obrigatorio: true }, descricao: { tipo: 'texto' }, data: { tipo: 'data' }, tags: { tipo: 'lista' } },
    rastrear: ['valor', 'descricao', 'data'],
    exemplos,
    reconhecer(texto, ctx) {
      const now = ctx?.now || new Date();
      const m = lerMovimento(texto, now);
      if (!m) return null;
      const palavra = temPalavra(texto, PALAVRAS[id]);
      const outra = temPalavra(texto, PALAVRAS[id === 'gasto' ? 'entrada' : 'gasto']);
      // sem palavra nenhuma, um valor "com cara de dinheiro" é mais provável gasto (entrada quase sempre tem palavra)
      const confianca = ctx?.forcar === id ? 1 : palavra ? 0.9 : !outra && id === 'gasto' && m.explicito ? 0.65 : 0;
      if (!confianca) return null;
      return { confianca, campos: { valor: m.valor, descricao: m.descricao, data: m.data, tags: tagsOf(texto) }, auto: m.temData ? [] : ['data'] };
    },
    montar: (i, ctx) => {
      const now = ctx?.now || new Date();
      return {
        kind: id, text: i.texto, tags: i.campos.tags || tagsOf(i.texto), ts: now.getTime(), day: dayKey(now),
        data: { valor: i.campos.valor, descricao: i.campos.descricao || '', data: i.campos.data || dayKey(now) },
      };
    },
  });
}

export function registrarTiposFinancas(r = REGISTRO) {
  registrarMovimento(r, 'gasto', 'gasto', ['gastei 30 no almoço', 'paguei R$ 120,50 de luz']);
  registrarMovimento(r, 'entrada', 'entrada', ['recebi 1.500 de salário']);
  return r;
}

registrarTiposFinancas(REGISTRO);
