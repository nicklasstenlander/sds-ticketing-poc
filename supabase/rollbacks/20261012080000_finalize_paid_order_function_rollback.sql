-- RESERV - inte en migration, körs inte automatiskt av `supabase db
-- push` (ligger medvetet utanför supabase/migrations/). Droppar HELA
-- finalize_paid_order-funktionen som
-- 20261012080000_finalize_paid_order_function.sql skapade - ny
-- funktion, ingen tidigare version att återställa. DROP FUNCTION tar
-- automatiskt bort funktionens ACL (grants/revokes) med sig.
--
-- Säkert att köra även efter en tid i drift: ordrar som redan
-- slutförts via funktionen förblir 'paid' med sina biljetter orörda -
-- bara MÖJLIGHETEN att slutföra FLER ordrar via den här vägen
-- försvinner. stripe-webhook skulle själv få fel (anropar en funktion
-- som inte finns) tills den redeployas utan anropet, eller funktionen
-- återskapas.
--
-- Kör (om/när det behövs):
--   supabase db query --linked -f supabase/rollbacks/20261012080000_finalize_paid_order_function_rollback.sql
begin;

drop function if exists finalize_paid_order(uuid, text, text[]);

commit;
