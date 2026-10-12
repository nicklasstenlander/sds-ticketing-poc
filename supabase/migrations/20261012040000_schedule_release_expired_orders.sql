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
begin;

create extension if not exists pg_cron;

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
  $$select release_expired_orders();$$
);

commit;
