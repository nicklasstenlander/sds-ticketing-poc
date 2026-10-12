-- RESERV - inte en migration, körs inte automatiskt av `supabase db
-- push` (ligger medvetet utanför supabase/migrations/). Tar bort HELA
-- cancel_paid_order-funktionen som 20261012020000_cancel_order_
-- function.sql skapade - till skillnad från arkivmigrationens reserv
-- (som återställde en ÄNDRAD befintlig policy) är det här en helt NY
-- funktion, så reserven är en ren DROP, inte en återskapning av något
-- tidigare tillstånd.
--
-- DROP FUNCTION tar automatiskt bort funktionens ACL (grants/revokes)
-- med sig - ingen separat revoke/grant-upprensning behövs.
--
-- Säkert att köra även efter att admin-cancel-order/stripe-webhook
-- (STEG 3) har varit i drift en tid: en order som redan avbokats via
-- funktionen förblir 'cancelled' (en vanlig kolumnvärde, inte beroende
-- av att funktionen finns kvar) - bara MÖJLIGHETEN att avboka FLER
-- ordrar via den här vägen försvinner. admin-cancel-order/stripe-
-- webhook skulle själva börja ge fel (funktionen de anropar finns inte
-- längre) tills de antingen redeployas utan anropet eller funktionen
-- återskapas.
--
-- Kör (om/när det behövs):
--   supabase db query --linked -f supabase/rollbacks/20261012020000_cancel_order_function_rollback.sql
begin;

drop function if exists cancel_paid_order(uuid);

commit;
