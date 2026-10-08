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

import { dayKey, pad } from './util.js';
import { findValor, fmtValor } from './valores.js';
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
// palavras que aparecem em quase todo lançamento e não dizem nada da categoria (não viram pista na memória)
export const PALAVRAS_DE_DINHEIRO = [...VERBOS.gasto, ...VERBOS.gastoComValor, ...VERBOS.entrada,
  ...'pix credito cartao debito dinheiro boleto especie cash reais real conto contos pila pilas pau paus centavos fiz mandei enviei transferi pagou pagaram via gasto gastos'.split(' ')];
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
const SOBRA = /^(?:gastei|paguei|comprei|torrei|desembolsei|recebi|ganhei|entrou|entraram|caiu|caíram|cairam|vendi|faturei|saiu|saíram|sairam|deu|deram|custou|custaram|pagaram|me\s+pagaram|no|na|nos|nas|num|numa|o|a|os|as|de|do|da|dos|das|com|em|pro|pra|pros|pras|para|por|um|uma|via)(?:\s+|$)/i; // até sozinho: "paguei 270" → descrição vazia

// "no almoço", "no fim de semana": é quando, não onde
const NAO_LUGAR = new Set('almoco jantar janta lanche cafe fim final comeco meio mes semana dia total'.split(' '));

// "gastei 45 no ifood ontem" → { valor: 4500, data: ontem, temData, forma: null, lugar: 'ifood', verbo: { tipo: 'gasto', palavra: 'gastei' }, ... }
// opts: { now, pessoas (cadastro, pra direção do pix), aprendidos: { gasto: ['abasteci'], entrada: [] } (verbos que você ensinou),
//         cartoes (cartoesDe: "no nubank" = crédito nesse cartão) }
export function lerFinanca(texto, { now = new Date(), pessoas = [], aprendidos = {}, cartoes = [] } = {}) {
  const original = String(texto ?? '').normalize('NFC').trim();
  const v = findValor(original);
  if (!v) return null;
  let d = findDate(v.resto, now);
  // "dia 5" sozinho (sem mês) que já passou neste mês: em dinheiro é o dia 5 DESTE mês (o gasto aconteceu), não o do mês que vem.
  // Sem isso, "mercado 187 no débito dia 2" (escrito no dia 8) virava futuro → tarefa. "pagar 120 dia 20" continua futuro.
  const soDia = d && d.data > dayKey(now) && d.trecho.trim().match(/^(?:(?:no|em)\s+)?(?:dia\s+)?(\d{1,2})$/i);
  if (soDia && +soDia[1] <= now.getDate()) d = { ...d, data: `${dayKey(now).slice(0, 7)}-${pad(+soDia[1])}` };
  let resto = d ? d.resto : v.resto;
  const low = strip(original);
  const ws = palavras(original);
  const corta = (txt, i, n) => (txt.slice(0, i) + ' ' + txt.slice(i + n)).replace(/\s+/g, ' ').trim();

  // parcelas (Fase 3b): "fone 3x de 100" = 3 de 100 (total 300) · "tênis 300 em 3x", "em 3 vezes", "parcelado em 3x" = 300 no total
  let parcelas = null, valor = v.centavos;
  const pDe = original.slice(0, v.inicio).match(/(?<![\p{L}\d])(\d{1,2})\s*x\s+de\s+$/iu);
  if (pDe) {
    parcelas = +pDe[1];
    valor = v.centavos * parcelas;
    const m = resto.match(/(?<![\p{L}\d])\d{1,2}\s*x\s+de(?![\p{L}])/iu);
    if (m) resto = corta(resto, m.index, m[0].length);
  } else {
    const m = resto.match(/(?<![\p{L}\d])(?:parcelad[oa]\s+)?(?:em\s+)?(\d{1,2})\s*(?:x|vezes|parcelas)(?![\p{L}\d])/iu);
    if (m) { parcelas = +m[1]; resto = corta(resto, m.index, m[0].length); }
  }
  resto = resto.replace(/(?<![\p{L}])parcelad[oa](?![\p{L}])/iu, ' ').replace(/\s+/g, ' ').trim();
  if (!(parcelas >= 2 && parcelas <= 48)) parcelas = null; // "1x" é à vista

  // cartão pelo nome (Fase 3b): "no nubank", "no cartão do inter", ou o nome no fim da frase → crédito nesse cartão
  let forma = null, formaTrecho = null, cartao = null;
  for (const c of cartoes) {
    const nome = strip(c.nome).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const lr = strip(resto);
    const m = lr.match(new RegExp(`(?<![a-z0-9])((?:no|na|pelo|pela|com\\s+o|com\\s+a)\\s+)?(cartao\\s+(?:do|da|de)\\s+)?${nome}(?![a-z0-9])`));
    if (!m || (!m[1] && !m[2] && m.index + m[0].length < lr.length)) continue; // sem "no"/"cartão do", só vale no fim
    cartao = c.id; forma = 'credito'; formaTrecho = resto.slice(m.index, m.index + m[0].length);
    resto = corta(resto, m.index, m[0].length);
    break;
  }

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
  for (const [f, re] of (forma ? [] : FORMA_RE)) {
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
    if (acharForma(w) || NAO_LUGAR.has(strip(w)) || findPessoas(w, pessoas).length) continue;
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
    valor, parcelas, cartao,
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

/* ---------- verbos que você ensinou ---------- */

// Registros da memória com chave 'verbo:<palavra>' (campo 'tipo'): só entram depois do seu /sim.
//   { kind: 'memoria', text: 'abasteci', data: { chave: 'verbo:abasteci', campo: 'tipo', acao: 'fixar', valor: 'gasto' } }
// O mais novo vale; 'desafixar' ou 'limpar' tira. → { gasto: ['abasteci'], entrada: [] }
export function verbosAprendidos(records = []) {
  const atual = new Map();
  for (const r of records.filter(e => e.kind === 'memoria' && String(e.data?.chave || '').startsWith('verbo:')).sort((a, b) => a.ts - b.ts)) {
    const w = r.data.chave.slice(6);
    if (r.data.acao === 'fixar' && TIPOS_FINANCAS.includes(r.data.valor)) atual.set(w, r.data.valor);
    else atual.delete(w);
  }
  const out = { gasto: [], entrada: [] };
  for (const [w, t] of atual) out[t].push(w);
  return out;
}

/* ---------- estorno ---------- */

// "estorno de 45 do ifood" → o gasto que ele devolve: o mais recente (até `dias` atrás) que tem a mesma palavra
// (lugar ou descrição); valor igual tem preferência. Não achou → null.
const NAO_PISTA = new Set('estorno estornaram estornou estornado reembolso reembolsaram reembolsou devolucao cashback de do da dos das no na o a os as em pro pra com reais real'.split(' '));
export function acharEstornado(texto, valor, entries = [], { now = new Date(), dias = 60 } = {}) {
  const ws = palavras(texto).filter(w => w.length >= 3 && !/^\d+$/.test(w) && !NAO_PISTA.has(w));
  if (!ws.length) return null;
  const desde = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - dias));
  const cands = entries.filter(e => e.kind === 'gasto' && (e.data?.data || e.day || '') >= desde &&
    ws.some(w => palavras(`${e.data?.lugar || ''} ${e.data?.descricao || ''} ${e.text || ''}`).includes(w)));
  if (!cands.length) return null;
  const recente = (a, b) => (b.data?.data || b.day || '').localeCompare(a.data?.data || a.day || '') || (b.ts || 0) - (a.ts || 0);
  return cands.filter(e => e.data?.valor === valor).sort(recente)[0] || cands.sort(recente)[0];
}

