// Histórico de mudanças (pensado pra Fase 6: o Coach lê o que andou e o que travou).
//
// Cada gravação feita NESTE aparelho numa tarefa vira UMA linha nova, que nunca é editada nem apagada:
//   { kind: 'evento', text: 'alterada · status · prazo', tags: [], ts, day,
//     data: { alvo: id, alvo_kind: 'tarefa', acao: 'criada'|'alterada'|'apagada'|'restaurada',
//             mudancas: { status: ['a fazer', 'feito'], prazo: ['2026-10-02', '2026-10-05'] },
//             origem: 'usuario'|'regra'|'ia'|'desfazer'|'importar', texto: 'revisar cap 2' } }
// Por que linhas e não uma lista dentro da tarefa: dois aparelhos editando não perdem evento,
// o /desfazer não apaga a história (ele mesmo vira evento) e apagar a tarefa não apaga o passado.
//
// O que chega da nuvem, do tempo real ou de outra aba NÃO gera evento aqui (quem gravou já gerou).

import { dayKey } from './util.js';

// campos acompanhados por tipo de entrada ('text' = o texto; o resto fica em data)
// (o registro de tipos da etapa 4 passa a fornecer esta lista)
export const RASTREAR = {
  tarefa: ['text', 'projeto', 'status', 'prazo', 'prioridade', 'feito_em', 'pessoas'],
};

const ORIGENS = ['usuario', 'regra', 'ia', 'desfazer', 'importar'];
const valueOf = (e, campo) => {
  const v = campo === 'text' ? e?.text : e?.data?.[campo];
  return v === undefined || v === '' ? null : v;
};
const short = s => { const t = String(s ?? ''); return t.length > 80 ? t.slice(0, 79) + '…' : t; };

// Compara duas versões (null = não existia / deixou de existir). Devolve o evento a gravar, ou null.
export function diffEvent(before, after, { origem = 'usuario', now = new Date() } = {}) {
  const ref = after || before;
  const campos = RASTREAR[ref?.kind];
  if (!campos) return null; // notas, registros e os próprios eventos não têm histórico
  const mudancas = {};
  let acao;
  if (!before) {
    acao = origem === 'desfazer' ? 'restaurada' : 'criada';
    for (const c of campos) { const v = valueOf(after, c); if (v !== null) mudancas[c] = [null, v]; }
  } else if (!after) {
    acao = 'apagada';
  } else {
    acao = 'alterada';
    for (const c of campos) {
      const de = valueOf(before, c), para = valueOf(after, c);
      if (JSON.stringify(de) !== JSON.stringify(para)) mudancas[c] = [de, para];
    }
    if (!Object.keys(mudancas).length) return null; // gravou igual: nada a contar
  }
  const nomes = acao === 'alterada' ? Object.keys(mudancas) : [];
  return {
    kind: 'evento',
    text: [acao, ...nomes].join(' · '), // nunca vazio (o banco exige)
    tags: [],
    ts: now.getTime(),
    day: dayKey(now),
    data: { alvo: ref.id, alvo_kind: ref.kind, acao, mudancas, origem: ORIGENS.includes(origem) ? origem : 'usuario', texto: short(ref.text) },
  };
}

// Envolve a memória: mesmas funções, mas add/restore/remove anotam o evento sozinhos.
// O segundo argumento diz a origem: store.restore(e, { origem: 'desfazer' }).
// Falha ao gravar o evento nunca desfaz nem trava a gravação principal.
export function withHistory(store, { now = () => new Date(), onError = e => console.warn('histórico', e) } = {}) {
  let current = new Map();
  let pending = Promise.resolve();
  store.subscribe(list => { current = new Map(list.map(e => [e.id, e])); });
  // o evento entra na fila na hora (a ordem fica garantida), mas a tela não espera a nuvem confirmar
  const log = (before, after, meta) => {
    let p;
    try {
      const ev = diffEvent(before, after, { origem: meta?.origem, now: now() });
      p = ev ? Promise.resolve(store.add(ev)).catch(onError) : Promise.resolve();
    } catch (e) { onError(e); p = Promise.resolve(); }
    pending = pending.then(() => p);
  };
  const wrapped = Object.create(store); // kind, status, pending, sync... continuam vindo da memória original
  wrapped.add = async (doc, meta) => {
    const e = await store.add(doc);
    log(null, e, meta);
    return e;
  };
  wrapped.restore = async (entry, meta) => {
    const before = current.get(entry.id) || null;
    await store.restore(entry);
    log(before, entry, meta);
  };
  wrapped.remove = async (id, meta) => {
    const before = current.get(id) || null;
    await store.remove(id);
    if (before) log(before, null, meta);
  };
  wrapped.idle = () => pending; // espera os eventos terminarem de gravar (usado nos testes)
  return wrapped;
}

// Eventos de uma tarefa (ou todos), do mais novo pro mais antigo.
export function eventsOf(records, alvo = null) {
  // no mesmo milissegundo, vale a ordem em que foram gravados
  return records.map((e, i) => [e, i]).filter(([e]) => e.kind === 'evento' && (!alvo || e.data?.alvo === alvo))
    .sort(([a, i], [b, j]) => b.ts - a.ts || j - i).map(([e]) => e);
}
