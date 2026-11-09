-- Väntelista för slutsålda speltider (2026-11).
--
-- Beslut (Nicklas 2026-11-09): valfri per speltid, och admin erbjuder
-- platserna själv. Inget mejlas automatiskt när en plats blir ledig -
-- admin ser kön och klickar "Erbjud plats", då får de valda ett mejl med
-- köplänk. Först till kvarn: erbjudandet reserverar ingen plats.
--
-- events.waitlist_enabled: av som standard. Läses publikt via den
-- befintliga SELECT-policyn på events (köpsidan visar formuläret bara
-- när den är på och speltiden är slutsåld).
--
-- waitlist_entries: skrivs bara via edge-funktioner (public-join-waitlist,
-- admin-waitlist) med service role. RLS är på utan policies, samma modell
-- som övriga tabeller med personuppgifter.
--   status: 'waiting'  - står i kö
--           'offered'  - har fått erbjudande (offered_at satt)
--           'removed'  - borttagen av admin (raden behålls inte i listan)
-- En e-postadress kan bara stå EN gång per speltid (bland ej borttagna).
begin;

alter table events add column if not exists waitlist_enabled boolean not null default false;

create table if not exists waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id),
  name text not null,
  email text not null,
  qty int not null,
  status text not null default 'waiting',
  created_at timestamptz not null default now(),
  offered_at timestamptz,
  constraint waitlist_entries_qty_check check (qty between 1 and 10),
  constraint waitlist_entries_status_check check (status in ('waiting', 'offered', 'removed'))
);

create index if not exists waitlist_entries_event_id_idx on waitlist_entries(event_id, created_at);
create unique index if not exists waitlist_entries_unique_email
  on waitlist_entries(event_id, lower(email))
  where status <> 'removed';

alter table waitlist_entries enable row level security;

commit;
