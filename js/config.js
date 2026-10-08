// Configuração da nuvem (Supabase).
//
// A chave abaixo é a "publishable" (ou "anon public"): ela FOI FEITA pra ficar no site.
// Quem protege os dados são as regras do banco (supabase/001_entries.sql).
// NUNCA coloque aqui a chave "secret" / "service_role".
//
// Com SUPABASE_KEY vazia, o app roda em modo local (só neste navegador).

export const SUPABASE_URL = 'https://xfvfgidvqrubdtogtczy.supabase.co';
// Operadores: o login pede o usuário (ex: "vini") e o app traduz pro e-mail da conta no Supabase.
// Com um operador só, a tela bloqueada pede direto a senha.
export const OPERATORS = { vini: 'hornburg.vinicius@gmail.com' };

export const SUPABASE_KEY = 'sb_publishable__83oomHbJQto-1Z_l5X1xA_Ee-EHveM';

// Intérprete (Fase 2): o que você escreve passa por interpretar() (js/interpretar.js).
//   limiar: abaixo disto as regras não têm certeza → IA (se ligada) ou salva como nota e pergunta
//   ia.ligada: false até a Edge Function existir (backlog). A chave da IA fica SÓ no servidor, nunca aqui.
//   ia.modelo: troque pra outro modelo quando quiser · ia.limiteDiario: trava de custo (chamadas por dia)
export const INTERPRETADOR = {
  limiar: 0.7,
  ia: { ligada: false, modelo: 'claude-haiku-4-5-20251001', funcao: 'interpretar', timeoutMs: 4000, limiteDiario: 100 },
};

// Memória que aprende (Fase 2.5, js/memoria.js): uma pessoa ou palavra só "vota" num projeto quando
// ele tem pelo menos `dominancia` do peso dela E peso total >= `pesoMinimo`. Pesos: apareceu 1 · você escreveu 2 · você corrigiu 3.
export const MEMORIA = { dominancia: 0.7, pesoMinimo: 3 };

// Finanças (Fase 3a, js/financas.js e js/tipos-financas.js).
//   formaPadrao: forma de pagamento quando você não diz e a memória não sabe · null = o app pergunta (/forma pix)
//   (troque por 'pix', 'credito', 'debito'... pra ele usar essa e marcar como automática)
// ciclo: o da fatura do Vini (fecha 29, vence 5), usado pelo /credito quando não há cartão cadastrado
export const FINANCAS = { formaPadrao: null, ciclo: { fechamento: 29, vencimento: 5 } };
