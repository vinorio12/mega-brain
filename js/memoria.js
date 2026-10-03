// Memória que aprende com o uso (Fase 2.5, generalizada na Fase 3a). Funções puras, testadas em tests/.
//
// Uma PISTA é uma pessoa ('pessoa:<id>') ou uma palavra ('palavra:planilha', 'palavra:ifood'). Pra cada pista
// e cada CAMPO a memória sabe em quais valores ela apareceu e com que força:
//   projeto            tarefas (e notas com #projeto)
//   categoria:gasto    gastos   (alimentação, mercado...)      categoria:entrada  entradas (salário, freela...)
//   forma              gastos e entradas (pix, credito, debito, dinheiro, boleto)
//   tipo               verbos que você ensinou ('verbo:abasteci' → gasto) · só por /sim, nunca sozinho
// Pesos: o app decidiu (e você não mexeu) 1 · você escreveu ou confirmou 2 · você CORRIGIU (lido do histórico) 3
//        nota com #projeto 1 · o PADRÃO não é evidência ("outros" sem pista vale 0, senão ele se reforça sozinho)
// Nada disso é guardado à parte: sai das entradas e do histórico que já existem (corrigiu → a próxima leitura já sabe).
// Só o que você decide por comando vira registro (kind 'memoria', só cresce, o mais novo vale):
//   { kind: 'memoria', text: 'ifood', data: { chave: 'palavra:ifood', campo: 'categoria:gasto', acao: 'fixar' | 'bloquear' | 'desafixar' | 'limpar', valor: 'alimentação' } }
//   (registros antigos, sem campo, são de projeto e guardam o valor em data.projeto)
// As palavras-chave antigas do /palavras (data.palavras do projeto) contam como "fixar" no campo projeto.
//
// Uma pista só VOTA quando um valor domina (MEMORIA.dominancia do peso e peso >= MEMORIA.pesoMinimo).

import { isTask, projectOf, registry, guessProject } from './tasks.js';
import { MEMORIA } from './config.js';
import { PALAVRAS_DE_DINHEIRO } from './financas.js';

