-- Mega Brain · sincronização leve: cada linha guarda quando mudou pela última vez (updated_at).
-- Com isso o app, a cada minuto, baixa só o que mudou, em vez da tabela inteira.
-- Cole tudo isto no Supabase: SQL Editor → New query → Run. Pode rodar mais de uma vez.

alter table public.entries add column if not exists updated_at timestamptz not null default now();

create index if not exists entries_user_updated on public.entries (user_id, updated_at);

-- O próprio banco carimba a hora em todo insert/update (o relógio do celular não entra na conta).
create or replace function public.entries_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists entries_touch on public.entries;
create trigger entries_touch
  before insert or update on public.entries
  for each row execute function public.entries_touch();

-- As regras de segurança (RLS) da 001 continuam valendo; nada a mudar nelas.
