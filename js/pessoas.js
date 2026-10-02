// Pessoas (Fase 2.5). Funções puras, testadas em tests/.
//
// Cadastro = registro escondido (sincroniza, só do dono):
//   { kind: 'pessoa', text: 'João Silva', data: { apelidos: ['jão'], arquivada: false, juntada_em: null } }
// As entradas guardam quem aparece nelas em data.pessoas: [id, ...]. O texto fica como foi escrito.
//
// Reconhecer: nome, primeiro nome e apelidos, como palavra inteira, sem ligar pra acento/maiúscula.
//   Sem @ (o @ é do status). "#joao" é tag, não pessoa.
// Nome novo (candidato): palavra com maiúscula no meio da frase ("falar com Ana"), ou depois de
//   "falar com", "ligar pro", "esperando o", "depende da"... ("falar com ana", jeito do celular).
//   Nunca cadastra sozinho: o app pergunta.

const strip = c => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// sem acento e minúsculo, letra por letra (posições iguais às do texto original)
export const fold = s => [...String(s ?? '').normalize('NFC')].map(c => { const f = strip(c); return f.length === c.length ? f : c; }).join('');
const norm = s => fold(s).replace(/\s+/g, ' ').trim();
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const isPessoa = e => e?.kind === 'pessoa';

// Cadastros ativos: { id, nome, apelidos (como foram escritos), chaves (sem acento: nome, 1º nome, apelidos) }
export function pessoasDe(records = []) {
  return records.filter(e => isPessoa(e) && !e.data?.arquivada && !e.data?.juntada_em).map(e => {
    const nome = String(e.text).trim();
    const apelidos = (e.data?.apelidos || []).map(String).filter(Boolean);
    const primeiro = nome.split(/\s+/)[0];
    const chaves = [...new Set([nome, primeiro, ...apelidos].map(norm).filter(k => k.length >= 2))];
    return { id: e.id, nome, apelidos, chaves };
  });
}

// "falar com o João e a Ana" → [{ ids: ['p1'], trecho: 'João', inicio, fim }, { ids: ['p2'], trecho: 'Ana', ... }]
// ids com mais de um = ambíguo (dois cadastros com o mesmo nome/apelido): quem decide é a memória ou você.
export function findPessoas(texto, pessoas = []) {
  const text = String(texto ?? '').normalize('NFC');
  const low = fold(text);
  const porChave = new Map();
  for (const p of pessoas) for (const k of p.chaves) {
    if (!porChave.has(k)) porChave.set(k, []);
    if (!porChave.get(k).includes(p.id)) porChave.get(k).push(p.id);
  }
  const chaves = [...porChave.keys()].sort((a, b) => b.length - a.length); // "joão pedro" antes de "joão"
  const achados = [];
  const ocupado = (i, f) => achados.some(a => i < a.fim && f > a.inicio);
  for (const k of chaves) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}#@>!/_-])${esc(k).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}_-])`, 'gu');
    for (const m of low.matchAll(re)) {
      const inicio = m.index, fim = m.index + m[0].length;
      if (ocupado(inicio, fim)) continue;
      achados.push({ ids: porChave.get(k), trecho: text.slice(inicio, fim), inicio, fim });
    }
  }
  return achados.sort((a, b) => a.inicio - b.inicio);
}

// palavras que nunca são nome de pessoa
const NAO_NOME = new Set(('segunda terca quarta quinta sexta sabado domingo hoje amanha ontem janeiro fevereiro marco abril maio junho julho agosto ' +
  'setembro outubro novembro dezembro semana mes ano dia noite tarde manha equipe time pessoal galera turma todos todas gente ele ela eles elas voce ' +
  'voces mim ele ela nos dele dela professor professora orientador orientadora chefe gerente cliente cliente mae pai irmao irma vo vovo avo tia tio ' +
  'banco mercado medico dentista eu tu isso isto aquilo tudo nada alguem ninguem cada outro outra').split(' '));
