// Acervo: links e textos curtos guardados (nada a ver com tarefas). Funções puras, testadas em tests/.
//
//   link   { kind: 'link', text: 'https://... contexto #tag', tags, data: { url, contexto } }
//   trecho { kind: 'trecho', text: 'texto curto guardado #tag', tags }
//
// Colar uma linha que começa com http(s):// → link. Linha que começa com aspas → trecho.

import { tagsOf } from './util.js';

export const isLink = e => e?.kind === 'link';
export const isSnippet = e => e?.kind === 'trecho';
export const isAcervo = e => isLink(e) || isSnippet(e);

// só http e https (nunca "javascript:", "data:" etc.)
export function safeUrl(s) {
  try {
    const u = new URL(String(s).trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

// "https://exemplo.com/x artigo bom #tcc" → { url, contexto, tags } · null se não for link
export function parseLink(line) {
  const v = String(line).trim();
  const m = v.match(/^(https?:\/\/\S+)\s*(.*)$/i);
  if (!m) return null;
  const url = safeUrl(m[1]);
  if (!url) return null;
  const contexto = m[2].trim();
  return { url, contexto, tags: tagsOf(contexto) };
}

// '"texto guardado"' ou '“texto”' → { text, tags } · null se não começar com aspas duplas
export function parseSnippet(line) {
  const v = String(line).trim();
  if (!/^["“”]/.test(v)) return null;
  const text = v.replace(/^["“”]\s*/, '').replace(/\s*["“”]$/, '').trim();
  return text ? { text, tags: tagsOf(text) } : null;
}

// "exemplo.com/caminho/longo..." pra mostrar o link de forma curta
export function shortUrl(url, max = 42) {
  try {
    const u = new URL(url);
    const s = u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname) + (u.search ? '?…' : '');
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  } catch { return url; }
}

const TIPOS = { link: 'link', links: 'link', trecho: 'trecho', trechos: 'trecho', texto: 'trecho', textos: 'trecho', tarefa: 'tarefa', tarefas: 'tarefa', nota: 'nota', notas: 'nota' };
export const tipoOf = e => (isLink(e) ? 'link' : isSnippet(e) ? 'trecho' : e?.kind === 'tarefa' ? 'tarefa' : 'nota');

// Busca em tudo: "rag", "#tcc", "rag tipo:link". Devolve grupos por tipo (só os que têm resultado).
export function searchAll(entries, query) {
  let q = String(query).trim().toLowerCase();
  let tipo = null;
  q = q.replace(/\btipo:(\S+)/, (_, t) => { tipo = TIPOS[t] || t; return ''; }).trim();
  const tag = q.startsWith('#') ? q.slice(1) : null;
  const hits = entries.filter(e => {
    if (tipo && tipoOf(e) !== tipo) return false;
    if (!q) return true;
    if (tag) return (e.tags || []).includes(tag);
    return [e.text, e.data?.url, e.data?.contexto].some(s => String(s || '').toLowerCase().includes(q));
  });
  const order = ['tarefa', 'nota', 'link', 'trecho'];
  const titles = { tarefa: 'tarefas', nota: 'notas', link: 'links', trecho: 'textos' };
  const groups = order.map(t => ({ key: t, title: titles[t], items: hits.filter(e => tipoOf(e) === t) })).filter(g => g.items.length);
  return { groups, total: hits.length, tipo, q };
}
