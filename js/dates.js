// Datas escritas do jeito que a gente fala → 'AAAA-MM-DD'.
// parseDue: o prazo de um marcador (>sex). findDate: a data dentro de uma frase. Funções puras, testadas em tests/.
//
//   hoje · amanhã · depois (de amanhã)
//   seg ter qua qui sex sáb dom      → o próximo (se for hoje, é hoje)
//   15 (próximo dia 15) · 15/10 (ano mais perto de hoje) · 15/10/26 · 15/10/2026 · 15.10
//   +3 (dias) · +3d · +2s (semanas) · +1m (meses)

import { dayKey, DOW, pad } from './util.js';

const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const DOW_KEYS = DOW.map(strip); // dom seg ter qua qui sex sab
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function parseDue(input, now = new Date()) {
  const s = strip(String(input).trim());
  if (!s) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (s === 'hoje') return dayKey(today);
  if (s === 'amanha') return dayKey(addDays(today, 1));
  if (s === 'depois') return dayKey(addDays(today, 2));

  const w = DOW_KEYS.indexOf(s.slice(0, 3));
  if (w >= 0 && /^[a-z]+$/.test(s)) return dayKey(addDays(today, (w - today.getDay() + 7) % 7));

  let m = s.match(/^\+(\d{1,3})([dsm]?)$/);
  if (m) {
    const n = +m[1];
    if (m[2] === 's') return dayKey(addDays(today, n * 7));
    if (m[2] === 'm') return clampDate(today.getFullYear(), today.getMonth() + n, today.getDate());
    return dayKey(addDays(today, n));
  }

  m = s.match(/^(\d{1,2})(?:[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?)?$/);
  if (m) {
    const d = +m[1];
    let mo = m[2] ? +m[2] - 1 : today.getMonth();
    let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : today.getFullYear();
    if (d < 1 || d > 31 || mo < 0 || mo > 11) return null;
    if (!m[3]) {
      if (m[2]) {
        // dd/mm sem ano → o ano que deixa a data mais perto de hoje
        // (28/09 escrito em 01/10 é "3 dias atrás", não "ano que vem"; 05/01 em setembro é janeiro que vem)
        const dist = yy => Math.abs(new Date(yy, mo, d) - today);
        y = [y - 1, y, y + 1].reduce((best, yy) => (dist(yy) < dist(best) ? yy : best), y);
      } else if (new Date(y, mo, d) < today) {
        mo++; // só o dia e já passou → mês que vem
      }
    }
    const date = new Date(y, mo, d);
    if (date.getDate() !== d) return null; // 31/02 não existe
    return dayKey(date);
  }
  return null;
}

function clampDate(y, mo, d) {
  const last = new Date(y, mo + 1, 0).getDate();
  return dayKey(new Date(y, mo, Math.min(d, last)));
}

// 'AAAA-MM-DD' → como mostrar: hoje · amanhã · sex 03.10 · atrasada 2d
export function fmtDue(key, now = new Date()) {
  if (!key) return '';
  const [y, mo, d] = key.split('-').map(Number);
  const date = new Date(y, mo - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((date - today) / 864e5);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff < 0) return `atrasada ${-diff}d`;
  if (diff < 7) return `${DOW[date.getDay()]} ${pad(d)}.${pad(mo)}`;
  return `${pad(d)}.${pad(mo)}${y !== today.getFullYear() ? '.' + String(y).slice(2) : ''}`;
}

/* ---------- datas dentro de frases (Fase 2: intérprete) ---------- */
//
// findDate('ligar pro dentista amanhã') → { data: '2026-10-02', trecho: 'amanhã', resto: 'ligar pro dentista', inicio, fim }
// Entende: hoje · amanhã · depois de amanhã · ontem · anteontem
//          sexta / sexta-feira / na sexta / até sexta · próxima sexta / sexta que vem (nunca hoje)
//          sexta da semana que vem / semana que vem na sexta · semana que vem (segunda) · mês que vem (dia 1)
//          fim de semana (sábado) · dia 15 · dia 15 de outubro · 15 de outubro · 15/10 (com ponto não: "nota 7.5") · daqui a 3 dias · em 2 semanas
// Número solto ("cap 15") nunca é data. "segunda", "quarta", "quinta" e "sexta" sozinhas só valem com
// preposição (na, até…), "-feira", "que vem" ou no fim da frase: "segunda versão do tcc" não é data.
// Achou mais de uma? Vale a que aparece primeiro. Nenhuma → null.

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
const SEMPRE = new Set(['terca', 'sabado', 'domingo']); // não têm outro sentido comum
const NUM = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, quinze: 15 };

