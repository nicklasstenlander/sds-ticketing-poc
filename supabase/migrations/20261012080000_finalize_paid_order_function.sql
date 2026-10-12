-- finalize_paid_order: atomär slutförning av en betald order (ordern
-- "Webhooken: misslyckade händelser måste kunna försökas igen"
-- 2026-10-12, STEG B punkt 1). Samma mönster som cancel_paid_order
-- (20261012020000_cancel_order_function.sql): EN transaktion, ett
-- villkorat statusbyte med RETURNING, och en tydlig, otvetydig
-- utfallskod istället för att gissa utifrån sidoeffekter.
--
-- AVVIKELSE FRÅN DEN ANGIVNA SIGNATUREN: ordern bad om
-- finalize_paid_order(p_order_id uuid, p_payment_intent_id text).
-- Biljettkoderna (26 tecken, Crockford base32, 128 bitars CSPRNG - se
-- _shared/base32.ts) genereras i TypeScript, inte SQL - Postgres har
-- ingen inbyggd base32-kodning, och att återskapa samma kodformat i
-- PL/pgSQL hade dubblerat den logiken och riskerat att de glider isär
-- över tid. Funktionen tar därför en TREDJE parameter, p_ticket_codes
-- text[] - en platt lista med REDAN GENERERADE koder, en per biljett
-- som ska skapas (summan av order_items.qty för ordern). Vinner inte
-- statusbytet (ordern var redan paid/expired/cancelled, eller finns
-- inte) används koderna aldrig - anroparen kastar dem, ofarligt.
--
-- Utfall (kolumnen "outcome" i resultatet):
--   'finalized'     - vann statusbytet pending -> paid. Biljetter
--                      skapade, rabattkoden (om någon) uppräknad, i
--                      SAMMA transaktion.
--   'already_paid'  - ordern var redan 'paid' (omkörning av samma
--                      betalning, eller en annan process som hann
--                      före). Inga nya biljetter skapas - de
--                      BEFINTLIGA biljetterna returneras, så att
--                      anroparen kan skicka mejlet om det inte redan
--                      skickats.
--   'not_found'     - ordern finns inte.
--   <order-status>  - statusen rakt av (t.ex. 'expired' eller
--                      'cancelled') när ordern finns men INTE är
--                      'pending' eller 'paid'. INTE tyst ignorerat -
--                      anroparen flaggar det som needs_attention i
--                      webhook_events (STEG B punkt 3), eftersom en
--                      bekräftad betalning då kom in för en order vars
--                      kapacitet redan kan vara frisläppt och given
--                      till någon annan (se STEG A-rapporten punkt 4).
--
-- Löser samtidigt den race som flaggades i STEG A-rapporten punkt 3:
-- handleCheckoutCompleteds gamla UPDATE saknade en .select()-kontroll
-- av antal träffade rader (till skillnad från handleCheckoutExpired,
-- som fick den rättningen redan i STEG 2). Här finns det problemet
-- inte längre - statusbytet, biljettskapandet och rabattkodsräkningen
-- sker i EN transaktion, och Postgres radlås serialiserar två
-- samtidiga anrop för SAMMA order: den förlorande sidan ser alltid
-- 'already_paid' (eller en av de andra statusarna) istället för att
-- tro att den också lyckades och skapa dubbla biljetter.
--
-- SÄKERHET (samma resonemang, och samma lärdom, som cancel_paid_order):
-- INGEN security definer, avsiktligt - enda tänkta anroparen är
-- service_role (stripe-webhook via _shared/finalizeOrder.ts), som
-- redan kringgår RLS och har full åtkomst utan att behöva köra som
-- funktionsägaren. EXECUTE revokeras explicit per roll (public, anon,
-- authenticated) - INTE bara "from public", som tidigare visat sig
-- verkningslöst för flera befintliga funktioner pga Supabases egna
-- ALTER DEFAULT PRIVILEGES (se cancel_paid_order-migrationens
-- kommentar för den fullständiga utredningen).
begin;

