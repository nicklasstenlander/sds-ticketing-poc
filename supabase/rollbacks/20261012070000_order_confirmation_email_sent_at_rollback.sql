-- RESERV - inte en migration, körs inte automatiskt av `supabase db
-- push` (ligger medvetet utanför supabase/migrations/). Tar bort
-- confirmation_email_sent_at-kolumnen som
-- 20261012070000_order_confirmation_email_sent_at.sql lade till.
--
-- OBS om du kör den här medan den nya stripe-webhook-koden fortfarande
-- är deployad: handleCheckoutCompleted försöker fortfarande SKRIVA
-- till kolumnen efter varje lyckat mejlutskick - det UPDATE-anropet
-- får då ett databasfel (kolumnen finns inte), vilket enligt den nya
-- felmodellen (STEG B punkt 4) gör att webhooken kastar och svarar 500
-- - Stripe skulle då försöka om händelsen i onödan (mejlet skickades
-- redan, bara markeringen misslyckades). Rulla tillbaka koden FÖRST,
-- kör SEDAN den här.
--
-- Kör (om/när det behövs):
--   supabase db query --linked -f supabase/rollbacks/20261012070000_order_confirmation_email_sent_at_rollback.sql
begin;

alter table orders
  drop column if exists confirmation_email_sent_at;

commit;
