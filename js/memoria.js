// Memória que aprende com o uso (Fase 2.5). Funções puras, testadas em tests/.
//
// Uma PISTA é uma pessoa ('pessoa:<id>') ou uma palavra ('palavra:planilha'). Pra cada pista a memória sabe
// em quais projetos ela apareceu e com que força:
//   tarefa com projeto decidido pelo app (e não corrigido) 1 · projeto escrito por você (#weg, aba) 2
//   projeto CORRIGIDO por você (/mover, /editar · lido do histórico) 3 · nota com #projeto 1
// Nada disso é guardado à parte: sai das tarefas e do histórico que já existem (corrigiu → a próxima leitura já sabe).
// Só o que você decide por comando vira registro (kind 'memoria', só cresce, o mais novo vale):
//   { kind: 'memoria', text: 'planilha', data: { chave: 'palavra:planilha', acao: 'fixar' | 'bloquear' | 'limpar', projeto } }
// As palavras-chave antigas do /palavras (data.palavras do projeto) contam como "fixar".
//
// Uma pista só VOTA quando um projeto domina (MEMORIA.dominancia do peso e peso >= MEMORIA.pesoMinimo).
// Decidir o projeto: nome do projeto na frase → pistas que votam (se discordam, não decide) →
//   palavras em comum com tarefas antigas → (pessoa dividida? não decide) → 'pessoal'.

import { isTask, projectOf, registry, guessProject } from './tasks.js';
import { MEMORIA } from './config.js';

const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = s => fold(s).replace(/#[a-z0-9_-]+/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
const STOP = new Set(('pra para pro com que uma uns umas dos das por mais como sem sobre nao sim ate apos entre isso esse essa este esta tem ter ser ' +
  'fazer feito ver hoje amanha ontem depois antes semana dia mes ano agora tudo nada muito pouco ainda tambem mesmo quando onde porque pois ' +
  'falar ligar mandar esperando aguardando depende comecei fazendo preciso tenho lembrar esquecer').split(' '));

// palavras que podem ser pista: 3+ letras, sem as muito comuns, sem número puro, sem as excluídas (projetos, pessoas)
export function palavrasDe(texto, excluir = new Set()) {
  return [...new Set(tokens(texto).filter(w => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w) && !excluir.has(w)))];
}

// chave de uma palavra (ou expressão) na memória: 'palavra:banca de defesa'
export const chavePalavra = w => 'palavra:' + tokens(w).join(' ');

const cache = new WeakMap();
// Versão com cache: recalcula só quando as entradas mudam (a prévia chama a cada tecla).
export function memoriaDe(entries = [], records = [], opts = {}) {
  // a lista de entradas e a de registros mudam (objeto novo) a cada gravação; projetos e pessoas comparam pelo conteúdo
  const sig = JSON.stringify([opts.reg?.projects, opts.reg?.palavras, (opts.pessoas || []).map(p => [p.id, p.chaves])]);
  const hit = cache.get(entries);
  if (hit && hit.records === records && hit.sig === sig) return hit.mem;
  const mem = criarMemoria(entries, records, opts);
  cache.set(entries, { records, sig, mem });
  return mem;
}

