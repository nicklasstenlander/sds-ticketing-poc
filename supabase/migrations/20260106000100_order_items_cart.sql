-- SODSS Biljett PoC - Tilläggsorder: flera biljettyper i samma köp (kundvagn)
--
-- En order kan nu innehålla flera rader (en per biljettyp) via en ny
-- order_items-tabell, istället för ett enda ticket_type_id/qty/price_ore
-- direkt på ordern. Bygger på den delade kapacitetspoolen (rättelseordern,
-- 20260106000000) - hela kundvagnen reserveras atomärt i EN kontroll mot
-- eventets pool, inte rad för rad.
--
-- orders behåller sina gamla kolumner (ticket_type_id/price_ore/vat_rate/
-- qty) OFÖRÄNDRADE och odroppade - det finns redan betalda ordrar som
-- använder dem. Nya ordrar lämnar dem null och använder bara order_items
-- + orders.total_ore.

-- === 1. order_items ===
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  ticket_type_id uuid not null references ticket_types(id),
  qty int not null,
  unit_price_ore int not null,
  vat_rate int not null,
  constraint order_items_qty_check check (qty > 0),
  constraint order_items_unit_price_check check (unit_price_ore >= 0)
);
create index order_items_order_id_idx on order_items(order_id);

-- === 2. orders.total_ore ===
alter table orders add column total_ore int;

-- Backfill: varje befintlig order (enradsköp under den gamla modellen)
-- får en motsvarande order_items-rad, och total_ore sätts från de gamla
-- price_ore/qty-kolumnerna.
insert into order_items (order_id, ticket_type_id, qty, unit_price_ore, vat_rate)
select o.id, o.ticket_type_id, o.qty, o.price_ore, o.vat_rate
from orders o
where o.ticket_type_id is not null;

update orders o
   set total_ore = o.price_ore * o.qty
 where o.ticket_type_id is not null;

-- === 3. Atomär reservation/frisläppning för hela kundvagnen ===
-- Ersätter reserve_shared_capacity/release_shared_capacity (enrads-
-- varianterna från rättelseordern) - multi-varianten täcker även
-- enradsfallet (en array med ett element), så de gamla tas bort.
create or replace function reserve_shared_capacity_multi(
  p_event_id uuid, p_items jsonb, p_total_qty int
)
returns table(event_sold_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_count int;
  item jsonb;
begin
  update events
     set sold_count = events.sold_count + p_total_qty
   where events.id = p_event_id
     and events.sold_count + p_total_qty <= events.capacity
  returning events.sold_count into v_new_count;
  if v_new_count is null then
    return; -- slutsålt, tom resultatmängd
  end if;
  for item in select * from jsonb_array_elements(p_items)
  loop
    update ticket_types
       set sold_count = ticket_types.sold_count + (item->>'qty')::int
     where ticket_types.id = (item->>'ticket_type_id')::uuid;
  end loop;
  event_sold_count := v_new_count;
  return next;
end;
$$;

create or replace function release_shared_capacity_multi(
  p_event_id uuid, p_items jsonb, p_total_qty int
)
returns table(event_sold_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
begin
  update events
     set sold_count = greatest(events.sold_count - p_total_qty, 0)
   where events.id = p_event_id
  returning events.sold_count into event_sold_count;
  for item in select * from jsonb_array_elements(p_items)
  loop
    update ticket_types
       set sold_count = greatest(ticket_types.sold_count - (item->>'qty')::int, 0)
     where ticket_types.id = (item->>'ticket_type_id')::uuid;
  end loop;
  return next;
end;
$$;

revoke all on function reserve_shared_capacity_multi(uuid, jsonb, int) from public;
revoke all on function release_shared_capacity_multi(uuid, jsonb, int) from public;

drop function if exists reserve_shared_capacity(uuid, uuid, int);
drop function if exists release_shared_capacity(uuid, uuid, int);

-- === 4. release_expired_orders() - läs order_items istället för ett
-- enda ticket_type_id/qty på ordern ===
create or replace function release_expired_orders()
returns table(released_order_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_items jsonb;
  v_total_qty int;
begin
  for r in
    update orders
       set status = 'expired'
     where orders.status = 'pending'
       and orders.expires_at is not null
       and orders.expires_at < now()
    returning orders.id, orders.event_id
  loop
    select
      coalesce(jsonb_agg(jsonb_build_object('ticket_type_id', oi.ticket_type_id, 'qty', oi.qty)), '[]'::jsonb),
      coalesce(sum(oi.qty), 0)
      into v_items, v_total_qty
    from order_items oi
    where oi.order_id = r.id;

    if v_total_qty > 0 then
      perform release_shared_capacity_multi(r.event_id, v_items, v_total_qty);
    end if;

    released_order_id := r.id;
    return next;
  end loop;
end;
$$;

revoke all on function release_expired_orders() from public;
