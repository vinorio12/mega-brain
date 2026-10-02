// Provedor de IA: CRIADO E DESLIGADO. Quando a Edge Function `interpretar` existir no Supabase (backlog),
// é só ligar em config.js (INTERPRETADOR.ia.ligada = true): nada mais no app muda.
//
// Como funciona quando ligado:
//   1. cache: a mesma frase no mesmo dia não chama a IA de novo
//   2. guard: trava de custo (limite de chamadas por dia); estourou → fica nas regras
//   3. pede à função do servidor (a chave da IA mora lá, nunca no app) com um pedido CURTO
//   4. a resposta só vale se passar no contrato (validarInterpretacao); senão é ignorada
// Erro, demora (timeoutMs), resposta inválida ou sem rede → devolve null e o intérprete segue com as regras.
// Os ganchos guard e cache já existem; as travas de verdade entram junto com a Edge Function.

import { REGISTRO, validarInterpretacao } from './tipos.js';
import { dayKey } from './util.js';

export const semTrava = { permitir: () => true, registrar: () => {} };
export const semCache = { get: () => null, set: () => {} };

// Trava simples: N chamadas por dia, contadas neste aparelho (a do servidor é a que vale de verdade).
export function travaDiaria(limite, { storage = globalThis.localStorage, key = 'mb.ia.uso.v1', now = () => new Date() } = {}) {
  const ler = () => { try { return JSON.parse(storage.getItem(key)) || {}; } catch { return {}; } };
  return {
    permitir: () => { const u = ler(); return (u.dia === dayKey(now()) ? u.n : 0) < limite; },
    registrar: () => {
      const u = ler(), dia = dayKey(now());
      try { storage.setItem(key, JSON.stringify({ dia, n: (u.dia === dia ? u.n : 0) + 1 })); } catch {}
    },
  };
}

// O que vai pra IA: só o necessário (cada caractere custa). Nada das suas notas vai junto.
export function montarPedido(texto, ctx = {}, { registro = REGISTRO, modelo } = {}) {
  const now = ctx.now || new Date();
  const reg = ctx.reg;
  return {
    modelo,
    texto: String(texto),
    hoje: dayKey(now),
    dia_semana: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][now.getDay()],
    aba: ctx.aba || null,
    tipos: registro.schema(),
    projetos: reg ? reg.projects : [],
    palavras: reg?.palavras || {},
    status: reg ? reg.statuses.map(s => s.name) : [],
  };
}

function comPrazo(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error('a IA demorou demais')), ms); })])
    .finally(() => clearTimeout(t));
}

// invoke(pedido) → resposta no formato do contrato (sem precisar de origem/texto: o app completa)
export function criarProvedorIA({ invoke = null, config = {}, registro = REGISTRO, guard = semTrava, cache = semCache, onError = e => console.warn('ia', e) } = {}) {
  const ligado = () => !!config.ligada && typeof invoke === 'function';
  return {
    id: 'ia',
    origem: 'ia',
    ligado,
    async interpretar(texto, ctx = {}) {
      if (!ligado()) return null;
      const chave = `${dayKey(ctx.now || new Date())}|${ctx.aba || ''}|${String(texto).trim().toLowerCase()}`;
      try {
        const hit = await cache.get(chave);
        if (hit) return hit;
        if (!(await guard.permitir())) return null;
        const resposta = await comPrazo(Promise.resolve(invoke(montarPedido(texto, ctx, { registro, modelo: config.modelo }))), config.timeoutMs || 4000);
        await guard.registrar();
        const v = validarInterpretacao({ ...resposta, origem: 'ia', texto: String(texto), provedor: 'ia-' + (config.modelo || '?') }, registro);
        if (!v.ok) { onError(new Error('resposta fora do contrato: ' + v.erro)); return null; }
        await cache.set(chave, v.valor);
        return v.valor;
      } catch (e) {
        onError(e);
        return null;
      }
    },
  };
}