create or replace function finalize_paid_order(
  p_order_id uuid,
  p_payment_intent_id text,
  p_ticket_codes text[]
)
returns table(outcome text, event_id uuid, paid_at timestamptz, tickets jsonb)
language plpgsql
set search_path = public
as $$
declare
  v_event_id uuid;
  v_discount_code_id uuid;
  v_buyer_name text;
  v_current_status text;
  v_outcome text;
  v_paid_at timestamptz;
  v_tickets jsonb;
  v_expected_qty int;
  v_actual_qty int;
begin
  update orders
     set status = 'paid',
         paid_at = now(),
         stripe_payment_intent_id = p_payment_intent_id
   where id = p_order_id
     and status = 'pending'
   returning orders.event_id, orders.discount_code_id, orders.buyer_name, orders.paid_at
    into v_event_id, v_discount_code_id, v_buyer_name, v_paid_at;

  if v_event_id is not null then
    -- Vann statusbytet - skapa biljetterna i SAMMA transaktion.
    select coalesce(sum(qty), 0) into v_expected_qty
      from order_items where order_id = p_order_id;

    v_actual_qty := coalesce(array_length(p_ticket_codes, 1), 0);
    if v_actual_qty != v_expected_qty then
      raise exception
        'finalize_paid_order: % biljettkod(er) skickades in, % förväntades (order %)',
        v_actual_qty, v_expected_qty, p_order_id;
    end if;

    if v_expected_qty > 0 then
      with expanded as (
        select oi.ticket_type_id,
               row_number() over (order by oi.id, gs.n) as rn
        from order_items oi
        cross join lateral generate_series(1, oi.qty) as gs(n)
        where oi.order_id = p_order_id
      ),
      codes as (
        select ord as rn, code
        from unnest(p_ticket_codes) with ordinality as u(code, ord)
      )
      insert into tickets (order_id, event_id, ticket_type_id, ticket_code, holder_name, status)
      select p_order_id, v_event_id, e.ticket_type_id, c.code, v_buyer_name, 'valid'
      from expanded e
      join codes c on c.rn = e.rn;
    end if;

    if v_discount_code_id is not null then
      perform increment_discount_code_used_count(v_discount_code_id);
    end if;

    v_outcome := 'finalized';
  else
    select o.status, o.event_id, o.paid_at into v_current_status, v_event_id, v_paid_at
      from orders o
     where o.id = p_order_id;

    if v_current_status is null then
      v_outcome := 'not_found';
      v_event_id := null;
    elsif v_current_status = 'paid' then
      -- paid_at här är den ORIGINELLA betalningstidpunkten (satt av det
      -- FÖRSTA lyckade finalized-anropet), inte "nu" - en omkörning som
      -- bara behöver skicka om mejlet ska visa samma kvittodatum som
      -- köparen redan sett, inte dagens datum (se STEG B-granskningen
      -- 2026-10-12, punkt 1a - den gamla koden återanvände explicit
      -- SAMMA tidsstämpel för DB-skrivningen och mejlet).
      v_outcome := 'already_paid';
    else
      -- 'expired', 'cancelled', eller nåt annat oväntat framtida värde
      -- - returneras RAKT AV, inte tyst ignorerat (STEG B punkt 3).
      v_outcome := v_current_status;
    end if;
  end if;

  if v_outcome in ('finalized', 'already_paid') then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id,
             'ticket_code', t.ticket_code,
             'holder_name', t.holder_name,
             'ticket_type_id', t.ticket_type_id
           )), '[]'::jsonb)
      into v_tickets
    from tickets t
    where t.order_id = p_order_id;
  else
    v_tickets := '[]'::jsonb;
  end if;

  outcome := v_outcome;
  event_id := v_event_id;
  paid_at := v_paid_at;
  tickets := v_tickets;
  return next;
end;
$$;

revoke all on function finalize_paid_order(uuid, text, text[]) from public;
revoke all on function finalize_paid_order(uuid, text, text[]) from anon;
revoke all on function finalize_paid_order(uuid, text, text[]) from authenticated;
grant execute on function finalize_paid_order(uuid, text, text[]) to service_role;

commit;
