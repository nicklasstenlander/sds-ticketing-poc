-- Flytta en betald order till en annan speltid av SAMMA föreställning
-- (2026-11, "flytta sålda biljetter mellan shower").
--
-- Beslut (Nicklas 2026-11-09):
--   * Hela ordern flyttas - aldrig delar av den.
--   * Bara till en annan speltid av samma föreställning: samma arrangör,
--     samma titel och plats (samma gruppering som /evenemang och admin).
--   * Biljettyperna matchas på NAMN. Priset och momsen är redan betalda
--     och snapshotade på order_items - de rörs inte, så ingen
--     mellanskillnad uppstår och bokföringsunderlaget förblir intakt.
--   * Gamla biljetter makuleras (status 'void' - avvisas av scan-ticket),
--     nya biljetter med nya koder skapas på mål-speltiden.
--
-- Allt sker i EN transaktion: platser frigörs på källan och reserveras
-- på målet (samma reserve/release_shared_capacity_multi som köp och
-- avbokning), order_items pekas om till målets biljettyper, ordern
-- flyttas, biljetterna byts och flytten loggas i order_moves.
--
-- Biljettkoderna genereras i edge-funktionen (admin-move-order), precis
-- som stripe-webhook gör för finalize_paid_order - en kod per biljett.
--
-- Utfall (outcome):
--   'moved'          - klart; tickets innehåller de nya biljetterna
--   'not_found'      - ordern finns inte, är inte betald eller är arkiverad
--   'same_event'     - målet är samma speltid som ordern redan ligger på
--   'invalid_target' - målet finns inte, tillhör annan arrangör, är inte
--                      publicerat/är arkiverat eller är en annan föreställning
--   'checked_in'     - minst en biljett är redan incheckad
--   'type_mismatch'  - målet saknar en biljettyp med samma namn
--   'no_capacity'    - målet har inte plats för hela ordern
begin;

create table if not exists order_moves (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  from_event_id uuid not null references events(id),
  to_event_id uuid not null references events(id),
  ticket_qty int not null,
  moved_by uuid,
  moved_at timestamptz not null default now()
);
create index if not exists order_moves_order_id_idx on order_moves(order_id);
alter table order_moves enable row level security;
-- Inga policies: bara service role (edge-funktionerna) läser och skriver,
-- samma modell som övriga tabeller i projektet.

create or replace function move_paid_order(
  p_order_id uuid,
  p_target_event_id uuid,
  p_organizer_id uuid,
  p_ticket_codes text[],
  p_moved_by uuid
)
returns table(outcome text, from_event_id uuid, to_event_id uuid, tickets jsonb)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  v_order record;
  v_source record;
  v_target record;
  v_total_qty int;
  v_source_items jsonb;
  v_target_items jsonb;
  v_missing int;
  v_reserved int;
