-- Os bancos ("Banco P ...", "Banco M ...") ficam ~2 meses para as contas da escala do mês;
-- os outros eventos continuam a sair 7 dias depois de acabarem.
create or replace function public.daily_hub_cleanup() returns void
language sql security definer set search_path = '' as $$
  delete from public.briefs where brief_date < (now() - interval '30 days')::date;
  delete from public.outlook_events
   where end_at < now() - interval '7 days'
     and not (title ~* '^\s*banco\M' and end_at > now() - interval '62 days');
  delete from public.tasks where done_at < now() - interval '30 days';
$$;
revoke execute on function public.daily_hub_cleanup() from public, anon, authenticated;
