-- SODSS Biljett PoC - Tilläggsorder: Flera arrangörer, riktiga
-- inloggningar och dataisolering
--
-- Ersätter den delade PIN-koden (ADMIN_PIN/ADMIN_SESSION_SECRET) med
-- riktig Supabase Auth. Varje arrangör (organizer) har en eller flera
-- inloggade personer (organizer_members), och event kopplas till en
-- arrangör (events.organizer_id). RLS ger dataisolering på databasnivå,
-- inte bara i Edge Function-koden.
--
-- AVVIKELSE FRÅN ORDERTEXTEN, dokumenterad här: ordertexten säger att
-- discount_codes ska scopas "transitivt via events.organizer_id" - precis
-- som ticket_types. Det fungerar för ticket_types (event_id är alltid
-- NOT NULL där), men discount_codes.event_id är NULLABLE (en global kod
-- gäller alla event, se Tilläggsordern 2026-08-04 om rabattkoder) - det
-- finns inget event att joina via för en global kod, så en transitiv
-- policy skulle antingen inte kunna skydda globala koder alls, eller (värre)
-- en "global" kod skapad av SDS skulle appliceras på Testscenens köp också
-- (create-order validerar bara code.event_id === eventId ELLER null).
-- Det bryter uttryckligen mot Definition of Done-punkt 6 (en arrangörs
-- rabattkod ska inte kunna påverka en annan arrangörs event). Lösning:
-- discount_codes får en egen organizer_id-kolumn (som events), så att
-- "global" konsekvent betyder "global inom den arrangörens event", inte
-- global över hela plattformen. Se även create-order/index.ts som nu
-- validerar discount_codes.organizer_id === events.organizer_id.

-- === 1. organizers ===
create table organizers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  contact_email text,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- === 2. organizer_members - kopplar Supabase Auth-användare till arrangör ===
create table organizer_members (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references organizers(id),
  user_id uuid not null references auth.users(id),
  role text not null default 'admin',
  created_at timestamptz default now(),
  unique (organizer_id, user_id)
);

create index organizer_members_user_id_idx on organizer_members(user_id);

-- RLS: helt stängd för anon/authenticated - bara service role (Edge
-- Functions) läser/skriver denna tabell, precis som orders/tickets m.fl.
-- Ingen anon/authenticated-policy alls = deny by default.
alter table organizer_members enable row level security;

-- === 3. events.organizer_id ===
alter table events add column organizer_id uuid references organizers(id);

insert into organizers (name, slug, contact_email)
values ('Sollentuna Dans & Scenskola', 'sds', null);

update events
   set organizer_id = (select id from organizers where slug = 'sds')
 where organizer_id is null;

alter table events alter column organizer_id set not null;

-- === 4. discount_codes.organizer_id (se avvikelsekommentaren högst upp) ===
alter table discount_codes add column organizer_id uuid references organizers(id);

update discount_codes
   set organizer_id = (select id from organizers where slug = 'sds')
 where organizer_id is null;

alter table discount_codes alter column organizer_id set not null;

-- === 5. organizers - publikt läsbart namn (köpsidan/evenemangslistan ska
-- kunna visa "Arrangör: X" utan att gå via en Edge Function) ===
alter table organizers enable row level security;

create policy "Namn på aktiva arrangörer är publikt läsbara"
  on organizers
  for select
  to anon, authenticated
  using (active = true);

-- === 6. events - RLS-baserad dataisolering för admin ===
-- Den befintliga publika läspolicyn (status = 'published' för anon OCH
-- authenticated) rörs inte - publika köpare (och inloggade arrangörer,
-- som också är "authenticated") ska fortfarande se ALLA publicerade
-- event oavsett arrangör. Den nya policyn nedan är "for all" (select/
-- insert/update/delete) och lägger till: en inloggad användare får också
-- se/ändra/radera event som hör till DERAS EGEN arrangör, oavsett status
-- (draft/published/cancelled). Ingen egen WITH CHECK-sats behövs - Postgres
-- använder USING-uttrycket för båda om WITH CHECK utelämnas, vilket
-- automatiskt hindrar en INSERT/UPDATE som skulle sätta organizer_id till
-- en arrangör man inte är medlem i.
create policy "Arrangörer ser och redigerar bara sina egna event (admin)"
  on events
  for all
  to authenticated
  using (
    exists (
      select 1 from organizer_members om
      where om.organizer_id = events.organizer_id
        and om.user_id = auth.uid()
    )
  );

-- === 7. ticket_types - samma mönster, transitivt via events.organizer_id
-- (event_id är alltid NOT NULL på ticket_types, ingen nullable-komplikation
-- här som för discount_codes) ===
create policy "Arrangörer ser och redigerar bara sina egna biljettyper (admin)"
  on ticket_types
  for all
  to authenticated
  using (
    exists (
      select 1 from events e
      join organizer_members om on om.organizer_id = e.organizer_id
      where e.id = ticket_types.event_id and om.user_id = auth.uid()
    )
  );

-- === 8. discount_codes - direkt via den nya organizer_id-kolumnen ===
create policy "Arrangörer ser och redigerar bara sina egna rabattkoder (admin)"
  on discount_codes
  for all
  to authenticated
  using (
    exists (
      select 1 from organizer_members om
      where om.organizer_id = discount_codes.organizer_id
        and om.user_id = auth.uid()
    )
  );

-- orders, order_items, tickets, ticket_scans förblir helt stängda för
-- authenticated/anon (som idag) - de nås uteslutande via Edge Functions
-- med service role, som själva måste filtrera på organizer_id (se
-- admin-event-tickets/export-sales). RLS skyddar administrationsytan;
-- service-role-funktionerna måste skydda resten manuellt eftersom de
-- medvetet kringgår RLS.
