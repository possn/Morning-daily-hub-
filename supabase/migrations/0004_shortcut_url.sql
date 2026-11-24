-- A app (sessão com segundo fator) obtém a ligação do Atalho já com o token, sem ir ao painel do Supabase.
create or replace function public.shortcut_url() returns text
language sql stable security definer set search_path = '' as $$
  select 'https://ejtpmwhyoekgcosuwilq.supabase.co/functions/v1/ingest-outlook?t=' || t.value
  from public.app_config t, public.app_config o
  where t.key = 'ingest_token' and o.key = 'owner_user_id'
    and o.value = (select auth.uid())::text
    and (select auth.jwt() ->> 'aal') = 'aal2';
$$;
revoke execute on function public.shortcut_url() from public, anon;
grant execute on function public.shortcut_url() to authenticated;
