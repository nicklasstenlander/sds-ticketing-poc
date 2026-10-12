-- Kolumnen lades till manuellt i SQL Editor av Nicklas 2026-10-12, efter
-- granskning av förslaget nedan (ordern "Köpvillkor godkända, gå live",
-- uppföljning: versionsspår på orders). Den här filen kodifierar samma
-- ändring i migrationshistoriken - "if not exists" gör den säker att köra
-- (t.ex. via `supabase db push`) även om kolumnen redan finns, utan att
-- försöka skapa den på nytt eller röra befintlig data.
--
-- Bakgrund: orders.terms_url/terms_accepted_at (se 20261003000000_order_
-- terms_acceptance.sql) sparar ADRESSEN som gällde och NÄR köparen
-- godkände, men inte vilken VERSION av texten (src/content/terms/sds.ts
-- VERSION) som visades. Så länge innehållet aldrig ändras spelar det
-- ingen roll - men den dag VERSION bumpas till en ny godkänd text pekar
-- terms_url fortfarande på samma /villkor/sds-sida, som då visar den NYA
-- texten - en tvist om en ÄLDRE order kan annars inte längre bevisa
-- exakt vilken text köparen faktiskt godkände, bara datumet.
--
-- Ingen backfill, ingen NOT NULL: historiska ordrar (innan kolumnen
-- fanns) och ordrar utan villkorskrav förblir null. Fylls i av
-- supabase/functions/create-order/index.ts (terms_version, bestämt av
-- servern via _shared/termsVersions.ts - aldrig av klienten).
alter table orders
  add column if not exists terms_version integer;

comment on column orders.terms_version is
  'Versionsnumret (TermsContent.VERSION) för den köpvillkorstext som gällde vid köpet, om arrangören hade terms_url satt. Null för ordrar innan detta fält fanns, och för ordrar utan villkorskrav.';
