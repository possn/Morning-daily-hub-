-- Tarefas guardadas na própria app (sem Notion). Só o dono, e só com segundo fator (aal2).
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  due date,
  priority text not null default 'media' check (priority in ('alta', 'media', 'baixa')),
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tasks_open_idx on public.tasks (user_id, due) where done_at is null;

alter table public.tasks enable row level security;

create policy "tasks: as minhas" on public.tasks
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tasks: exige segundo fator" on public.tasks
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- Tarefas feitas há mais de 30 dias são apagadas pela limpeza diária.
create or replace function public.daily_hub_cleanup() returns void
language sql security definer set search_path = '' as $$
  delete from public.briefs where brief_date < (now() - interval '30 days')::date;
  delete from public.outlook_events where end_at < now() - interval '7 days';
  delete from public.tasks where done_at < now() - interval '30 days';
$$;
revoke execute on function public.daily_hub_cleanup() from public, anon, authenticated;
