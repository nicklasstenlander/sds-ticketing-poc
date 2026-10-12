-- RESERV - inte en migration, körs inte automatiskt av `supabase db
-- push` (ligger medvetet utanför supabase/migrations/). Avschemalägger
-- pg_cron-jobbet som 20261012040000_schedule_release_expired_orders.sql
-- skapade. Rör INTE extensionen (pg_cron lämnas aktiverad - andra jobb
-- kan använda den) och INTE release_expired_orders()-funktionen själv.
--
-- Säkert att köra även om jobbet redan är borta (loopen matchar då noll
-- rader, gör ingenting) - samma idempotenta mönster som migrationen.
--
-- OBS om du kör den här: GitHub Actions-reserven (.github/workflows/
-- release-expired-orders.yml, var 30:e minut efter den här ordern)
-- fortsätter fungera oavsett - men utan pg_cron-jobbet är den ENDA
-- mekanismen igen, och värsta-fall-tiden för en övergiven kassa blir
-- densamma som innan (se schemaläggningsrapporten - upp till flera
-- timmar i praktiken, inte 30 minuter).
--
-- Kör (om/när det behövs):
--   supabase db query --linked -f supabase/rollbacks/20261012040000_schedule_release_expired_orders_rollback.sql
begin;

do $$
declare
  r record;
begin
  for r in select jobid from cron.job where jobname = 'release-expired-orders' loop
    perform cron.unschedule(r.jobid);
  end loop;
end
$$;

commit;
