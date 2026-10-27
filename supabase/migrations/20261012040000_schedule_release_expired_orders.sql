-- Schemalägger release_expired_orders() var 5:e minut via pg_cron
-- (ordern "Avbokning, återbetalning, omsändning och köparmeddelanden"
-- 2026-10-12, uppföljning: alternativ a1 från schemaläggnings-
-- rapporten). Ersätter GitHub Actions som PRIMÄR mekanism - den
-- workflown behålls som reserv på lägre frekvens (se separat commit
-- för .github/workflows/release-expired-orders.yml).
--
-- VARFÖR a1 (direkt SQL, inte HTTP mot edge-funktionen): pg_cron körs
-- INUTI databasen. release_expired_orders() är redan en Postgres-
-- funktion - ett direkt "select release_expired_orders();" behöver
-- inget nätverksanrop, ingen pg_net-extension, och INGEN hemlighet
-- alls (CRON_SECRET används bara av HTTP-vägen/edge-funktionen/GitHub
-- Actions-reserven, rörs inte här). Den här filen innehåller därför
-- inga hemligheter i klartext - se check-cron-schedule.ts för ett
-- statiskt skydd som kontrollerar exakt det.
--
-- pg_cron-jobbet körs som den roll som schemalägger det (postgres,
-- migrationens egen roll) - en superuser/ägarroll som kringgår EXECUTE-
-- grants helt, så säkerhetsmigrationen (20261012030000, som låste
-- EXECUTE på release_expired_orders() till bara service_role) påverkar
-- INTE detta - postgres är (eller agerar som) funktionens ägare,
-- vilket alltid har rätt att anropa den oavsett REVOKE-satser riktade
-- mot andra roller.
--
-- create extension pg_cron kräver en behörighet migrationsrollen
-- förhoppningsvis har (Supabase dokumenterar `create extension
-- pg_cron;` som ett giltigt sätt att aktivera den, vid sidan av
-- Dashboard-växeln Database -> Extensions) - men OM den ändå
-- misslyckas med ett behörighetsfel: aktivera pg_cron via Dashboard
-- (Database -> Extensions -> pg_cron) och kör sedan om HELA den här
-- filen oförändrad. "if not exists" gör extension-raden ofarlig att
-- köra igen när extensionen redan finns, och resten av filen (av-
-- schemaläggning + schemaläggning) är skriven idempotent av samma skäl
-- - säkert att köra om, oavsett hur många gånger.
--
-- UPPDATERAD 2026-10-26: jobbet hade aldrig skapats i produktion
-- (pg_cron ej installerat, cron.job saknades, supabase_migrations-
-- historiken tom - filen hade alltså aldrig körts). Ändringar:
--   * "with schema pg_catalog" - Supabase-dokumentationens rekommenderade
--     form; extensionens egna objekt hamnar ändå i schemat "cron".
--   * Förkontroll: avbryter HELA transaktionen med ett tydligt fel om
--     public.release_expired_orders() eller dess beroenden saknas,
--     istället för att schemalägga ett jobb som sedan felar tyst var
--     5:e minut (felen syns bara i cron.job_run_details).
--   * Kommandot är schema-kvalificerat (public.release_expired_orders())
--     så att det inte beror på search_path i pg_cron-bakgrundsprocessen.
-- Körs säkert i produktion med `supabase db query --linked -f <den här
-- filen>`, INTE med `supabase db push` (historiken är tom - push skulle
-- försöka köra om ALLA migrationer från init). Se PR-beskrivningen.
begin;

do $$
begin
  if to_regprocedure('public.release_expired_orders()') is null then
    raise exception 'public.release_expired_orders() saknas - kör 20260106000100_order_items_cart.sql först';
  end if;
  if to_regprocedure('public.release_shared_capacity_multi(uuid, jsonb, integer)') is null then
    raise exception 'public.release_shared_capacity_multi(uuid, jsonb, integer) saknas - kör 20260106000100_order_items_cart.sql först';
  end if;
  if to_regclass('public.order_items') is null then
    raise exception 'public.order_items saknas - kör 20260106000100_order_items_cart.sql först';
  end if;
end
$$;

create extension if not exists pg_cron with schema pg_catalog;

-- Avschemalägg ett eventuellt BEFINTLIGT jobb med samma namn först -
-- pg_cron tvingar inte fram unika jobbnamn, så att bara anropa
-- cron.schedule igen (t.ex. om den här migrationen körs om) skulle
-- annars kunna skapa ETT JOBB TILL med samma namn, som då kör
-- release_expired_orders() dubbelt så ofta (ofarligt i sig, funktionen
-- är redan idempotent, men onödigt och förvirrande att ha kvar två
-- schemalagda jobb). Loopen hanterar noll, ett eller flera matchande
-- jobb lika robust.
do $$
declare
  r record;
begin
  for r in select jobid from cron.job where jobname = 'release-expired-orders' loop
    perform cron.unschedule(r.jobid);
  end loop;
end
$$;

select cron.schedule(
  'release-expired-orders',
  '*/5 * * * *',
  $$select public.release_expired_orders();$$
);

commit;
