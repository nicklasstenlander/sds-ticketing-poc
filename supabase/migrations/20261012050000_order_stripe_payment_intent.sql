-- stripe_payment_intent_id på orders (ordern "Avbokning, återbetalning,
-- omsändning och köparmeddelanden" 2026-10-12, STEG 3 punkt 1).
--
-- Additiv, nullable, ingen backfill - historiska ordrar (betalda innan
-- den här kolumnen fanns) har null här för alltid. charge.refunded-
-- hanteringen (stripe-webhook) har en reserv för exakt det fallet: slå
-- upp ordern via stripe.checkout.sessions.list({payment_intent}) istället,
-- se _shared/refundLookup.ts.
--
-- Satt i handleCheckoutCompleted (stripe-webhook) när ordern markeras
-- 'paid' - session.payment_intent finns redan på Checkout Session-
-- objektet där, ingen extra Stripe-anrop behövs för att läsa den.
--
-- Index: uppslag sker via EXAKT den här kolumnen när charge.refunded
-- kommer in (WHERE stripe_payment_intent_id = <id från webhooken>) -
-- utan index blir det en sekventiell scan av hela orders-tabellen per
-- återbetalning. Partiellt unikt index (bara där kolumnen är satt) -
-- varje payment_intent hör till exakt en order, men många historiska
-- rader har null och null-värden ska inte krocka med varandra i ett
-- unikt index (de gör det aldrig i Postgres per default, men ett
-- partiellt index gör avsikten explicit och håller indexet mindre).
begin;

alter table orders
  add column stripe_payment_intent_id text;

create unique index if not exists orders_stripe_payment_intent_id_idx
  on orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

commit;
