// Arrumação dos dados (v0.14, etapa 7): o que limpar ou corrigir no que já está gravado. Função pura, testada em tests/.
// Só SUGERE: quem aplica é o /arrumar (js/comandos/dados.js), e só depois do seu /sim.
//
//   sugestoesArrumacao(entries, { projetos, statuses, comandos, ler }) → [{ acao, ids, texto, motivo, extra? }]
//     acao: 'apagar' · 'fatura' (gasto que era pagamento de fatura) · 'tirar-tag' (#tag que não é projeto no título)
//           · 'sem-prazo' (tarefas abertas com prazo automático, juntas numa sugestão)
//     ler(texto) → { tipo, pergunta } (o intérprete de hoje: "pix de 270" seria gasto)

import { acharForma, ehPagamentoFatura } from './financas.js';
import { lerAtalhoTarefa } from './conversa.js';
import { isTask, doneAt } from './tasks.js';

const strip = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const SIM_NAO = /^(?:s|sim|n|nao|ok|isso)$/;
const TAG = /#([\p{L}\p{N}_-]+)/gu;

export function sugestoesArrumacao(entries = [], { projetos = [], statuses = [], comandos = [], ler = () => null } = {}) {
  const out = [];
  const cmds = new Set(comandos.map(strip));
  const nomesStatus = new Set(statuses.map(s => strip(s.name || s)));

  for (const e of entries) {
    const t = String(e.text || '').trim(), k = strip(t);
    // notas que eram resposta a uma pergunta ou tentativa de comando (antes da v0.14 viravam nota)
    if (!e.kind || e.kind === 'nota') {
      let motivo = null;
      if (acharForma(k)) motivo = 'resposta ao "forma?"';
      else if (SIM_NAO.test(k)) motivo = 'resposta a uma pergunta';
      else if (cmds.has(k.replace(/^\//, ''))) motivo = `era o comando /${k.replace(/^\//, '')}`;
      else if (lerAtalhoTarefa(t, { statuses })) motivo = 'era pra mexer numa tarefa';
      else {
        const r = ler(t);
        if (r && r.tipo && r.tipo !== 'nota' && !r.pergunta) motivo = `tentativa · hoje seria ${r.tipo}`;
      }
      if (motivo) out.push({ acao: 'apagar', ids: [e.id], texto: t, kind: 'nota', motivo });
      continue;
    }
    if (isTask(e)) {
      // tarefa com nome de status ou de comando ("fazendo"): era pra mudar o status de outra
      if (!doneAt(e) && (nomesStatus.has(k) || cmds.has(k))) { out.push({ acao: 'apagar', ids: [e.id], texto: t, kind: 'tarefa', motivo: 'era pra mudar o status de outra tarefa' }); continue; }
      // #tag que não é projeto no título
      const novas = [...t.matchAll(TAG)].map(m => m[1].toLowerCase()).filter(x => !projetos.includes(x));
      // o projeto escolhido pelo app (chute) também sai: criando o projeto da #tag, a tarefa vai pra ele sozinha
      const chute = (e.data?.auto?.campos || []).includes('projeto') && e.data?.projeto ? e.data.projeto : null;
      if (novas.length) out.push({ acao: 'tirar-tag', ids: [e.id], texto: t, kind: 'tarefa', motivo: `#${novas.join(' #')} não é projeto${chute ? ` · o #${chute} foi chute do app` : ''}`, extra: { tags: novas, chute } });
      continue;
    }
    // gasto que era pagamento de fatura (contava duas vezes: no mês e na fatura)
    if (e.kind === 'gasto' && ehPagamentoFatura(t)) out.push({ acao: 'fatura', ids: [e.id], texto: t, kind: 'gasto', motivo: 'pagar a fatura não é gasto (contava duas vezes)' });
  }
  // tarefas abertas que ganharam prazo sozinhas (antes da v0.14 o prazo era automático): uma sugestão só
  const auto = entries.filter(e => isTask(e) && !doneAt(e) && e.data?.prazo && (e.data?.auto?.campos || []).includes('prazo'));
  if (auto.length) out.push({ acao: 'sem-prazo', ids: auto.map(e => e.id), texto: `${auto.length} tarefa${auto.length > 1 ? 's' : ''} com prazo automático`, kind: 'tarefa', motivo: 'o prazo foi inventado pelo app, não por você' });
  return out;
}

// o título sem as #tags que não são projeto: "enviar comprovante #faculdade" → "enviar comprovante"
export const semTags = (texto, tags = []) => tags.reduce((t, tag) => t.replace(new RegExp(`\\s*#${tag}(?![\\p{L}\\p{N}_-])`, 'giu'), ''), String(texto)).replace(/\s+/g, ' ').trim();
