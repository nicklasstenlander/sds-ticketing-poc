-- SODSS Biljett PoC - Tilläggsorder: Duplicera event
--
-- Låter en admin duplicera ett befintligt event (inklusive dess
-- biljettyper) som utgångspunkt för en ny föreställning, istället för
-- att fylla i allt från grunden igen.
--
-- Datumet kopieras MEDVETET INTE - ett dublicerat event med exakt samma
-- starts_at som originalet skulle se ut som en identisk föreställning
-- samma kväll, förvirrande i både admin och den publika listan. events.
-- starts_at måste därför bli nullable (var NOT NULL sedan grundschemat)
-- och kopian tvingas till status='draft' - ett event utan datum får
-- ALDRIG synas publikt eller säljas biljetter till av misstag.
--
-- Publiceringsspärren i admin-update-event täcker redan "minst en
-- biljettyp krävs" - denna order lägger till motsvarande spärr för
-- datum, både i edge function-koden OCH som ett DB-constraint (samma
-- försvar-i-djup-princip som resten av schemat: koden kan ha buggar,
-- constrainten kan inte kringgås).
--
-- Affischer kopieras INTE (filerna ligger på en event_id-baserad sökväg
-- i Storage - det nya eventet har ett nytt id, och en dublicerad
-- föreställning har ofta ett annat datum/annan affisch ändå). Historik
-- (ordrar, order_items, biljetter, ticket_scans, rabattkodsanvändning)
-- kopieras aldrig - det hör till källeventet.

-- === 1. events.starts_at blir nullable ===
alter table events alter column starts_at drop not null;

-- Försvar i djupet: ett event kan aldrig vara 'published' utan ett
-- satt datum, oavsett vad applikationskoden råkar tillåta. Detta är
-- INTE bara relevant för dubliceringsflödet - skyddar mot varje framtida
-- kodväg (nuvarande eller ännu oskriven) som skulle kunna publicera ett
-- event utan datum.
alter table events
  add constraint events_published_requires_starts_at
  check (status <> 'published' or starts_at is not null);

-- === 2. duplicate_event() - kopiera event + ticket_types atomärt ===
-- SECURITY DEFINER, samma mönster som reserve_shared_capacity_multi:
-- edge function-koden (admin-duplicate-event) har REDAN verifierat att
-- källeventet tillhör den inloggade användarens arrangör INNAN detta
-- anropas - denna funktion litar på det och gör själva kopieringen, inte
-- ägarskapskontrollen. Allt sker i en enda transaktion (ett funktions-
-- anrop) så att ett event aldrig kan skapas utan sina biljettyper vid
-- ett halvvägs-fel.
create or replace function duplicate_event(p_event_id uuid)
returns table(new_event_id uuid, new_slug text)
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

  -- Unik slug: bas-slug + "-kopia", sedan "-kopia-2", "-kopia-3", ... vid
  -- kollision. Samma inkrementerande mönster som admin-create-event
  -- använder för nya events - slugen är unik globalt (över alla
  -- arrangörer), inte bara inom en arrangör, eftersom den utgör den
  -- publika köp-URL:en.
  v_slug := v_source.slug || '-kopia';
  while exists (select 1 from events where slug = v_slug) loop
    v_slug := v_source.slug || '-kopia-' || v_attempt;
    v_attempt := v_attempt + 1;
  end loop;

  insert into events (slug, title, venue, starts_at, capacity, sold_count, status, organizer_id)
  values (
    v_slug,
    'Kopia av ' || v_source.title,
    v_source.venue,
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