const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = s => fold(s).replace(/#[a-z0-9_-]+/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
const STOP = new Set(('pra para pro com que uma uns umas dos das por mais como sem sobre nao sim ate apos entre isso esse essa este esta tem ter ser ' +
  'fazer feito ver hoje amanha ontem depois antes semana dia mes ano agora tudo nada muito pouco ainda tambem mesmo quando onde porque pois ' +
  'falar ligar mandar esperando aguardando depende comecei fazendo preciso tenho lembrar esquecer').split(' ').concat(PALAVRAS_DE_DINHEIRO));

export const CAMPO_PADRAO = 'projeto';
// o campo da categoria de cada tipo de dinheiro
export const campoCategoria = tipo => 'categoria:' + tipo;

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

// o que uma entrada ensina: [{ campo, valor, peso }] (peso 0 = não conta)
function licoes(e, { projetos, corrigidos }) {
  if (isTask(e)) {
    const p = projectOf(e, projetos);
    if (!p) return [];
    const auto = (e.data?.auto?.campos || []).includes('projeto');
    return [{ campo: 'projeto', valor: p, peso: corrigidos.get('projeto')?.has(e.id) ? 3 : auto ? 1 : e.data?.auto ? 2 : 1 }];
  }
  if (e.kind === 'gasto' || e.kind === 'entrada') {
    const auto = e.data?.auto?.campos || [];
    const out = [];
    const cat = e.data?.categoria;
    if (cat) {
      const padrao = cat === 'outros' && auto.includes('categoria');
      out.push({ campo: campoCategoria(e.kind), valor: cat, peso: corrigidos.get('categoria')?.has(e.id) ? 3 : padrao ? 0 : auto.includes('categoria') ? 1 : 2 });
    }
    const forma = e.data?.forma;
    if (forma) out.push({ campo: 'forma', valor: forma, peso: corrigidos.get('forma')?.has(e.id) ? 3 : auto.includes('forma') ? 1 : 2 });
    const p = (e.tags || []).find(t => projetos.includes(t)); // "gastei 30 no xerox #tcc" também ensina o projeto
    if (p) out.push({ campo: 'projeto', valor: p, peso: 1 });
    return out;
  }
  const p = (e.tags || []).find(t => projetos.includes(t));
  return p ? [{ campo: 'projeto', valor: p, peso: 1 }] : [];
}

export function criarMemoria(entries = [], records = [], { reg = registry([]), pessoas = [], config = MEMORIA } = {}) {
  const projetos = reg.projects;
  const excluir = new Set([...projetos.map(fold), ...pessoas.flatMap(p => p.chaves.flatMap(k => k.split(' ')))]);
  const nomeDe = new Map(pessoas.map(p => [p.id, p.nome]));
  const id = (campo, k) => campo + '|' + k;

  // decisões manuais por (campo, pista): fixado, bloqueados, e "limpar" (esquece o que veio antes)
  const manual = new Map();
  const estado = (campo, k) => { const i = id(campo, k); if (!manual.has(i)) manual.set(i, { campo, chave: k, fixado: null, bloqueados: new Set(), desde: 0 }); return manual.get(i); };
  for (const [p, ws] of Object.entries(reg.palavras || {})) for (const w of ws) estado('projeto', 'palavra:' + tokens(w).join(' ')).fixado = p;
  for (const r of records.filter(e => e.kind === 'memoria' && e.data?.chave).sort((a, b) => a.ts - b.ts)) {
    const s = estado(r.data.campo || CAMPO_PADRAO, r.data.chave), v = r.data.valor ?? r.data.projeto;
    if (r.data.acao === 'fixar' && v) { s.fixado = v; s.bloqueados.delete(v); }
    else if (r.data.acao === 'bloquear' && v) { s.bloqueados.add(v); if (s.fixado === v) s.fixado = null; }
    else if (r.data.acao === 'desafixar') s.fixado = null;
    else if (r.data.acao === 'limpar') { s.fixado = null; s.bloqueados.clear(); s.desde = r.ts; }
  }

  // entradas que você corrigiu, por campo (histórico). Preencher o que estava vazio ou no padrão ("outros") não é
  // correção: vale como "você escreveu" (2). Mudar o que o app tinha chutado é correção (3).
  const corrigidos = new Map();
  for (const ev of records) {
    if (ev.kind !== 'evento' || ev.data?.acao !== 'alterada' || ev.data?.origem === 'desfazer') continue;
    for (const [c, [de]] of Object.entries(ev.data?.mudancas || {})) {
      if (!['projeto', 'categoria', 'forma'].includes(c)) continue;
      if (c !== 'projeto' && (!de || (c === 'categoria' && de === 'outros'))) continue;
      if (!corrigidos.has(c)) corrigidos.set(c, new Set());
      corrigidos.get(c).add(ev.data.alvo);
    }
  }

  const pistas = new Map(); // campo|chave → Map(valor → peso)
  const soma = (campo, k, v, peso, ts) => {
    const desde = manual.get(id(campo, k))?.desde || 0;
    if (desde && ts <= desde) return; // "limpar" esquece tudo até aquele instante (inclusive)
    const i = id(campo, k);
    if (!pistas.has(i)) pistas.set(i, new Map());
    pistas.get(i).set(v, (pistas.get(i).get(v) || 0) + peso);
  };
  for (const e of entries) {
    for (const { campo, valor, peso } of licoes(e, { projetos, corrigidos })) {
      if (!peso) continue;
      for (const pid of e.data?.pessoas || []) soma(campo, 'pessoa:' + pid, valor, peso, e.ts || 0);
      for (const w of palavrasDe(e.text, excluir)) soma(campo, 'palavra:' + w, valor, peso, e.ts || 0);
    }
  }

  const rotulo = k => (k.startsWith('pessoa:') ? nomeDe.get(k.slice(7)) || '?' : k.slice(k.indexOf(':') + 1));

  // o que a memória sabe de uma pista num campo
  // (porProjeto = [[valor, peso], ...] do mais forte pro mais fraco · o nome ficou da Fase 2.5, vale pra qualquer campo)
  function info(k, campo = CAMPO_PADRAO) {
    const m = manual.get(id(campo, k));
    const bloq = m?.bloqueados || new Set();
    const por = [...(pistas.get(id(campo, k)) || new Map())].filter(([p]) => !bloq.has(p)).sort((a, b) => b[1] - a[1]);
    const total = por.reduce((s, [, w]) => s + w, 0);
    const base = { chave: k, campo, rotulo: rotulo(k), porProjeto: por, total, fixado: m?.fixado || null, bloqueados: [...bloq] };
    if (m?.fixado) return { ...base, estado: 'fixado', dominante: m.fixado, peso: por.find(([p]) => p === m.fixado)?.[1] || 0 };
    if (!total) return { ...base, estado: 'nada', dominante: null };
    const [top, w] = por[0];
    if (total < config.pesoMinimo) return { ...base, estado: 'pouca', dominante: null };
    if (w / total >= config.dominancia) return { ...base, estado: 'dominante', dominante: top, peso: w };
    return { ...base, estado: 'dividida', dominante: null };
  }

  // pistas presentes numa frase: as pessoas reconhecidas + as palavras + palavras fixadas com espaço ("banca de defesa")
  function pistasDaFrase(texto, pessoasIds = [], campo = CAMPO_PADRAO) {
    const ks = [...pessoasIds.map(pid => 'pessoa:' + pid), ...palavrasDe(texto, excluir).map(w => 'palavra:' + w)];
    const frase = ' ' + tokens(texto).join(' ') + ' ';
    for (const s of manual.values()) if (s.campo === campo && s.chave.startsWith('palavra:') && s.chave.includes(' ') && frase.includes(' ' + s.chave.slice(8) + ' ')) ks.push(s.chave);
    return [...new Set(ks)].map(k => info(k, campo));
  }

  // todas as pistas conhecidas de um campo (pro /memoria) · sem campo = todos
  const todas = (campo = null) => {
    const ids = new Set([...pistas.keys(), ...manual.keys()]);
    return [...ids].map(i => { const c = i.slice(0, i.indexOf('|')); return [c, i.slice(c.length + 1)]; })
      .filter(([c]) => !campo || c === campo).map(([c, k]) => info(k, c));
  };

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

// Decide um campo qualquer (categoria, forma) só pelas pistas da frase. Devolve { valor | null, motivo }.
//   o que você fixou manda (se as fixadas concordam) → pistas dominantes (se discordam: 'conflito') →
//   alguma pista dividida: 'dividida' (não chuta) → 'nada' (quem chamou decide: semente, padrão, pergunta)
//   validos: só aceita esses valores (ex: as categorias que existem hoje)
export function decidirPorPistas(texto, campo, { mem, pessoas = [], validos = null } = {}) {
  if (!mem) return { valor: null, motivo: { tipo: 'nada' } };
  const ok = v => !validos || validos.includes(v);
  const ps = mem.pistasDaFrase(texto, pessoas, campo);
  const explica = i => ({ tipo: 'pista', pista: i.rotulo, estado: i.estado, peso: i.peso, total: i.total });
  for (const grupo of [ps.filter(i => i.estado === 'fixado' && ok(i.dominante)), ps.filter(i => i.estado === 'dominante' && ok(i.dominante))]) {
    if (!grupo.length) continue;
    const vals = [...new Set(grupo.map(i => i.dominante))];
    if (vals.length > 1) return { valor: null, motivo: { tipo: 'conflito', pistas: grupo.map(i => ({ pista: i.rotulo, valor: i.dominante })) } };
    const melhor = grupo.sort((a, b) => (b.peso || 0) - (a.peso || 0))[0];
    return { valor: vals[0], motivo: explica(melhor) };
  }
  const dividida = ps.find(i => i.estado === 'dividida');
  if (dividida) return { valor: null, motivo: { tipo: 'dividida', pista: dividida.rotulo, porValor: dividida.porProjeto } };
  return { valor: null, motivo: { tipo: 'nada' } };
}
