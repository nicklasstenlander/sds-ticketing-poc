-- SODSS Biljett PoC - Tilläggsorder: Biljettyper och rabattkoder
--
-- Flyttar pris/moms/kapacitet från events till en ny ticket_types-tabell
-- (ett event kan ha flera biljettyper), och lägger till stöd för globala
-- eller eventspecifika rabattkoder. Se Tilläggsordern 2026-08-04 för full
-- bakgrund och de två bindande antagandena (en biljettyp per köp, koder
-- antingen globala eller knutna till ett event).

-- === 1. ticket_types ===

create table ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id),
  name text not null,
  price_ore int not null,
  vat_rate int not null default 6,
  capacity int not null,
  sold_count int not null default 0,
  sort_order int not null default 0,
  created_at timestamptz default now(),
  constraint ticket_types_price_ore_check check (price_ore >= 0),
  constraint ticket_types_vat_rate_check check (vat_rate in (0, 6, 12, 25)),
  constraint ticket_types_capacity_check check (capacity >= 0),
  constraint ticket_types_sold_count_check check (sold_count >= 0 and sold_count <= capacity)
);

create index ticket_types_event_id_idx on ticket_types(event_id);

alter table ticket_types enable row level security;

-- anon får bara läsa biljettyper som hör till ett publicerat event - samma
-- mönster som events-policyn, men uttryckt som ett EXISTS-villkor mot
-- events eftersom ticket_types själv inte har en status-kolumn.
create policy "Publika biljettyper är läsbara för publicerade event"
  on ticket_types
  for select
  to anon, authenticated
  using (exists (
    select 1 from events e where e.id = ticket_types.event_id and e.status = 'published'
  ));

-- === 2. Migrera befintliga event -> en "Ordinarie"-biljettyp ===
-- Måste ske INNAN events.price_ore/vat_rate/capacity/sold_count droppas
-- nedan, så att ingen prisdata för befintliga event/redan sålda biljetter
-- går förlorad.
insert into ticket_types (event_id, name, price_ore, vat_rate, capacity, sold_count, sort_order)
select id, 'Ordinarie', price_ore, vat_rate, capacity, sold_count, 0
from events;

-- === 3. orders/tickets -> ticket_type_id ===
alter table orders add column ticket_type_id uuid references ticket_types(id);
alter table tickets add column ticket_type_id uuid references ticket_types(id);

-- Bakåtkompatibilitet: befintliga orders/tickets-rader pekas om till
-- respektive events nyskapade "Ordinarie"-typ.
update orders o
   set ticket_type_id = tt.id
  from ticket_types tt
 where tt.event_id = o.event_id
   and tt.name = 'Ordinarie';

update tickets t
   set ticket_type_id = tt.id
  from ticket_types tt
 where tt.event_id = t.event_id
   and tt.name = 'Ordinarie';

-- === 4. events - pris/moms/kapacitet flyttar bort ===
alter table events drop column price_ore;
alter table events drop column vat_rate;
alter table events drop column capacity;
alter table events drop column sold_count;

-- === 5. discount_codes ===
create table discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null,
  value int not null,
  event_id uuid references events(id),
  max_uses int,
  used_count int not null default 0,
  valid_from timestamptz,
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz default now(),
  constraint discount_codes_type_check check (discount_type in ('percent', 'amount')),
  constraint discount_codes_value_check check (
    (discount_type = 'percent' and value >= 1 and value <= 100)
    or (discount_type = 'amount' and value >= 0)
  ),
  constraint discount_codes_used_count_check check (used_count >= 0)
);

create unique index discount_codes_code_upper_idx on discount_codes (upper(code));
create index discount_codes_event_id_idx on discount_codes(event_id);

-- RLS: ingen policy för anon/authenticated alls - koder ska aldrig gå att
-- lista eller läsa från klienten (annars kan giltiga koder scannas fram).
-- De valideras uteslutande server-side i create-order med service role,
-- som kringgår RLS helt.
alter table discount_codes enable row level security;

-- === 6. orders - spåra tillämpad rabatt ===
alter table orders
  add column discount_code_id uuid references discount_codes(id),
  add column discount_amount_ore int not null default 0;

alter table orders
  add constraint orders_discount_amount_ore_check check (discount_amount_ore >= 0);

-- === 7. Atomisk kapacitetsreservation/-frisläppning på ticket_types ===
-- Ersätter reserve_event_capacity/release_event_capacity (som refererade
-- events.capacity/sold_count, vilka just droppats ovan). Samma atomiska
-- mönster som tidigare, bara flyttat till ticket_types.
create or replace function reserve_ticket_type_capacity(p_ticket_type_id uuid, p_qty int)
returns table(sold_count int)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update ticket_types
       set sold_count = ticket_types.sold_count + p_qty
     where ticket_types.id = p_ticket_type_id
       and ticket_types.sold_count + p_qty <= ticket_types.capacity
    returning ticket_types.sold_count;
end;
$$;

create or replace function release_ticket_type_capacity(p_ticket_type_id uuid, p_qty int)
returns table(sold_count int)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update ticket_types
       set sold_count = greatest(ticket_types.sold_count - p_qty, 0)
     where ticket_types.id = p_ticket_type_id
    returning ticket_types.sold_count;
end;
$$;

revoke all on function reserve_ticket_type_capacity(uuid, int) from public;
revoke all on function release_ticket_type_capacity(uuid, int) from public;

-- release_expired_orders() skrivs om att jobba mot ticket_types istället
-- för events - annars skulle den fortfarande referera events.capacity/
-- sold_count som just droppats.
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
    returning orders.id, orders.ticket_type_id, orders.qty
  loop
    if r.ticket_type_id is not null then
      perform release_ticket_type_capacity(r.ticket_type_id, r.qty);
    end if;
    released_order_id := r.id;
    return next;
  end loop;
end;
$$;

revoke all on function release_expired_orders() from public;

-- De gamla event-baserade kapacitetsfunktionerna är inte längre
-- anropbara (events har inga price_ore/capacity/sold_count-kolumner kvar)
-- och ersätts helt av ticket_types-varianterna ovan.
drop function if exists reserve_event_capacity(uuid, int);
drop function if exists release_event_capacity(uuid, int);

-- Atomisk ökning av discount_codes.used_count, anropad från stripe-webhook
-- vid checkout.session.completed (aldrig från create-order - se
-- kommentaren där). SECURITY DEFINER, samma mönster som
-- reserve_ticket_type_capacity.
--
-- Villkorad på max_uses (samma atomiska WHERE-i-samma-sats-mönster som
-- kapacitetsreservationen): validering i create-order sker FÖRE betalning
-- och skyddar inte ensam mot två samtidiga köp som båda validerar en
-- max_uses=1-kod innan någon av dem hunnit betala. Detta UPDATE-villkor
-- är det som faktiskt garanterar att used_count aldrig kan gå förbi
-- max_uses, oavsett hur create-order-valideringen racear.
create or replace function increment_discount_code_used_count(p_discount_code_id uuid)
returns table(used_count int)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update discount_codes
       set used_count = discount_codes.used_count + 1
     where discount_codes.id = p_discount_code_id
       and (discount_codes.max_uses is null or discount_codes.used_count < discount_codes.max_uses)
    returning discount_codes.used_count;
end;
$$;

revoke all on function increment_discount_code_used_count(uuid) from public;