begin
  -- Låser ordern så att två samtidiga flyttar (eller en avbokning) inte
  -- kan krocka.
  select o.id, o.event_id, o.status, o.archived_at, o.buyer_name
    into v_order
    from orders o
   where o.id = p_order_id
   for update;

  if v_order.id is null or v_order.status <> 'paid' or v_order.archived_at is not null then
    outcome := 'not_found'; return next; return;
  end if;

  select e.id, e.organizer_id, e.title, e.venue into v_source
    from events e where e.id = v_order.event_id;
  if v_source.organizer_id is distinct from p_organizer_id then
    outcome := 'not_found'; return next; return;
  end if;

  if p_target_event_id = v_order.event_id then
    outcome := 'same_event'; from_event_id := v_source.id; return next; return;
  end if;

  select e.id, e.organizer_id, e.title, e.venue, e.status, e.archived_at into v_target
    from events e where e.id = p_target_event_id;
  if v_target.id is null
     or v_target.organizer_id is distinct from p_organizer_id
     or v_target.status <> 'published'
     or v_target.archived_at is not null
     or v_target.title <> v_source.title
     or coalesce(v_target.venue, '') <> coalesce(v_source.venue, '') then
    outcome := 'invalid_target'; from_event_id := v_source.id; return next; return;
  end if;

  if exists (select 1 from tickets t where t.order_id = p_order_id and t.status = 'checked_in') then
    outcome := 'checked_in'; from_event_id := v_source.id; return next; return;
  end if;

  -- Varje orderrad måste ha en biljettyp med samma namn på målet.
  select count(*) into v_missing
    from order_items oi
    join ticket_types src on src.id = oi.ticket_type_id
   where oi.order_id = p_order_id
     and not exists (
       select 1 from ticket_types dst
        where dst.event_id = p_target_event_id and dst.name = src.name
     );
  if v_missing > 0 then
    outcome := 'type_mismatch'; from_event_id := v_source.id; return next; return;
  end if;

  select coalesce(sum(oi.qty), 0),
         coalesce(jsonb_agg(jsonb_build_object('ticket_type_id', oi.ticket_type_id, 'qty', oi.qty)), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object(
           'ticket_type_id',
           (select dst.id from ticket_types dst
             where dst.event_id = p_target_event_id and dst.name = src.name
             order by dst.sort_order, dst.created_at limit 1),
           'qty', oi.qty)), '[]'::jsonb)
    into v_total_qty, v_source_items, v_target_items
    from order_items oi
    join ticket_types src on src.id = oi.ticket_type_id
   where oi.order_id = p_order_id;

  if coalesce(array_length(p_ticket_codes, 1), 0) <> v_total_qty then
    raise exception 'move_paid_order: % biljettkod(er) skickades in, % förväntades (order %)',
      coalesce(array_length(p_ticket_codes, 1), 0), v_total_qty, p_order_id;
  end if;

  -- Platser: reservera på målet först (kan misslyckas), frigör sedan källan.
  select r.event_sold_count into v_reserved
    from reserve_shared_capacity_multi(p_target_event_id, v_target_items, v_total_qty) r;
  if v_reserved is null then
    outcome := 'no_capacity'; from_event_id := v_source.id; return next; return;
  end if;
  perform release_shared_capacity_multi(v_source.id, v_source_items, v_total_qty);

  -- Orderraderna pekas om till målets biljettyper (pris/moms orörda).
  update order_items oi
     set ticket_type_id = (
       select dst.id from ticket_types dst
        where dst.event_id = p_target_event_id
          and dst.name = (select src.name from ticket_types src where src.id = oi.ticket_type_id)
        order by dst.sort_order, dst.created_at limit 1)
   where oi.order_id = p_order_id;

  update orders set event_id = p_target_event_id where id = p_order_id;

  -- Gamla biljetter makuleras och ligger kvar på källan (spårbarhet).
  update tickets set status = 'void'
   where order_id = p_order_id and status <> 'void';

  -- Nya biljetter, en per köpt plats, samma mönster som finalize_paid_order.
  with expanded as (
    select oi.ticket_type_id,
           row_number() over (order by oi.id, gs.n) as rn
    from order_items oi
    cross join lateral generate_series(1, oi.qty) as gs(n)
    where oi.order_id = p_order_id
  ),
  codes as (
    select ord as rn, code
    from unnest(p_ticket_codes) with ordinality as u(code, ord)
  )
  insert into tickets (order_id, event_id, ticket_type_id, ticket_code, holder_name, status)
  select p_order_id, p_target_event_id, e.ticket_type_id, c.code, v_order.buyer_name, 'valid'
  from expanded e
  join codes c on c.rn = e.rn;

  insert into order_moves (order_id, from_event_id, to_event_id, ticket_qty, moved_by)
  values (p_order_id, v_source.id, p_target_event_id, v_total_qty, p_moved_by);

  outcome := 'moved';
  from_event_id := v_source.id;
  to_event_id := p_target_event_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'ticket_code', t.ticket_code, 'ticket_type_id', t.ticket_type_id)), '[]'::jsonb)
    into tickets
    from tickets t
   where t.order_id = p_order_id and t.status = 'valid';
  return next;
end;
$$;

revoke all on function move_paid_order(uuid, uuid, uuid, text[], uuid) from public;
revoke all on function move_paid_order(uuid, uuid, uuid, text[], uuid) from anon;
revoke all on function move_paid_order(uuid, uuid, uuid, text[], uuid) from authenticated;
grant execute on function move_paid_order(uuid, uuid, uuid, text[], uuid) to service_role;

commit;
