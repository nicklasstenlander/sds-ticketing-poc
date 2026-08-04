-- SODSS Biljett PoC - grundschema
-- Körs på ett HELT NYTT, tomt Supabase-projekt. Detta projekt är fristående
-- och delar INGET med produktionsmiljön (SODSS CORE/CogWork).

create extension if not exists pgcrypto;

create table events (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  venue text,
  starts_at timestamptz not null,
  capacity int not null,
  sold_count int not null default 0,
  status text not null default 'published', -- draft | published
  created_at timestamptz default now(),
  constraint events_status_check check (status in ('draft', 'published')),
  constraint events_capacity_check check (capacity >= 0),
  constraint events_sold_count_check check (sold_count >= 0 and sold_count <= capacity)
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id),
  buyer_name text not null,
  buyer_email text not null,
  qty int not null,
  status text not null default 'confirmed',
  created_at timestamptz default now(),
  constraint orders_qty_check check (qty >= 1 and qty <= 6)
);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  event_id uuid not null references events(id),
  ticket_code text unique not null,
  holder_name text,
  status text not null default 'valid', -- valid | checked_in | void
  checked_in_at timestamptz,
  checked_in_by text,
  constraint tickets_status_check check (status in ('valid', 'checked_in', 'void'))
);

create table ticket_scans (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references tickets(id),
  scanned_at timestamptz default now(),
  device text,
  result text -- ok | duplicate | invalid
);

create index orders_event_id_idx on orders(event_id);
create index tickets_order_id_idx on tickets(order_id);
create index tickets_event_id_idx on tickets(event_id);
create index tickets_ticket_code_idx on tickets(ticket_code);
create index ticket_scans_ticket_id_idx on ticket_scans(ticket_id);

-- === Row Level Security: neka allt som standard ===
-- Alla skrivningar (create-order, scan-ticket, admin-*) sker i edge
-- functions med service role-nyckeln, som kringgår RLS helt. Anon-nyckeln
-- (den enda nyckel som når klienten) får bara läsa publicerade events.

alter table events enable row level security;
alter table orders enable row level security;
alter table tickets enable row level security;
alter table ticket_scans enable row level security;

-- events: anon får SELECT där status = 'published'. Inga andra policies
-- (ingen INSERT/UPDATE/DELETE) - det sker enbart via admin-edge-functions
-- med service role.
create policy "Publika events är läsbara för alla"
  on events
  for select
  to anon, authenticated
  using (status = 'published');

-- orders: ingen policy alls för anon -> ingen åtkomst.
-- tickets: ingen policy alls för anon -> ingen åtkomst.
-- ticket_scans: ingen policy alls för anon -> ingen åtkomst.
