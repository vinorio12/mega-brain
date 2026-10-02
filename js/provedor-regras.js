// Provedor de regras: o intérprete que roda hoje, sem internet e sem custo. Síncrono (serve pra prévia a cada tecla).
//
// Roda o reconhecer() de cada tipo registrado e fica com o de maior confiança.
// Nenhum tipo deu sinal → nota (0.8, sem pergunta). Começou com "nota:" → nota (1.0), sem pensar.
// Sinal fraco (ex: "estudar estatística", confiança 0.6) volta como está: quem decide perguntar é o interpretar().
// Devolve sempre o contrato de js/tipos.js, já validado.

import { REGISTRO, validarInterpretacao } from './tipos.js';
import './tipos-base.js';

export function criarProvedorRegras(registro = REGISTRO) {
  function montar(tipo, r, texto) {
    const obj = { tipo, campos: r.campos, confianca: r.confianca, origem: 'regra', auto: r.auto || [], provedor: 'regras', texto };
    if (r.erro) obj.erro = r.erro;
    return validarInterpretacao(obj, registro);
  }

  function interpretar(texto, ctx = {}) {
    const t = String(texto ?? '').trim();
    if (!t) return null;
    const nota = registro.get('nota');

    // forçado (/t, /tipo tarefa) ou escape "nota:"
    const forcado = ctx.forcar || (/^nota:/i.test(t) ? 'nota' : null);
    if (forcado) {
      const tipo = registro.get(forcado);
      const r = tipo?.reconhecer?.(t, ctx);
      if (r) { const v = montar(forcado, { ...r, confianca: 1 }, t); if (v.ok) return v.valor; }
    }

    let best = null;
    for (const tipo of registro.lista()) {
      if (tipo.id === 'nota' || !tipo.reconhecer) continue;
      let r = null;
      try { r = tipo.reconhecer(t, ctx); } catch (e) { console.warn('reconhecer', tipo.id, e); }
      if (r && (!best || r.confianca > best.r.confianca)) best = { tipo, r };
    }
    if (best) {
      const v = montar(best.tipo.id, best.r, t);
      if (v.ok) return v.valor;
      console.warn('regras: resposta fora do contrato', best.tipo.id, v.erro);
    }
    const v = montar('nota', nota.reconhecer(t, ctx), t);
    return v.valor;
  }

  return { id: 'regras', origem: 'regra', interpretar };
}

export const provedorRegras = criarProvedorRegras();
