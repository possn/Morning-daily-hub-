-- Agendador no Supabase: o horário do GitHub chega com horas de atraso (ou falha), por isso é o Supabase
-- que dá o sinal de partida ao brief (workflow_dispatch) às 05:15, 12:15 e 18:15 UTC, e corre a limpeza diária.
-- Antes de correr: troca COLA_AQUI_O_TOKEN pelo token do GitHub (fine-grained, só este repositório, Actions: Read and write).
-- O token fica cifrado no Vault do Supabase; não vai para o repositório.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('COLA_AQUI_O_TOKEN', 'github_dispatch_token', 'Token do GitHub para arrancar o brief');

create or replace function public.dispatch_brief() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://api.github.com/repos/possn/Morning-daily-hub-/actions/workflows/morning-brief.yml/dispatches',
    body := '{"ref":"main"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_token'),
      'Accept', 'application/vnd.github+json',
      'User-Agent', 'daily-hub',
      'Content-Type', 'application/json'
    )
  );
end $$;
revoke execute on function public.dispatch_brief() from public, anon, authenticated;

select cron.schedule('brief-manha', '15 5 * * *', 'select public.dispatch_brief()');
select cron.schedule('brief-tarde', '15 12 * * *', 'select public.dispatch_brief()');
select cron.schedule('brief-fecho', '15 18 * * *', 'select public.dispatch_brief()');
select cron.schedule('limpeza-diaria', '30 3 * * *', 'select public.daily_hub_cleanup()');
