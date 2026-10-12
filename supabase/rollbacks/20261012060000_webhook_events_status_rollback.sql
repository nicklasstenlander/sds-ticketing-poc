-- RESERV - inte en migration, körs inte automatiskt av `supabase db
-- push` (ligger medvetet utanför supabase/migrations/). Tar bort
-- statuskolumnerna som 20261012060000_webhook_events_status.sql lade
-- till.
--
-- OBS: Deno.serve-dispatchen i stripe-webhook (och
-- stripe-webhook/webhookEventRetry.ts) FÖRUTSÄTTER att dessa kolumner
-- finns. Kör INTE den här reserven samtidigt som den nya koden är
-- deployad - varje webhook-anrop skulle då få ett databasfel vid
-- INSERT/UPDATE mot webhook_events. Rulla tillbaka koden FÖRST
-- (deploya en tidigare stripe-webhook-version), kör SEDAN den här.
--
-- Kör (om/när det behövs):
--   supabase db query --linked -f supabase/rollbacks/20261012060000_webhook_events_status_rollback.sql
begin;

alter table webhook_events
  drop constraint if exists webhook_events_status_check;

alter table webhook_events
  drop column if exists status,
  drop column if exists attempts,
  drop column if exists processed_at,
  drop column if exists last_error;

commit;