// Só verbos que pedem gente: "falar com ana", "ligar pro rafa". Depois de "esperando o" pode vir coisa
// ("esperando o orçamento"), então ali só vale nome com maiúscula ou alguém já cadastrado.
const GATILHO = /(?:^|[\s,;(])(?:falar|conversar|reuniao|reunir|encontro)\s+com\s+(?:o\s+|a\s+)?$|(?:^|[\s,;(])(?:ligar|perguntar|mandar\s+\S+|responder|pedir)\s+(?:pro|pra|pros|pras|para\s+[oa]|ao)\s+$/;

// Possíveis nomes novos na frase (ainda não cadastrados). ignorar: palavras que você já disse que não são pessoa (/nao).
export function candidatosPessoa(texto, { pessoas = [], projetos = [], status = [], ignorar = [] } = {}) {
  const text = String(texto ?? '').normalize('NFC');
  const low = fold(text);
  const conhecidos = findPessoas(text, pessoas);
  const fora = new Set([...NAO_NOME, ...projetos.map(norm), ...status.flatMap(s => norm(s).split(' ')), ...ignorar.map(norm)]);
  const out = [];
  for (const m of text.matchAll(/(?<![\p{L}\p{N}#@>!/_-])\p{L}[\p{L}'’-]{1,}/gu)) {
    const w = m[0], i = m.index, k = norm(w);
    if (k.length < 3 || fora.has(k)) continue;
    if (conhecidos.some(c => i < c.fim && i + w.length > c.inicio)) continue;
    const antes = low.slice(0, i);
    const maiuscula = /^\p{Lu}\p{Ll}/u.test(w) && i > 0 && !/[.!?]\s*$/.test(text.slice(0, i)) && !/^\s*$/.test(text.slice(0, i));
    if (!maiuscula && !GATILHO.test(antes)) continue;
    if (!out.some(o => norm(o.nome) === k)) out.push({ nome: w.charAt(0).toUpperCase() + w.slice(1), trecho: w, inicio: i });
  }
  return out;
}

// Acha UM cadastro pelo que foi digitado num comando (/pessoa João). Devolve { pessoa } ou { ambiguo: [...] } ou {}.
export function acharPessoa(nome, pessoas = []) {
  const k = norm(nome);
  if (!k) return {};
  const exatos = pessoas.filter(p => norm(p.nome) === k);
  if (exatos.length === 1) return { pessoa: exatos[0] };
  const porChave = pessoas.filter(p => p.chaves.includes(k));
  if (porChave.length === 1) return { pessoa: porChave[0] };
  if (porChave.length > 1) return { ambiguo: porChave };
  return {};
}

// "/pessoa apelido João +jão -joãozinho" → lista nova de apelidos (sem repetir, sem o próprio nome)
export function editApelidos(atual = [], tokens = [], nome = '') {
  let out = [...atual];
  for (const raw of tokens) {
    const tira = raw.startsWith('-');
    const w = raw.replace(/^[+-]/, '').trim();
    if (!w || norm(w) === norm(nome)) continue;
    out = tira ? out.filter(x => norm(x) !== norm(w)) : out.some(x => norm(x) === norm(w)) ? out : [...out, w.toLowerCase()];
  }
  return out;
}

// Juntar: `de` some (fica marcado juntada_em) e tudo dele passa pro `para`. Devolve as versões novas pra gravar.
export function juntarPessoas(de, para, entries = []) {
  const apelidos = editApelidos(para.data?.apelidos || [], [de.text, ...(de.data?.apelidos || [])], para.text);
  const novoPara = { ...para, data: { ...(para.data || {}), apelidos } };
  const novoDe = { ...de, data: { ...(de.data || {}), juntada_em: para.id } };
  const religadas = entries.filter(e => (e.data?.pessoas || []).includes(de.id)).map(e => ({
    ...e, data: { ...e.data, pessoas: [...new Set(e.data.pessoas.map(id => (id === de.id ? para.id : id)))] },
  }));
  return { novoPara, novoDe, religadas };
}

// Tudo sobre pessoas numa frase, no formato do contrato do intérprete:
//   { pessoas: [ids sem dúvida], pessoasAmbiguas: [{ trecho, ids }], pessoasNovas: ['Carla'] }
export function pessoasNaFrase(texto, { pessoas = [], projetos = [], status = [], ignorar = [] } = {}, { novas = true } = {}) {
  const achados = findPessoas(texto, pessoas);
  const out = {
    pessoas: [...new Set(achados.filter(a => a.ids.length === 1).map(a => a.ids[0]))],
    pessoasAmbiguas: achados.filter(a => a.ids.length > 1).map(a => ({ trecho: a.trecho, ids: a.ids })),
    pessoasNovas: novas ? candidatosPessoa(texto, { pessoas, projetos, status, ignorar }).map(c => c.nome) : [],
  };
  return out;
}

// Tudo de uma pessoa (/pessoa João). entries = notas/tarefas/...; eventos = histórico (kind 'evento').
//   esperando: tarefas abertas em "esperando" ligadas a ela · abertas: o resto das abertas
//   feitas: concluídas nos últimos `dias` · notas e outros (gasto, treino...) · projetos: [[nome, quantas]]
export function resumoPessoa(id, entries = [], eventos = [], { now = new Date(), dias = 30, projetos = [] } = {}) {
  const dela = entries.filter(e => (e.data?.pessoas || []).includes(id));
  const tarefa = e => e.kind === 'tarefa';
  const feitoEm = e => e.data?.feito_em ?? e.data?.feito ?? null;
  const abertasTodas = dela.filter(e => tarefa(e) && !feitoEm(e));
  const esperando = abertasTodas.filter(e => e.data?.status === 'esperando');
  const desde = now.getTime() - dias * 864e5;
  const cont = new Map();
  for (const e of dela.filter(tarefa)) {
    const p = e.data?.projeto || (e.tags || []).find(t => projetos.includes(t));
    if (p) cont.set(p, (cont.get(p) || 0) + 1);
  }
  const ids = new Set(dela.map(e => e.id));
  return {
    total: dela.length,
    esperando,
    abertas: abertasTodas.filter(e => !esperando.includes(e)),
    feitas: dela.filter(e => tarefa(e) && feitoEm(e) >= desde),
    notas: dela.filter(e => !e.kind || e.kind === 'nota').sort((a, b) => b.ts - a.ts),
    outros: dela.filter(e => e.kind && !['nota', 'tarefa'].includes(e.kind)).sort((a, b) => b.ts - a.ts),
    projetos: [...cont].sort((a, b) => b[1] - a[1]),
    eventos: eventos.filter(ev => ev.kind === 'evento' && ids.has(ev.data?.alvo)).sort((a, b) => b.ts - a.ts),
  };
}
