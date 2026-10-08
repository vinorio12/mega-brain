// Limpeza escolhida por você (v0.14): o que dá pra apagar, por grupo e item por item. Funções puras, testadas em tests/.
// Quem desenha a tela é o ui.js (palco "limpeza"); quem apaga é o /limpeza (js/comandos/dados.js), num passo só do /desfazer.
//
// NUNCA entram na lista (então nunca são apagados por aqui): aprendizado (interpretacao), memória, pessoas, projetos, status,
// categorias, cartões, recorrentes, o crédito (credito) e o histórico (evento). Eles guardam o que o app aprendeu e configurou.

import { dayKey } from './util.js';
import { mesDe } from './financas.js';

// os grupos, na ordem da tela: [chave, nome, quem entra]
export const GRUPOS_LIMPEZA = [
  ['abertas', 'tarefas abertas', e => e.kind === 'tarefa' && !(e.data?.feito_em ?? e.data?.feito)],
  ['feitas', 'tarefas feitas', e => e.kind === 'tarefa' && !!(e.data?.feito_em ?? e.data?.feito)],
  ['notas', 'notas', e => !e.kind || e.kind === 'nota'],
  ['acervo', 'acervo (links e textos)', e => e.kind === 'link' || e.kind === 'trecho'],
  ['gastos', 'gastos', e => e.kind === 'gasto'],
  ['entradas', 'entradas', e => e.kind === 'entrada'],
  ['movimentos', 'transferências e rendimentos', e => e.kind === 'transferencia' || e.kind === 'rendimento'],
  ['treinos', 'treinos', e => e.kind === 'treino'],
  ['saldos', 'saldos informados (/saldo)', e => e.kind === 'saldo'],
  ['faturas', 'faturas pagas', e => e.kind === 'faturapaga'],
];

// a data que aparece na lista: a do lançamento (gasto, tarefa feita…) ou a de quando foi escrito
const dataDe = e => e.data?.data || (e.kind === 'tarefa' && e.data?.prazo) || e.day || dayKey(new Date(e.ts || 0));

// → [{ key, nome, itens: [{ id, texto, data, valor }] }] (só os grupos com algo; do mais novo pro mais antigo)
export function gruposLimpeza(entries = [], records = []) {
  const todos = [...entries, ...records];
  return GRUPOS_LIMPEZA.map(([key, nome, pega]) => ({
    key, nome,
    itens: todos.filter(pega).sort((a, b) => (b.ts || 0) - (a.ts || 0)).map(e => ({
      id: e.id, data: dataDe(e), valor: Number.isInteger(e.data?.valor) ? e.data.valor : null,
      texto: e.kind === 'saldo' ? `saldo ${e.text}` : String(e.text || ''),
    })),
  })).filter(g => g.itens.length);
}

// O que apagar de verdade a partir dos ids marcados (só os que estão nos grupos: nunca aprendizado, pessoas etc.):
//   → { remover: [entradas], recorrentes: [versão nova da recorrente com o mês em "pulados"] }
// Gasto lançado por uma recorrente: o mês vai pra "pulados", senão o lançador recriaria o lançamento (igual ao /apagar f3).
export function planoLimpeza(ids = [], entries = [], records = []) {
  const permitidos = new Set(gruposLimpeza(entries, records).flatMap(g => g.itens.map(i => i.id)));
  const marcados = new Set([...ids].filter(id => permitidos.has(id)));
  const remover = [...entries, ...records].filter(e => marcados.has(e.id));
  const recs = new Map();
  for (const e of remover) {
    const rid = e.data?.recorrente;
    const rec = rid && (recs.get(rid) || records.find(r => r.id === rid && r.kind === 'recorrente'));
    if (!rec) continue;
    recs.set(rid, { ...rec, data: { ...rec.data, pulados: [...new Set([...(rec.data?.pulados || []), mesDe(e)])] } });
  }
  return { remover, recorrentes: [...recs.values()] };
}
