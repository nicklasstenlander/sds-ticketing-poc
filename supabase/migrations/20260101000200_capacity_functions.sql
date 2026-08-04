-- Atomisk kapacitetsreservation/-frisläppning, anropas via supabase.rpc()
-- från create-order-edge-functionen. SECURITY DEFINER så att den kan
-- exekveras oavsett RLS (den anropas ändå bara med service role-nyckeln
-- från edge functions, aldrig direkt av anon).
--
-- Detta är samma logik som spec:ens rådata-UPDATE:
--   update events set sold_count = sold_count + :qty
--    where id = :id and sold_count + :qty <= capacity
--    returning sold_count;
-- Eftersom WHERE-villkoret och UPDATE:et körs i en och samma sats i
-- databasen är detta atomiskt - två samtidiga köp kan aldrig båda lyckas
-- över kapacitetsgränsen.

create or replace function reserve_event_capacity(p_event_id uuid, p_qty int)
returns table(sold_count int)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update events
       set sold_count = events.sold_count + p_qty
     where events.id = p_event_id
       and events.sold_count + p_qty <= events.capacity
    returning events.sold_count;
end;
$$;

-- Används för att rulla tillbaka en reservation om order/biljett-skapandet
-- misslyckas efter att kapaciteten redan reserverats.
create or replace function release_event_capacity(p_event_id uuid, p_qty int)
returns table(sold_count int)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update events
       set sold_count = greatest(events.sold_count - p_qty, 0)
     where events.id = p_event_id
    returning events.sold_count;
end;
$$;

revoke all on function reserve_event_capacity(uuid, int) from public;
revoke all on function release_event_capacity(uuid, int) from public;
