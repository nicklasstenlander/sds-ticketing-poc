-- orders.confirmation_email_sent_at (ordern "Webhooken: misslyckade
-- händelser måste kunna försökas igen" 2026-10-12, STEG B punkt 2).
--
-- Additiv, nullable, ingen backfill - historiska ordrar har null här
-- för alltid. De är redan 'paid' sedan länge och körs aldrig om via
-- den nya finalize_paid_order-vägen, så det spelar ingen roll att vi
-- inte vet om DE fick sitt mejl.
--
-- Satt av handleCheckoutCompleted (stripe-webhook) FÖRST efter att
-- Resend har svarat OK för mejlet - aldrig innan. Vid en omkörning
-- (samma order, t.ex. efter ett tidigare fel som gjorde att webhooken
-- svarade 500 och Stripe försökte igen) kontrolleras kolumnen: redan
-- satt -> mejlet skickas inte en andra gång, oavsett hur många gånger
-- biljetterna redan finns (se finalize_paid_order, vars 'already_paid'-
-- utfall är tänkt att kunna nås upprepade gånger utan skada).
begin;

alter table orders
  add column confirmation_email_sent_at timestamptz;

commit;
