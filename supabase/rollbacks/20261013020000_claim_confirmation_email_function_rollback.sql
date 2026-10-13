-- RESERV - droppar HELA claim_confirmation_email-funktionen (ny
-- funktion, ingen tidigare version). DROP FUNCTION tar bort ACL
-- automatiskt.
--
-- Säkert att köra: stripe-webhook/admin-resend-tickets/retry-
-- confirmation-emails skulle själva få fel (anropar en funktion som
-- inte finns) tills de redeployas utan anropet, eller funktionen
-- återskapas. Ingen orderdata rörs.
--
-- Kör (om/när det behövs):
--   supabase db query --linked -f supabase/rollbacks/20261013020000_claim_confirmation_email_function_rollback.sql
begin;

drop function if exists claim_confirmation_email(uuid, boolean);

commit;
