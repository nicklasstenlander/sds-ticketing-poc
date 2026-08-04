-- Skapar det publika storage-bucketet "qr" för QR-kodsbilder (PNG).
-- Detta går även att göra manuellt via Dashboard -> Storage -> New bucket,
-- se README. Denna migration gör det reproducerbart via `supabase db push`.

insert into storage.buckets (id, name, public)
values ('qr', 'qr', true)
on conflict (id) do update set public = true;

-- Publik läsning av objekt i "qr"-bucketet (så att e-postklienter kan
-- hämta bilden via en vanlig https-URL). Uppladdning sker enbart från
-- create-order-edge-functionen med service role-nyckeln, som kringgår
-- RLS/storage-policies helt - därför behövs ingen INSERT-policy här.
create policy "Publik läsning av QR-bilder"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'qr');
