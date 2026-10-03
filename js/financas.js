// Finanças (Fase 3a). Funções puras, testadas em tests/.
//
// Categorias = registros escondidos (sincronizam, só do dono), semeados com id fixo como os projetos:
//   { kind: 'categoria', text: 'alimentação', data: { tipo: 'gasto' | 'entrada', ordem, arquivada } }
// Sem nenhum registro de um tipo ainda, valem as categorias padrão.
//
// lerFinanca(frase) tira da frase tudo o que dá pra saber sem memória:
//   valor (centavos) · data · forma de pagamento · lugar ("no ifood") · verbo (gastei / recebi / me pagou)
//   direção do pix (pro João = gasto · do Pedro = entrada) · transferência entre contas suas · estorno
// Quem decide o TIPO e a CATEGORIA é o reconhecedor (js/tipos-financas.js), com a memória (js/memoria.js).

import { dayKey } from './util.js';
import { findValor } from './valores.js';
import { findDate } from './dates.js';
import { findPessoas } from './pessoas.js';

const strip = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palavras = s => strip(s).split(/[^a-z0-9]+/).filter(Boolean);

/* ---------- categorias ---------- */

export const CATEGORIAS_PADRAO = {
  gasto: ['alimentação', 'mercado', 'transporte', 'moradia', 'saúde', 'educação', 'vestuário', 'lazer', 'assinaturas', 'outros'],
  entrada: ['salário', 'freela', 'reembolso', 'outros'],
};
export const TIPOS_FINANCAS = ['gasto', 'entrada'];

// { gasto: ['alimentação', ...], entrada: [...] } · ordem do registro, sem as arquivadas
export function categoriasDe(records = []) {
  const out = {};
  for (const tipo of TIPOS_FINANCAS) {
    const regs = records.filter(e => e.kind === 'categoria' && (e.data?.tipo || 'gasto') === tipo);
    out[tipo] = regs.length
      ? [...new Set(regs.filter(e => !e.data?.arquivada).sort((a, b) => (a.data?.ordem ?? 99) - (b.data?.ordem ?? 99) || a.ts - b.ts).map(e => String(e.text).toLowerCase()))]
      : [...CATEGORIAS_PADRAO[tipo]];
  }
  return out;
}

// o nome digitado ("alimentacao", "Saúde") → o nome cadastrado, ou null
export function acharCategoria(nome, lista = []) {
  const k = strip(nome).trim();
  return lista.find(c => strip(c) === k) || null;
}

/* ---------- formas de pagamento ---------- */

export const FORMAS = ['pix', 'credito', 'debito', 'dinheiro', 'boleto'];
export const FORMA_ROTULO = { pix: 'pix', credito: 'crédito', debito: 'débito', dinheiro: 'dinheiro', boleto: 'boleto' };
// "crédito", "cartao", "no cartão de débito" → 'credito' / 'debito' · senão null
export function acharForma(txt) {
  const t = strip(txt).trim();
  if (/^(?:cartao\s+de\s+)?debito$/.test(t)) return 'debito';
  if (/^(?:cartao(?:\s+de\s+credito)?|credito)$/.test(t)) return 'credito';
  if (/^(?:dinheiro|especie|cash)$/.test(t)) return 'dinheiro';
  return FORMAS.includes(t) ? t : null;
}

// forma escrita na frase (a ordem importa: "cartão de débito" é débito, "no cartão" sozinho é crédito)
const PRE = String.raw`(?:(?:no|na|em|via|pelo|pela|com|de|do|da|por)\s+)?`;
const FORMA_RE = [
  ['debito', new RegExp(String.raw`(?<![a-z])${PRE}(?:(?:o\s+)?cartao\s+de\s+)?debito(?![a-z])`)],
  ['credito', new RegExp(String.raw`(?<![a-z])${PRE}(?:(?:o\s+)?cartao(?:\s+de\s+credito)?|credito)(?![a-z])`)],
  ['pix', new RegExp(String.raw`(?<![a-z])(?:(?:fiz|mandei|enviei|recebi|caiu)\s+(?:um\s+)?)?${PRE}pix(?![a-z])`)],
  ['dinheiro', new RegExp(String.raw`(?<![a-z])${PRE}(?:dinheiro|especie|cash)(?![a-z])`)],
  ['boleto', new RegExp(String.raw`(?<![a-z])(?:(?:o|um)\s+)?boleto(?![a-z])`)],
];

