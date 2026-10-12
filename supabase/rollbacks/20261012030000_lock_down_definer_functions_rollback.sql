-- RESERV - inte en migration, körs inte automatiskt av `supabase db
-- push` (ligger medvetet utanför supabase/migrations/). Återställer
-- EXECUTE-rättigheterna på de fem funktionerna i 20261012030000_lock_
-- down_definer_functions.sql till precis det läge de hade innan den
-- migrationen - dvs de implicita grants till anon/authenticated som
-- fanns (nästan säkert Supabase-projektets egna ALTER DEFAULT
-- PRIVILEGES) återskapas INTE automatiskt av en revert här (ett grant
-- borttaget går inte att "återställa som default" i efterhand - bara
-- att bevilja samma rättighet igen explicit, vilket är precis vad den
-- här filen gör).
--
-- OBS om du kör den här: den återställer funktionerna till samma
-- SÅRBARA läge som 20261012030000 stängde (anon/authenticated kan
-- åter anropa alla fem direkt via PostgREST, förbi RLS, eftersom alla
-- är SECURITY DEFINER) - kör bara om något i produktionen FAKTISKT gick
-- sönder av åtstramningen, aldrig i förebyggande syfte.
--
-- Kör (om/när det behövs):
--   supabase db query --linked -f supabase/rollbacks/20261012030000_lock_down_definer_functions_rollback.sql
begin;

grant execute on function release_shared_capacity_multi(uuid, jsonb, integer) to anon, authenticated;
grant execute on function reserve_shared_capacity_multi(uuid, jsonb, integer) to anon, authenticated;
grant execute on function release_expired_orders() to anon, authenticated;
grant execute on function duplicate_event(uuid) to anon, authenticated;
grant execute on function increment_discount_code_used_count(uuid) to anon, authenticated;

commit;
