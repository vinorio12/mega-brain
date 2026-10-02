// Régua do intérprete: frases de exemplo com o resultado esperado.
// Roda como teste automático (tests/run.js) contra o motor de regras. Quando a IA entrar,
// ela tem que passar nesta MESMA lista. Frase nova que deu errado no uso real (/aprendizado exportar) entra aqui.
//
// esperado: { tipo, campos (só os que importam), pergunta (true = salvou como nota e perguntou), minConfianca }
// aba: projeto da aba atual (~/weg). Todas as frases são lidas como se hoje fosse quinta, 01/10/2026.

export const HOJE = '2026-10-01';

export const FRASES = [
  // nota: nada de outro tipo → nota, sem perguntar
  { frase: 'li um artigo bom sobre RAG #tcc', esperado: { tipo: 'nota', pergunta: false, campos: { tags: ['tcc'] } } },
  { frase: 'ideia: app de receitas pra semana', esperado: { tipo: 'nota', pergunta: false } },
  { frase: 'hoje foi um dia bom', esperado: { tipo: 'nota', pergunta: false } },
  { frase: 'ontem fui no cinema com a Ana', esperado: { tipo: 'nota', pergunta: false } },
  { frase: 'celular novo chegou', esperado: { tipo: 'nota', pergunta: false } },
  { frase: 'nota: preciso pensar melhor nisso', esperado: { tipo: 'nota', pergunta: false, campos: { texto: 'preciso pensar melhor nisso' } } },
  { frase: 'reunião boa com o orientador', aba: 'tcc', esperado: { tipo: 'nota', pergunta: false, campos: { texto: 'reunião boa com o orientador #tcc', tags: ['tcc'] } } },

  // tarefa explícita (- ) e com marcadores
  { frase: '- revisar cap 2 #tcc >sex !alta', esperado: { tipo: 'tarefa', minConfianca: 1, campos: { texto: 'revisar cap 2', projeto: 'tcc', prazo: '2026-10-02', prioridade: 'alta' } } },
  { frase: 'revisar slides @fazendo', esperado: { tipo: 'tarefa', campos: { texto: 'revisar slides', status: 'fazendo' } } },
  { frase: '- comprar café', esperado: { tipo: 'tarefa', campos: { texto: 'comprar café', prazo: '2026-10-04', prioridade: 'média', status: 'a fazer' } } },

  // tarefa em texto livre
  { frase: 'ligar pro dentista amanhã', esperado: { tipo: 'tarefa', minConfianca: 0.8, campos: { texto: 'ligar pro dentista', prazo: '2026-10-02' } } },
  { frase: 'Ligar pro banco na sexta', esperado: { tipo: 'tarefa', campos: { texto: 'Ligar pro banco', prazo: '2026-10-02' } } },
  { frase: 'preciso comprar presente da mãe até sábado', esperado: { tipo: 'tarefa', campos: { texto: 'comprar presente da mãe', prazo: '2026-10-03' } } },
  { frase: 'tenho que entregar o relatório da weg dia 15', esperado: { tipo: 'tarefa', campos: { texto: 'entregar o relatório da weg', projeto: 'weg', prazo: '2026-10-15' } } },
  { frase: 'lembrar de pagar o boleto', esperado: { tipo: 'tarefa', campos: { texto: 'pagar o boleto', prazo: '2026-10-04' } } },
  { frase: 'não esquecer de ligar pra vó', esperado: { tipo: 'tarefa', campos: { texto: 'ligar pra vó' } } },
  { frase: 'estudar estatística semana que vem', esperado: { tipo: 'tarefa', campos: { texto: 'estudar estatística', prazo: '2026-10-05' } } },
  { frase: 'revisar slides amanhã', aba: 'weg', esperado: { tipo: 'tarefa', campos: { projeto: 'weg', prazo: '2026-10-02' } } },
  { frase: 'mandar email pro orientador sobre o tcc daqui a 3 dias', esperado: { tipo: 'tarefa', campos: { projeto: 'tcc', prazo: '2026-10-04' } } },

  // sinal fraco → salva como nota e pergunta
  { frase: 'estudar estatística', esperado: { tipo: 'nota', pergunta: true } },
  { frase: 'comprar pão', esperado: { tipo: 'nota', pergunta: true } },
  { frase: 'reunião com orientador sexta', esperado: { tipo: 'nota', pergunta: true } },

  // acervo
  { frase: 'https://arxiv.org/abs/2005.11401 paper do RAG #tcc', esperado: { tipo: 'link', campos: { url: 'https://arxiv.org/abs/2005.11401', contexto: 'paper do RAG #tcc', tags: ['tcc'] } } },
  { frase: '"a persistência é o caminho do êxito"', esperado: { tipo: 'trecho', campos: { texto: 'a persistência é o caminho do êxito' } } },
];

// Frases que só a IA precisa acertar (as regras não são obrigadas). Ficam fora da exigência automática.
export const FRASES_IA = [
  { frase: 'me lembra de ver aquele documentário que o João indicou', esperado: { tipo: 'tarefa' } },
  { frase: 'acho que vou precisar trocar o pneu do carro logo', esperado: { tipo: 'tarefa' } },
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Roda a régua. `interpretar(frase, ctx)` é qualquer intérprete que siga o contrato (regras, IA, os dois).
// `ctxBase(frase)` monta o contexto (projetos, entradas…). Devolve [{ frase, ok, motivo, veio }].
export async function rodarFrases(interpretar, frases = FRASES, ctxBase = () => ({})) {
  const [y, m, d] = HOJE.split('-').map(Number);
  const out = [];
  for (const f of frases) {
    const ctx = { ...ctxBase(f), now: new Date(y, m - 1, d, 12, 0), aba: f.aba || null };
    let r, motivo = '';
    try { r = await interpretar(f.frase, ctx); } catch (e) { motivo = 'erro: ' + e.message; }
    const e = f.esperado;
    if (!motivo && !r) motivo = 'sem resposta';
    if (!motivo && r.tipo !== e.tipo) motivo = `tipo ${r.tipo}, esperado ${e.tipo}`;
    if (!motivo && e.pergunta !== undefined && !!r.pergunta !== e.pergunta) motivo = e.pergunta ? 'deveria perguntar' : 'perguntou sem precisar';
    if (!motivo && e.minConfianca !== undefined && !(r.confianca >= e.minConfianca)) motivo = `confiança ${r.confianca} < ${e.minConfianca}`;
    for (const [k, v] of Object.entries(e.campos || {})) {
      if (!motivo && !same(r.campos?.[k], v)) motivo = `${k}: veio ${JSON.stringify(r.campos?.[k])}, esperado ${JSON.stringify(v)}`;
    }
    out.push({ frase: f.frase, ok: !motivo, motivo, veio: r });
  }
  return out;
}