// "abasteci 200 no posto" → 'abasteci': a primeira palavra parece verbo no passado (…ei, …i, …ou) e o app não conhece.
// É o que o app oferece aprender depois do seu /sim. Nunca aprende sozinho.
export function verboCandidato(texto) {
  const w = palavras(texto)[0];
  if (!w || w.length < 4 || !/(?:ei|i|ou)$/.test(w)) return null;
  if (PALAVRAS_DE_DINHEIRO.includes(w) || tipoDaPalavra(w)) return null;
  return w;
}

/* ---------- o mês ---------- */

// 'AAAA-MM' do lançamento (a data do gasto, não a de quando você escreveu)
export const mesDe = e => String(e?.data?.data || e?.day || '').slice(0, 7);
// '2026-10' → '2026-09'
export function mesAnterior(mes) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
// '2026-10' → 'out/2026' (sem o ano se for o ano de `now`: 'out')
export function fmtMes(mes, now = null) {
  const [y, m] = mes.split('-').map(Number);
  return MESES_CURTOS[m - 1] + (now && now.getFullYear() === y ? '' : '/' + y);
}

// Saldo do mês (decisão do Vini): entradas − (o que sai à vista no mês + as faturas que VENCEM no mês). Não é o saldo do banco.
//   à vista = pix, débito, dinheiro, boleto e sem forma, no mês da compra
//   faturas = cada parcela de cada compra no crédito, na fatura do seu cartão (Fase 3b: parcelasNoMes)
//   sem cartão cadastrado (ou crédito sem cartão que se ache): conta no mês da compra, como na 3a (provisorio)
// Transferência fica fora.  opts.cartoes = cartoesDe(records, { todos: true }) (os arquivados também: os gastos deles continuam)
//   → { mes, entradas, gastos, aVista, saldo, porCategoria: [[cat, centavos]], entradasPorCategoria, faturas: [{ cartao, nome, total, vence, itens }],
//       credito (provisório), provisorio, semForma, semCategoria, transferencias: { para, de }, n: { gastos, entradas, transferencias } }
export function resumoMes(entries = [], mes, { cartoes = [] } = {}) {
  const doMes = entries.filter(e => mesDe(e) === mes);
  const de = k => doMes.filter(e => e.kind === k);
  const val = e => (Number.isInteger(e.data?.valor) ? e.data.valor : 0);
  const soma = l => l.reduce((s, e) => s + val(e), 0);
  const gastos = de('gasto'), entradas = de('entrada'), transf = de('transferencia');
  // crédito com cartão vai pra fatura; o resto sai no mês da compra
  const naFatura = e => e.data?.forma === 'credito' && !!cartaoDoGasto(e, cartoes);
  const aVista = gastos.filter(e => !naFatura(e));
  const parc = parcelasNoMes(entries, mes, cartoes);
  const porCat = itens => [...itens.reduce((m, [c, v]) => m.set(c || 'sem categoria', (m.get(c || 'sem categoria') || 0) + v), new Map())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const faturas = new Map();
  for (const p of parc) {
    const f = faturas.get(p.cartao.id) || { cartao: p.cartao.id, nome: p.cartao.nome, total: 0, vence: p.vence, itens: 0 };
    f.total += p.valor; f.itens++;
    faturas.set(p.cartao.id, f);
  }
  const totalFaturas = parc.reduce((s, p) => s + p.valor, 0);
  const credito = soma(aVista.filter(e => e.data?.forma === 'credito'));
  return {
    mes,
    entradas: soma(entradas), aVista: soma(aVista), gastos: soma(aVista) + totalFaturas, saldo: soma(entradas) - soma(aVista) - totalFaturas,
    porCategoria: porCat([...aVista.map(e => [e.data?.categoria, val(e)]), ...parc.map(p => [p.e.data?.categoria, p.valor])]),
    entradasPorCategoria: porCat(entradas.map(e => [e.data?.categoria, val(e)])),
    faturas: [...faturas.values()].sort((a, b) => a.vence.localeCompare(b.vence)),
    credito, provisorio: credito > 0,
    semForma: aVista.filter(e => !e.data?.forma).length,
    semCategoria: [...aVista, ...parc.map(p => p.e), ...entradas].filter(e => !e.data?.categoria).length,
    transferencias: { para: soma(transf.filter(e => e.data?.sentido !== 'de')), de: soma(transf.filter(e => e.data?.sentido === 'de')) },
    n: { gastos: aVista.length + parc.length, entradas: entradas.length, transferencias: transf.length },
  };
}
// quanto mudou em %: (atual − anterior) / anterior · sem base (anterior 0) → null
export const variacao = (atual, anterior) => (anterior ? Math.round(((atual - anterior) / anterior) * 100) : null);
// barra de texto: 0.4 → '████░░░░░░'
export const barra = (frac, largura = 10) => { const n = Math.max(0, Math.min(largura, Math.round(frac * largura))); return '█'.repeat(n) + '░'.repeat(largura - n); };

// lançamentos de um mês (e de uma categoria), do mais antigo pro mais novo
export function lancamentos(entries = [], { mes = null, kind = 'gasto', categoria = null } = {}) {
  return entries.filter(e => e.kind === kind && (!mes || mesDe(e) === mes) && (!categoria || (e.data?.categoria || 'sem categoria') === categoria))
    .sort((a, b) => String(a.data?.data || a.day).localeCompare(String(b.data?.data || b.day)) || a.ts - b.ts);
}

/* ---------- semente das categorias ---------- */

// As categorias padrão que ainda faltam virar registro (id fixo: dois aparelhos criam o mesmo, sem duplicar).
// Só semeia um tipo que ainda não tem nenhum registro (igual aos projetos).
export function seedCategorias(records = [], owner = 'local', now = new Date(), seedId = s => s) {
  const out = [];
  const day = dayKey(now), ts = now.getTime();
  for (const tipo of TIPOS_FINANCAS) {
    if (records.some(e => e.kind === 'categoria' && (e.data?.tipo || 'gasto') === tipo)) continue;
    CATEGORIAS_PADRAO[tipo].forEach((nome, i) => out.push({
      id: seedId(`${owner}:categoria:${tipo}:${nome}`), kind: 'categoria', text: nome, tags: [], ts: ts + 20 + out.length, day,
      data: { tipo, ordem: i + 1, arquivada: false },
    }));
  }
  return out;
}

/* ---------- HUD e contexto ---------- */

// O que o painel da direita mostra (poucas linhas): saldo, gastos, comparação com o mês passado e as 3 categorias que mais pesaram.
// vazio = nada lançado no mês (o painel mostra NA, mas não some)
export function hudFinancas(entries = [], now = new Date(), opts = {}) {
  const mes = dayKey(now).slice(0, 7), ant = mesAnterior(mes);
  const r = resumoMes(entries, mes, opts), a = resumoMes(entries, ant, opts);
  return { mes, mesAnterior: ant, saldo: r.saldo, gastos: r.gastos, entradas: r.entradas, vs: variacao(r.gastos, a.gastos), top: r.porCategoria.slice(0, 3), vazio: !r.n.gastos && !r.n.entradas };
}

// Uma linha pro montarContexto (a IA lê na Fase 6): totais e categorias do mês, nunca cada lançamento.
//   "finanças out: entradas R$ 3.200,00 · gastos R$ 162,00 (3) · vs set +12% · saldo R$ 3.038,00 · top: alimentação R$ 75,00, mercado R$ 87,00"
export function linhaContexto(entries = [], now = new Date(), opts = {}) {
  const h = hudFinancas(entries, now, opts);
  if (h.vazio) {
    // mês sem lançamento: ainda vale contar os saldos, se você já disse quanto tem
    const sd = opts.records ? resumoSaldos(entries, opts.records, now) : {};
    const s = [sd.conta != null ? `conta ${fmtValor(sd.conta)}` : '', sd.investido != null ? `investido ${fmtValor(sd.investido)}` : '', sd.devo ? `cartões deve ${fmtValor(sd.devo)}` : ''].filter(Boolean);
    return s.length ? `finanças ${fmtMes(h.mes, now)}: saldos: ${s.join(' · ')}` : null;
  }
  const n = resumoMes(entries, h.mes, opts).n.gastos;
  const top = h.top.map(([c, v]) => `${c} ${fmtValor(v)}`).join(', ');
  // a próxima fatura de cada cartão (Fase 3b): "fatura nubank R$ 420,00 vence 10.11"
  const fat = proximasFaturas(entries, opts.cartoes || [], now).map(f => `fatura ${f.nome} ${fmtValor(f.total)} vence ${f.vence.slice(8, 10)}.${f.vence.slice(5, 7)}`).join(', ');
  // recorrentes (Fase 3c): o fixo por mês e as contas variáveis que ainda faltam lançar
  const recs = (opts.recorrentes || []).filter(r => r.status === 'ativa' && r.tipo === 'gasto' && r.valor);
  const lem = lembretesVariaveis(opts.recorrentes || [], entries, now).map(l => l.rec.nome);
  const rec = (recs.length ? ` · recorrentes ${fmtValor(recs.reduce((s, r) => s + r.valor, 0))}/mês (${recs.length})` : '') + (lem.length ? ` · lembrete: ${lem.join(', ')}` : '');
  // os três saldos (Fase 3d), só os que existem
  const sd = opts.records ? resumoSaldos(entries, opts.records, now) : {};
  const saldos = [sd.conta != null ? `conta ${fmtValor(sd.conta)}` : '', sd.investido != null ? `investido ${fmtValor(sd.investido)}` : '', sd.devo ? `cartões deve ${fmtValor(sd.devo)}` : ''].filter(Boolean);
  const rec2 = rec + (saldos.length ? ` · saldos: ${saldos.join(' · ')}` : '');
  return `finanças ${fmtMes(h.mes, now)}: entradas ${fmtValor(h.entradas)} · gastos ${fmtValor(h.gastos)} (${n})` +
    `${h.vs === null ? '' : ` · vs ${fmtMes(h.mesAnterior, now)} ${h.vs > 0 ? '+' : ''}${h.vs}%`} · saldo ${fmtValor(h.saldo)}${top ? ` · top: ${top}` : ''}${fat ? ` · ${fat}` : ''}${rec2}`;
}

/* ---------- cartões, fatura e parcelas (Fase 3b) ---------- */

// Cartões = registros escondidos: { kind: 'cartao', text: 'nubank', data: { fechamento: 3, vencimento: 10, padrao, arquivado } }
// → [{ id, nome, fechamento, vencimento, padrao }] (os ativos, na ordem em que foram criados)
// (todos: true inclui os arquivados, com arquivado: true · as contas da fatura usam assim, porque os gastos deles continuam)
export function cartoesDe(records = [], { todos = false } = {}) {
  const dia = v => Math.min(31, Math.max(1, Math.round(Number(v)) || 1));
  return records.filter(e => e.kind === 'cartao' && (todos || !e.data?.arquivado)).sort((a, b) => a.ts - b.ts)
    .map(e => ({ id: e.id, nome: String(e.text).toLowerCase(), fechamento: dia(e.data?.fechamento), vencimento: dia(e.data?.vencimento ?? 10), padrao: !!e.data?.padrao, arquivado: !!e.data?.arquivado, limite: Number.isInteger(e.data?.limite) && e.data.limite > 0 ? e.data.limite : null }));
}
// o padrão: o marcado (se dois aparelhos marcaram, o mais novo) · senão o primeiro · sem cartão: null (arquivado nunca é padrão)
export const cartaoPadrao = cartoes => { const at = cartoes.filter(c => !c.arquivado); return at.filter(c => c.padrao).pop() || at[0] || null; };
// o cartão de um gasto no crédito: o gravado · senão o padrão (decisão do plano: o padrão vale na hora de ler)
export const cartaoDoGasto = (e, cartoes) => cartoes.find(c => c.id === e.data?.cartao) || cartaoPadrao(cartoes);

// As parcelas que caem nas faturas que VENCEM no mês: [{ e, cartao, k (0..n-1), n, valor, vence, fecha }]
export function parcelasNoMes(entries = [], mes, cartoes = []) {
  const out = [];
  if (!cartoes.length) return out;
  for (const e of entries) {
    if (e.kind !== 'gasto' || e.data?.forma !== 'credito') continue;
    const c = cartaoDoGasto(e, cartoes);
    const data = e.data?.data || e.day;
    if (!c || !data) continue;
    const n = e.data?.parcelas >= 2 ? e.data.parcelas : 1;
    for (let k = 0; k < n; k++) {
      const f = faturaDaCompra(data, c, k);
      if (f.mes > mes) break;
      if (f.mes === mes) { out.push({ e, cartao: c, k, n, valor: parcelasDe(e.data?.valor || 0, n)[k], vence: f.vence, fecha: f.fecha }); break; }
    }
  }
  return out;
}

// "tênis 300 em 3x" → [10000, 10000, 10000] · 10000 em 3x → [3334, 3333, 3333] (a sobra dos centavos vai na primeira)
export function parcelasDe(total, n = 1) {
  const q = Math.max(1, Math.floor(n) || 1), base = Math.floor(total / q);
  return Array.from({ length: q }, (_, i) => (i === 0 ? total - base * (q - 1) : base));
}

const diasNoMes = (y, m) => new Date(y, m, 0).getDate(); // m de 1 a 12
const diaDe = (y, m, d) => `${y}-${pad(m)}-${pad(Math.min(d, diasNoMes(y, m)))}`; // dia 31 em fevereiro → 28/29
const somaMes = (y, m, k) => { const d = new Date(y, m - 1 + k, 1); return [d.getFullYear(), d.getMonth() + 1]; };

// As datas da fatura que FECHA no mês (fy, fm) de um cartão
function datasFatura(cartao, fy, fm) {
  const fecha = diaDe(fy, fm, cartao.fechamento);
  // vence depois do fechamento → no mesmo mês · vence antes (fecha 28, vence 5) → no mês seguinte
  const [vy, vm] = cartao.vencimento > cartao.fechamento ? [fy, fm] : somaMes(fy, fm, 1);
  const vence = diaDe(vy, vm, cartao.vencimento);
  const [py, pm] = somaMes(fy, fm, -1);
  return { fecha, vence, mes: vence.slice(0, 7), de: diaDe(py, pm, cartao.fechamento) };
}

// Em que fatura cai uma compra (ou a parcela k, contando do 0): { fecha, vence, mes (o do vencimento), de }
// Compra ANTES do fechamento → a fatura que fecha neste mês · NO DIA do fechamento ou depois → a do mês seguinte
export function faturaDaCompra(dataCompra, cartao, k = 0) {
  const [y, m, d] = dataCompra.split('-').map(Number);
  const [fy, fm] = d < Math.min(cartao.fechamento, diasNoMes(y, m)) ? [y, m] : somaMes(y, m, 1);
  return datasFatura(cartao, ...somaMes(fy, fm, k));
}
export const mesDaFatura = (dataCompra, cartao, k = 0) => faturaDaCompra(dataCompra, cartao, k).mes;

// As datas da fatura de um cartão que VENCE no mês 'AAAA-MM'
export function vencimentoDa(cartao, mes) {
  const [y, m] = mes.split('-').map(Number);
  return datasFatura(cartao, ...(cartao.vencimento > cartao.fechamento ? [y, m] : somaMes(y, m, -1)));
}

// A próxima fatura de cada cartão ativo, com o total: [{ cartao, nome, mes, vence, total }] (sem os de total zero)
export function proximasFaturas(entries = [], cartoesTodos = [], now = new Date()) {
  return cartoesTodos.filter(c => !c.arquivado).map(c => {
    const mes = proximaFatura(c, now);
    const total = parcelasNoMes(entries, mes, cartoesTodos).filter(p => p.cartao.id === c.id).reduce((s, p) => s + p.valor, 0);
    return { cartao: c.id, nome: c.nome, mes, vence: vencimentoDa(c, mes).vence, total };
  }).filter(f => f.total > 0).sort((a, b) => a.vence.localeCompare(b.vence));
}

// A próxima fatura a pagar: a que vence este mês, se ainda não venceu; senão a do mês que vem → 'AAAA-MM'
export function proximaFatura(cartao, now = new Date()) {
  const hoje = dayKey(now), mes = hoje.slice(0, 7);
  if (vencimentoDa(cartao, mes).vence >= hoje) return mes;
  const [y, m] = somaMes(...mes.split('-').map(Number), 1);
  return `${y}-${pad(m)}`;
}

/* ---------- recorrentes (Fase 3c) ---------- */

// "todo mês", "todos os meses", "todo dia 10", "por mês", "mensal", "mensalmente", "a cada mês"
// ("mensalidade" e "assinatura" NÃO: "paguei a mensalidade 890" é um pagamento só)
const RECORRENCIA = /(?<![a-z])(?:todos?\s+(?:os\s+)?mes(?:es)?|todo\s+dia\s+\d{1,2}|por\s+mes|mensal(?:mente)?|a\s+cada\s+mes)(?![a-z])/;
// "netflix 55,90 todo mês dia 15" → { dia: 15, resto: 'netflix 55,90' } · sem recorrência → null
// "pagar a luz todo mês dia 10" → { dia: 10, resto: 'luz' } (pagar/receber no começo saem: é a conta, não uma tarefa)
export function lerRecorrencia(texto, now = new Date()) {
  const t = String(texto ?? '').normalize('NFC').trim();
  const low = strip(t);
  if (!RECORRENCIA.test(low)) return null;
  const dm = low.match(/(?<![a-z])(?:todo\s+)?dia\s+(\d{1,2})(?!\d)/);
  const dia = dm ? Math.min(31, Math.max(1, +dm[1])) : now.getDate();
  let resto = t;
  for (const re of [/(?<![\p{L}])(?:todos?\s+(?:os\s+)?m[eê]s(?:es)?|todo\s+dia\s+\d{1,2}|por\s+m[eê]s|mensal(?:mente)?|a\s+cada\s+m[eê]s)(?![\p{L}])/iu,
    /(?<![\p{L}])dia\s+\d{1,2}(?!\d)/iu]) resto = resto.replace(re, ' ');
  resto = resto.replace(/^\s*(?:pagar|pago|paga|receber|recebo|recebe)\s+/iu, '').replace(/\s+/g, ' ').trim();
  return { dia, resto };
}
// o nome de uma conta variável ("a conta de luz" → "luz"): sem artigos e sem "conta de"
export const nomeConta = resto => String(resto).replace(/^(?:(?:a|o|as|os|uma?|minha|meu)\s+)+/i, '').replace(/^conta\s+(?:de|da|do)\s+/i, '').replace(/\s+(?:de|do|da|no|na)$/i, '').trim();

// Registros escondidos: { kind: 'recorrente', text: 'netflix', data: { tipo, valor (null = variável), dia, categoria, forma, cartao,
//   desde: 'AAAA-MM', status: 'ativa' | 'pausada' | 'cancelada', pulados: ['AAAA-MM'] } }
// → [{ id, nome, tipo, valor, dia, categoria, forma, cartao, desde, status, pulados }] (sem as canceladas, a não ser com todas: true)
export function recorrentesDe(records = [], { todas = false } = {}) {
  return records.filter(e => e.kind === 'recorrente' && (todas || e.data?.status !== 'cancelada')).sort((a, b) => a.ts - b.ts).map(e => ({
    id: e.id, nome: String(e.text), tipo: e.data?.tipo === 'entrada' ? 'entrada' : 'gasto',
    valor: Number.isInteger(e.data?.valor) && e.data.valor > 0 ? e.data.valor : null,
    dia: Math.min(31, Math.max(1, Math.round(Number(e.data?.dia)) || 1)),
    categoria: e.data?.categoria || null, forma: e.data?.forma || null, cartao: e.data?.cartao || null,
    desde: /^\d{4}-\d{2}$/.test(e.data?.desde || '') ? e.data.desde : dayKey(new Date(e.ts || 0)).slice(0, 7),
    status: ['pausada', 'cancelada'].includes(e.data?.status) ? e.data.status : 'ativa',
    pulados: Array.isArray(e.data?.pulados) ? e.data.pulados : [],
  }));
}

const proximoMes = mes => { const [y, m] = somaMes(...mes.split('-').map(Number), 1); return `${y}-${pad(m)}`; };
// a data do lançamento num mês: dia 31 em fevereiro → 28
export const dataNoMes = (mes, dia) => diaDe(+mes.slice(0, 4), +mes.slice(5, 7), dia);
// o primeiro mês de uma recorrente nova: se o dia ainda não passou (ou é hoje), este mês · senão o que vem
export function desdeInicial(dia, now = new Date()) {
  const hoje = dayKey(now), mes = hoje.slice(0, 7);
  return dataNoMes(mes, dia) >= hoje ? mes : proximoMes(mes);
}
// a chave do lançamento: a MESMA em qualquer aparelho (o app transforma em id com seedId)
export const chaveLancamento = (owner, recId, mes) => `${owner}:recorrente:${recId}:${mes}`;

// O que falta lançar: [{ rec, mes, data, id }] · só ativas com valor, de `desde` (no máximo `maxMeses` pra trás) até hoje,
// no mês atual só se o dia já chegou, sem os meses pulados e sem o que já existe (mesmo id)
export function pendentesRecorrentes(recs = [], entries = [], now = new Date(), { owner = 'local', seedId = s => s, maxMeses = 12 } = {}) {
  const hoje = dayKey(now), mesHoje = hoje.slice(0, 7);
  const [y, m] = somaMes(+mesHoje.slice(0, 4), +mesHoje.slice(5, 7), -(maxMeses - 1));
  const limite = `${y}-${pad(m)}`;
  const existe = new Set(entries.map(e => e.id));
  const out = [];
  for (const r of recs) {
    if (r.status !== 'ativa' || r.valor === null) continue;
    for (let mes = r.desde > limite ? r.desde : limite; mes <= mesHoje; mes = proximoMes(mes)) {
      const data = dataNoMes(mes, r.dia);
      if (data > hoje) break;
      if (r.pulados.includes(mes)) continue;
      const id = seedId(chaveLancamento(owner, r.id, mes));
      if (!existe.has(id)) out.push({ rec: r, mes, data, id });
    }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

// O gasto/entrada de um pendente (é um lançamento normal: entra no saldo, nas faturas e nas listas)
export function lancamentoRecorrente({ rec, data, id }, now = new Date()) {
  const d = { valor: rec.valor, descricao: rec.nome, data, recorrente: rec.id, auto: { campos: [], fonte: 'recorrente' } };
  if (rec.categoria) d.categoria = rec.categoria;
  if (rec.forma) d.forma = rec.forma;
  if (rec.cartao) d.cartao = rec.cartao;
  return { id, kind: rec.tipo, text: `${rec.nome} (recorrente)`, tags: [], ts: now.getTime(), day: dayKey(now), data: d };
}

// um lançamento do mês é desta recorrente? (ligado pelo id, ou pelo nome: "paguei 120 de luz" é a luz)
export function eDaRecorrente(e, rec) {
  if (e.kind !== rec.tipo) return false;
  if (e.data?.recorrente) return e.data.recorrente === rec.id;
  const nome = palavras(rec.nome).filter(w => w.length >= 3);
  const ws = palavras(e.text);
  return nome.length > 0 && nome.every(w => ws.includes(w));
}

// Contas variáveis (sem valor) ativas que ainda não foram lançadas este mês: [{ rec, vence }]
export function lembretesVariaveis(recs = [], entries = [], now = new Date()) {
  const mes = dayKey(now).slice(0, 7);
  const doMes = entries.filter(e => mesDe(e) === mes);
  return recs.filter(r => r.status === 'ativa' && r.valor === null && r.desde <= mes && !doMes.some(e => eDaRecorrente(e, r)))
    .map(rec => ({ rec, vence: dataNoMes(mes, rec.dia) })).sort((a, b) => a.vence.localeCompare(b.vence));
}

/* ---------- os três saldos (Fase 3d) ---------- */

// "Poupança", "poupanca", "a poupança" → 'poupanca' (a chave do lugar) · 'conta' é a conta corrente
export const chaveLugar = nome => strip(nome).replace(/^(?:a|o|minha|meu)\s+/, '').replace(/\s+/g, ' ').trim();

// Âncoras = "eu tenho X aqui": registros kind 'saldo' (só crescem, o mais novo de cada lugar vale)
//   { kind: 'saldo', text: 'poupança', data: { onde: 'poupanca' | 'conta', valor, data: 'AAAA-MM-DD' } }
// → Map(onde → { id, nome, valor, data, ts })
export function ancorasDe(records = []) {
  const out = new Map();
  for (const r of records.filter(e => e.kind === 'saldo' && Number.isInteger(e.data?.valor)).sort((a, b) => a.ts - b.ts)) {
    const onde = chaveLugar(r.data.onde || r.text);
    out.set(onde, { id: r.id, nome: String(r.text), valor: r.data.valor, data: r.data.data || dayKey(new Date(r.ts)), ts: r.ts });
  }
  return out;
}

// "paguei a fatura do nubank": registros kind 'faturapaga' { data: { cartao, mes (o do vencimento), valor?, data } } → Map('cartao|mes' → data do pagamento)
// (v0.14: valor = o que saiu da conta, quando você escreveu; sem cartão nem /credito, cartao e mes ficam vazios)
export function faturasPagas(records = []) {
  const out = new Map();
  for (const r of records.filter(e => e.kind === 'faturapaga' && e.data?.cartao && e.data?.mes)) {
    const k = r.data.cartao + '|' + r.data.mes, d = r.data.data || dayKey(new Date(r.ts));
    if (!out.has(k) || d < out.get(k)) out.set(k, d);
  }
  return out;
}
// todos os pagamentos de fatura: [{ cartao, mes, valor (centavos | null), data, ts }]
export function pagamentosFatura(records = []) {
  return records.filter(e => e.kind === 'faturapaga').sort((a, b) => a.ts - b.ts).map(r => ({
    cartao: r.data?.cartao || null, mes: r.data?.mes || null, valor: Number.isInteger(r.data?.valor) && r.data.valor > 0 ? r.data.valor : null,
    data: r.data?.data || dayKey(new Date(r.ts)), ts: r.ts,
  }));
}
// quando uma fatura é paga: no dia em que você disse que pagou (antes ou depois do vencimento: o Vini paga no 5º dia útil),
// ou sozinha no vencimento se você não disse nada
const pagaEm = (pagas, cartao, mes, vence) => pagas.get(cartao.id + '|' + mes) || vence;

// compra parcelada no boleto (carnê, v0.14): cada parcela vence um mês depois da outra, a partir da data da compra
//   → [{ valor, data }] · não parcelada → null
const somaMesData = (data, k) => { const [y, m, d] = data.split('-').map(Number); return diaDe(...somaMes(y, m, k), d); };
export function parcelasBoleto(e) {
  if (e?.kind !== 'gasto' || e.data?.forma !== 'boleto' || !(e.data?.parcelas >= 2)) return null;
  const data = e.data?.data || e.day, vals = parcelasDe(e.data?.valor || 0, e.data.parcelas);
  return vals.map((valor, k) => ({ valor, data: somaMesData(data, k) }));
}

// 1. Conta: âncora + o que foi registrado DEPOIS dela (pela hora em que você escreveu) − faturas pagas depois da data da âncora.
//    entradas + · gastos à vista − (crédito vai pra fatura) · guardar em investimento − · resgatar + · rendimento não mexe
//    boleto parcelado: cada parcela sai no dia dela · fatura paga com valor ("paguei a fatura 1.680"): sai o valor que você disse
//    → { valor, ancora } | null (sem âncora)
export function saldoConta(entries = [], records = [], now = new Date(), cartoes = ciclosCredito(records)) {
  const a = ancorasDe(records).get('conta');
  if (!a) return null;
  const hoje = dayKey(now);
  let v = a.valor;
  for (const e of entries) {
    if (!Number.isInteger(e.data?.valor)) continue;
    const boleto = parcelasBoleto(e);
    if (boleto) {
      // a 1ª parcela conta como as outras compras (registrada depois da âncora); as seguintes, quando vencem
      boleto.forEach((p, k) => { if (p.data <= hoje && (k === 0 ? e.ts >= a.ts : p.data > a.data)) v -= p.valor; });
      continue;
    }
    if (!(e.ts >= a.ts)) continue;
    if (e.kind === 'entrada') v += e.data.valor;
    else if (e.kind === 'gasto' && !(e.data?.forma === 'credito' && cartaoDoGasto(e, cartoes))) v -= e.data.valor;
    else if (e.kind === 'transferencia') v += e.data?.sentido === 'de' ? e.data.valor : -e.data.valor;
  }
  // faturas: as que foram pagas entre a âncora (exclusive) e hoje (inclusive as de meses futuros pagas adiantado)
  const pagas = faturasPagas(records), pags = pagamentosFatura(records);
  const [ay, am] = a.data.split('-').map(Number);
  const [hy, hm] = hoje.split('-').map(Number);
  const ate = dayKey(new Date(hy, hm + 2, 1)).slice(0, 7);
  for (let d = new Date(ay, am - 2, 1); dayKey(d).slice(0, 7) <= ate; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const mes = dayKey(d).slice(0, 7);
    for (const c of cartoes) {
      // com valor escrito ("paguei a fatura 1.680") sai o valor; sem, o total que o app calculou das compras
      const escrito = pags.find(x => x.cartao === c.id && x.mes === mes);
      const total = escrito?.valor || parcelasNoMes(entries, mes, cartoes).filter(p => p.cartao.id === c.id).reduce((s, p) => s + p.valor, 0);
      if (!total) continue;
      // você disse que pagou: conta se registrou depois da âncora (a mesma regra dos gastos) · senão, sai sozinha no vencimento
      if (escrito) { if (escrito.ts >= a.ts && escrito.data <= hoje) v -= total; }
      else { const vence = vencimentoDa(c, mes).vence; if (vence > a.data && vence <= hoje) v -= total; }
    }
  }
  // pagamento com valor sem ciclo conhecido (sem cartão nem /credito): sai da conta quando você registra
  for (const x of pags) if (x.valor && !cartoes.some(c => c.id === x.cartao && x.mes) && x.ts >= a.ts) v -= x.valor;
  return { valor: v, ancora: a };
}

// 2. Investimentos por lugar: âncora do lugar (se tiver) + guardei − resgatei + rendimentos registrados depois dela
//    → [{ lugar, nome, valor, ancora }] (do maior pro menor)
export function investimentosPorLugar(entries = [], records = []) {
  const ancoras = ancorasDe(records);
  const lugares = new Map();
  const nomeDe = new Map();
  for (const [k, a] of ancoras) if (k !== 'conta') { lugares.set(k, a); nomeDe.set(k, a.nome); }
  const movs = entries.filter(e => (e.kind === 'transferencia' && e.data?.conta) || (e.kind === 'rendimento' && e.data?.lugar));
  for (const e of movs) { const k = chaveLugar(e.data.conta || e.data.lugar); if (!nomeDe.has(k)) nomeDe.set(k, String(e.data.conta || e.data.lugar).toLowerCase()); if (!lugares.has(k)) lugares.set(k, null); }
  return [...lugares].map(([k, a]) => {
    let v = a ? a.valor : 0;
    for (const e of movs) {
      if (chaveLugar(e.data.conta || e.data.lugar) !== k || (a && !(e.ts >= a.ts)) || !Number.isInteger(e.data?.valor)) continue;
      v += e.kind === 'rendimento' ? e.data.valor : e.data.sentido === 'de' ? -e.data.valor : e.data.valor;
    }
    return { lugar: k, nome: nomeDe.get(k), valor: v, ancora: a };
  }).sort((x, y) => y.valor - x.valor);
}

// 3. Cartões: quanto ainda devo (toda parcela de fatura não paga: aberta, fechada antes do vencimento e as futuras) e o limite livre
//    → [{ cartao, nome, devo, limite, livre }] (livre null sem limite cadastrado)
export function devoNoCartao(entries = [], records = [], now = new Date(), cartoes = ciclosCredito(records)) {
  const hoje = dayKey(now), pagas = faturasPagas(records);
  const devo = new Map(cartoes.map(c => [c.id, 0]));
  for (const e of entries) {
    if (e.kind !== 'gasto' || e.data?.forma !== 'credito') continue;
    const c = cartaoDoGasto(e, cartoes), data = e.data?.data || e.day;
    if (!c || !data) continue;
    const n = e.data?.parcelas >= 2 ? e.data.parcelas : 1, vals = parcelasDe(e.data?.valor || 0, n);
    for (let k = 0; k < n; k++) {
      const f = faturaDaCompra(data, c, k);
      if (pagaEm(pagas, c, f.mes, f.vence) > hoje) devo.set(c.id, devo.get(c.id) + vals[k]);
    }
  }
  return cartoes.filter(c => !c.arquivado || devo.get(c.id)).map(c => ({
    cartao: c.id, nome: c.nome, devo: devo.get(c.id), limite: c.limite ?? null, livre: c.limite ? c.limite - devo.get(c.id) : null,
  }));
}

/* ---------- frases dos saldos (Fase 3d) ---------- */

// lugares de investimento que o app reconhece sozinho (os que você já tem saldo também valem: `extras`)
const INVEST = String.raw`poupanca|investimentos?|reserva(?:\s+de\s+emergencia)?|tesouro(?:\s+direto)?|cdb|lci|lca|corretora|caixinha|cofrinho|acoes|fundos?`;
// "na poupança", "no tesouro direto", "no cdb" → 'poupança' (como foi escrito, minúsculo) · senão null
export function lugarInvestimento(texto, extras = []) {
  const t = String(texto ?? '').normalize('NFC'), low = strip(t);
  const lista = [INVEST, ...extras.map(x => strip(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))].join('|');
  const m = low.match(new RegExp(String.raw`(?<![a-z])(?:na|no|em|da|do|nas|nos)\s+(?:a\s+|o\s+|minha\s+|meu\s+)?(?<lugar>${lista})(?![a-z])`));
  if (!m) return null;
  const fim = m.index + m[0].length;
  return t.slice(fim - m.groups.lugar.length, fim).toLowerCase();
}

// "tenho 2.500 na conta", "saldo 2.500", "saldo da conta 2.500", "tenho 5.000 na poupança" → { onde: 'conta' | lugar, valor } · senão null
// ("tenho que pagar 200" é tarefa; "tenho 2 provas" não tem lugar nem cara de dinheiro)
export function lerAjusteSaldo(texto, extras = []) {
  const t = String(texto ?? '').normalize('NFC').trim(), low = strip(t);
  const saldo = /^saldo(?![a-z])/.test(low), tenho = /^(?:eu\s+)?tenho\s+(?!que\b|de\b)/.test(low);
  if (!saldo && !tenho) return null;
  const v = findValor(t);
  if (!v) return null;
  const lugar = lugarInvestimento(t, extras);
  const naConta = /(?<![a-z])(?:na|em)\s+(?:minha\s+)?conta(?!\s+(?:da|do|de)\s)(?![a-z])|(?<![a-z])no\s+banco(?![a-z])/.test(low) || /^saldo(?:\s+da\s+conta)?(?![a-z])/.test(low);
  if (lugar) return { onde: lugar, valor: v.centavos };
  if (naConta || (tenho && v.explicito && !/(?<![a-z])(?:na|no|em)\s+\w/.test(strip(v.resto)))) return { onde: 'conta', valor: v.centavos };
  return null;
}

// "paguei a fatura", "paguei a fatura do nubank", "quitei o cartão", "fatura do inter paga" → true
// v0.14: "paguei cartão de crédito 1.680", "paguei o cartão 1.680", "fatura 1.680 paga" também (sem cartão cadastrado vale igual)
// · "paguei 1.680 no cartão" NÃO: o valor antes do "no cartão" é compra no crédito
export const ehPagamentoFatura = texto => /(?<![a-z])(?:(?:paguei|pago|quitei|acertei)\s+(?:a\s+|o\s+)?(?:fatura|cartao(?:\s+de\s+credito)?)(?![a-z])|fatura\s+(?:\S+\s+){0,3}(?:paga|quitada)(?![a-z]))/.test(strip(texto));

// "rendeu 32 na poupança", "rendimento de 12 no cdb", "a poupança rendeu 32" → { valor, lugar } · senão null
export function lerRendimento(texto, extras = []) {
  const t = String(texto ?? '').normalize('NFC').trim(), low = strip(t);
  if (!/(?<![a-z])(?:rendeu|renderam|rendimento|rendimentos|juros)(?![a-z])/.test(low)) return null;
  const v = findValor(t);
  if (!v) return null;
  // "a poupança rendeu 32": o lugar no começo, sem preposição
  const lugar = lugarInvestimento(t, extras) || (low.match(new RegExp(String.raw`^(?:a\s+|o\s+|minha\s+|meu\s+)?(${INVEST})(?![a-z])`)) ? lugarInvestimento('na ' + t.replace(/^(?:a|o|minha|meu)\s+/i, ''), extras) : null);
  return lugar ? { valor: v.centavos, lugar } : null;
}

// Os três saldos num objeto só (HUD, /overview, contexto): null = sem dado (a tela mostra NA)
//   → { conta, investido, devo, livre }
export function resumoSaldos(entries = [], records = [], now = new Date()) {
  const conta = saldoConta(entries, records, now);
  const inv = investimentosPorLugar(entries, records);
  const cards = devoNoCartao(entries, records, now);
  const livres = cards.filter(c => c.livre != null);
  return {
    conta: conta ? conta.valor : null,
    investido: inv.length ? inv.reduce((s, i) => s + i.valor, 0) : null,
    devo: cards.length ? cards.reduce((s, c) => s + c.devo, 0) : null,
    livre: livres.length ? livres.reduce((s, c) => s + c.livre, 0) : null,
    credito: resumoCredito(entries, records, now), // v0.14: o seu crédito (limite, usado, resta)
  };
}

/* ---------- crédito: um limite seu, pelo ciclo da fatura (v0.14) ---------- */

// Registro escondido kind 'credito' (só cresce, o mais novo vale): { kind: 'credito', text: 'crédito', data: { valor, fechamento, vencimento } }
// → { valor, fechamento, vencimento } | null
export function creditoDe(records = []) {
  const r = records.filter(e => e.kind === 'credito' && Number.isInteger(e.data?.valor)).sort((a, b) => a.ts - b.ts).pop();
  if (!r) return null;
  const dia = v => (v ? Math.min(31, Math.max(1, Math.round(Number(v)) || 1)) : null);
  return { valor: r.data.valor, fechamento: dia(r.data.fechamento), vencimento: dia(r.data.vencimento) };
}
export const CARTAO_CREDITO = 'credito'; // o id do "cartão" virtual (sem cartão cadastrado)

// Os ciclos de fatura que valem pras contas: os cartões cadastrados (os arquivados também, os gastos deles continuam)
// · sem cartão, um "cartão" virtual com o ciclo do /credito (fecha 29, vence 5) · sem nenhum dos dois: []
export function ciclosCredito(records = []) {
  const cards = cartoesDe(records, { todos: true });
  if (cards.length) return cards;
  const c = creditoDe(records);
  if (!c?.fechamento) return [];
  return [{ id: CARTAO_CREDITO, nome: 'crédito', fechamento: c.fechamento, vencimento: c.vencimento || c.fechamento, padrao: true, arquivado: false, limite: null }];
}

// Qual fatura um "paguei a fatura" paga: a última que já FECHOU, se o vencimento dela foi há pouco (você paga uns dias depois)
// e ainda não foi marcada paga · senão a que está aberta (pagar adiantado) → 'AAAA-MM' (o mês do vencimento)
const FOLGA_DIAS = 15;
export function faturaAPagar(cartao, records = [], now = new Date()) {
  const hoje = dayKey(now), pagas = faturasPagas(records);
  const limite = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - FOLGA_DIAS));
  const [y, m] = hoje.split('-').map(Number);
  const meses = [-1, 0, 1, 2].map(k => { const [yy, mm] = somaMes(y, m, k); return `${yy}-${pad(mm)}`; });
  const fechadas = meses.map(mes => ({ mes, ...vencimentoDa(cartao, mes) })).filter(f => f.fecha <= hoje && f.vence >= limite && !pagas.has(cartao.id + '|' + f.mes));
  if (fechadas.length) return fechadas[fechadas.length - 1].mes;
  return meses.find(mes => vencimentoDa(cartao, mes).fecha > hoje) || proximaFatura(cartao, now);
}

// O crédito do momento: quanto você se deu (/credito, ou a soma dos limites dos cartões) e quanto já está usado
//   usado = toda compra no crédito ainda não paga (fatura aberta, fechada que não venceu nem foi paga, parcelas futuras)
//           + parcelas do boleto parcelado que ainda não venceram · uma fatura paga devolve a parte dela
//   → { limite, usado, resta, frac, fonte: 'credito' | 'cartao' | null, ciclo: bool, proxima: { nome, vence, total } | null }
export function resumoCredito(entries = [], records = [], now = new Date()) {
  const c = creditoDe(records), ciclos = ciclosCredito(records), hoje = dayKey(now);
  const cards = devoNoCartao(entries, records, now, ciclos);
  const boleto = entries.reduce((s, e) => s + (parcelasBoleto(e) || []).filter(p => p.data > hoje).reduce((t, p) => t + p.valor, 0), 0);
  const usado = cards.reduce((s, x) => s + x.devo, 0) + boleto;
  const limCartoes = cartoesDe(records).reduce((s, k) => s + (k.limite || 0), 0);
  const limite = c ? c.valor : limCartoes || null;
  const prox = proximasFaturas(entries, ciclos, now)[0] || null;
  return {
    limite, usado, resta: limite == null ? null : limite - usado, frac: limite ? usado / limite : null,
    fonte: c ? 'credito' : limCartoes ? 'cartao' : null, ciclo: ciclos.length > 0,
    proxima: prox ? { nome: prox.nome, vence: prox.vence, total: prox.total } : null,
  };
}
