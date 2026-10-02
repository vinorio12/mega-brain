// Tarefas. Funções puras: não mexem na tela nem na memória, só calculam. Testadas em tests/.
//
// Uma tarefa é uma entrada com kind 'tarefa' e detalhes em `data`:
//   { id, text: 'revisar cap 2', tags: ['tcc'], kind: 'tarefa', ts, day,
//     data: { projeto: 'tcc', status: 'a fazer', prazo: '2026-10-02' | null, prioridade: 'média',
//             feito_em: epoch ms | null, auto: { campos: [...], fonte: 'regra' } } }
// Compatível com o formato antigo (data.feito; projeto = #tag): leia sempre pelas funções abaixo.
//
// Projetos e status são registros editáveis, guardados como entradas também:
//   { kind: 'projeto', text: 'tcc', data: { ordem, arquivado } }
//   { kind: 'status',  text: 'a fazer', data: { ordem, final } }

import { tagsOf, dayKey } from './util.js';
import { parseDue } from './dates.js';

export const PRIORITIES = ['alta', 'média', 'baixa'];
export const DEFAULT_PROJECTS = ['tcc', 'weg', 'pessoal'];
export const DEFAULT_STATUSES = [
  { name: 'a fazer', final: false },
  { name: 'fazendo', final: false },
  { name: 'esperando', final: false },
  { name: 'feito', final: true },
];
export const RECORD_KINDS = ['projeto', 'status', 'evento', 'interpretacao', 'pessoa'];
// o que aparece nas listas. Qualquer outro kind (evento, e os que versões novas do app criarem)
// fica escondido em S.records: assim um aparelho com versão velha nunca mostra lixo no /inbox.
export const CONTENT_KINDS = ['nota', 'tarefa', 'link', 'trecho', 'gasto', 'entrada', 'treino'];

export const isTask = e => e?.kind === 'tarefa';
export const isRecord = e => !!e?.kind && !CONTENT_KINDS.includes(e.kind);
export const isNoteKind = e => !e?.kind || e.kind === 'nota';
// concluída = tem horário de conclusão (formato novo: feito_em · antigo: feito)
export const doneAt = e => e?.data?.feito_em ?? e?.data?.feito ?? null;
export const isOpen = e => isTask(e) && !doneAt(e);
export const statusOf = e => e?.data?.status || (doneAt(e) ? 'feito' : 'a fazer');
export const prioOf = e => (PRIORITIES.includes(e?.data?.prioridade) ? e.data.prioridade : 'média');
export const prioRank = p => ({ alta: 0, 'média': 1, baixa: 2 }[p] ?? 1);
// projeto: o campo novo, ou (formato antigo) a primeira #tag que é um projeto registrado
export function projectOf(e, projects = []) {
  if (e?.data?.projeto) return e.data.projeto;
  return (e?.tags || []).find(t => projects.includes(t)) || null;
}
const inProj = (e, proj, projects = []) => !proj || projectOf(e, projects) === proj || (e.tags || []).includes(proj);

/* ---------- registros de projetos e status ---------- */

// Lê os registros. Sem nenhum ainda (antes da semente), usa os padrões.
export function registry(records = []) {
  const byOrder = (a, b) => (a.data?.ordem ?? 99) - (b.data?.ordem ?? 99) || a.ts - b.ts;
  const uniq = list => list.filter((x, i) => list.findIndex(y => y.name === x.name) === i);
  const projects = uniq(records.filter(e => e.kind === 'projeto' && !e.data?.arquivado).sort(byOrder)
    .map(e => ({ name: String(e.text).toLowerCase(), id: e.id, palavras: Array.isArray(e.data?.palavras) ? e.data.palavras : [] })));
  const statuses = uniq(records.filter(e => e.kind === 'status').sort(byOrder)
    .map(e => ({ name: String(e.text).toLowerCase(), final: !!e.data?.final, id: e.id })));
  return {
    projects: projects.length ? projects.map(p => p.name) : [...DEFAULT_PROJECTS],
    statuses: statuses.length ? statuses : DEFAULT_STATUSES.map(s => ({ ...s })),
    // palavras-chave de cada projeto (/palavras): { tcc: ['orientador', 'monografia'] }
    palavras: Object.fromEntries(projects.filter(p => p.palavras.length).map(p => [p.name, p.palavras])),
    seeded: projects.length > 0 && statuses.length > 0,
  };
}