/* ---------- vocabulário semente ---------- */

// verbos que dizem "isto é gasto/entrada" (sem acento)
export const VERBOS = {
  gasto: ['gastei', 'paguei', 'comprei', 'torrei', 'desembolsei'],
  // só valem com o valor logo depois ("deu 64", "saiu 1.234,56"); "deu ruim", "saiu o resultado" não são gasto
  gastoComValor: ['saiu', 'sairam', 'deu', 'deram', 'custou', 'custaram'],
  entrada: ['recebi', 'ganhei', 'caiu', 'cairam', 'entrou', 'entraram', 'vendi', 'faturei', 'pagaram'],
};
// verbos de entrada que também têm outro sentido ("o celular caiu"): perdem pra um verbo de gasto na mesma frase
const FRACOS = ['caiu', 'cairam', 'entrou', 'entraram'];
// "o João me pagou 30", "a Ana me mandou 50": entrada, mesmo sem outro verbo
const ME_PAGOU = /(?<![a-z])me\s+(?:pagou|pagaram|mandou|mandaram|devolveu|devolveram|transferiu|transferiram|passou|passaram|deu|deram)(?![a-z])/;
// estorno / reembolso: entrada ligada ao gasto
const ESTORNO = /(?<![a-z])(?:estorno|estornaram|estornou|estornado|reembolso|reembolsaram|reembolsou|devolucao|cashback)(?![a-z])/;
// transferência entre as suas contas (não é gasto nem entrada)
const CONTAS = String.raw`(?:poupanca|investimentos?|reserva(?:\s+de\s+emergencia)?|tesouro(?:\s+direto)?|cdb|corretora|caixinha|cofrinho|conta\s+(?:da|do|de)\s+\w+|outra\s+conta|minha\s+conta)`;
const TRANSF_PARA = new RegExp(String.raw`(?<![a-z])(?:transferi|transferencia|guardei|apliquei|investi|depositei|coloquei|botei|mandei|passei|joguei)(?![a-z]).*?(?<![a-z])(?:pra|para|pro|na|no|em)\s+(?:a\s+|o\s+)?(?<conta>${CONTAS})(?![a-z])`);
const TRANSF_DE = new RegExp(String.raw`(?<![a-z])(?:resgatei|tirei|saquei|puxei|retirei|transferi)(?![a-z]).*?(?<![a-z])(?:da|do|de)\s+(?:minha\s+)?(?<conta>${CONTAS})(?![a-z])`);
const TRANSF_VERBO = /(?<![a-z])(?:transferi|transferencia)(?![a-z])/;

