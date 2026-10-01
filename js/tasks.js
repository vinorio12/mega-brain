// Tarefas (Fase 1). Funções puras: não mexem na tela nem na memória, só calculam. Testadas em tests/.
//
// Uma tarefa é uma entrada com kind 'tarefa' e detalhes em `data`:
//   { id, text: 'revisar cap 2 #tcc', tags: ['tcc'], kind: 'tarefa', ts, day,
//     data: { prazo: '2026-10-02' | null, feito: 1790000000000 | null } }
// Projeto = qualquer #tag.

import { tagsOf, dayKey } from './util.js';
import { parseDue } from './dates.js';

export const isTask = e => e?.kind === 'tarefa';
export const doneAt = e => e?.data?.feito || null;
export const isOpen = e => isTask(e) && !doneAt(e);
const inProj = (e, proj) => !proj || (e.tags || []).includes(proj);

// Nome de projeto/aba válido: letras, números, _ e - (igual às #tags)
export const projName = s => {
  const p = String(s || '').trim().replace(/^#/, '').toLowerCase();
  return /^[\p{L}\p{N}_-]+$/u.test(p) ? p : null;
};

// "revisar cap 2 #tcc >sex" (+ aba atual) → { text, tags, prazo } ou { error }
export function parseTaskInput(raw, ctxProj = null, now = new Date()) {
  let prazo = null;
  const words = [];
  for (const w of String(raw).trim().split(/\s+/)) {
    if (w.startsWith('>') && w.length > 1) {
      prazo = parseDue(w.slice(1), now);
      if (!prazo) return { error: 'prazo', token: w };
    } else if (w) words.push(w);
  }
  let text = words.join(' ');
  if (!text) return { error: 'vazio' };
  if (ctxProj && !tagsOf(text).includes(ctxProj)) text += ' #' + ctxProj;
  return { text, tags: tagsOf(text), prazo };
}

export function newTask({ text, tags, prazo }, now = new Date()) {
  return { text, tags, kind: 'tarefa', ts: now.getTime(), day: dayKey(now), data: { prazo: prazo || null, feito: null } };
}

// Lista do /tarefas: grupos na ordem em que aparecem + a numeração (t1, t2...) na mesma ordem.
export function groupTasks(entries, { proj = null, now = new Date() } = {}) {
  const today = dayKey(now);
  const tasks = entries.filter(e => isTask(e) && inProj(e, proj));
  const byDue = (a, b) => (a.data.prazo || '').localeCompare(b.data.prazo || '') || a.ts - b.ts;
  const open = tasks.filter(e => !doneAt(e));
  const groups = [
    { key: 'atrasadas', title: 'atrasadas', items: open.filter(e => e.data?.prazo && e.data.prazo < today).sort(byDue) },
    { key: 'hoje', title: 'hoje', items: open.filter(e => e.data?.prazo === today).sort((a, b) => a.ts - b.ts) },
    { key: 'proximas', title: 'próximas', items: open.filter(e => e.data?.prazo > today).sort(byDue) },
    { key: 'sem', title: 'sem prazo', items: open.filter(e => !e.data?.prazo).sort((a, b) => a.ts - b.ts) },
    // concluídas hoje continuam visíveis (riscadas) até a meia-noite
    { key: 'feitas', title: 'feitas hoje', items: tasks.filter(e => doneAt(e) && dayKey(new Date(doneAt(e))) === today).sort((a, b) => doneAt(a) - doneAt(b)) },
  ].filter(g => g.items.length);
  return { groups, list: groups.flatMap(g => g.items.map(e => e.id)) };
}

// Histórico do /feitas: concluídas nos últimos `days` dias, agrupadas por dia (mais recente primeiro).
export function doneHistory(entries, { proj = null, days = 7, now = new Date() } = {}) {
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  const done = entries.filter(e => isTask(e) && inProj(e, proj) && doneAt(e) >= since).sort((a, b) => doneAt(b) - doneAt(a));
  const byDay = new Map();
  for (const e of done) {
    const k = dayKey(new Date(doneAt(e)));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  const groups = [...byDay].map(([day, items]) => ({ key: day, title: day, items }));
  return { groups, list: done.map(e => e.id), total: done.length };
}

// /projetos: cada #tag com quantas tarefas abertas, atrasadas e notas tem.
export function projectsSummary(entries, now = new Date()) {
  const today = dayKey(now);
  const map = new Map();
  for (const e of entries) {
    for (const t of e.tags || []) {
      if (!map.has(t)) map.set(t, { proj: t, abertas: 0, atrasadas: 0, notas: 0 });
      const p = map.get(t);
      if (isOpen(e)) { p.abertas++; if (e.data?.prazo && e.data.prazo < today) p.atrasadas++; }
      else if (!isTask(e)) p.notas++;
    }
  }
  return [...map.values()].sort((a, b) => b.abertas - a.abertas || b.notas - a.notas || a.proj.localeCompare(b.proj));
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
