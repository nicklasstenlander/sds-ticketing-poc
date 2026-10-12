-- Arkiv för event och ordrar (ordern "Arkiv för ordrar och event" 2026-
-- 10-12). Additivt, ingen backfill - alla befintliga rader får
-- archived_at=null (inte arkiverade).
--
-- "Radera aldrig något": det här ersätter inte en radering, det är en
-- flagga. Event-fokuserat (DEL 2, punkt 1): att arkivera ett event
-- döljer eventet OCH kaskaderar till att arkivera dess ordrar (se
-- admin-archive-event/index.ts) - orders.archived_at/by/reason finns
-- därför HÄR, inte bara på events, så export-filtreringen (punkt 2)
-- kan filtrera per order utan att behöva joina events.
--
-- archived_reason (punkt 2): 'test' = ingen riktig betalning, utesluts
-- ur bokföringsexporterna (export-sales, platform-export-revenue).
-- 'hidden' = riktig betalning, bara dold ur admin-vyer/publika API:er -
-- ligger KVAR i bokföringsexporterna som standard. Satt bara när
-- archived_at är satt (kontrolleras i applikationskoden, inte en egen
-- databas-constraint här - samma stil som övriga additiva kolumner i
-- det här projektet, se terms_version).
--
-- Policynamnet på events är EXAKT "Publika events ar lasbara for alla"
-- (utan å/ä - bekräftat mot pg_policies på det riktiga projektet, skiljer
-- sig från diakritiken i källkommentaren i 20260101000000_init.sql).
-- Fel namn här hade gjort att drop policy inte hittat raden och hela
-- migrationen hade misslyckats. Se supabase/rollbacks/
-- 20261012010000_archive_rollback.sql för en reserv som återskapar
-- BÅDA policyerna exakt som de var FÖRE den här migrationen.
begin;

alter table events
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id),
  add column archived_reason text;

alter table events
  add constraint events_archived_reason_check
  check (archived_reason is null or archived_reason in ('test', 'hidden'));

alter table orders
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id),
  add column archived_reason text;

alter table orders
  add constraint orders_archived_reason_check
  check (archived_reason is null or archived_reason in ('test', 'hidden'));

-- === RLS: arkiverade event (och deras biljettyper) ska aldrig vara
-- publikt läsbara, samma gate som status='published' redan är (se
-- 20260101000000_init.sql och 20260105000000_ticket_types_and_
-- discounts.sql). Köpsidan/EventsPage.tsx går direkt mot dessa policyer
-- (RLS, inte en edge function) - utan den här ändringen skulle ett
-- arkiverat event fortfarande vara köpbart där även om adminlistan och
-- public-embed/public-events/list-events (edge functions, filtrerade i
-- kod) döljer det. ===
drop policy "Publika events ar lasbara for alla" on events;
create policy "Publika events ar lasbara for alla"
  on events
  for select
  to anon, authenticated
  using (status = 'published' and archived_at is null);

drop policy "Publika biljettyper är läsbara för publicerade event" on ticket_types;
create policy "Publika biljettyper är läsbara för publicerade event"
  on ticket_types
  for select
  to anon, authenticated
  using (exists (
    select 1 from events e
    where e.id = ticket_types.event_id
      and e.status = 'published'
      and e.archived_at is null
  ));

commit;