// palavra → categoria (sem acento). A memória (js/memoria.js) aprende por cima disto e ganha dela.
export const SEMENTE = {
  gasto: {
    'alimentação': 'ifood rappi almoco almocei jantar janta lanche lanchonete rodizio restaurante pizza pizzaria hamburguer burger padaria cafe cafeteria acai sorvete marmita delivery sushi churrasco',
    mercado: 'mercado supermercado atacadao atacado feira hortifruti sacolao acougue',
    transporte: 'uber taxi posto gasolina combustivel etanol onibus metro estacionamento pedagio passagem',
    moradia: 'aluguel luz agua condominio internet energia gas celesc iptu',
    'saúde': 'farmacia remedio remedios medico dentista consulta exame exames hospital psicologo terapia',
    'educação': 'faculdade livro livros curso mensalidade material apostila matricula',
    'vestuário': 'roupa roupas tenis camisa camiseta calca sapato sapatos jaqueta vestido',
    lazer: 'bar cinema show festa balada cerveja ingresso viagem jogo',
    assinaturas: 'netflix spotify prime disney youtube hbo max icloud chatgpt assinatura deezer globoplay',
  },
  entrada: {
    'salário': 'salario pagamento holerite',
    freela: 'freela freelance job bico',
    reembolso: 'reembolso estorno devolucao cashback',
    outros: 'rendimento rendimentos juros',
  },
};
const SEMENTE_MAPA = Object.fromEntries(TIPOS_FINANCAS.map(t => [t, new Map(Object.entries(SEMENTE[t]).flatMap(([cat, ws]) => ws.split(' ').map(w => [w, cat])))]));

// a primeira palavra da frase (ou do lugar) que a semente conhece → { categoria, palavra } · senão null
export function categoriaSemente(texto, tipo = 'gasto', { lugar = null } = {}) {
  const mapa = SEMENTE_MAPA[tipo];
  if (!mapa) return null;
  for (const w of [...(lugar ? palavras(lugar) : []), ...palavras(texto)]) if (mapa.has(w)) return { categoria: mapa.get(w), palavra: w };
  return null;
}
// a palavra é conhecida da semente (em algum tipo)? → 'gasto' | 'entrada' | null
export const tipoDaPalavra = w => TIPOS_FINANCAS.find(t => SEMENTE_MAPA[t].has(strip(w))) || null;

/* ---------- ler a frase ---------- */

// palavras que sobram no começo da descrição (verbos, artigos, preposições)
const SOBRA = /^(?:gastei|paguei|comprei|torrei|desembolsei|recebi|ganhei|entrou|entraram|caiu|caíram|cairam|vendi|faturei|saiu|saíram|sairam|deu|deram|custou|custaram|pagaram|me\s+pagaram|no|na|nos|nas|num|numa|o|a|os|as|de|do|da|dos|das|com|em|pro|pra|pros|pras|para|por|um|uma|via)\s+/i;

