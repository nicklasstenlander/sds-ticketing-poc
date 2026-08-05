-- Tilläggsorder 2026-08-05, uppföljning: "Platform-admin"-åtkomst till
-- alla arrangörers workspaces.
--
-- Bakgrund: resolveOrganizer() (se _shared/organizerAuth.ts) härledde
-- tidigare organizer_id enbart via organizer_members, med .maybeSingle()
-- - dvs en användare kunde bara tillhöra EN arrangör. Det räcker inte för
-- Nicklas/plattformsägaren, som behöver kunna agera i vilket workspace
-- som helst (support, felsökning, onboarding av nya kunder).
--
-- Lösningen (Alternativ 1 av de tre som diskuterades): en separat
-- platform_admins-tabell, inte fler rader i organizer_members. En
-- platform-admin väljer AKTIVT vilket workspace hen agerar i just nu
-- (X-Organizer-Id-headern, validerad server-side mot organizers-tabellen
-- - se resolveOrganizer) istället för att automatiskt "se allt" utan
-- sammanhang. Det håller kvar samma "en åtgärd = ett tydligt organizer_id"
-- - princip som resten av dataisoleringen bygger på, bara med en explicit,
-- granskningsbar undantagsväg för plattformsägaren.
create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- RLS på, men avsiktligt inga policies: tabellen läses ENDAST från
-- edge functions med service role (som kringgår RLS ändå), aldrig direkt
-- från klienten via PostgREST/anon-nyckeln. Detta är samma mönster som
-- discount_codes (se 20260105000000-migrationen).
alter table platform_admins enable row level security;
