-- RESERV - droppar HELA core_event_stats-funktionen (ny funktion,
-- ingen tidigare version). DROP FUNCTION tar bort ACL automatiskt.
--
-- Säkert att köra: stats-for-core skulle själv få fel (anropar en
-- funktion som inte finns) tills den redeployas utan anropet, eller
-- funktionen återskapas. Ren läsning, ingen orderdata rörs av att
-- rulla tillbaka detta - inget skrivs här som andra funktioner
-- beror på.
--
-- Kör (om/när det behövs):
--   supabase db query --linked -f supabase/rollbacks/20261013040000_core_event_stats_function_rollback.sql
begin;

drop function if exists core_event_stats(uuid);

commit;
