-- Ansökningsformulär för nya arrangörer (Tilläggsordern 2026-08-06/07,
-- "Ansökningsformulär för nya arrangörer (Squarespace -> godkännande ->
-- portal)"). Ersätter ett tidigare utkast som hade skapat konton direkt
-- vid formulärinskick - se ordertextens punkt 0 för riskgenomgången.
--
-- Formuläret skapar bara en ANSÖKAN, aldrig ett konto/Auth-inbjudan
-- direkt. En platform-admin måste explicit godkänna innan
-- platform-create-organizer-flödet (organizers-rad + Supabase-inbjudan +
-- organizer_members-rad) körs - se admin-approve-application och
-- _shared/createOrganizer.ts.

create table organizer_applications (
  id uuid primary key default gen_random_uuid(),
  organizer_name text not null,
  contact_email text not null,
  message text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  constraint organizer_applications_status_check
    check (status in ('pending', 'approved', 'rejected'))
);

-- Ingen policy för anon/authenticated - RLS är alltså default-deny för
-- bägge, samma mönster som discount_codes (se scenpass-platform-skillen,
-- avsnitt 6). Bara nåbar via Edge Functions med service-role-klienten
-- (_shared/supabaseAdmin.ts), som kringgår RLS helt oavsett.
alter table organizer_applications enable row level security;

create index organizer_applications_status_idx
  on organizer_applications (status, created_at desc);

-- Generell formulär-hastighetsbegränsning, döpt så att den kan
-- återanvändas av framtida publika formulär (inte bara detta) - se
-- ordertextens punkt 4. `form`-kolumnen skiljer olika formulär åt inom
-- samma tabell istället för att varje nytt formulär behöver en egen
-- rate-limit-tabell.
create table form_submission_attempts (
  id uuid primary key default gen_random_uuid(),
  form text not null,
  ip_address text not null,
  created_at timestamptz not null default now()
);

alter table form_submission_attempts enable row level security;

-- Stödjer "räkna anrop för (form, ip) inom ett tidsfönster"-frågan som
-- public-apply-organizer kör på varje anrop.
create index form_submission_attempts_lookup_idx
  on form_submission_attempts (form, ip_address, created_at desc);
