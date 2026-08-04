-- SODSS Biljett PoC - Stripe Checkout, momssats och bokföringsexport
--
-- Denna migration bygger vidare på 20260101000000_init.sql och
-- 20260101000200_capacity_functions.sql. Den lägger till:
--   1. Pris (öre) och momssats på events.
--   2. Kolumner på orders för att stödja Stripe Checkout-flödet
--      (pending -> paid/expired/cancelled) samt en pris/moms-ögonblicksbild
--      som fryses vid köptillfället (se motivering nedan).
--   3. En webhook_events-tabell för idempotent hantering av Stripe-webhooks.
--
-- OBS - momsögonblicksbild: orders.price_ore och orders.vat_rate kopieras
-- från events vid köptillfället och ändras ALDRIG efteråt, även om admin
-- redigerar eventets pris/moms senare (det finns idag ingen redigeringsfunktion,
-- men denna design skyddar mot att en framtida sådan retroaktivt skulle
-- ändra bokföringen för redan betalda ordrar). All export (CSV/SIE) läser
-- alltså alltid orders.price_ore/orders.vat_rate, aldrig events.price_ore.

alter table events
  add column price_ore int not null default 0,
  add column vat_rate int not null default 6;

alter table events
  add constraint events_price_ore_check check (price_ore >= 0),
  add constraint events_vat_rate_check check (vat_rate in (0, 6, 12, 25));

-- orders.status-livscykel byter från det gamla "confirmed" (satt direkt vid
-- köp) till en riktig statusmaskin som styrs av Stripe-webhooken:
--   pending   - order skapad, väntar på betalning i Stripe Checkout.
--   paid      - betalning bekräftad (checkout.session.completed), biljetter skapade.
--   expired   - Stripe Checkout-sessionen gick ut utan betalning (checkout.session.expired
--               eller vår egen release-expired-orders-städning), kapacitet återförd.
--   cancelled - reserverat för ev. framtida admin-avbokning, används inte av
--               något flöde i denna PoC men finns med så exporten kan filtrera
--               bort den utan schemaändring senare.
alter table orders
  add column stripe_session_id text,
  add column expires_at timestamptz,
  add column paid_at timestamptz,
  add column price_ore int,
  add column vat_rate int;

alter table orders
  alter column status set default 'pending';

-- Bakåtkompatibilitet: ordrar som skapades INNAN Stripe-lagret fanns har
-- status = 'confirmed' (satt synkront av den gamla create-order-koden,
-- innan biljetter flyttades till stripe-webhook). De motsvarar semantiskt
-- en betald/klar order (biljetterna skapades redan då), så de migreras om
-- till 'paid' här - annars skulle nästa rad (check-constrainten) avvisa
-- dem eftersom 'confirmed' inte längre är ett giltigt värde.
update orders set status = 'paid', paid_at = coalesce(paid_at, created_at)
  where status = 'confirmed';

alter table orders
  add constraint orders_status_check check (status in ('pending', 'paid', 'expired', 'cancelled'));

alter table orders
  add constraint orders_stripe_session_id_unique unique (stripe_session_id);

create index orders_expires_at_idx on orders(expires_at) where status = 'pending';
create index orders_status_idx on orders(status);
create index orders_paid_at_idx on orders(paid_at);

-- webhook_events - idempotensspärr för Stripe-webhooken. Stripe kan leverera
-- samma event flera gånger (retries vid timeout/nätverksfel på vår sida), så
-- varje (provider, provider_event_id) får bara behandlas en gång. Vi
-- försöker INSERT:a raden innan vi gör några databasändringar för eventet;
-- om INSERT:en misslyckas med unique violation (23505) vet vi att eventet
-- redan hanterats och svarar 200 direkt utan att upprepa arbetet.
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  payload jsonb,
  created_at timestamptz default now(),
  constraint webhook_events_unique unique (provider, provider_event_id)
);

-- RLS: deny-by-default, precis som övriga tabeller. Ingen anon/authenticated
-- policy skapas alls - endast service role (som alla edge functions
-- använder via createAdminClient()) kan läsa/skriva, och service role
-- kringgår RLS helt.
alter table webhook_events enable row level security;

-- release_expired_orders() - säkerhetsnät utöver checkout.session.expired-
-- webhooken. Stripe skickar normalt session.expired när en Checkout-session
-- går ut (24 h efter skapande som standard, men vi sätter en kortare
-- expires_at, se stripe-webhook/create-order), men webhooken kan i teorin
-- utebli (nätverksfel, felkonfigurerad endpoint). Denna funktion körs
-- periodiskt av release-expired-orders-edge-functionen (anropad via ett
-- schemalagt GitHub Actions-jobb, se README) och städar bort alla ordrar
-- som blivit hängande i "pending" förbi sin expires_at utan att någon
-- webhook hunnit markera dem paid/expired - kapaciteten återförs och
-- ordern markeras expired, precis som webhook-hanteringen gör.
create or replace function release_expired_orders()
returns table(released_order_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    update orders
       set status = 'expired'
     where orders.status = 'pending'
       and orders.expires_at is not null
       and orders.expires_at < now()
    returning orders.id, orders.event_id, orders.qty
  loop
    perform release_event_capacity(r.event_id, r.qty);
    released_order_id := r.id;
    return next;
  end loop;
end;
$$;

revoke all on function release_expired_orders() from public;
