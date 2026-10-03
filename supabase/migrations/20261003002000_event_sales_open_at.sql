-- Ordern "Schemalagt biljettsläpp och inbäddningsbar widget" (2026-10-03),
-- STEG 1.
--
-- sales_open_at: om satt och i framtiden går eventet att se men inte
-- köpa från (status 'upcoming', se create-order/public-events). Saknas
-- (null): dagens beteende, köp möjligt direkt när eventet publicerats.
--
-- Constrainten säkerställer att ett släpp alltid ligger FÖRE
-- föreställningens start (annars är det bara fel) - men tillåter null i
-- endera fältet, eftersom starts_at kan vara null för ett nydublicerat,
-- ännu ej satt event (se migrationen 20260805020000_duplicate_event.sql).
alter table events add column sales_open_at timestamptz;
alter table events add constraint events_sales_open_before_start
  check (sales_open_at is null or starts_at is null or sales_open_at < starts_at);
