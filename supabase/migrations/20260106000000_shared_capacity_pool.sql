-- SODSS Biljett PoC - Rättelseorder: delad kapacitetspool mellan biljettyper
--
-- Ursprungsordern för biljettyper gav varje ticket_type en egen, oberoende
-- capacity. Det var fel: biljettyperna ska dela en gemensam pott platser
-- för eventet (styrt av lokalens faktiska storlek), inte ha oberoende
-- kapacitetstak som tillsammans kan överstiga lokalens verkliga storlek.
--
-- events återfår capacity/sold_count som en delad pool. ticket_types
-- behåller sold_count (rapportering: "35 sålda Ordinarie") men tappar
-- capacity helt - ingen egen spärr längre.

-- === 1. events - återfår capacity/sold_count som delad pool ===
alter table events
  add column capacity int not null default 0,
  add column sold_count int not null default 0;

-- Backfill: capacity = summan av alla ticket_types.capacity för eventet
-- (den totala lokalstorlek som redan var känd via den felaktiga
-- per-typ-modellen). Körs INNAN ticket_types.capacity droppas nedan.
update events e
   set capacity = coalesce((
         select sum(tt.capacity) from ticket_types tt where tt.event_id = e.id
       ), 0),
       sold_count = coalesce((
         select sum(tt.sold_count) from ticket_types tt where tt.event_id = e.id
       ), 0);

alter table events
  add constraint events_capacity_check check (capacity >= 0),
  add constraint events_sold_count_check check (sold_count >= 0 and sold_count <= capacity);

-- === 2. ticket_types - behåller sold_count, tappar capacity ===
alter table ticket_types drop constraint ticket_types_sold_count_check;
alter table ticket_types drop constraint ticket_types_capacity_check;
alter table ticket_types drop column capacity;

-- sold_count har ingen check-koppling till någon kapacitet längre på
-- denna tabell - bara ett icke-negativt räkneverk för rapportering.
alter table ticket_types
  add constraint ticket_types_sold_count_check check (sold_count >= 0);

-- === 3. reserve_shared_capacity / release_shared_capacity ===
-- Ersätter reserve_ticket_type_capacity/release_ticket_type_capacity.
-- Kontrollen sker mot EVENTETS pool (atomiskt, samma WHERE-i-samma-sats-
-- mönster som tidigare), men ticket_types.sold_count uppdateras samtidigt
-- för rapportering - båda uppdateringarna sker i samma
-- plpgsql-funktionsanrop och är därmed atomära tillsammans.
create or replace function reserve_shared_capacity(p_event_id uuid, p_ticket_type_id uuid, p_qty int)
returns table(event_sold_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_count int;
begin
  update events
     set sold_count = events.sold_count + p_qty
   where events.id = p_event_id
     and events.sold_count + p_qty <= events.capacity
  returning events.sold_count into v_new_count;
  if v_new_count is null then
    return; -- ingen rad matchade = slutsålt, tom resultatmängd precis som tidigare
  end if;
  update ticket_types
     set sold_count = ticket_types.sold_count + p_qty
   where ticket_types.id = p_ticket_type_id;
  event_sold_count := v_new_count;
  return next;
end;
$$;

create or replace function release_shared_capacity(p_event_id uuid, p_ticket_type_id uuid, p_qty int)
returns table(event_sold_count int)
language plpgsql
security definer
set search_path = public
as $$
begin
  update events
     set sold_count = greatest(events.sold_count - p_qty, 0)
   where events.id = p_event_id
  returning events.sold_count into event_sold_count;
  update ticket_types
     set sold_count = greatest(ticket_types.sold_count - p_qty, 0)
   where ticket_types.id = p_ticket_type_id;
  return next;
end;
$$;

revoke all on function reserve_shared_capacity(uuid, uuid, int) from public;
revoke all on function release_shared_capacity(uuid, uuid, int) from public;

drop function if exists reserve_ticket_type_capacity(uuid, int);
drop function if exists release_ticket_type_capacity(uuid, int);

-- === 4. release_expired_orders() - anropa nya funktionen med event_id ===
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
    returning orders.id, orders.event_id, orders.ticket_type_id, orders.qty
  loop
    if r.ticket_type_id is not null then
      perform release_shared_capacity(r.event_id, r.ticket_type_id, r.qty);
    end if;
    released_order_id := r.id;
    return next;
  end loop;
end;
$$;

revoke all on function release_expired_orders() from public;
