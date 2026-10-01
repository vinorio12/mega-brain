// Datas escritas do jeito que a gente fala → 'AAAA-MM-DD'.
// Preparado para a Fase 1 (prazos de tarefas). Funções puras, testadas em tests/.
//
//   hoje · amanhã · depois (de amanhã)
//   seg ter qua qui sex sáb dom      → o próximo (se for hoje, é hoje)
//   15  · 15/10 · 15/10/26 · 15/10/2026 · 15.10
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
    // sem ano e já passou → é o próximo (mês que vem, ou ano que vem)
    if (!m[3]) {
      let cand = new Date(y, mo, d);
      if (cand < today) {
        if (m[2]) y++; else mo++;
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