export function criarMemoria(entries = [], records = [], { reg = registry([]), pessoas = [], config = MEMORIA } = {}) {
  const projetos = reg.projects;
  const excluir = new Set([...projetos.map(fold), ...pessoas.flatMap(p => p.chaves.flatMap(k => k.split(' ')))]);
  const nomeDe = new Map(pessoas.map(p => [p.id, p.nome]));

  // decisões manuais por pista: fixado, bloqueados, e "limpar" (esquece o que veio antes)
  const manual = new Map();
  const estado = k => { if (!manual.has(k)) manual.set(k, { fixado: null, bloqueados: new Set(), desde: 0 }); return manual.get(k); };
  for (const [p, ws] of Object.entries(reg.palavras || {})) for (const w of ws) estado('palavra:' + tokens(w).join(' ')).fixado = p;
  for (const r of records.filter(e => e.kind === 'memoria' && e.data?.chave).sort((a, b) => a.ts - b.ts)) {
    const s = estado(r.data.chave), p = r.data.projeto;
    if (r.data.acao === 'fixar' && p) { s.fixado = p; s.bloqueados.delete(p); }
    else if (r.data.acao === 'bloquear' && p) { s.bloqueados.add(p); if (s.fixado === p) s.fixado = null; }
    else if (r.data.acao === 'desafixar') s.fixado = null;
    else if (r.data.acao === 'limpar') { s.fixado = null; s.bloqueados.clear(); s.desde = r.ts; }
  }

  // tarefas cujo projeto você corrigiu (histórico)
  const corrigidas = new Set(records.filter(e => e.kind === 'evento' && e.data?.acao === 'alterada' && e.data?.mudancas?.projeto && e.data?.origem !== 'desfazer').map(e => e.data.alvo));

  const pistas = new Map(); // chave → Map(projeto → peso)
  const soma = (k, p, peso, ts) => {
    const desde = manual.get(k)?.desde || 0;
    if (desde && ts <= desde) return; // "limpar" esquece tudo até aquele instante (inclusive)
    if (!pistas.has(k)) pistas.set(k, new Map());
    pistas.get(k).set(p, (pistas.get(k).get(p) || 0) + peso);
  };
  for (const e of entries) {
    let p, peso;
    if (isTask(e)) {
      p = projectOf(e, projetos);
      if (!p) continue;
      const auto = (e.data?.auto?.campos || []).includes('projeto');
      peso = corrigidas.has(e.id) ? 3 : auto ? 1 : e.data?.auto ? 2 : 1;
    } else {
      p = (e.tags || []).find(t => projetos.includes(t));
      if (!p) continue;
      peso = 1;
    }
    for (const id of e.data?.pessoas || []) soma('pessoa:' + id, p, peso, e.ts || 0);
    for (const w of palavrasDe(e.text, excluir)) soma('palavra:' + w, p, peso, e.ts || 0);
  }

  const rotulo = k => (k.startsWith('pessoa:') ? nomeDe.get(k.slice(7)) || '?' : k.slice(k.indexOf(':') + 1));

  // o que a memória sabe de uma pista
  function info(k) {
    const m = manual.get(k);
    const bloq = m?.bloqueados || new Set();
    const por = [...(pistas.get(k) || new Map())].filter(([p]) => !bloq.has(p)).sort((a, b) => b[1] - a[1]);
    const total = por.reduce((s, [, w]) => s + w, 0);
    const base = { chave: k, rotulo: rotulo(k), porProjeto: por, total, fixado: m?.fixado || null, bloqueados: [...bloq] };
    if (m?.fixado) return { ...base, estado: 'fixado', dominante: m.fixado, peso: por.find(([p]) => p === m.fixado)?.[1] || 0 };
    if (!total) return { ...base, estado: 'nada', dominante: null };
    const [top, w] = por[0];
    if (total < config.pesoMinimo) return { ...base, estado: 'pouca', dominante: null };
    if (w / total >= config.dominancia) return { ...base, estado: 'dominante', dominante: top, peso: w };
    return { ...base, estado: 'dividida', dominante: null };
  }

  // pistas presentes numa frase: as pessoas reconhecidas + as palavras + palavras fixadas com espaço ("banca de defesa")
  function pistasDaFrase(texto, pessoasIds = []) {
    const ks = [...pessoasIds.map(id => 'pessoa:' + id), ...palavrasDe(texto, excluir).map(w => 'palavra:' + w)];
    const frase = ' ' + tokens(texto).join(' ') + ' ';
    for (const k of manual.keys()) if (k.startsWith('palavra:') && k.includes(' ') && frase.includes(' ' + k.slice(8) + ' ')) ks.push(k);
    return [...new Set(ks)].map(info);
  }

  // todas as pistas conhecidas (pro /memoria)
  const todas = () => [...new Set([...pistas.keys(), ...manual.keys()])].map(info);

  // a frase sem nomes de pessoas (o desempate fraco por palavras não pode contar o "joão" de novo)
  const semPessoas = texto => tokens(texto).filter(w => !excluir.has(w) || projetos.map(fold).includes(w)).join(' ');

  return { info, pistasDaFrase, todas, rotulo, semPessoas };
}

// Decide o projeto de uma tarefa nova. Devolve { projeto | null, motivo }.
//   motivo.tipo: 'nome' | 'pista' | 'frase' | 'padrao' (decidiu) · 'conflito' | 'dividida' (não chuta: pergunta)
export function decidirProjeto(texto, { mem, pessoas = [], reg = registry([]), entries = [] } = {}) {
  const words = new Set(tokens(texto));
  const nome = reg.projects.find(p => words.has(fold(p)));
  if (nome) return { projeto: nome, motivo: { tipo: 'nome' } };

  const ps = mem ? mem.pistasDaFrase(texto, pessoas) : [];
  const votos = ps.filter(i => i.dominante);
  const projs = [...new Set(votos.map(i => i.dominante))];
  if (projs.length === 1) {
    // a pista mais forte explica a decisão: fixada primeiro, depois a de mais peso
    const melhor = votos.sort((a, b) => (b.estado === 'fixado') - (a.estado === 'fixado') || (b.peso || 0) - (a.peso || 0))[0];
    return { projeto: projs[0], motivo: { tipo: 'pista', pista: melhor.rotulo, estado: melhor.estado, peso: melhor.peso, total: melhor.total } };
  }
  if (projs.length > 1) return { projeto: null, motivo: { tipo: 'conflito', pistas: votos.map(i => ({ pista: i.rotulo, projeto: i.dominante })) } };

  const fraco = guessProject(mem ? mem.semPessoas(texto) : texto, { entries, reg: { ...reg, palavras: {} }, semPadrao: true });
  if (fraco) return { projeto: fraco, motivo: { tipo: 'frase' } };

  const dividida = ps.find(i => i.estado === 'dividida' && i.chave.startsWith('pessoa:'));
  if (dividida) return { projeto: null, motivo: { tipo: 'dividida', pista: dividida.rotulo, porProjeto: dividida.porProjeto } };
  const padrao = reg.projects.includes('pessoal') ? 'pessoal' : reg.projects[0] || null;
  return { projeto: padrao, motivo: { tipo: 'padrao' } };
}
