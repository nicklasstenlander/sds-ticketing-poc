-- Ordern "Köpvillkor på köpsidan" (2026-10-03), A6.
--
-- Snapshot av villkorsgodkännandet på ordern, samma princip som pris/moms
-- (orders.price_ore/vat_rate): terms_url sparas som den adress som gällde
-- VID KÖPET, inte en referens till organizers.terms_url som kan ändras i
-- efterhand. Syftet är att kunna visa exakt vad köparen godkände vid en
-- eventuell tvist.
--
-- Båda kolumnerna lämnas null för ordrar där arrangören saknade terms_url
-- (ingen kryssruta visades, inget att godkänna) och för alla äldre ordrar.
-- Exponeras INTE i något publikt svar eller någon export (se ordertexten,
-- avsnitt 3 och 8) - bara skrivs av create-order, läses aldrig tillbaka av
-- klienten.
alter table orders
  add column terms_accepted_at timestamptz,
  add column terms_url text;
