// Visões das tarefas (Etapa 4). Funções puras: só organizam, quem desenha é o commands.js.
//
//   prazo      atrasadas · hoje · próximas · sem prazo · feitas hoje (a visão clássica do /tarefas)
//   lista      um grupo por projeto (na ordem dos projetos), dentro por prazo
//   status     um grupo por status (na ordem dos status)
//   kanban     colunas por status (todas, mesmo vazias)
//   calendario mês em grade (PC) / agenda (celular), pelo prazo
//
// Todas devolvem `list`: os ids na ordem da numeração t1, t2...

import { dayKey } from './util.js';
import { isTask, doneAt, statusOf, projectOf, registry, isFinalStatus, byDue, groupTasks } from './tasks.js';

export const VIEWS = ['prazo', 'lista', 'status', 'kanban', 'calendario'];
const VIEW_ALIASES = { prazo: 'prazo', prazos: 'prazo', lista: 'lista', projeto: 'lista', projetos: 'lista', status: 'status', kanban: 'kanban', quadro: 'kanban', calendario: 'calendario', 'calendário': 'calendario', cal: 'calendario', agenda: 'calendario', mes: 'calendario', 'mês': 'calendario' };
export const viewName = s => VIEW_ALIASES[String(s || '').toLowerCase()] || null;

const inProj = (e, proj, projects) => !proj || projectOf(e, projects) === proj || (e.tags || []).includes(proj);
// tarefas que aparecem nas visões: abertas + concluídas hoje (riscadas até a meia-noite)
function visible(entries, { proj, reg, now }) {
  const today = dayKey(now);
  return entries.filter(e => isTask(e) && inProj(e, proj, reg.projects) && (!doneAt(e) || dayKey(new Date(doneAt(e))) === today));
}

export function viewGroups(entries, view, { reg = registry([]), proj = null, now = new Date() } = {}) {
  if (view === 'prazo') return groupTasks(entries, { proj, now, projects: reg.projects });
  const tasks = visible(entries, { proj, reg, now });
  let groups;

  if (view === 'lista') {
    const names = [...reg.projects];
    for (const e of tasks) { const p = projectOf(e, reg.projects); if (p && !names.includes(p)) names.push(p); }
    groups = names.map(p => ({ key: p, title: '#' + p, items: tasks.filter(e => projectOf(e, reg.projects) === p) }));
    const loose = tasks.filter(e => !projectOf(e, reg.projects));
    if (loose.length) groups.push({ key: '-', title: 'sem projeto', items: loose });
    // abertas por prazo; concluídas (riscadas) no fim de cada grupo
    for (const g of groups) g.items.sort((a, b) => (!!doneAt(a) - !!doneAt(b)) || byDue(a, b));
  } else {
    // status e kanban: um grupo por status registrado (+ status órfãos, se existirem)
    const names = reg.statuses.map(s => s.name);
    for (const e of tasks) if (!names.includes(statusOf(e))) names.push(statusOf(e));
    groups = names.map(s => ({ key: s, title: '@' + s, final: isFinalStatus(reg, s), items: tasks.filter(e => statusOf(e) === s).sort(byDue) }));
  }
  if (view !== 'kanban') groups = groups.filter(g => g.items.length);
  return { groups, list: groups.flatMap(g => g.items.map(e => e.id)) };
}

// Calendário de um mês ('AAAA-MM'), semanas começando na segunda.
// Numeração: atrasadas (antes do mês) primeiro, depois dia a dia.
export function calendarModel(entries, { reg = registry([]), proj = null, now = new Date(), month = null } = {}) {
  const [y, m] = (month || dayKey(now).slice(0, 7)).split('-').map(Number);
  const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
  const today = dayKey(now);
  const open = entries.filter(e => isTask(e) && !doneAt(e) && inProj(e, proj, reg.projects) && e.data?.prazo);
  const monthKey = `${y}-${String(m).padStart(2, '0')}`;
  const firstKey = dayKey(first);
  // atrasadas: prazo antes de hoje e antes do mês mostrado (as do mês aparecem no próprio dia)
  const late = open.filter(e => e.data.prazo < today && e.data.prazo < firstKey).sort(byDue);
  const inMonth = open.filter(e => e.data.prazo.startsWith(monthKey)).sort(byDue);

  const byDay = new Map();
  for (const e of inMonth) { if (!byDay.has(e.data.prazo)) byDay.set(e.data.prazo, []); byDay.get(e.data.prazo).push(e); }

  const weeks = [];
  const start = new Date(y, m - 1, 1 - ((first.getDay() + 6) % 7)); // segunda da 1ª semana
  for (let d = new Date(start); d <= last || weeks[weeks.length - 1]?.length < 7; d.setDate(d.getDate() + 1)) {
    if (!weeks.length || weeks[weeks.length - 1].length === 7) weeks.push([]);
    const key = dayKey(d);
    weeks[weeks.length - 1].push({ key, day: d.getDate(), inMonth: d.getMonth() === m - 1, today: key === today, past: key < today, items: byDay.get(key) || [] });
  }
  const days = [...byDay].map(([key, items]) => ({ key, items }));
  return { year: y, month: m, monthKey, late, days, weeks, list: [...late, ...inMonth].map(e => e.id), total: late.length + inMonth.length };
}

// "10/2026", "2026-10", "10", "+1", "-1" → 'AAAA-MM' (relativo a hoje)
export function parseMonth(s, now = new Date()) {
  const v = String(s || '').trim();
  if (!v) return null;
  let m;
  if ((m = v.match(/^([+-]\d{1,2})$/))) { const d = new Date(now.getFullYear(), now.getMonth() + +m[1], 1); return dayKey(d).slice(0, 7); }
  if ((m = v.match(/^(\d{4})-(\d{1,2})$/))) return `${m[1]}-${m[2].padStart(2, '0')}`;
  if ((m = v.match(/^(\d{1,2})(?:\/(\d{2}|\d{4}))?$/))) {
    const mo = +m[1];
    if (mo < 1 || mo > 12) return null;
    const yr = m[2] ? (m[2].length === 2 ? 2000 + +m[2] : +m[2]) : now.getFullYear();
    return `${yr}-${String(mo).padStart(2, '0')}`;
  }
  return null;
}
