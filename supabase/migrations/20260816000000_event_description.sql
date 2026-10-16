-- Showinformation (fri text) som visas på biljettsidan. Valfri; redigeras
-- via admin-update-event. Läses publikt via befintlig events-SELECT-policy.
alter table events add column if not exists description text;

-- Duplicera event ska ta med beskrivningen, så att flera speltillfällen av
-- samma föreställning (= flera event-rader) får samma text från start.
create or replace function duplicate_event(p_event_id uuid)
returns table (new_event_id uuid, new_slug text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source events%rowtype;
  v_slug text;
  v_attempt int := 2;
  v_new_id uuid;
begin
  select * into v_source from events where id = p_event_id;
  if not found then
    raise exception 'event_not_found';
  end if;

  v_slug := v_source.slug || '-kopia';
  while exists (select 1 from events where slug = v_slug) loop
    v_slug := v_source.slug || '-kopia-' || v_attempt;
    v_attempt := v_attempt + 1;
  end loop;

  insert into events (slug, title, venue, description, starts_at, capacity, sold_count, status, organizer_id)
  values (
    v_slug,
    'Kopia av ' || v_source.title,
    v_source.venue,
    v_source.description,
    null,
    v_source.capacity,
    0,
    'draft',
    v_source.organizer_id
  )
  returning id into v_new_id;

  insert into ticket_types (event_id, name, price_ore, vat_rate, sold_count, sort_order)
  select v_new_id, tt.name, tt.price_ore, tt.vat_rate, 0, tt.sort_order
  from ticket_types tt
  where tt.event_id = p_event_id;

  new_event_id := v_new_id;
  new_slug := v_slug;
  return next;
end;
$$;

revoke all on function duplicate_event(uuid) from public;
notify pgrst, 'reload schema';
