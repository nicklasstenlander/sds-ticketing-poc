-- Ordern "Rideau skarpt för SDS vinterföreställning" (2026-10-01), A5/A6.
--
-- legal_name/org_number: visas som säljare på kvittodelen av biljettmailet
-- (stripe-webhook). Om legal_name saknas för en arrangör hoppar mailet
-- bara över säljarraden - kraschar inte (se A5).
--
-- terms_url: om satt visar köpsidan en obligatorisk köpvillkor-kryssruta
-- (A6) för den arrangörens event. Tom/null för en arrangör = ingen
-- kryssruta, inga andra arrangörer påverkas.
alter table organizers
  add column legal_name text,
  add column org_number text,
  add column terms_url text;
