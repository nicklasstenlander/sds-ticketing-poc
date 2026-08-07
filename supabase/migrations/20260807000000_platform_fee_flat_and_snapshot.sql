-- Tilläggsorder 2026-08-07: "Fast avgift per biljett + korrekt
-- momshantering på plattformsavgiften (bägge modeller)"
--
-- application_fee_amount (pengarna Childproof AB tar från varje
-- transaktion, oavsett om PLATFORM_FEE_MODE är 'percent' eller
-- 'flat_per_ticket') har hittills bara funnits i Stripe, aldrig sparats i
-- egen databas - gör korrekt bokföring omöjlig utan att manuellt gå
-- igenom Stripes transaktionslogg varje period.
--
-- Samma SNAPSHOT-princip som redan används för order_items.unit_price_ore
-- /vat_rate (se schema.md): beloppen sätts en gång vid create-order och
-- ändras aldrig i efterhand, oavsett om secrets (PLATFORM_FEE_MODE/RATE/
-- FLAT_ORE) byts senare. Gäller BÅDA avgiftsmodellerna, inte bara den nya
-- flat-modellen - se regressionstestet i tilläggsorderns punkt 6.
alter table orders
  add column platform_fee_ore integer,
  add column platform_fee_vat_ore integer;

comment on column orders.platform_fee_ore is
  'Plattformsavgift i öre, inkl. moms - snapshot av vad som togs ut via Stripes application_fee_amount vid köptillfället. Beräknas antingen som PLATFORM_FEE_RATE * biljettsumma (percent-läge) eller PLATFORM_FEE_FLAT_ORE * antal biljetter (flat_per_ticket-läge). Ändras aldrig i efterhand.';

comment on column orders.platform_fee_vat_ore is
  'Moms (25%) baklängesberäknad ur platform_fee_ore: platform_fee_ore * 25/125. Ren bokföringsuppdelning - ändrar inte det faktiska beloppet som togs ut i Stripe.';
