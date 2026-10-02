// Valores em reais → centavos inteiros (3000 = R$ 30,00). Funções puras, testadas em tests/.
// Centavos inteiros porque conta com vírgula no computador erra (0,1 + 0,2 ≠ 0,3).
//
//   parseValor('R$ 30,50') → 3050       (o texto inteiro é um valor)
//   findValor('gastei 30 no almoço') → { centavos: 3000, trecho: '30', resto: 'gastei no almoço', explicito: false }
//   fmtValor(123456) → 'R$ 1.234,56'
//
// Entende: 30 · 30,5 · 30,50 · 30.50 · 1.234 · 1.234,56 · R$30 · R$ 30,00 · 30 reais · 1 real · 50 conto/pila/pau
//          50 centavos · 2 mil · R$ 2 mil · 2 mil reais
// explicito = tem R$, reais, centavos ou gíria de dinheiro. Número solto (explicito: false) só vira gasto/entrada
// se o intérprete achar palavra de contexto (gastei, paguei, recebi…). Hora, km, cap 15, dia 15, 15/10 não são valor.

const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const MOEDA = String.raw`reais|real|contos?|pilas?|paus?|pratas?`;
const MESES = 'janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const ANTES = String.raw`(?<![\p{L}\d#/:.,$>@!])`;
const DEPOIS = String.raw`(?![\p{L}\d%º°ª/:]|[.,]\d)`;
// palavras antes do número que dizem "isto não é dinheiro"
const NAO_ANTES = String.raw`(?<!(?<![\p{L}\d])(?:dia|cap|capitulo|capítulo|pag|pág|pagina|página|as|às|n|nº|numero|número|versao|versão|v|item|questao|questão|exercicio|exercício|aula|semana|top)\s+)`;
// unidades depois do número que dizem "isto não é dinheiro"
const NAO_DEPOIS = String.raw`(?!\s*(?:h|hs|hrs?|horas?|min|mins|minutos?|seg|segundos?|km|kms|m|metros?|kg|kgs|quilos?|g|gramas?|l|litros?|x|vezes|series|séries|reps?|repeti\p{L}*|dias?|semanas?|mes|mês|meses|anos?|pessoas?|anos?|%|de\s+(?:${MESES}))(?![\p{L}\d]))`;

const RULES = [
  { explicito: true, re: String.raw`r\$\s*(?<n>${NUM})(?<mil>\s*mil)?` },
  { explicito: true, re: String.raw`(?<n>${NUM})(?<mil>\s*mil)?\s*(?:${MOEDA})` },
  { explicito: true, centavos: true, re: String.raw`(?<n>\d+)\s*centavos?` },
  { explicito: false, re: String.raw`${NAO_ANTES}(?<n>${NUM})(?<mil>\s*mil)?${NAO_DEPOIS}` },
].map(r => ({ ...r, re: new RegExp(ANTES + r.re + DEPOIS, 'giu') }));

// '1.234,56' → 123456 · '30.5' → 3050 · '1.234' → 123400 (ponto com 3 dígitos = milhar)
function toCents(s) {
  let int, dec = '';
  if (s.includes(',')) [int, dec] = [s.slice(0, s.lastIndexOf(',')), s.slice(s.lastIndexOf(',') + 1)];
  else if (/\.\d{1,2}$/.test(s)) [int, dec] = [s.slice(0, s.lastIndexOf('.')), s.slice(s.lastIndexOf('.') + 1)];
  else int = s;
  return Number(int.replace(/\./g, '') || 0) * 100 + Number(dec.padEnd(2, '0') || 0);
}

export function findValor(input) {
  const text = String(input ?? '').normalize('NFC');
  let best = null;
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      const inicio = m.index, fim = m.index + m[0].length;
      // explícito sempre ganha de número solto; entre iguais, vale o primeiro
      if (best && (best.explicito && !rule.explicito || (best.explicito === rule.explicito && inicio >= best.inicio))) continue;
      const n = m.groups.n;
      const centavos = rule.centavos ? Number(n) : toCents(n) * (m.groups.mil ? 1000 : 1);
      best = { centavos, explicito: rule.explicito, inicio, fim };
    }
  }
  if (!best) return null;
  const resto = (text.slice(0, best.inicio) + ' ' + text.slice(best.fim))
    .replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,.;:–-]+|[\s,;:–-]+$/g, '');
  return { centavos: best.centavos, trecho: text.slice(best.inicio, best.fim), resto, explicito: best.explicito, inicio: best.inicio, fim: best.fim };
}

// o texto inteiro é um valor? → centavos · senão null
export function parseValor(input) {
  const r = findValor(String(input ?? '').trim());
  return r && !r.resto ? r.centavos : null;
}

// 123456 → 'R$ 1.234,56' · -500 → '-R$ 5,00'
export function fmtValor(centavos) {
  if (centavos === null || centavos === undefined || !Number.isFinite(centavos)) return '';
  const abs = Math.abs(Math.round(centavos));
  const reais = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${centavos < 0 ? '-' : ''}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
}
