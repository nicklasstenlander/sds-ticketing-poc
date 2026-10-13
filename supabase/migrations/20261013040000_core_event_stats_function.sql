-- core_event_stats: skrivskyddad aggregerad statistik per
-- föreställning, för CORE-webbens (sds-dashboard) nya flik
-- "Föreställningar" (ordern "Föreställningar-statistik från Rideau
-- till CORE" 2026-10-13, Fas 1).
--
-- EN funktion, ETT anrop - samma motiv som finalize_paid_order
-- (2026-10-13, "Webhooken är för långsam"): varje DB-anrop kostar
-- ~0,6 s. Anroparen (stats-for-core) gör därför bara EN rpc-fråga,
-- oavsett hur många event/biljettyper/dagar arrangören har.
--
-- Rör INGET i betal-/mejlspåret - läser bara befintliga tabeller,
-- skriver ingenting. Ingen security definer: enda tänkta anroparen är
-- service_role (stats-for-core), samma resonemang/låsning som
-- cancel_paid_order/finalize_paid_order - se de migrationernas
-- kommentarer för den fullständiga säkerhetsmotiveringen (kort
-- version: service_role kringgår RLS oavsett, så "security definer"
-- skulle bara öka blastradien om EXECUTE någonsin beviljades fel roll
-- av misstag).
--
-- === UNDERSÖKNING 1: hur representeras återbetalningar i schemat? ===
--
-- FULL återbetalning: charge.refunded (stripe-webhook) anropar
-- cancel_paid_order, som sätter orders.status='cancelled' OCH
-- tickets.status='void' för alla ordens biljetter, i SAMMA transaktion
-- (se 20261012020000_cancel_order_function.sql). En fullt återbetald
-- order filtreras alltså bort HELT av vårt eget "status='paid'"-villkor
-- nedan - ingen särskild hantering behövs, "netto" är redan korrekt
-- för det fallet.
--
-- PARTIELL återbetalning: VIKTIGT FYND - stripe-webhooks
-- charge.refunded-hanterare (handleChargeRefunded) GÖR INGENTING i
-- databasen för en partiell återbetalning. Den loggar bara
-- order-id och belopp (console.log) - "Delvis återbetalning - ändra
-- ingenting, bara logga" (se stripe-webhook/index.ts, STEG 3 punkt 3,
-- 2026-10-12). Ordern förblir status='paid', alla biljetter förblir
-- 'valid'/'checked_in', och INGEN tabell/kolumn någonstans i schemat
-- lagrar det återbetalda beloppet - sökt igenom samtliga migrationer,
-- ingen "refunded_ore"/"refund_amount"-kolumn finns.
--
-- KONSEKVENS för revenue_ore nedan: en partiellt återbetald order
-- räknas med till FULLA order_items-priset (bruttot vid köpet) - det
-- återbetalda beloppet dras INTE av, eftersom den uppgiften helt
-- enkelt inte finns lagrad någonstans att läsa. "NETTO efter
-- återbetalningar" är alltså idag bara sant för HELA återbetalningar
-- (som redan utesluts via status<>'paid'), INTE för partiella. Detta
-- är en känd, rapporterad begränsning - se rapporten till Nicklas för
-- den testorder-verifiering som bekräftar avvikelsen (2 biljetter a
-- 3 kr, 3 kr återbetalat -> funktionen ger idag 600 öre, inte de
-- förväntade 300). Att åtgärda det kräver ANTINGEN en ny kolumn +
-- en ändring i stripe-webhooks charge.refunded-hanterare (EXPLICIT
-- UTANFÖR den här ordern, som uttryckligen förbjuder att röra
-- stripe-webhook) ELLER att denna funktion/edge-funktionen gör egna
-- Stripe-anrop (inte byggt här - skulle göra "ett DB-anrop" till
-- "ett DB-anrop + N Stripe-anrop", och kräver ett beslut om det är
-- acceptabelt för en flik som pollas var 60:e sekund).
--
-- === UNDERSÖKNING 2: källa för checked_in ===
--
-- Vald källa: tickets.status = 'checked_in' (INTE ticket_scans).
-- ticket_scans är en append-only LOGG - en biljett som skannas två
-- gånger (dubbelskanning, eller en nekad/ogiltig skanning) ger FLERA
-- rader med result in ('ok','duplicate','invalid') för SAMMA biljett
-- (se scan-ticket/index.ts: insert i ticket_scans vid VARJE
-- skanningsförsök, lyckat eller inte). Att räkna rader i ticket_scans
-- hade alltså kunnat ge "checked_in" > faktiskt antal unika insläppta
-- biljetter. tickets.status sätts till 'checked_in' EXAKT EN gång per
-- biljett (den första lyckade skanningen - se scan-ticket/index.ts:
-- ".update({ status: 'checked_in', ... })") och är därför den
-- auktoritativa, redan deduplicerade räkningen.
--
-- OBS (spec-rättelse): ordertexten skrev "tickets.status valid/använda"
-- - de FAKTISKA värdena i schemat är 'valid' | 'checked_in' | 'void'
-- (se 20260101000000_init.sql), ingen status heter "used". "sold"
-- nedan räknar alltså valid+checked_in, aldrig void.
--
-- === UNDERSÖKNING 3: archived_reason='hidden' inkluderas ===
--
-- Flaggar enligt instruktion: ordrar med archived_reason='hidden'
-- (riktig betalning, bara dold ur admin-vyer/publika API:er - se
-- 20261012010000_archive.sql) INKLUDERAS i all statistik nedan, exakt
-- som begärt. archived_reason='test' (ingen riktig betalning)
-- UTESLUTS. Arkiverade EVENT (events.archived_at is not null) utesluts
-- helt och hållet - ordertexten bad bara om filtrering per ORDER-
-- arkivstatus, inte per event.
--
-- capacity: events.capacity (DEN DELADE POOLEN, se
-- 20260106000000_shared_capacity_pool.sql) - ticket_types.capacity
-- droppades helt i den migrationen, finns inte längre.
--
-- by_day: datum i Europe/Stockholm (inte UTC) via
-- "paid_at at time zone 'Europe/Stockholm'" - konverterar till lokal
-- väggklockstid FÖRE datumextraktionen, annars hade en betalning
-- 00:30 svensk tid (23:30 UTC föregående dag, under vintertid) räknats
-- till fel dag.
--
-- Inga personuppgifter: frågan rör ALDRIG buyer_name/buyer_email eller
-- exponerar några order-id:n - bara aggregat per event/biljettyp/dag.
begin;