const B = '(?<![a-z0-9>#@!/.,$-])'; // começo de palavra (e não é marcador >sex, #tag, link, número)
const E = String.raw`(?![a-z0-9]|[.,/]\d)`;  // fim de palavra
const PRE = String.raw`(?<pre>(?:ate|para|pra)\s+(?:a|o)\s+|(?:ate|para|pra|pro|na|no|em|nesta|neste|nessa|nesse|esta|este|essa|esse)\s+)?`;
const DIA = String.raw`(?<dia>${Object.keys(DIAS).join('|')})(?:[-\s]feira)?`;
const MES = String.raw`(?<mes>${MESES.join('|')})`;
const QTD = String.raw`(?<n>\d{1,3}|${Object.keys(NUM).join('|')})`;
const ATE_O_FIM = /^\s*(?:[#!@>]\S*\s*)*[.,;:!?…]*\s*$/; // depois só tem #tags, marcadores ou pontuação

// cada regra: o padrão e como calcular a data (null = não vale aqui)
const RULES = [
  { re: String.raw`${PRE}(?<w>depois\s+de\s+amanha|anteontem|amanha|hoje|ontem)`,
    calc: (g, t) => dayKey(addDays(t, { 'depois de amanha': 2, amanha: 1, hoje: 0, ontem: -1, anteontem: -2 }[g.w.replace(/\s+/g, ' ')])) },
  { re: String.raw`${PRE}(?<prox>proxim[oa]\s+)?${DIA}(?<qv>\s+que\s+vem)?(?<sv>\s+(?:da|na)\s+(?:semana\s+que\s+vem|proxima\s+semana))?`,
    calc: (g, t, m, after) => {
      const w = DIAS[g.dia];
      const feira = /feira$/.test(m);
      if (!SEMPRE.has(g.dia) && !g.pre && !g.prox && !feira && !g.qv && !g.sv && !ATE_O_FIM.test(after)) return null;
      if (g.sv) return dayKey(inNextWeek(t, w));
      const n = (w - t.getDay() + 7) % 7;
      return dayKey(addDays(t, n === 0 && (g.prox || g.qv) ? 7 : n));
    } },
  { re: String.raw`${PRE}(?:semana\s+que\s+vem|proxima\s+semana)(?:,?\s+(?:na\s+|no\s+)?${DIA})?`,
    calc: (g, t) => dayKey(inNextWeek(t, g.dia ? DIAS[g.dia] : 1)) },
  { re: String.raw`${PRE}(?:mes\s+que\s+vem|proximo\s+mes)`,
    calc: (g, t) => dayKey(new Date(t.getFullYear(), t.getMonth() + 1, 1)) },
  { re: String.raw`${PRE}(?:(?:fim|final)\s+de\s+semana|fds)(?<qv>\s+que\s+vem)?`,
    calc: (g, t) => dayKey(g.qv ? inNextWeek(t, 6) : t.getDay() === 0 ? t : addDays(t, 6 - t.getDay())) },
  { re: String.raw`${PRE}(?:daqui\s+(?:a\s+)?|dentro\s+de\s+|em\s+)${QTD}\s+(?<u>dias?|semanas?|mes|meses)`,
    calc: (g, t) => {
      const n = NUM[g.n] ?? +g.n;
      if (g.u.startsWith('mes')) return clampDate(t.getFullYear(), t.getMonth() + n, t.getDate());
      return dayKey(addDays(t, g.u.startsWith('semana') ? n * 7 : n));
    } },
  { re: String.raw`${PRE}(?:proximo\s+)?dia\s+(?<d>\d{1,2})(?:\s*/\s*(?<mo>\d{1,2})(?:/(?<y>\d{4}|\d{2}))?|\s+de\s+${MES}(?:\s+de\s+(?<ano>\d{4}))?)?`,
    calc: (g, t) => dateOf(g, t) },
  { re: String.raw`${PRE}(?<d>\d{1,2})\s+de\s+${MES}(?:\s+de\s+(?<ano>\d{4}))?`,
    calc: (g, t) => dateOf(g, t) },
  { re: String.raw`${PRE}(?<d>\d{1,2})/(?<mo>\d{1,2})(?:/(?<y>\d{4}|\d{2}))?`,
    calc: (g, t) => dateOf(g, t) },
].map(r => ({ ...r, re: new RegExp(B + r.re + E, 'g') }));

// dia da semana `w` (0 = domingo) na semana que vem (semana começa na segunda)
function inNextWeek(t, w) {
  const monday = addDays(t, (1 - t.getDay() + 7) % 7 || 7);
  return addDays(monday, (w + 6) % 7);
}

// dia + mês (número ou nome) + ano → reaproveita as regras do parseDue (ano mais perto de hoje etc.)
function dateOf(g, t) {
  const mo = g.mes ? MESES.indexOf(g.mes) + 1 : g.mo;
  const y = g.ano || g.y;
  return parseDue(mo ? `${g.d}/${mo}${y ? '/' + y : ''}` : g.d, t);
}

// sem acento e minúsculo, letra por letra (as posições continuam as mesmas do texto original)
const fold = s => [...s].map(c => { const f = strip(c); return f.length === c.length ? f : c; }).join('');

export function findDate(input, now = new Date()) {
  const text = String(input ?? '').normalize('NFC');
  const low = fold(text);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let best = null;
  for (const rule of RULES) {
    for (const m of low.matchAll(rule.re)) {
      const inicio = m.index, fim = m.index + m[0].length;
      if (best && (inicio > best.inicio || (inicio === best.inicio && fim <= best.fim))) continue;
      const data = rule.calc(m.groups || {}, today, m[0], low.slice(fim));
      if (data) best = { data, inicio, fim };
    }
  }
  if (!best) return null;
  const resto = (text.slice(0, best.inicio) + ' ' + text.slice(best.fim))
    .replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,.;:–-]+|[\s,;:–-]+$/g, '');
  return { data: best.data, trecho: text.slice(best.inicio, best.fim), resto, inicio: best.inicio, fim: best.fim };
}
