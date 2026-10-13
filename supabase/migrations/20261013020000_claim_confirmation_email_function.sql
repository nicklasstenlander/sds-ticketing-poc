-- claim_confirmation_email: atomär "claim" innan ett mejlutskick
-- påbörjas (ordern "Webhooken är för långsam" 2026-10-13, ny plan,
-- punkt 2 - "Mejlet får fortfarande aldrig skickas två gånger (claim
-- före utskick)").
--
-- Returnerar TRUE om anroparen vann claimen och SKA skicka mejlet, FALSE
-- om den INTE ska. Villkorat UPDATE, samma mönster som cancel_paid_order/
-- finalize_paid_order: Postgres radlås serialiserar två samtidiga
-- anrop för SAMMA order - bara ett kan vinna.
--
-- p_force (granskning 2026-10-13, punkt 3 - admin-resend-tickets ska
-- kunna återanvända SAMMA claim):
--   false (webhookens bakgrundsuppgift, det schemalagda återförsöket
--   retry-confirmation-emails) - claimen vinns bara om
--   confirmation_email_sent_at ÄNNU är null. Det här är den
--   "skicka BARA om det inte redan gått iväg"-vägen.
--   true (admin-resend-tickets) - en MEDVETEN, manuell ombegäran ska
--   kunna skicka om ÄVEN ett redan skickat mejl (admins hela syfte:
--   köparen bad om det igen, eller vill ha det till en annan adress).
--   confirmation_email_sent_at-villkoret hoppas då över, men
--   claimed_at-spärren (se nedan) gäller FORTFARANDE - två samtidiga
--   försök (t.ex. ett admin-klick som råkar krocka med webhookens egen
--   bakgrundsuppgift för samma order) kan ändå inte skicka samtidigt.
--
-- Vinner claimen när BÅDA:
--   1. p_force ÄR true, ELLER confirmation_email_sent_at IS NULL.
--   2. confirmation_email_claimed_at är NULL, eller äldre än 2 minuter
--      (samma tröskel och samma resonemang som webhook_events'
--      STILL_RUNNING_THRESHOLD_MS - se webhookEventRetry.ts: en claim
--      yngre än 2 minuter antas vara ett FORTFARANDE PÅGÅENDE
--      utskick, en äldre antas vara ett ÖVERGIVET försök (isolatet
--      stängdes mitt i - se Supabase-dokumentationen om
--      EdgeRuntime.waitUntil/beforeunload, citerad i chatten) och får
--      försökas om.
--
-- OBS: p_force kringgår INTE max-antal-försök-gränsen i
-- retry-confirmation-emails - den gränsen ligger i den funktionens
-- egen SELECT-fråga (confirmation_email_attempts < 5), inte här. Den
-- gränsen gäller BARA den automatiska återförsöksvägen (force=false) -
-- en admin som medvetet klickar "skicka om" ska aldrig blockeras av en
-- gräns tänkt för att stoppa en förmodat trasig adress från att
-- försökas om i all evighet AUTOMATISKT.
--
-- RÄTTAT (granskning 2026-10-13, fråga 2c): confirmation_email_attempts
-- räknas nu BARA upp när p_force är false. Tidigare räknades den upp
-- även vid force=true - ett antal medvetna admin-ombegäranden för EN
-- order kunde då själva knuffa räknaren till 5 och därmed blockera
-- DEN AUTOMATISKA vägen (retry-confirmation-emails) från att försöka
-- något den aldrig själv fått chansen att misslyckas med. Räknaren ska
-- bara mäta AUTOMATISKA, obevakade försök - inte medvetna mänskliga
-- handlingar, som redan är begränsade av claimed_at-spärren ovan.
--
-- SÄKERHET (samma resonemang som cancel_paid_order/finalize_paid_order):
-- INGEN security definer - enda tänkta anroparen är service_role
-- (stripe-webhook/admin-resend-tickets/retry-confirmation-emails via
-- _shared/claimConfirmationEmail.ts). EXECUTE revokeras explicit per
-- roll, inte bara "from public".
begin;

create or replace function claim_confirmation_email(p_order_id uuid, p_force boolean default false)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  update orders
     set confirmation_email_claimed_at = now(),
         confirmation_email_attempts = confirmation_email_attempts + case when p_force then 0 else 1 end
   where id = p_order_id
     and (p_force or confirmation_email_sent_at is null)
     and (confirmation_email_claimed_at is null or confirmation_email_claimed_at < now() - interval '2 minutes')
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function claim_confirmation_email(uuid, boolean) from public;
revoke all on function claim_confirmation_email(uuid, boolean) from anon;
revoke all on function claim_confirmation_email(uuid, boolean) from authenticated;
grant execute on function claim_confirmation_email(uuid, boolean) to service_role;

commit;
