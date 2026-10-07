-- Ordern "Skannern ska visa vilken typ av biljett som skannas" 2026-10-07,
-- A2 - ticket_is_free.
--
-- INTE EFTERFRÅGAD ORDAGRANT I ORDERTEXTEN, men nödvändig för att
-- ticket_is_free överhuvudtaget ska kunna implementeras korrekt enligt
-- ordertextens egen definition - se rapporten till Nicklas.
--
-- Rabattkoder tillämpas PER RAD (create-order, applyDiscountToLines) -
-- order_items.unit_price_ore är alltså redan det RABATTERADE priset, inte
-- biljettypens grundpris. En vuxenbiljett med en 100%-kod får alltså
-- unit_price_ore = 0, exakt samma värde som en genuint gratis barnbiljett
-- - utan ytterligare data går de INTE att skilja åt, trots att
-- ordertexten uttryckligen kräver det ("En vuxenbiljett som blev gratis
-- via rabattkod är alltså inte gratis i det här läget").
--
-- list_price_ore sparar radens pris FÖRE rabattkoden (create-order har
-- redan detta värde i minnet som unitPriceOre, men persisterar det idag
-- aldrig) - samma "pris vid köpet, aldrig typens nuvarande pris"-princip
-- som redan gäller unit_price_ore/vat_rate, bara ETT STEG TIDIGARE i
-- rabatt-beräkningen.
--
-- MEDVETET INGEN BACKFILL (rättat efter avstämning med Nicklas 2026-10-07
-- - en tidigare version av denna migration backfillade alla befintliga
-- rader, och gissade dessutom fram ett historiskt pre-rabatt-pris via
-- ticket_types NUVARANDE pris för rader med rabattkod, vilket varken är
-- riskfritt mot en skarp tabell eller nödvändigtvis korrekt). Kolumnen är
-- nullable utan default - rent additiv, rör INGEN befintlig rad. Befintliga
-- order_items (alla köp gjorda FÖRE denna migration) får alltså
-- list_price_ore = null, vilket scan-ticket (buildTicketTypeInfo,
-- determineScanOutcome.ts) tolkar som "okänt" (ticket_is_free = null) -
-- INTE som "inte gratis" - för just de biljetterna, tills de skannas
-- nästa gång efter ett nytt köp. Nya köp (från och med att create-order
-- deployas om, se leveransordningen) får alltid ett riktigt värde direkt.
alter table order_items add column list_price_ore int;

alter table order_items
  add constraint order_items_list_price_ore_check check (list_price_ore is null or list_price_ore >= 0);
