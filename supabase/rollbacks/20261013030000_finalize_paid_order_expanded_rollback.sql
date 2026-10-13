-- RESERV - rullar tillbaka finalize_paid_order till den TIDIGARE,
-- smalare returtabellen (20261012080000_finalize_paid_order_function.sql)
-- - SAMMA 3-parameters-signatur hela tiden, bara returtabellen ändras
-- tillbaka. Droppar den utvidgade versionen och återskapar originalet
-- exakt.
--
-- OBS: stripe-webhook måste redeployas till en version som bara läser
-- outcome/event_id/paid_at/tickets (inte order_info/order_items/
-- event_info/organizer_info) INNAN eller SAMTIDIGT som den här
-- reserven körs.
--
-- Kör (om/när det behövs):
--   supabase db query --linked -f supabase/rollbacks/20261013030000_finalize_paid_order_expanded_rollback.sql
begin;

drop function if exists finalize_paid_order(uuid, text, text[]);

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
      v_outcome := 'already_paid';
    else
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
