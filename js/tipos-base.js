// Tipos base do intérprete (Fase 2): nota, tarefa, link, trecho.
// Cada fase futura cria o seu arquivo e chama registrarTipo (veja js/tipos.js).
//
// reconhecer(texto, ctx) → { confianca, campos, auto?, erro? } | null
//   ctx: { reg (projetos e status), entries, now, aba (projeto da aba atual), forcar ('tarefa' no /t) }
// Confiança da tarefa em texto livre:
//   "- " ou /t = 1 · marcadores @status >prazo !prio = 0.9 · "preciso / tenho que / lembrar de…" = 0.8
//   verbo no infinitivo no começo + data = 0.8 · só o verbo = 0.6 · só uma data futura = 0.6 (fracos: viram pergunta)

import { REGISTRO } from './tipos.js';
import { tagsOf, dayKey } from './util.js';
import { parseTaskInput, fillByRules, registry, newTask, PRIORITIES, matchStatus } from './tasks.js';
import { findPessoas, candidatosPessoa } from './pessoas.js';
import { parseLink, parseSnippet } from './acervo.js';
import { findDate } from './dates.js';
import { RASTREAR } from './historico.js';

// começos que dizem "isto é uma tarefa" (saem do texto)
const INTRO = /^(?:eu\s+)?(?:preciso|tenho\s+(?:que|de)|temos\s+que|vou\s+ter\s+que|devo|lembrar\s+de|lembrete:?|n[aã]o\s+(?:posso\s+)?esquecer\s+de|falta)\s+/i;
// palavras terminadas em -ar/-er/-ir que não são verbo
const NAO_VERBO = new Set(('lugar mar bar lar par luar celular familiar popular particular militar escolar similar regular titular auxiliar ' +
  'solar polar lazer qualquer mulher colher prazer talher acucar radar hangar altar dolar bilhar milhar exemplar singular peculiar ' +
  'elixir').split(' '));
const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// a primeira palavra parece verbo no infinitivo? ("ligar", "revisar", "ler", "ir")
export function comecaComVerbo(texto) {
  const w = strip(String(texto).trim().split(/\s+/)[0] || '').replace(/[^a-z]/g, '');
  return (w.length >= 3 || w === 'ir') && /(ar|er|ir)$/.test(w) && !NAO_VERBO.has(w);
}

// "tô fazendo os slides", "estou fazendo", "comecei o relatório", "já comecei a ler"
const FAZENDO = /^(?:eu\s+)?(?:(?:t[oô]|tou|estou|to)\s+fazendo|(?:j[aá]\s+)?comecei)(?=\s|$)/i;
// "esperando o João…", "aguardando a Ana", "depende do Pedro", "esperando retorno da Bia": só vale se vier uma pessoa
const ESPERA = /(?:^|\s)(?:esperando|aguardando|esperar|aguardar|depende)\s+(?:(?:de|do|da|dos|das|o|a|os|as)\s+)?(?:(?:retorno|resposta|aprova[cç][aã]o|ok|confirma[cç][aã]o)\s+(?:do|da|de|dos|das)\s+)?/gi;
export function esperandoAlguem(texto, ctx = {}) {
  const pessoas = ctx.pessoas || [];
  const known = findPessoas(texto, pessoas);
  const novos = candidatosPessoa(texto, { pessoas, projetos: ctx.reg?.projects || [], ignorar: ctx.ignorarPessoas || [] });
  for (const m of String(texto).matchAll(ESPERA)) {
    const pos = m.index + m[0].length;
    if (known.some(a => a.inicio === pos) || novos.some(c => c.inicio === pos)) return true;
  }
  return false;
}

const ctxDe = ctx => ({ reg: ctx?.reg || registry([]), entries: ctx?.entries || [], now: ctx?.now || new Date(), aba: ctx?.aba || null });
const stamp = now => ({ ts: now.getTime(), day: dayKey(now) });

