-- Daily Hub: esquema inicial. Um só utilizador (tu); RLS garante que só a tua sessão lê os dados.

create table if not exists public.briefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  brief_date date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, brief_date)
);

create table if not exists public.outlook_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  uid text not null,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  location text,
  calendar text,
  synced_at timestamptz not null default now(),
  primary key (user_id, uid)
);
create index if not exists outlook_events_start_idx on public.outlook_events (user_id, start_at);

alter table public.briefs enable row level security;
alter table public.outlook_events enable row level security;

-- Leitura só pelo próprio utilizador. Escritas só via service role (job e edge function).
create policy "briefs: ler os meus" on public.briefs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "outlook: ler os meus" on public.outlook_events
  for select to authenticated using ((select auth.uid()) = user_id);

-- Retenção mínima: apaga briefs com mais de 30 dias e eventos Outlook passados há mais de 7 dias.
create or replace function public.daily_hub_cleanup() returns void
language sql security definer set search_path = '' as $$
  delete from public.briefs where brief_date < (now() - interval '30 days')::date;
  delete from public.outlook_events where end_at < now() - interval '7 days';
$$;
revoke execute on function public.daily_hub_cleanup() from public, anon, authenticated;
