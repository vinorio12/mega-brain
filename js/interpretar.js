// interpretar(texto): a função única por onde passa tudo o que o Vini escreve.
//
// Ordem, sempre:
//   1. regras (provedor-regras.js). Confiança >= limiar (0.7) → vale.
//   2. confiança baixa e IA ligada → pergunta à IA. Resposta boa (>= limiar) → vale.
//   3. senão → salva como NOTA e marca pergunta: true, com o palpite ("era tarefa?"). Nunca perde o texto.
// Tarefa forçada (/t, "- "), erro de marcador e "nota:" não passam pela IA: já são certeza.
//
// Devolve sempre o contrato de js/tipos.js. `previa` é a versão instantânea (só regras) pra mostrar
// a cada tecla o que o Enter vai fazer; a IA nunca é chamada por tecla.

import { REGISTRO } from './tipos.js';
import { provedorRegras } from './provedor-regras.js';
import { INTERPRETADOR } from './config.js';

export function criarInterpretador({ regras = provedorRegras, ia = null, config = INTERPRETADOR, registro = REGISTRO } = {}) {
  const limiar = config.limiar ?? 0.7;

  function comoNota(r, texto, ctx) {
    const n = registro.get('nota').reconhecer(texto, ctx);
    const pes = Object.fromEntries(['pessoas', 'pessoasNovas', 'pessoasAmbiguas'].filter(k => r[k]).map(k => [k, r[k]]));
    return { tipo: 'nota', campos: n.campos, confianca: r.confianca, origem: r.origem, auto: [], provedor: r.provedor, texto: r.texto, pergunta: true, palpite: r.tipo, ...pes };
  }
  const certeza = (r, ctx) => r.confianca >= limiar || !!r.erro || !!ctx.forcar;

  function previa(texto, ctx = {}) {
    const r = regras.interpretar(texto, ctx);
    if (!r) return null;
    return certeza(r, ctx) ? r : comoNota(r, texto, ctx);
  }

  async function interpretar(texto, ctx = {}) {
    const r = regras.interpretar(texto, ctx);
    if (!r) return null;
    if (certeza(r, ctx)) return r;
    if (ia?.ligado()) {
      const x = await ia.interpretar(texto, ctx);
      if (x && x.confianca >= limiar) return x;
    }
    return comoNota(r, texto, ctx);
  }

  return { interpretar, previa, limiar, ia };
}

// o intérprete do app: regras + IA desligada (o app.js liga a IA de verdade quando ela existir)
const padrao = criarInterpretador();
export const interpretar = (texto, ctx) => padrao.interpretar(texto, ctx);
export const previa = (texto, ctx) => padrao.previa(texto, ctx);
