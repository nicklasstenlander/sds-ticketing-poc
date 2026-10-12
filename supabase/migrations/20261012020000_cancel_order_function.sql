-- Atomär avbokning av en betald order (ordern "Avbokning, återbetalning,
-- omsändning och köparmeddelanden" 2026-10-12, STEG 2 tillägg A).
--
-- EN transaktion (en Postgres-funktion körs i en enda transaktion per
-- default): statusbytet till 'cancelled', biljetternas 'void' och
-- kapacitetsfrigörningen sker tillsammans eller inte alls.
--
-- Statusbytet är VILLKORAT (where status='paid') och returnerar bara en
-- rad om det FAKTISKT ändrades - exakt samma mönster som
-- release_expired_orders (20260106000100_order_items_cart.sql): "ett
-- race mellan två samtidiga anrop frigör aldrig kapacitet två gånger,
-- bara den anrop som faktiskt vann statusbytet gör något mer." Det här
-- skyddar både mot ett dubbelklick i admin-UI:t OCH mot ett framtida
-- race mellan admin-cancel-order och charge.refunded-hanteringen
-- (STEG 3) för SAMMA order, eftersom båda ska anropa den här funktionen
-- via samma delade TypeScript-omslag (_shared/cancelOrder.ts).
--
-- Returnerar en TOM resultatmängd (ingen rad, inte ett fel) om ordern
-- inte hade status='paid' vid anropet - anroparen (_shared/
-- cancelOrder.ts) tolkar det tydligt och explicit som "redan avbokad
-- eller fel status för att avbokas" (cancelled: false i svaret), inte
-- ett undantag.
--
-- Rör ALDRIG Stripe och gör ingen återbetalning - bara flaggor i vår
-- egen databas, precis som arkivfunktionen.
--
-- SÄKERHET (granskat explicit, inte bara kopierat från release_shared_
-- capacity_multi/release_expired_orders):
--
-- 1. INGEN "security definer" här, avsiktligt. Den ENDA tänkta
--    anroparen är service_role (admin-cancel-order, och i STEG 3
--    stripe-webhook) - service_role kringgår RLS och har redan full
--    åtkomst till orders/tickets/order_items UTAN att behöva köra som
--    funktionsägaren. "security definer" hade bara varit motiverat om
--    en LÄGRE-privilegierad roll behövde anropa funktionen utan att ha
--    direkt tabellåtkomst - det är uttryckligen INTE fallet här (punkt
--    2 nedan stänger av exakt den vägen). Utan "security definer" körs
--    funktionen alltid som ANROPAREN, vilket är ett extra skyddsnät:
--    skulle EXECUTE någonsin beviljas fel roll av misstag skulle RLS
--    (ingen policy alls på orders/tickets för anon/authenticated)
--    ändå blockera den rollen - med "security definer" hade samma
--    misstag istället tyst gett vem som helst rätt att avboka VILKEN
--    ORDER SOM HELST, körandes med funktionsägarens fulla privilegier.
--    set search_path = public behålls ändå som god hygien, oavsett
--    security-läge.
--
-- 2. EXECUTE revokeras explicit per roll (public, anon, authenticated),
--    INTE bara "from public". Kontrollerat direkt mot pg_proc.proacl på
--    projektet: release_shared_capacity_multi/reserve_shared_capacity_
--    multi/release_expired_orders har alla ett EXPLICIT, direkt EXECUTE-
--    grant till både anon OCH authenticated (proacl visar
--    "anon=X/postgres,authenticated=X/postgres", INGET från public) -
--    nästan säkert Supabase-projektets egna ALTER DEFAULT PRIVILEGES,
--    som ger EXECUTE på varje ny funktion i schemat "public" till
--    anon/authenticated/service_role automatiskt vid skapandet. "revoke
--    all ... from public" i de BEFINTLIGA migrationerna har alltså
--    ALDRIG stängt av anon/authenticated:s åtkomst till de funktionerna
--    - de går (och har hela tiden gått) att anropa direkt via
--    POST /rest/v1/rpc/<funktionsnamn>, utan inloggning. Rapporterat
--    separat till Nicklas - INTE rättat här (utanför den här ordern,
--    rör tre befintliga, redan driftsatta funktioner). Den här nya
--    funktionen upprepar INTE det misstaget.
begin;

create or replace function cancel_paid_order(p_order_id uuid)
returns table(event_id uuid, total_ore int, voided_ticket_count int)
language plpgsql
set search_path = public
as $$
declare
  v_event_id uuid;
  v_total_ore int;
  v_items jsonb;
  v_total_qty int;
  v_voided_count int;
begin
  update orders
     set status = 'cancelled'
   where id = p_order_id
     and status = 'paid'
   returning orders.event_id, orders.total_ore into v_event_id, v_total_ore;

  if v_event_id is null then
    return; -- ingen rad bytte status (fel status, eller redan avbokad) - inget mer att göra
  end if;

  update tickets
     set status = 'void'
   where order_id = p_order_id
     and status != 'void';
  get diagnostics v_voided_count = row_count;

  select
    coalesce(jsonb_agg(jsonb_build_object('ticket_type_id', oi.ticket_type_id, 'qty', oi.qty)), '[]'::jsonb),
    coalesce(sum(oi.qty), 0)
    into v_items, v_total_qty
  from order_items oi
  where oi.order_id = p_order_id;

  if v_total_qty > 0 then
    perform release_shared_capacity_multi(v_event_id, v_items, v_total_qty);
  end if;

  event_id := v_event_id;
  total_ore := v_total_ore;
  voided_ticket_count := v_voided_count;
  return next;
end;
$$;

revoke all on function cancel_paid_order(uuid) from public;
revoke all on function cancel_paid_order(uuid) from anon;
revoke all on function cancel_paid_order(uuid) from authenticated;
grant execute on function cancel_paid_order(uuid) to service_role;

commit;