// "gastei 45 no ifood ontem" → { valor: 4500, data: ontem, temData, forma: null, lugar: 'ifood', verbo: { tipo: 'gasto', palavra: 'gastei' }, ... }
// opts: { now, pessoas (cadastro, pra direção do pix), aprendidos: { gasto: ['abasteci'], entrada: [] } (verbos que você ensinou) }
export function lerFinanca(texto, { now = new Date(), pessoas = [], aprendidos = {} } = {}) {
  const original = String(texto ?? '').normalize('NFC').trim();
  const v = findValor(original);
  if (!v) return null;
  const d = findDate(v.resto, now);
  let resto = d ? d.resto : v.resto;
  const low = strip(original);
  const ws = palavras(original);

  // verbo: o primeiro forte da frase; "caiu"/"entrou" são fracos ("o celular caiu e gastei 300" é gasto)
  // (low tem as mesmas posições do original: só tira o acento de cada letra)
  const achados = [];
  for (const m of low.matchAll(/[a-z]+/g)) {
    const w = m[0];
    if (VERBOS.gasto.includes(w) || (aprendidos.gasto || []).includes(w)) achados.push({ tipo: 'gasto', palavra: w, forca: 2, aprendido: !VERBOS.gasto.includes(w) });
    else if (VERBOS.entrada.includes(w) || (aprendidos.entrada || []).includes(w)) achados.push({ tipo: 'entrada', palavra: w, forca: FRACOS.includes(w) ? 1 : 2, aprendido: !VERBOS.entrada.includes(w) });
    // saiu/deu/custou: só com o valor logo depois
    else if (VERBOS.gastoComValor.includes(w) && /^\s*$/.test(original.slice(m.index + w.length, v.inicio))) achados.push({ tipo: 'gasto', palavra: w, forca: 2 });
  }
  let verbo = achados.find(a => a.forca === 2) || achados[0] || null;
  if (verbo) { verbo = { ...verbo }; delete verbo.forca; if (!verbo.aprendido) delete verbo.aprendido; }
  if (ME_PAGOU.test(low)) verbo = { tipo: 'entrada', palavra: low.match(ME_PAGOU)[0] };

  // forma de pagamento escrita
  let forma = null, formaTrecho = null;
  for (const [f, re] of FORMA_RE) {
    const m = strip(resto).match(re);
    if (m) { forma = f; formaTrecho = resto.slice(m.index, m.index + m[0].length); resto = (resto.slice(0, m.index) + ' ' + resto.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(); break; }
  }

  // pessoas na frase (cadastradas) ou nome com maiúscula depois de pro/pra/do/da
  const conhecidas = findPessoas(original, pessoas);
  const pessoaEm = pos => conhecidas.some(a => a.inicio === pos) || /^\p{Lu}\p{Ll}/u.test(original.slice(pos));
  let direcao = null;
  for (const m of original.matchAll(/(?<![\p{L}])(pro|pra|para\s+[oa]|para|ao|à|do|da)\s+/giu)) {
    const pos = m.index + m[0].length;
    if (!pessoaEm(pos)) continue;
    direcao = /^(?:do|da)$/i.test(m[1]) ? 'de' : 'para';
    break;
  }

  // transferência entre contas suas (não é gasto nem entrada)
  let transferencia = null;
  const tp = low.match(TRANSF_PARA), td = low.match(TRANSF_DE);
  // o nome da conta como foi escrito ("poupança"), não a versão sem acento
  const conta = m => { const fim = m.index + m[0].length; return original.slice(fim - m.groups.conta.length, fim).toLowerCase().replace(/\s+/g, ' '); };
  if (tp) transferencia = { sentido: 'para', conta: conta(tp) };
  else if (td) transferencia = { sentido: 'de', conta: conta(td) };
  // "transferi 50 pro João": é um pix pra uma pessoa (gasto)
  if (!transferencia && TRANSF_VERBO.test(low) && direcao) { verbo ||= { tipo: direcao === 'de' ? 'entrada' : 'gasto', palavra: 'transferi' }; forma ||= 'pix'; }

  // lugar: "no ifood", "na farmácia", "no bar" (uma palavra, que não é forma, pessoa nem data)
  let lugar = null;
  for (const m of resto.matchAll(/(?<![\p{L}])(?:no|na|num|numa|em)\s+(\p{L}[\p{L}\d'’-]*)/giu)) {
    const w = m[1];
    if (acharForma(w) || findPessoas(w, pessoas).length) continue;
    lugar = w.toLowerCase();
    break;
  }

  // descrição: o que sobra sem verbo, artigos e preposições soltas
  let desc = resto.replace(ME_PAGOU_TXT, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 6 && SOBRA.test(desc); i++) desc = desc.replace(SOBRA, '');
  desc = desc.replace(/\s+(?:de|do|da|no|na|pro|pra|com|em)$/i, '').trim();

  // a primeira palavra da frase sem o valor (pra regra "mercado 87": começa com palavra conhecida)
  const primeira = palavras(v.resto)[0] || null;

  return {
    valor: v.centavos,
    explicito: v.explicito || /,\d{2}\b/.test(v.trecho),
    data: d ? d.data : dayKey(now),
    temData: !!d,
    futuro: !!d && d.data > dayKey(now),
    forma, formaTrecho, lugar, verbo, direcao, transferencia,
    estorno: ESTORNO.test(low),
    descricao: desc,
    primeira,
    palavras: ws,
  };
}
const ME_PAGOU_TXT = /(?<![\p{L}])me\s+(?:pagou|pagaram|mandou|mandaram|devolveu|devolveram|transferiu|transferiram|passou|passaram|deu|deram)(?![\p{L}])/giu;
