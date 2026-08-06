-- Stripe Connect: eget underkonto per arrangör (Tilläggsordern 2026-08-06,
-- "Stripe Connect - eget underkonto per arrangör").
--
-- Båda kolumnerna är VALFRIA (nullable / default false), medvetet - se
-- ordertextens punkt 6 om migreringsordning. Befintlig kod (create-order)
-- fortsätter fungera för en arrangör som saknar stripe_account_id genom
-- att falla tillbaka på plattformens delade Stripe-konto, tills SDS och
-- Testscenen är aktivt migrerade och fallback-koden tas bort i en separat,
-- senare städning.
--
-- stripe_account_id sätts av admin-connect-stripe när Connect-kontot
-- skapas (INNAN onboarding är klar - en Account Link kan behöva besökas
-- flera gånger om arrangören inte slutför KYC-flödet i ett svep).
-- stripe_onboarding_complete sätts av stripe-webhook när Stripe bekräftar
-- via account.updated att kontot faktiskt kan ta emot betalningar
-- (charges_enabled && details_submitted) - inte av admin-connect-stripe,
-- eftersom att skapa ett Connect-konto inte är samma sak som att det är
-- redo att ta betalt.
alter table organizers
  add column stripe_account_id text,
  add column stripe_onboarding_complete boolean not null default false;