export function registrarTiposBase(r = REGISTRO) {
  r.registrar({
    id: 'nota', rotulo: 'nota',
    campos: { texto: { tipo: 'texto', obrigatorio: true }, tags: { tipo: 'lista' } },
    exemplos: ['li um artigo bom sobre RAG #tcc'],
    // nota é o que sobra: o provedor só usa isto quando nenhum outro tipo deu sinal
    reconhecer(texto, ctx) {
      const { aba } = ctxDe(ctx);
      let t = String(texto).trim().replace(/^nota:\s*/i, '');
      if (aba && !tagsOf(t).includes(aba)) t += ' #' + aba; // dentro de uma aba, a nota ganha a #tag dela
      return { confianca: 0.8, campos: { texto: t, tags: tagsOf(t) } };
    },
    montar: (i, ctx) => ({ text: i.campos.texto, tags: tagsOf(i.campos.texto), kind: 'nota', ...stamp(ctxDe(ctx).now) }),
  });

  r.registrar({
    id: 'tarefa', rotulo: 'tarefa',
    campos: {
      texto: { tipo: 'texto', obrigatorio: true }, projeto: { tipo: 'texto' }, status: { tipo: 'texto' },
      prazo: { tipo: 'data' }, prioridade: { tipo: 'enum', valores: PRIORITIES }, tags: { tipo: 'lista' },
    },
    rastrear: RASTREAR.tarefa,
    exemplos: ['ligar pro dentista amanhã', 'preciso entregar o relatório da weg dia 15', '- revisar cap 2 #tcc >sex !alta'],
    reconhecer(texto, ctx) {
      const { reg, entries, now, aba } = ctxDe(ctx);
      const today = dayKey(now);
      const explicito = ctx?.forcar === 'tarefa' || /^-\s+\S/.test(texto);
      let raw = String(texto).trim().replace(/^-\s+/, '');
      const intro = raw.match(INTRO);
      if (intro) raw = raw.slice(intro[0].length);
      const marcador = /(^|\s)[@>!]\S/.test(raw);
      // status pela frase (Fase 2.5): "esperando o João…" → esperando · "tô fazendo…", "comecei…" → fazendo
      const espera = esperandoAlguem(raw, ctx);
      const fazendo = FAZENDO.test(raw);
      // data falada ("amanhã", "dia 15"), só se não tem >prazo e se não é passado
      let data = /(^|\s)>\S/.test(raw) ? null : findDate(raw, now);
      if (data && data.data < today) data = null;
      // se tirar a data não sobra texto ("segunda @fazendo"), a palavra é a tarefa, não a data
      if (data && !data.resto.split(/\s+/).some(w => w && !/^[#@>!]/.test(w))) data = null;
      const verbo = comecaComVerbo(raw);

      let confianca = explicito ? 1 : marcador ? 0.9 : intro || espera || fazendo ? 0.8 : verbo && data ? 0.8 : verbo ? 0.6 : data && data.data > today ? 0.6 : 0;
      if (!confianca) return null;

      const p = parseTaskInput(data ? data.resto : raw, { ctx: aba, reg, now });
      if (!p.error && !p.status && (espera || fazendo)) p.status = matchStatus(espera ? 'esperando' : 'fazendo', reg.statuses);
      if (p.error) {
        // marcador errado: na tarefa explícita é erro pra mostrar; em texto livre, não era tarefa
        return explicito ? { confianca: 1, campos: { texto: raw || '-' }, erro: { codigo: p.error, token: p.token || '' } } : null;
      }
      if (data && (p.prazo === null || p.prazo === undefined)) p.prazo = data.data;
      const { values, auto } = fillByRules(p, { entries, reg, now });
      return {
        confianca,
        campos: { texto: p.text, projeto: values.projeto, status: values.status, prazo: values.prazo, prioridade: values.prioridade, tags: [...new Set([values.projeto, ...p.tags].filter(Boolean))] },
        auto,
      };
    },
    montar: (i, ctx) => {
      const e = newTask({
        text: i.campos.texto, tags: i.campos.tags || [], prazo: i.campos.prazo || null, projeto: i.campos.projeto || null,
        status: i.campos.status, prioridade: i.campos.prioridade || 'média', auto: { campos: i.auto || [], fonte: i.origem },
      }, ctxDe(ctx).now);
      // a frase como foi escrita ("ligar pro dentista amanhã"), quando o texto da tarefa ficou diferente
      const frase = String(i.texto || '').replace(/^-\s+/, '').trim();
      if (frase && frase !== i.campos.texto) e.data.frase = frase;
      return e;
    },
  });

  r.registrar({
    id: 'link', rotulo: 'link',
    campos: { url: { tipo: 'url', obrigatorio: true }, contexto: { tipo: 'texto' }, tags: { tipo: 'lista' } },
    exemplos: ['https://arxiv.org/abs/2005.11401 paper do RAG #tcc'],
    reconhecer(texto) {
      const l = parseLink(texto);
      return l ? { confianca: 1, campos: { url: l.url, contexto: l.contexto, tags: l.tags } } : null;
    },
    montar: (i, ctx) => ({
      kind: 'link', text: `${i.campos.url}${i.campos.contexto ? ' ' + i.campos.contexto : ''}`, tags: i.campos.tags || [],
      ...stamp(ctxDe(ctx).now), data: { url: i.campos.url, contexto: i.campos.contexto || '' },
    }),
  });

  r.registrar({
    id: 'trecho', rotulo: 'texto guardado',
    campos: { texto: { tipo: 'texto', obrigatorio: true }, tags: { tipo: 'lista' } },
    exemplos: ['"a persistência é o caminho do êxito"'],
    reconhecer(texto) {
      const s = parseSnippet(texto);
      return s ? { confianca: 1, campos: { texto: s.text, tags: s.tags } } : null;
    },
    montar: (i, ctx) => ({ kind: 'trecho', text: i.campos.texto, tags: i.campos.tags || [], ...stamp(ctxDe(ctx).now), data: {} }),
  });
  return r;
}

registrarTiposBase(REGISTRO);