// "/palavras tcc +orientador banca -defesa" → lista nova (sem repetir, minúsculas, sem #)
export function editPalavras(atual = [], tokens = []) {
  let out = [...atual];
  for (const raw of tokens) {
    const tira = raw.startsWith('-');
    const w = raw.replace(/^[+-]/, '').replace(/^#/, '').trim().toLowerCase();
    if (!w) continue;
    out = tira ? out.filter(x => x !== w) : out.includes(w) ? out : [...out, w];
  }
  return out;
}
export const finalStatus = reg => (reg.statuses.find(s => s.final) || { name: 'feito' }).name;
export const firstStatus = reg => (reg.statuses.find(s => !s.final) || { name: 'a fazer' }).name;
export const isFinalStatus = (reg, name) => !!reg.statuses.find(s => s.name === name)?.final;

// id fixo calculado do texto (formato de uuid): a mesma semente nunca duplica, mesmo criada em 2 aparelhos
export function seedId(str) {
  const h = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    for (let i = 0; i < 4; i++) h[i] = Math.imul(h[i] ^ (c + i * 31), 16777619 + i * 2) >>> 0;
  }
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) h[i] = Math.imul(h[i] ^ (h[(i + 1) % 4] >>> 13), 0x5bd1e995) >>> 0;
  const x = h.map(n => n.toString(16).padStart(8, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-a${x.slice(17, 20)}-${x.slice(20, 32)}`;
}

// O que falta criar da semente inicial (projetos tcc/weg/pessoal e os 4 status).
export function seedEntries(records, owner, now = new Date()) {
  const out = [];
  const day = dayKey(now), ts = now.getTime();
  if (!records.some(e => e.kind === 'projeto')) {
    DEFAULT_PROJECTS.forEach((name, i) => out.push({
      id: seedId(`${owner}:projeto:${name}`), kind: 'projeto', text: name, tags: [], ts: ts + i, day, data: { ordem: i + 1, arquivado: false },
    }));
  }
  if (!records.some(e => e.kind === 'status')) {
    DEFAULT_STATUSES.forEach((s, i) => out.push({
      id: seedId(`${owner}:status:${s.name}`), kind: 'status', text: s.name, tags: [], ts: ts + 10 + i, day, data: { ordem: i + 1, final: s.final },
    }));
  }
  return out;
}

// mudanças de status: concluir grava a hora; voltar pra um status aberto limpa
export function statusChange(reg, name, now = Date.now()) {
  const final = isFinalStatus(reg, name);
  return { status: name, feito_em: final ? now : null, feito: null };
}

// Nome de projeto/aba válido: letras, números, _ e - (igual às #tags)
export const projName = s => {
  const p = String(s || '').trim().replace(/^#/, '').toLowerCase();
  return /^[\p{L}\p{N}_-]+$/u.test(p) ? p : null;
};

/* ---------- escrever: "revisar cap 2 #tcc @fazendo >sex !alta" ---------- */

const PRIO_ALIASES = { alta: 'alta', a: 'alta', 1: 'alta', 'média': 'média', media: 'média', m: 'média', 2: 'média', baixa: 'baixa', b: 'baixa', 3: 'baixa' };
const squash = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s_-]+/g, '');

// "@fazendo", "@afazer", "@a-fazer", "@faz" → nome do status registrado (ou null)
export function matchStatus(token, statuses) {
  const q = squash(token);
  if (!q) return null;
  const exact = statuses.find(s => squash(s.name) === q);
  if (exact) return exact.name;
  const pre = statuses.filter(s => squash(s.name).startsWith(q));
  return pre.length === 1 ? pre[0].name : null;
}

// Lê a linha da tarefa. Devolve o que foi INFORMADO (o resto fica null pras regras decidirem).
//   projeto: a 1ª #tag que é projeto registrado (ou a aba atual) · as outras #tags ficam no texto
//   allowEmpty: pro /editar, que pode mudar só um campo
export function parseTaskInput(raw, { ctx = null, reg = registry([]), now = new Date(), allowEmpty = false } = {}) {
  let prazo = null, prioridade = null, status = null, projeto = null;
  const words = [];
  for (const w of String(raw).trim().split(/\s+/)) {
    if (!w) continue;
    if (w.startsWith('>') && w.length > 1) {
      const sem = ['sem', 'nenhum', '-'].includes(w.slice(1).toLowerCase());
      prazo = sem ? '' : parseDue(w.slice(1), now);
      if (prazo === null) return { error: 'prazo', token: w };
    } else if (w.startsWith('!') && w.length > 1) {
      prioridade = PRIO_ALIASES[w.slice(1).toLowerCase()] || null;
      if (!prioridade) return { error: 'prioridade', token: w };
    } else if (w.startsWith('@') && w.length > 1) {
      status = matchStatus(w.slice(1), reg.statuses);
      if (!status) return { error: 'status', token: w };
    } else if (/^#[\p{L}\p{N}_-]+$/u.test(w) && !projeto && reg.projects.includes(w.slice(1).toLowerCase())) {
      projeto = w.slice(1).toLowerCase();
    } else words.push(w);
  }
  const text = words.join(' ');
  if (!text && !allowEmpty) return { error: 'vazio' };
  if (!projeto && ctx) projeto = ctx; // dentro de uma aba, o projeto é o dela
  const tags = [...new Set([...(projeto ? [projeto] : []), ...tagsOf(text)])];
  return { text, tags, projeto, status, prazo, prioridade };
}

// palavras "de conteúdo" (3+ letras, sem acento, sem as muito comuns) pra comparar textos
const STOP = new Set('pra para com que uma uns umas dos das por mais como sem sobre nao sim ate apos entre isso esse essa este esta tem ter ser fazer feito ver'.split(' '));
const words3 = s => String(s).replace(/#[\p{L}\p{N}_-]+/gu, ' ')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w));

// texto como sequência de palavras sem acento: " mandar email pro orientador " (pra achar palavra-chave, até com espaço)
const tokens = s => ' ' + String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' ') + ' ';

// Projeto mais provável pelo texto: nome do projeto no texto (+5), palavra-chave do projeto (+4, /palavras)
// e palavras em comum com as tarefas de cada projeto (+1 cada).
export function guessProject(text, { entries = [], reg = registry([]), semPadrao = false } = {}) {
  const mine = new Set(words3(text));
  const toks = tokens(text);
  let best = null, bestScore = 0;
  for (const p of reg.projects) {
    let score = mine.has(squash(p)) ? 5 : 0;
    for (const k of reg.palavras?.[p] || []) if (toks.includes(tokens(k))) score += 4;
    for (const e of entries) {
      if (!isTask(e) || projectOf(e, reg.projects) !== p) continue;
      for (const w of new Set(words3(e.text))) if (mine.has(w)) score++;
    }
    if (score > bestScore) { best = p; bestScore = score; }
  }
  if (semPadrao) return best; // null = nenhuma pista (quem chama decide)
  return best || (reg.projects.includes('pessoal') ? 'pessoal' : reg.projects[0] || null);
}

// prazo sugerido pela prioridade, em dias corridos: alta → amanhã · média → +3 · baixa → +7
export const PRIO_DAYS = { alta: 1, 'média': 3, baixa: 7 };
export function dueFor(prioridade, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (PRIO_DAYS[prioridade] ?? 3));
  return dayKey(d);
}

// Regras simples: preenchem o que não foi informado. Devolve os valores + a lista do que foi automático.
// (é também o "plano B" quando houver IA: se ela falhar, isto decide)
// decidir(texto) → { projeto, motivo } (Fase 2.5: a memória); sem ele, o guessProject de sempre. projeto null = não chutou.
export function fillByRules(parsed, { entries = [], reg = registry([]), now = new Date(), decidir = null } = {}) {
  const motivos = {};
  const auto = [];
  const v = { projeto: parsed.projeto, status: parsed.status, prioridade: parsed.prioridade, prazo: parsed.prazo };
  if (!v.projeto) {
    if (decidir) { const d = decidir(parsed.text); v.projeto = d.projeto; motivos.projeto = d.motivo; }
    else v.projeto = guessProject(parsed.text, { entries, reg });
    auto.push('projeto');
  }
  if (!v.status) { v.status = firstStatus(reg); auto.push('status'); }
  if (!v.prioridade) { v.prioridade = 'média'; auto.push('prioridade'); }
  if (v.prazo === null || v.prazo === undefined) { v.prazo = dueFor(v.prioridade, now); auto.push('prazo'); }
  if (v.prazo === '') v.prazo = null; // ">sem" = sem prazo, de propósito
  return { values: v, auto, motivos };
}

export function newTask({ text, tags, prazo = null, projeto = null, status = 'a fazer', prioridade = 'média', auto = null }, now = new Date()) {
  const data = { projeto, status, prazo: prazo || null, prioridade, feito_em: null };
  if (auto?.campos?.length) data.auto = auto;
  return { text, tags, kind: 'tarefa', ts: now.getTime(), day: dayKey(now), data };
}

// ordenações: prazo, depois prioridade, depois criação
export const byDue = (a, b) => (a.data?.prazo || '9').localeCompare(b.data?.prazo || '9') || prioRank(prioOf(a)) - prioRank(prioOf(b)) || a.ts - b.ts;
export const byPrio = (a, b) => prioRank(prioOf(a)) - prioRank(prioOf(b)) || a.ts - b.ts;

// Lista do /tarefas: grupos na ordem em que aparecem + a numeração (t1, t2...) na mesma ordem.
export function groupTasks(entries, { proj = null, now = new Date(), projects = [] } = {}) {
  const today = dayKey(now);
  const tasks = entries.filter(e => isTask(e) && inProj(e, proj, projects));
  const open = tasks.filter(e => !doneAt(e));
  const groups = [
    { key: 'atrasadas', title: 'atrasadas', items: open.filter(e => e.data?.prazo && e.data.prazo < today).sort(byDue) },
    { key: 'hoje', title: 'hoje', items: open.filter(e => e.data?.prazo === today).sort(byPrio) },
    { key: 'proximas', title: 'próximas', items: open.filter(e => e.data?.prazo > today).sort(byDue) },
    { key: 'sem', title: 'sem prazo', items: open.filter(e => !e.data?.prazo).sort(byPrio) },
    // concluídas hoje continuam visíveis (riscadas) até a meia-noite
    { key: 'feitas', title: 'feitas hoje', items: tasks.filter(e => doneAt(e) && dayKey(new Date(doneAt(e))) === today).sort((a, b) => doneAt(a) - doneAt(b)) },
  ].filter(g => g.items.length);
  return { groups, list: groups.flatMap(g => g.items.map(e => e.id)) };
}

// Histórico do /feitas: concluídas nos últimos `days` dias, agrupadas por dia (mais recente primeiro).
export function doneHistory(entries, { proj = null, days = 7, now = new Date(), projects = [] } = {}) {
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  const done = entries.filter(e => isTask(e) && inProj(e, proj, projects) && doneAt(e) >= since).sort((a, b) => doneAt(b) - doneAt(a));
  const byDay = new Map();
  for (const e of done) {
    const k = dayKey(new Date(doneAt(e)));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  const groups = [...byDay].map(([day, items]) => ({ key: day, title: day, items }));
  return { groups, list: done.map(e => e.id), total: done.length };
}

// /projetos: cada projeto registrado (na ordem) com tarefas abertas, atrasadas e notas;
// depois, as #tags soltas que não são projeto.
export function projectsSummary(entries, now = new Date(), projects = []) {
  const today = dayKey(now);
  const rows = new Map(projects.map(p => [p, { proj: p, abertas: 0, atrasadas: 0, notas: 0, registrado: true }]));
  const tags = new Map();
  for (const e of entries) {
    const p = isTask(e) ? projectOf(e, projects) : null;
    if (p) {
      if (!rows.has(p)) rows.set(p, { proj: p, abertas: 0, atrasadas: 0, notas: 0, registrado: false });
      const r = rows.get(p);
      if (isOpen(e)) { r.abertas++; if (e.data?.prazo && e.data.prazo < today) r.atrasadas++; }
    }
    for (const t of e.tags || []) {
      if (rows.has(t)) { if (!isTask(e)) rows.get(t).notas++; continue; }
      if (t === p) continue;
      tags.set(t, (tags.get(t) || 0) + 1);
    }
  }
  return {
    projects: [...rows.values()],
    tags: [...tags].sort((a, b) => b[1] - a[1]).map(([tag, n]) => ({ tag, n })),
  };
}

// Tela inicial: só o essencial, em poucas linhas.
// Ordem: atrasadas → prioridade alta → as que vencem primeiro (sem repetir).
export function briefing(entries, { reg = registry([]), now = new Date(), limit = 6, proj = null } = {}) {
  const today = dayKey(now);
  const open = entries.filter(e => isOpen(e) && inProj(e, proj, reg.projects));
  const late = open.filter(e => e.data?.prazo && e.data.prazo < today).sort(byDue);
  const high = open.filter(e => prioOf(e) === 'alta' && !late.includes(e)).sort(byDue);
  const soon = open.filter(e => e.data?.prazo && !late.includes(e) && !high.includes(e)).sort(byDue);
  const items = [...late, ...high, ...soon].slice(0, limit);
  return {
    items,
    abertas: open.length,
    atrasadas: late.length,
    altas: open.filter(e => prioOf(e) === 'alta').length,
    hoje: open.filter(e => e.data?.prazo === today).length,
  };
}

// Números para o HUD.
export function taskStats(entries, now = new Date()) {
  const today = dayKey(now);
  let abertas = 0, hoje = 0, atrasadas = 0, feitasHoje = 0;
  for (const e of entries) {
    if (!isTask(e)) continue;
    const f = doneAt(e);
    if (f) { if (dayKey(new Date(f)) === today) feitasHoje++; continue; }
    abertas++;
    if (e.data?.prazo === today) hoje++;
    else if (e.data?.prazo && e.data.prazo < today) atrasadas++;
  }
  return { abertas, hoje, atrasadas, feitasHoje };
}

// "t1 t3", "1-4", "t2" → números (sem o t). null se não for número.
export function taskNumbers(raw) {
  const tokens = String(raw).trim().split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length || !tokens.every(x => /^t?\d+(-t?\d+)?$/i.test(x))) return null;
  return tokens.map(x => x.replace(/t/gi, '')).join(' ');
}
