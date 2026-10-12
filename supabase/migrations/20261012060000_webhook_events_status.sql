-- webhook_events: statuskolumn för att skilja "mottagen" från "lyckad
-- bearbetning" (ordern "Webhooken: misslyckade händelser måste kunna
-- försökas igen" 2026-10-12, STEG B punkt 1 och 3).
--
-- Idag (se order-code-webhook-aterforsok.md STEG A-rapporten, punkt 1)
-- markeras en händelse som "hanterad" redan vid INSERT, innan handlern
-- körs. Ett genuint databasfel mitt i bearbetningen får därför aldrig
-- en ärlig andra chans: en Stripe-retry av SAMMA event-id skulle bara
-- träffa unique-constrainten (provider, provider_event_id) och
-- kortslutas till 200 utan att handlern anropas igen.
--
-- status:
--   'received'       - mottagen, bearbetas. Kan ALLTID vara en
--                       bearbetning som kraschade utan att hinna
--                       skriva en slutstatus - se tröskeln i
--                       stripe-webhook/webhookEventRetry.ts, som
--                       avgör om en NY leverans ska vänta (troligen
--                       fortfarande pågår) eller ta över (troligen
--                       kraschad).
--   'done'            - bearbetad utan fel. Terminal.
--   'failed'          - ett riktigt fel inträffade. Kan försökas igen
--                       - en ny leverans av SAMMA event-id sätter
--                       raden tillbaka till 'received' och ökar
--                       attempts.
--   'needs_attention' - bearbetad, inget tekniskt fel, men utfallet
--                       kräver en människa (t.ex. en betalning som kom
--                       in för en order som redan är 'expired' - STEG
--                       B punkt 3). Terminal - försöks INTE om
--                       automatiskt, webhooken svarar 200 (ingen idé
--                       att Stripe försöker igen, problemet är inte
--                       tekniskt).
--
-- attempts: antal gånger en bearbetning har PÅBÖRJATS för det här
-- event-id:t. Börjar på 1, ökas vid varje omförsök (en rad som går
-- från 'failed', eller en 'received'-rad som bedöms kraschad, tillbaka
-- till 'received').
--
-- processed_at: satt när raden går till 'done' eller 'needs_attention'.
-- Null så länge raden är 'received' eller 'failed'.
--
-- last_error: kort feltext vid 'failed' - ALDRIG namn, e-post eller
-- betalningsuppgifter, bara det Postgres/Stripe-klienten själva
-- rapporterar som felmeddelande (trunkerat i koden innan den skrivs).
-- Nollställs vid varje nytt försök.
--
-- Befintliga rader: skrivs här uttryckligen om till 'done' - de
-- representerar händelser som redan bearbetades under den GAMLA
-- modellen (INSERT = klar). Utan den här engångsuppdateringen skulle
-- de felaktigt få status-kolumnens DEFAULT-värde 'received' och kunna
-- plockas upp av den nya omförsöksvägen i onödan.
begin;

alter table webhook_events
  add column status text not null default 'received',
  add column attempts int not null default 1,
  add column processed_at timestamptz,
  add column last_error text;

alter table webhook_events
  add constraint webhook_events_status_check
  check (status in ('received', 'done', 'failed', 'needs_attention'));

update webhook_events
   set status = 'done',
       processed_at = created_at
 where status = 'received';

commit;
