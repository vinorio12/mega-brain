-- Mega Brain · tabela de entradas (inbox)
-- Cole tudo isto no Supabase: SQL Editor → New query → Run.
-- Pode rodar mais de uma vez sem problema.

create table if not exists public.entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 10000),
  tags       text[] not null default '{}',
  kind       text not null default 'nota',
  ts         bigint not null,              -- momento da captura (epoch ms)
  day        text not null,                -- 'AAAA-MM-DD' no fuso de quem capturou
  created_at timestamptz not null default now()
);

create index if not exists entries_user_ts on public.entries (user_id, ts);

-- Trava de segurança (RLS): cada linha só pode ser vista e mexida pelo dono.
-- Mesmo com a chave pública do site, ninguém mais lê nada.
alter table public.entries enable row level security;

drop policy if exists "dono le"      on public.entries;
drop policy if exists "dono cria"    on public.entries;
drop policy if exists "dono altera"  on public.entries;
drop policy if exists "dono apaga"   on public.entries;

create policy "dono le"     on public.entries for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria"   on public.entries for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono altera" on public.entries for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dono apaga"  on public.entries for delete to authenticated using ((select auth.uid()) = user_id);

-- Tempo real: o celular vê na hora o que você escreveu no PC (e vice-versa).
do $$
begin
  alter publication supabase_realtime add table public.entries;
exception when duplicate_object then null;
end $$;
