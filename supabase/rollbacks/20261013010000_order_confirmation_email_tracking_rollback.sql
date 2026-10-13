-- RESERV - inte en migration, körs inte automatiskt av `supabase db
-- push` (ligger medvetet utanför supabase/migrations/). Tar bort
-- confirmation_email_{attempts,last_error,claimed_at}-kolumnerna som
-- 20261013010000_order_confirmation_email_tracking.sql lade till.
--
-- OBS: claim_confirmation_email() (20261013020000) FÖRUTSÄTTER dessa
-- kolumner - kör INTE den här reserven samtidigt som den funktionen
-- fortfarande finns/anropas. Rulla tillbaka
-- claim_confirmation_email-funktionen FÖRST, kör SEDAN den här.
--
-- Kör (om/när det behövs):
--   supabase db query --linked -f supabase/rollbacks/20261013010000_order_confirmation_email_tracking_rollback.sql
begin;

alter table orders
  drop column if exists confirmation_email_attempts,
  drop column if exists confirmation_email_last_error,
  drop column if exists confirmation_email_claimed_at;

commit;