create or replace function core_event_stats(p_organizer_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'event_id', e.id,
      'slug', e.slug,
      'title', e.title,
      'starts_at', e.starts_at,
      'status', e.status,
      'capacity', e.capacity,
      'sold', coalesce(tix.sold, 0),
      'checked_in', coalesce(tix.checked_in, 0),
      'revenue_ore', coalesce(rev.revenue_ore, 0),
      'by_ticket_type', coalesce(btt.rows, '[]'::jsonb),
      'by_day', coalesce(bd.rows, '[]'::jsonb)
    )
    order by e.starts_at nulls last, e.title
  ), '[]'::jsonb)
  into v_result
  from events e
  left join lateral (
    select
      count(*) filter (where t.status in ('valid', 'checked_in')) as sold,
      count(*) filter (where t.status = 'checked_in') as checked_in
    from tickets t
    join orders o on o.id = t.order_id
    where t.event_id = e.id
      and o.status = 'paid'
      and coalesce(o.archived_reason, '') <> 'test'
  ) tix on true
  left join lateral (
    select sum(oi.unit_price_ore * oi.qty) as revenue_ore
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.event_id = e.id
      and o.status = 'paid'
      and coalesce(o.archived_reason, '') <> 'test'
  ) rev on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('name', tt.name, 'sold', coalesce(s.sold, 0), 'revenue_ore', coalesce(r.revenue_ore, 0))
      order by tt.sort_order, tt.name
    ) as rows
    from ticket_types tt
    left join lateral (
      select count(*) as sold
      from tickets t
      join orders o on o.id = t.order_id
      where t.ticket_type_id = tt.id
        and t.status in ('valid', 'checked_in')
        and o.status = 'paid'
        and coalesce(o.archived_reason, '') <> 'test'
    ) s on true
    left join lateral (
      select sum(oi.unit_price_ore * oi.qty) as revenue_ore
      from order_items oi
      join orders o on o.id = oi.order_id
      where oi.ticket_type_id = tt.id
        and o.status = 'paid'
        and coalesce(o.archived_reason, '') <> 'test'
    ) r on true
    where tt.event_id = e.id
  ) btt on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'), 'tickets', d.tickets, 'revenue_ore', d.revenue_ore)
      order by d.day
    ) as rows
    from (
      select
        (o.paid_at at time zone 'Europe/Stockholm')::date as day,
        -- order_items.qty = antal biljetter för RADEN - motsvarar
        -- exakt tickets-antalet för en status='paid'-order, eftersom
        -- enskilda biljetter ALDRIG voidas utan att HELA ordern
        -- avbokas samtidigt (se undersökning 1 ovan) - alltså ingen
        -- avvikelse mot "sold" för ordrar som når hit.
        sum(oi.qty) as tickets,
        sum(oi.unit_price_ore * oi.qty) as revenue_ore
      from order_items oi
      join orders o on o.id = oi.order_id
      where o.event_id = e.id
        and o.status = 'paid'
        and coalesce(o.archived_reason, '') <> 'test'
      group by (o.paid_at at time zone 'Europe/Stockholm')::date
    ) d
  ) bd on true
  where e.organizer_id = p_organizer_id
    and e.archived_at is null;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on function core_event_stats(uuid) from public;
revoke all on function core_event_stats(uuid) from anon;
revoke all on function core_event_stats(uuid) from authenticated;
grant execute on function core_event_stats(uuid) to service_role;

commit;
