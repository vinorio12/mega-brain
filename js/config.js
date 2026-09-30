// Configuração da nuvem (Supabase).
//
// A chave abaixo é a "publishable" (ou "anon public"): ela FOI FEITA pra ficar no site.
// Quem protege os dados são as regras do banco (supabase/001_entries.sql).
// NUNCA coloque aqui a chave "secret" / "service_role".
//
// Com SUPABASE_KEY vazia, o app roda em modo local (só neste navegador).

export const SUPABASE_URL = 'https://xfvfgidvqrubdtogtczy.supabase.co';
export const SUPABASE_KEY = '';
