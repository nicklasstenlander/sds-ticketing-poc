-- Säkerhetsmigration: låser ner EXECUTE på befintliga SECURITY DEFINER-
-- funktioner till service_role (ordern "Avbokning, återbetalning,
-- omsändning och köparmeddelanden" 2026-10-12, uppföljning efter
-- granskningen av cancel_paid_order-migrationen).
--
-- FYND (bekräftat mot pg_proc.proacl/has_function_privilege på det
-- riktiga projektet, inte antaget): "revoke all ... from public" i de
-- ursprungliga migrationerna för dessa funktioner har ALDRIG stängt av
-- anon/authenticated:s åtkomst. De har ett EXPLICIT, direkt EXECUTE-
-- grant (nästan säkert Supabase-projektets egna ALTER DEFAULT
-- PRIVILEGES, som ger EXECUTE på varje ny funktion i schemat "public"
-- till anon/authenticated/service_role automatiskt vid skapandet) -
-- PUBLIC självt hade aldrig access, så revoke-raden var verkningslös.
-- Alla fem är SECURITY DEFINER, så en oinloggad POST till
-- /rest/v1/rpc/<funktionsnamn> kör med funktionsägarens fulla
-- privilegier, förbi RLS helt.
--
-- TRE funktioner identifierade i den ursprungliga rapporten:
--   release_shared_capacity_multi, reserve_shared_capacity_multi,
--   release_expired_orders
-- TVÅ FLER hittade i en bredare genomsökning av HELA public-schemat
-- (samma mönster, inte bara de tre som redan nämndes) - utökar
-- medvetet omfattningen, flaggar det tydligt här:
--   duplicate_event (anropas av admin-duplicate-event - en oinloggad
--     anropare skulle kunna duplicera VILKET event som helst, hos
--     vilken arrangör som helst, förbi admin-duplicate-events egen
--     ägarskapskontroll)
--   increment_discount_code_used_count (anropas av stripe-webhook
--     efter en bekräftad betalning - en oinloggad anropare skulle
--     kunna höja used_count för VILKEN rabattkod som helst utan ett
--     enda riktigt köp, och på så sätt göra en begränsad kod "slut" i
--     förtid)
--
-- KRAV, kontrollerade innan denna fil skrevs:
-- 1. service_role behåller EXECUTE på alla fem - explicit grant nedan,
--    inte bara en förhoppning om ett ambient default-privilegium.
-- 2. INGET webbläsaren anropar dras in: `grep -rn ".rpc(" src/` gav
--    TRÄFF PÅ NOLL rader - den publika/inloggade frontend-koden anropar
--    aldrig någon Postgres-funktion direkt, bara via edge functions
--    (callFunction -> service_role). Bekräftat per funktion vilken
--    edge function som faktiskt anropar den: admin-duplicate-event
--    (duplicate_event), create-order (reserve_shared_capacity_multi),
--    create-order + stripe-webhook (release_shared_capacity_multi),
--    release-expired-orders (release_expired_orders), stripe-webhook
--    (increment_discount_code_used_count) - alla via createAdminClient
--    (service_role).
--
-- Rör INGET annat: ingen funktionskropp, inget security definer-läge,
-- inga tabeller. Bara ACL:en.
begin;

revoke all on function release_shared_capacity_multi(uuid, jsonb, integer) from public;
revoke all on function release_shared_capacity_multi(uuid, jsonb, integer) from anon;
revoke all on function release_shared_capacity_multi(uuid, jsonb, integer) from authenticated;
grant execute on function release_shared_capacity_multi(uuid, jsonb, integer) to service_role;

revoke all on function reserve_shared_capacity_multi(uuid, jsonb, integer) from public;
revoke all on function reserve_shared_capacity_multi(uuid, jsonb, integer) from anon;
revoke all on function reserve_shared_capacity_multi(uuid, jsonb, integer) from authenticated;
grant execute on function reserve_shared_capacity_multi(uuid, jsonb, integer) to service_role;

revoke all on function release_expired_orders() from public;
revoke all on function release_expired_orders() from anon;
revoke all on function release_expired_orders() from authenticated;
grant execute on function release_expired_orders() to service_role;

revoke all on function duplicate_event(uuid) from public;
revoke all on function duplicate_event(uuid) from anon;
revoke all on function duplicate_event(uuid) from authenticated;
grant execute on function duplicate_event(uuid) to service_role;

revoke all on function increment_discount_code_used_count(uuid) from public;
revoke all on function increment_discount_code_used_count(uuid) from anon;
revoke all on function increment_discount_code_used_count(uuid) from authenticated;
grant execute on function increment_discount_code_used_count(uuid) to service_role;

commit;
