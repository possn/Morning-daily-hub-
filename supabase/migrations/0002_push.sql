-- Notificações push (Web Push) e configuração privada da edge function.

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "push: ver as minhas" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "push: guardar as minhas" on public.push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "push: atualizar as minhas" on public.push_subscriptions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "push: apagar as minhas" on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Chaves e token da função. RLS ligado e sem políticas: só a service role lê.
create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
