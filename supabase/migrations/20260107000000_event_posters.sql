-- SODSS Biljett PoC - Tilläggsorder: Affischuppladdning per event
--
-- Ny publik (läs-only) Storage-bucket "posters" för en liggande
-- (1920x1080) och en stående (1080x1920) affisch per event, samma
-- publik-läsning/service-role-skrivning-mönster som den befintliga
-- "qr"-bucketen.

insert into storage.buckets (id, name, public)
values ('posters', 'posters', true)
on conflict (id) do nothing;

-- Publik läsning av affischer. Ingen INSERT/UPDATE/DELETE-policy för
-- anon - uppladdning sker enbart från admin-upload-poster-edge-
-- functionen med service role-nyckeln, som kringgår RLS/storage-
-- policies helt.
create policy "Publikt läsbara affischer"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'posters');

alter table events
  add column poster_landscape_url text,
  add column poster_portrait_url text;
