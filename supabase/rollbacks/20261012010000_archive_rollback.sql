-- RESERV - inte en migration, körs inte automatiskt av `supabase db
-- push` (ligger medvetet utanför supabase/migrations/). Återställer
-- BARA de två RLS-policyerna som 20261012010000_archive.sql ändrade, till
-- EXAKT de definitioner som gällde FÖRE den migrationen (bekräftat mot
-- pg_policies på det riktiga projektet):
--
--   events, SELECT, roles {anon,authenticated}:
--     using (status = 'published'::text)
--   ticket_types, SELECT, roles {anon,authenticated}:
--     using (exists (select 1 from events e where e.id =
--       ticket_types.event_id and e.status = 'published'::text))
--
-- Rör INTE kolumnerna (archived_at/archived_by/archived_reason) eller
-- deras check-constraints - rent additiva och ofarliga att lämna kvar
-- även om RLS-ändringen rullas tillbaka. Policynamnet på events är
-- EXAKT "Publika events ar lasbara for alla" (utan å/ä), samma som i
-- 20261012010000_archive.sql.
--
-- Kör (om/när det behövs):
--   supabase db query --linked -f supabase/rollbacks/20261012010000_archive_rollback.sql
begin;

drop policy "Publika events ar lasbara for alla" on events;
create policy "Publika events ar lasbara for alla"
  on events
  for select
  to anon, authenticated
  using (status = 'published');

drop policy "Publika biljettyper är läsbara för publicerade event" on ticket_types;
create policy "Publika biljettyper är läsbara för publicerade event"
  on ticket_types
  for select
  to anon, authenticated
  using (exists (
    select 1 from events e
    where e.id = ticket_types.event_id
      and e.status = 'published'
  ));

commit;
