-- SODSS Biljett PoC - Redigera och radera event i admin
--
-- Lägger till statusvärdet 'cancelled' på events. Används av
-- admin-delete-event: när ett event har sålda biljetter (kopplade ordrar)
-- kan det inte raderas rakt av utan sätts till 'cancelled' istället - se
-- kommentaren i supabase/functions/admin-delete-event/index.ts.
--
-- 'cancelled' events är fortfarande synliga i admin-listan och i
-- exportunderlaget (events-status filtreras inte bort någonstans i
-- export-sales, som bara bryr sig om orders.status), men försvinner från
-- den publika list-events-funktionen och /kop/:slug (båda filtrerar redan
-- på status = 'published', ingen ändring behövs där för detta).

alter table events drop constraint events_status_check;

alter table events
  add constraint events_status_check check (status in ('draft', 'published', 'cancelled'));
