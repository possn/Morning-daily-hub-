-- Os dados só saem para sessões com segundo fator (código da app de autenticação, nível aal2).
-- Políticas restritivas: somam-se às existentes. A service role (job e edge function) não é afetada.
create policy "briefs: exige segundo fator" on public.briefs
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy "outlook: exige segundo fator" on public.outlook_events
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy "push: exige segundo fator" on public.push_subscriptions
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
