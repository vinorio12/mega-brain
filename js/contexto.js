// montarContexto: resumo enxuto do estado atual, pra IA ler (Fase 6: Coach). Função pura, testada em tests/.
//
// Curto de propósito (cada caractere custa): data, totais e, por projeto,
//   atrasadas (dias de atraso, quantas vezes adiada) · hoje e !alta · o que andou na semana · o que travou · próximas
// mais uma linha de cada tipo que sabe se resumir (gastos, entradas, treinos).
// Passou de maxChars? Corta primeiro o menos importante (próximas → andou → travou...), nunca o cabeçalho.

import { dayKey, DOW } from './util.js';
import { isOpen, isTask, doneAt, prioOf, projectOf, statusOf, registry } from './tasks.js';
import { REGISTRO } from './tipos.js';
import './tipos-base.js';
import './tipos-financas.js';
import './tipos-corpo.js';

const DIA = 864e5;
const curto = (s, n = 38) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const ddmm = key => (key ? `${key.slice(8, 10)}.${key.slice(5, 7)}` : '');
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / DIA);

export function montarContexto(entries = [], eventos = [], { reg = registry([]), now = new Date(), dias = 7, maxChars = 1500, registro = REGISTRO, pessoas = [] } = {}) {
  const today = dayKey(now);
  const desde = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (dias - 1)).getTime();
  const tasks = entries.filter(isTask);
  const open = tasks.filter(isOpen);

  // eventos por tarefa (do mais antigo pro mais novo)
  const evs = new Map();
  for (const ev of eventos.filter(e => e.kind === 'evento').sort((a, b) => a.ts - b.ts)) {
    const k = ev.data?.alvo;
    if (!evs.has(k)) evs.set(k, []);
    evs.get(k).push(ev);
  }
  const adiamentos = t => (evs.get(t.id) || []).filter(ev => { const p = ev.data?.mudancas?.prazo; return p && p[0] && p[1] && p[1] > p[0]; }).length;
  const ultimoMovimento = t => Math.max(t.ts || 0, ...(evs.get(t.id) || []).map(ev => ev.ts));
  const desdeStatus = t => { const m = (evs.get(t.id) || []).filter(ev => ev.data?.mudancas?.status).pop(); return m ? m.ts : t.ts || 0; };

  // linhas com prioridade: 0 nunca sai · quanto maior, mais cedo é cortada
  const L = [];
  const add = (p, s) => L.push({ p, s });
  const feitas7 = tasks.filter(t => doneAt(t) >= desde);
  const atrasadasTotal = open.filter(t => t.data?.prazo && t.data.prazo < today).length;
  add(0, `hoje ${today} ${DOW[now.getDay()]}`);
  add(0, `tarefas: ${open.length} abertas · ${atrasadasTotal} atrasadas · ${feitas7.length} feitas em ${dias}d`);

  const projetos = [...new Set([...reg.projects, ...open.map(t => projectOf(t, reg.projects)).filter(Boolean)])];
  for (const p of projetos) {
    const doP = t => projectOf(t, reg.projects) === p;
    const ab = open.filter(doP);
    const feitas = feitas7.filter(doP);
    if (!ab.length && !feitas.length) continue;
    const late = ab.filter(t => t.data?.prazo && t.data.prazo < today).sort((a, b) => a.data.prazo.localeCompare(b.data.prazo));
    add(1, `#${p}: ${ab.length} abertas${late.length ? ` · ${late.length} atrasadas` : ''}`);
    for (const t of late) {
      const n = adiamentos(t);
      add(1, `  atrasada ${diasEntre(t.data.prazo, today)}d: ${curto(t.text)}${prioOf(t) === 'alta' ? ' !alta' : ''}${n ? ` (adiada ${n}x)` : ''}`);
    }
    for (const t of ab.filter(t => !late.includes(t) && (t.data?.prazo === today || prioOf(t) === 'alta'))) {
      add(2, `  ${t.data?.prazo === today ? 'hoje' : t.data?.prazo ? '>' + ddmm(t.data.prazo) : 'sem prazo'}: ${curto(t.text)}${prioOf(t) === 'alta' ? ' !alta' : ''}`);
    }
    // travou: esperando há 3+ dias, parada há 7+ dias, adiada 2x+
    const travou = [];
    for (const t of ab) {
      const st = statusOf(t), parada = Math.floor((now - ultimoMovimento(t)) / DIA), n = adiamentos(t);
      if (st === 'esperando' && (now - desdeStatus(t)) / DIA >= 3) travou.push(`${curto(t.text, 30)} (esperando ${Math.floor((now - desdeStatus(t)) / DIA)}d)`);
      else if (n >= 2 && !late.includes(t)) travou.push(`${curto(t.text, 30)} (adiada ${n}x)`);
      else if (parada >= 7) travou.push(`${curto(t.text, 30)} (parada ${parada}d)`);
    }
    if (travou.length) add(3, `  travou: ${travou.join('; ')}`);
    // andou: concluídas e mudanças de status na janela
    const andou = feitas.map(t => `✓ ${curto(t.text, 30)}`);
    for (const t of ab) {
      const m = (evs.get(t.id) || []).filter(ev => ev.ts >= desde && ev.data?.mudancas?.status && ev.data.acao === 'alterada').pop();
      if (m) andou.push(`${curto(t.text, 30)} → ${m.data.mudancas.status[1]}`);
    }
    if (andou.length) add(4, `  andou: ${andou.join('; ')}`);
    const prox = ab.filter(t => t.data?.prazo > today && prioOf(t) !== 'alta').sort((a, b) => a.data.prazo.localeCompare(b.data.prazo)).slice(0, 3);
    if (prox.length) add(5, `  próximas: ${prox.map(t => `${curto(t.text, 30)} >${ddmm(t.data.prazo)}`).join('; ')}`);
  }

  // por quem você está esperando (Fase 2.5): "esperando: João (2) · Ana (1)"
  const esperando = new Map();
  for (const t of open.filter(t => statusOf(t) === 'esperando')) for (const id of t.data?.pessoas || []) esperando.set(id, (esperando.get(id) || 0) + 1);
  const nomeDe = id => pessoas.find(p => p.id === id)?.nome || eventos.find(e => e.id === id)?.text;
  const esp = [...esperando].map(([id, n]) => [nomeDe(id), n]).filter(([nm]) => nm).sort((a, b) => b[1] - a[1]);
  if (esp.length) add(2, `esperando: ${esp.map(([nm, n]) => `${nm} (${n})`).join(' · ')}`);

  // outros tipos (gastos, entradas, treinos...) se resumem sozinhos
  for (const tipo of registro.lista()) {
    if (typeof tipo.resumo !== 'function') continue;
    const linha = tipo.resumo(entries.filter(e => e.kind === tipo.kind), { now, dias, desde });
    if (linha) add(2, linha);
  }

  // corta do menos importante até caber
  for (let nivel = 5; nivel >= 1; nivel--) {
    if (L.reduce((s, l) => s + l.s.length + 1, 0) <= maxChars) break;
    for (let i = L.length - 1; i >= 0; i--) if (L[i].p === nivel) L.splice(i, 1);
  }
  let texto = L.map(l => l.s).join('\n');
  if (texto.length > maxChars) texto = texto.slice(0, maxChars - 1) + '…';
  return texto;
}

// quantos tokens isso deve custar (aproximado: ~4 caracteres por token)
export const estimarTokens = texto => Math.ceil(String(texto || '').length / 4);

