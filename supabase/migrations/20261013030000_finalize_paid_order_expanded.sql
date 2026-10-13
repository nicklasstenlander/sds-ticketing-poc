-- finalize_paid_order (utvidgad): ordern "Webhooken är för långsam"
-- 2026-10-13, ny plan (ersätter B1/B2), punkt 1.
--
-- Mätningen 2026-10-13 (DEBUG_TIMING) visade att varje enskilt DB-
-- anrop kostar 540-690 ms (fast pris, oavsett datamängd). Den här
-- migrationen viker FYRA separata DB-anrop (orders-select,
-- events-select, organizers-select - plus att den återanvänder samma
-- biljettskapande som innan) in i EN transaktion/anrop: statusbyte,
-- biljetter, rabattkodsräkning (oförändrat), PLUS att den hämtar allt
-- mejlet behöver (order/order_items/event/arrangör).
--
-- RÄTTAT (granskning 2026-10-13, punkt 1): en TIDIGARE version av den
-- här migrationen lät funktionen ÄVEN skriva webhook_events-slutstatus
-- (en fjärde parameter, p_webhook_event_row_id). Det introducerade en
-- RACE: raden blev 'done' INNAN QR-uppladdningen och mejlschemaläggningen
-- hade körts. Om funktionsinstansen dog mellan finalize_paid_order och
-- svaret till Stripe skulle Stripes omförsök av SAMMA event träffa
-- webhook_events-raden som redan 'done' (decideRetryAction ->
-- already_done -> 200) UTAN att QR eller mejl någonsin kördes om - och
-- inget annat skulle försöka igen. Webhook_events-skrivningen ligger
-- därför INTE här - den sker (som innan STEG-ersättningen) i
-- stripe-webhook/index.ts, EFTER att QR-uppladdningen och mejl-
-- schemaläggningen lyckats.
--
-- DÄRFÖR OCKSÅ: SAMMA signatur (p_order_id, p_payment_intent_id,
-- p_ticket_codes) som redan är driftsatt (v22) - bara returtabellen
-- blir bredare. Det gör migrationen BAKÅTKOMPATIBEL med den körande
-- koden: v22:s anrop skickar exakt dessa tre namngivna parametrar och
-- läser bara ut outcome/event_id/paid_at/tickets ur resultatet - de
-- fyra NYA kolumnerna ignoreras helt enkelt av den gamla koden.
-- Migrationen kan alltså köras FÖRE en ny deploy utan att störa det
-- som redan är i drift.
--
-- Postgres tillåter INTE att CREATE OR REPLACE ändrar en funktions
-- returtyp (även om parameterlistan är oförändrad) - "cannot change
-- return type of existing function". DROP FUNCTION + CREATE FUNCTION
-- krävs därför även fast parametrarna är identiska med v22:s version.
--
-- Kvar: 2 DB-anrop före svaret (order_items-qty-select + denna
-- funktion), plus webhook_events-insert/CAS (1) och webhook_events-
-- slutuppdatering (1, i index.ts, oförändrat läge) = 4 totalt, ned
-- från 7.
--
-- VIKTIGT - VARFÖR funktionen INTE kastar om event/arrangör saknas:
-- till skillnad från biljettkod-mismatchen (som kastar OCH rullar
-- tillbaka HELA transaktionen, se originalmigrationens kommentar - där
-- är det rätt, inget har committats än) skulle ett kastat fel HÄR
-- rulla tillbaka ett REDAN LYCKAT statusbyte/biljettskapande bara
-- därför att mejldata saknas. Istället returneras event_info/
-- organizer_info som NULL - anroparen (handleCheckoutCompleted)
-- kontrollerar det och kastar DÄR istället, vilket bara gör om
-- MEJLSTEGET (finalize_paid_order ger redan 'already_paid' billigt
-- vid omkörning, ingen ny biljett skapas).
--
-- SÄKERHET: oförändrat resonemang från originalmigrationen - ingen
-- security definer, EXECUTE revokeras explicit per roll och beviljas
-- bara service_role. OBS (granskning 2026-10-13, punkt 4): resultatet
-- innehåller nu buyer_name/buyer_email (order_info) - ingen NY
-- exponering i sig (service_role har redan full åtkomst till orders
-- och kringgår RLS), men beroende av att lockdownen nedan faktiskt
-- håller. Verifiera med privilegiefrågan i chatten efter migrationen.
begin;

drop function if exists finalize_paid_order(uuid, text, text[]);

create or replace function finalize_paid_order(
  p_order_id uuid,
  p_payment_intent_id text,
  p_ticket_codes text[]
)
returns table(
  outcome text,
  event_id uuid,
  paid_at timestamptz,
  tickets jsonb,
  order_info jsonb,
  order_items jsonb,
  event_info jsonb,
  organizer_info jsonb
)
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
  v_order_info jsonb;
  v_order_items jsonb;
  v_event_info jsonb;
  v_organizer_info jsonb;
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
      -- FÖRSTA lyckade finalized-anropet) - se originalmigrationens
      -- kommentar.
      v_outcome := 'already_paid';
    else
      -- 'expired', 'cancelled', eller nåt annat oväntat framtida värde
      -- - returneras RAKT AV, inte tyst ignorerat (STEG B punkt 3,
      -- order-code-webhook-aterforsok.md).
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

    -- NYTT - allt mejlet behöver, i SAMMA transaktion som ovan.
    select jsonb_build_object(
             'buyer_name', o.buyer_name,
             'buyer_email', o.buyer_email,
             'total_ore', o.total_ore,
             'confirmation_email_sent_at', o.confirmation_email_sent_at
           )
      into v_order_info
    from orders o
    where o.id = p_order_id;

    select coalesce(jsonb_agg(jsonb_build_object(
             'ticket_type_id', oi.ticket_type_id,
             'qty', oi.qty,
             'unit_price_ore', oi.unit_price_ore,
             'vat_rate', oi.vat_rate,
             'type_name', tt.name
           )), '[]'::jsonb)
      into v_order_items
    from order_items oi
    left join ticket_types tt on tt.id = oi.ticket_type_id
    where oi.order_id = p_order_id;

    -- event_info/organizer_info lämnas NULL (inte ett fel här - se
    -- filkommentaren) om eventet eller arrangören mot förmodan saknas.
    select jsonb_build_object(
             'title', e.title,
             'venue', e.venue,
             'starts_at', e.starts_at
           )
      into v_event_info
    from events e
    where e.id = v_event_id;

    select jsonb_build_object(
             'legal_name', org.legal_name,
             'org_number', org.org_number,
             'terms_url', org.terms_url
           )
      into v_organizer_info
    from organizers org
    join events e on e.organizer_id = org.id
    where e.id = v_event_id;
  else
    v_tickets := '[]'::jsonb;
    v_order_info := null;
    v_order_items := '[]'::jsonb;
    v_event_info := null;
    v_organizer_info := null;
  end if;

  outcome := v_outcome;
  event_id := v_event_id;
  paid_at := v_paid_at;
  tickets := v_tickets;
  order_info := v_order_info;
  order_items := v_order_items;
  event_info := v_event_info;
  organizer_info := v_organizer_info;
  return next;
end;
$$;

revoke all on function finalize_paid_order(uuid, text, text[]) from public;
revoke all on function finalize_paid_order(uuid, text, text[]) from anon;
revoke all on function finalize_paid_order(uuid, text, text[]) from authenticated;
grant execute on function finalize_paid_order(uuid, text, text[]) to service_role;

commit;
