// Aprendizado do intérprete: frases que as regras não entenderam e as correções do /tipo.
// Vira material pra melhorar as regras e, depois, exemplos pra IA. Funções puras, testadas em tests/.
//
//   { kind: 'interpretacao', text: '<frase>', tags: [], ts, day,
//     data: { palpite: 'tarefa', confianca: 0.6, origem: 'regra', era: 'nota', corrigido: 'tarefa' | null } }
// Só cresce (como o histórico). Fica escondido em S.records e sincroniza.

import { dayKey } from './util.js';

// registro novo: pergunta (não entendeu) ou correção (/tipo)
export function registroAprendizado({ texto, palpite = null, confianca = null, origem = 'regra', era = null, corrigido = null }, now = new Date()) {
  const t = String(texto || '').trim();
  if (!t) return null;
  return { kind: 'interpretacao', text: t.slice(0, 2000), tags: [], ts: now.getTime(), day: dayKey(now), data: { palpite, confianca, origem, era, corrigido } };
}

// Junta por frase (a mais nova vale): o que ficou sem resposta e o que foi corrigido.
export function resumoAprendizado(records = []) {
  const porFrase = new Map();
  for (const r of records.filter(e => e.kind === 'interpretacao').sort((a, b) => a.ts - b.ts)) {
    const k = r.text.trim().toLowerCase();
    const atual = porFrase.get(k) || { texto: r.text, vezes: 0, palpite: null, corrigido: null, era: null, ts: r.ts };
    atual.vezes++;
    atual.ts = r.ts;
    atual.texto = r.text;
    if (r.data?.palpite) atual.palpite = r.data.palpite;
    if (r.data?.corrigido) { atual.corrigido = r.data.corrigido; atual.era = r.data.era; }
    porFrase.set(k, atual);
  }
  const itens = [...porFrase.values()].sort((a, b) => b.ts - a.ts);
  return { total: itens.length, semResposta: itens.filter(i => !i.corrigido), corrigidas: itens.filter(i => i.corrigido) };
}

// Linhas no formato de tests/frases.js (corrigidas viram teste; sem resposta vão comentadas pra você decidir)
export function exportarFrases({ corrigidas = [], semResposta = [] } = {}) {
  const q = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ')}'`;
  return [
    ...corrigidas.map(i => `  { frase: ${q(i.texto)}, esperado: { tipo: '${i.corrigido}' } },`),
    ...semResposta.map(i => `  // { frase: ${q(i.texto)}, esperado: { tipo: '?' } }, // palpite: ${i.palpite || '—'}`),
  ];
}
