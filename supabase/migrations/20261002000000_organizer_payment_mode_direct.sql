-- Ordern "Rideau skarpt för SDS vinterföreställning" (2026-10-01), A1.
--
-- Andra betalningsläge för en arrangör: 'direct' betyder att betalningen
-- tas på plattformens eget Stripe-konto (STRIPE_SECRET_KEY), utan
-- stripeAccount-option och utan application_fee_amount - för SDS, som
-- säljer sina EGNA biljetter med Moon Movements eget konto, inte via
-- Stripe Connect. 'connect' (default) är oförändrat beteende för alla
-- befintliga arrangörer (Testscenen m.fl.).
--
-- Sätts bara via SQL av platform-admin (ingen UI i denna order, se
-- ordertextens A10) - ingen admin-funktion skriver detta fält, så en
-- vanlig arrangörs-admin kan aldrig ändra sitt eget betalningsläge.
alter table organizers
  add column payment_mode text not null default 'connect',
  add constraint organizers_payment_mode_check
    check (payment_mode in ('connect', 'direct'));
