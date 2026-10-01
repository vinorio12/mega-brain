-- Mega Brain · Fase 1: campo "data" para detalhes de cada entrada (ex: prazo e conclusão de tarefas)
-- Cole tudo isto no Supabase: SQL Editor → New query → Run. Pode rodar mais de uma vez.

alter table public.entries add column if not exists data jsonb not null default '{}'::jsonb;

create index if not exists entries_user_kind on public.entries (user_id, kind);

-- As regras de segurança (RLS) da 001 já valem para a coluna nova. Nada a mudar nelas.
