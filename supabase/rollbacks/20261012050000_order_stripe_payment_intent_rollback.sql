-- RESERV - inte en migration, körs inte automatiskt av `supabase db
-- push` (ligger medvetet utanför supabase/migrations/). Tar bort
-- stripe_payment_intent_id-kolumnen (och dess index, som försvinner
-- automatiskt med kolumnen) som
-- 20261012050000_order_stripe_payment_intent.sql lade till.
--
-- OBS om du kör den här: charge.refunded-hanteringen i stripe-webhook
-- (_shared/refundLookup.ts) faller tillbaka på att slå upp ordern via
-- Stripe (stripe.checkout.sessions.list) när kolumnen saknas, så
-- funktionen slutar inte fungera - men VARJE återbetalning tar då den
-- långsammare reservvägen, inte bara historiska ordrar. Deploya inte
-- den här filen samtidigt som stripe-webhook-koden som skriver till
-- kolumnen förblir aktiv utan att också rulla tillbaka den koden.
--
-- Kör (om/när det behövs):
--   supabase db query --linked -f supabase/rollbacks/20261012050000_order_stripe_payment_intent_rollback.sql
begin;

drop index if exists orders_stripe_payment_intent_id_idx;

alter table orders
  drop column if exists stripe_payment_intent_id;

commit;
