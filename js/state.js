// Estado do MB Core e leitura do que o operador está digitando. Funções puras, testadas em tests/.

import { lev } from './util.js';
import { registry } from './tasks.js';
import { previa } from './interpretar.js';

// Cada estado: rótulo, descrição curta e tom de cor (token do CSS)
export const STATE_INFO = {
  initializing: { label: 'INITIALIZING', desc: 'inicializando o núcleo', tone: 'int' },
  locked:       { label: 'LOCKED', desc: 'memória bloqueada · aguardando operador', tone: 'warn' },
  ready:        { label: 'READY', desc: 'aguardando operador', tone: 'act' },
  listening:    { label: 'LISTENING', desc: 'recebendo entrada', tone: 'int' },
  processing:   { label: 'PROCESSING', desc: 'processando', tone: 'int' },
  executing:    { label: 'EXECUTING', desc: 'executando', tone: 'act' },
  degraded:     { label: 'DEGRADED', desc: 'operando com falhas', tone: 'warn' },
  offline:      { label: 'OFFLINE', desc: 'sem rede · memória local ativa', tone: 'warn' },
  fault:        { label: 'FAULT', desc: 'erro detectado', tone: 'err' },
};

export const LISTEN_MS = 2500;   // quanto tempo depois da última tecla ainda é "escutando"
export const FAULT_MS = 2200;    // quanto tempo o FAULT fica aceso depois de um erro

// Atividade (momentânea) vence condição (duradoura): executar > processar > escutar > bloqueado > falhas > offline > pronto.
export function deriveState({ booting, now, faultUntil = 0, tasks = [], lastKey = 0, locked, degraded, online = true }) {
  if (booting) return 'initializing';
  if (now < faultUntil) return 'fault';
  if (tasks.some(t => t.kind === 'exec')) return 'executing';
  if (tasks.length) return 'processing';
  if (lastKey && now - lastKey < LISTEN_MS) return 'listening';
  if (locked) return 'locked';
  if (degraded) return 'degraded';
  if (!online) return 'offline';
  return 'ready';
}

// Descrição com detalhe: "executando · captura", "recebendo senha"...
export function describeState(key, { tasks = [], mode = null } = {}) {
  const info = STATE_INFO[key] || STATE_INFO.ready;
  let desc = info.desc;
  const last = tasks[tasks.length - 1];
  if ((key === 'processing' || key === 'executing') && last) desc = `${info.desc} · ${last.label}`;
  if (key === 'listening' && mode) desc = { email: 'recebendo usuário', password: 'recebendo senha', code: 'recebendo código' }[mode] || desc;
  return { key, ...info, desc };
}

// O que vai acontecer quando o operador apertar Enter?
//   catalog: [{ name, alias, args, desc }] dos comandos
export function readIntent(text, { mode = null, ctx = null, catalog = [], reg = registry([]), entries = [], now = new Date() } = {}) {
  const raw = String(text);
  if (mode) return { type: 'login', field: mode };
  const v = raw.trim();
  if (!v) return { type: 'idle' };

  if (v.startsWith('/')) {
    const [name, ...rest] = v.slice(1).split(/\s+/);
    const n = name.toLowerCase();
    const exact = catalog.find(c => c.name === n || (c.alias || []).includes(n));
    if (exact && (rest.length || raw.endsWith(' '))) return { type: 'command', cmd: exact, arg: rest.join(' ') };
    const matches = catalog.filter(c => c.name.startsWith(n) || (c.alias || []).some(a => a.startsWith(n)));
    if (exact && !matches.includes(exact)) matches.unshift(exact);
    if (matches.length) return { type: 'commands', query: n, matches: matches.slice(0, 6) };
    const near = catalog.map(c => [c, lev(n, c.name)]).filter(([, d]) => d <= 2).sort((a, b) => a[1] - b[1]).map(([c]) => c);
    return { type: 'unknown', query: n, near: near.slice(0, 3) };
  }

  // texto livre: a mesma leitura que o Enter vai fazer (o intérprete, só regras: instantâneo)
  const ictx = { reg, entries, aba: ctx, now };
  const r = previa(v, ictx);
  if (r.tipo === 'link') return { type: 'link', url: r.campos.url, contexto: r.campos.contexto || '', tags: r.campos.tags || [] };
  if (r.tipo === 'trecho') return { type: 'trecho', text: r.campos.texto, tags: r.campos.tags || [] };

  if (/^-\s+\S/.test(v)) {
    const t = previa(v.replace(/^-\s+/, ''), { ...ictx, forcar: 'tarefa' });
    if (t.erro) return { type: 'task-error', error: t.erro.codigo, token: t.erro.token };
    // prévia completa: o que foi informado + o que as regras vão decidir
    const c = t.campos;
    return { type: 'task', text: c.texto, tags: c.tags || [], projeto: c.projeto, status: c.status, prazo: c.prazo || null, prioridade: c.prioridade, auto: t.auto };
  }

  // (etapa 9a: o resto continua nota)
  const n = previa(v, { ...ictx, forcar: 'nota' });
  return { type: 'note', text: n.campos.texto, tags: n.campos.tags || [] };
}
