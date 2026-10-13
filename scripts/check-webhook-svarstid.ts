// Kontroller för ordern "Webhooken är för långsam: sänk svarstiden
// utan att tappa mejl" 2026-10-13 (ny plan, ersätter B1/B2) OCH
// uppföljningsgranskningen samma dag (race i webhook_events-
// markeringen, återförsök, admin-resend-tickets-claim). Deno-skript,
// samma mönster som övriga check-*.ts.
//
// Tre sorters kontroller:
//
// 1. Riktigt enhetstest av shortEmailErrorCode och mapFinalizeOutcome
//    (rena funktioner).
//
// 2. Statiska kontroller av migrationerna: att finalize_paid_order är
//    utvidgad korrekt MEN INTE rör webhook_events (granskningens
//    rättelse - se motiveringen i koden), att den har SAMMA
//    3-parameters-signatur som redan är driftsatt (v22) - bakåt-
//    kompatibelt, att claim_confirmation_email har force-parametern
//    och rätt grants.
//
// 3. Statiska kontroller av stripe-webhook/index.ts,
//    _shared/attemptConfirmationEmail.ts, admin-resend-tickets och
//    retry-confirmation-emails: att webhook_events-slutstatusen
//    SKRIVS EFTER att handlern (inkl. QR och mejlschemaläggning)
//    returnerat - ALDRIG inuti finalize_paid_order, att QR fortfarande
//    sker FÖRE svaret (inte flyttad till bakgrunden), att claim sker
//    FÖRE utskick och delas av alla tre anropare, att admin-resend-
//    tickets claimar med force=true men retry-confirmation-emails med
//    force=false, att bakgrundsuppgiften ALDRIG rör webhook_events,
//    och att timeouts finns på Resend (fetch, signal) och Stripe-
//    anropet (RequestOptions.timeout, INTE signal - Stripes
//    RequestOptions-typ saknar den egenskapen).
//
// Kör: deno run --allow-read scripts/check-webhook-svarstid.ts

import { shortEmailErrorCode } from '../supabase/functions/_shared/emailErrorCode.ts'
import { mapFinalizeOutcome } from '../supabase/functions/_shared/finalizeOrder.ts'

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}
function assertTrue(actual: unknown, label: string) {
  assertEqual(Boolean(actual), true, label)
}

// === 1. Rena funktioner ===

assertEqual(
  shortEmailErrorCode(Object.assign(new Error('nåt'), { name: 'TimeoutError' })),
  'timeout',
  'En AbortSignal.timeout-avbruten fetch (TimeoutError) -> "timeout"',
)
assertEqual(
  shortEmailErrorCode(Object.assign(new Error('nåt'), { name: 'AbortError' })),
  'timeout',
  'AbortError (äldre Deno-versioner kan kalla det så) -> också "timeout"',
)
assertEqual(
  shortEmailErrorCode(new Error('Resend svarade 422 - mejlet skickades inte')),
  'resend_http_422',
  'Ett Resend-HTTP-fel -> resend_http_<statuskod>, INTE den råa feltexten (som kan innehålla köparens e-post)',
)
assertEqual(shortEmailErrorCode(new Error('nåt helt annat')), 'send_failed', 'Ett okänt Error-objekt -> generisk kod, ingen rå text')
assertEqual(shortEmailErrorCode('inte ens ett Error-objekt'), 'unknown_error', 'Ett icke-Error-värde kraschar inte, ger en säker fallback-kod')

assertEqual(mapFinalizeOutcome('finalized'), 'done', "'finalized' -> done")
assertEqual(mapFinalizeOutcome('already_paid'), 'done', "'already_paid' -> done")
assertEqual(mapFinalizeOutcome('not_found'), 'not_found', "'not_found' -> egen kod (handlern konverterar den till 'done' själv)")
assertEqual(mapFinalizeOutcome('expired'), 'needs_attention', "'expired' -> needs_attention")

// === 2. Statiska kontroller av migrationerna ===

const root = new URL('..', import.meta.url)
function read(relPath: string): string {
  return Deno.readTextFileSync(new URL(relPath, root))
}
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
}

// --- finalize_paid_order (utvidgad, RÄTTAD) ---
{
  const migration = read('supabase/migrations/20261013030000_finalize_paid_order_expanded.sql')
  const codeOnly = stripSqlComments(migration)

  assertTrue(migration.includes('begin;') && migration.includes('commit;'), 'Migrationen är omsluten av begin/commit')
  assertTrue(!/\bsecurity definer\b/i.test(codeOnly), 'INGEN security definer i någon KODRAD')

  // RÄTTELSEN (granskning 2026-10-13, punkt 1): funktionen har SAMMA
  // 3-parameters-signatur som redan är driftsatt (v22) - INGEN
  // p_webhook_event_row_id, INGEN UPDATE av webhook_events. Ett race
  // (raden blev 'done' innan QR/mejl hunnit köras) gjorde att en
  // tidigare version av den här migrationen gjorde fel.
  assertTrue(
    codeOnly.includes('create or replace function finalize_paid_order(\n  p_order_id uuid,\n  p_payment_intent_id text,\n  p_ticket_codes text[]\n)'),
    'Funktionen har EXAKT samma 3-parameters-signatur som den redan driftsatta v22-versionen - bakåtkompatibelt',
  )
  assertTrue(!codeOnly.includes('p_webhook_event_row_id'), 'Funktionen tar INTE emot ett webhook_event_row_id (rättat - se filkommentaren om racet)')
  assertTrue(!codeOnly.includes('update webhook_events'), 'Funktionen rör ALDRIG webhook_events (rättat - se filkommentaren om racet)')

  assertTrue(
    codeOnly.includes('returns table(') &&
      codeOnly.includes('order_info jsonb') &&
      codeOnly.includes('order_items jsonb') &&
      codeOnly.includes('event_info jsonb') &&
      codeOnly.includes('organizer_info jsonb'),
    'Funktionen returnerar order-/order_items-/event-/arrangörsdata för mejlet',
  )

  assertTrue(
    migration.includes('drop function if exists finalize_paid_order(uuid, text, text[]);'),
    'DROP FUNCTION krävs trots oförändrad signatur - Postgres tillåter inte att CREATE OR REPLACE ändrar returtypen',
  )

  assertTrue(
    migration.includes('revoke all on function finalize_paid_order(uuid, text, text[]) from public') &&
      migration.includes('revoke all on function finalize_paid_order(uuid, text, text[]) from anon') &&
      migration.includes('revoke all on function finalize_paid_order(uuid, text, text[]) from authenticated') &&
      migration.includes('grant execute on function finalize_paid_order(uuid, text, text[]) to service_role'),
    'EXECUTE revokeras explicit per roll och beviljas bara service_role',
  )
}

// --- confirmation_email tracking-kolumnerna ---
{
  const migration = read('supabase/migrations/20261013010000_order_confirmation_email_tracking.sql')
  assertTrue(migration.includes('begin;') && migration.includes('commit;'), 'Migrationen är omsluten av begin/commit')
  assertTrue(
    migration.includes('confirmation_email_attempts int not null default 0') &&
      migration.includes('confirmation_email_last_error text') &&
      migration.includes('confirmation_email_claimed_at timestamptz'),
    'Alla tre kolumner finns med rätt typ/default',
  )
  assertTrue(!/\bupdate\s+orders\b/i.test(migration), 'Ingen UPDATE av befintliga rader - ingen backfill')
}

// --- claim_confirmation_email (med force-parameter) ---
{
  const migration = read('supabase/migrations/20261013020000_claim_confirmation_email_function.sql')
  const codeOnly = stripSqlComments(migration)
  assertTrue(migration.includes('begin;') && migration.includes('commit;'), 'Migrationen är omsluten av begin/commit')
  assertTrue(!/\bsecurity definer\b/i.test(codeOnly), 'INGEN security definer')
  assertTrue(
    codeOnly.includes('p_force boolean default false') && codeOnly.includes('(p_force or confirmation_email_sent_at is null)'),
    'Funktionen tar en force-parameter - admin-resend-tickets kan skicka om ÄVEN ett redan skickat mejl, men respekterar fortfarande claimed_at-spärren',
  )
  assertTrue(
    codeOnly.includes("confirmation_email_claimed_at < now() - interval '2 minutes'"),
    'claimed_at-spärren (2 minuter, samma tröskel som webhook_events) gäller OAVSETT force',
  )
  // Granskning 2026-10-13, fråga 2c: force=true ska INTE räkna upp
  // confirmation_email_attempts - annars kan medvetna admin-
  // ombegäranden själva knuffa räknaren till gränsen (5) och blockera
  // DEN AUTOMATISKA vägen (retry-confirmation-emails) från egna försök.
  assertTrue(
    codeOnly.includes('confirmation_email_attempts + case when p_force then 0 else 1 end'),
    'confirmation_email_attempts räknas BARA upp vid force=false - en admins medvetna ombegäranden äter inte av den automatiska vägens försöksbudget',
  )
  assertTrue(
    migration.includes('grant execute on function claim_confirmation_email(uuid, boolean) to service_role'),
    'EXECUTE beviljas explicit till service_role, för signaturen med force-parametern',
  )
}

// === 3. Statiska kontroller av TypeScript-koden ===

// --- stripe-webhook/index.ts ---
{
  const content = read('supabase/functions/stripe-webhook/index.ts')

  // RÄTTELSEN: webhook_events-slutstatusen skrivs OVILLKORAT, EFTER
  // try/catch-blocket (dvs efter att handlern - inkl. QR och
  // mejlschemaläggning för checkout.session.completed - returnerat).
  // Ingen "webhookEventAlreadyAcknowledged"-genväg längre.
  assertTrue(
    !content.includes('webhookEventAlreadyAcknowledged'),
    'Dispatchen har INGEN genväg som hoppar över sin egen webhook_events-slutuppdatering (rättat - den skrivs alltid, efter handlern)',
  )
  assertTrue(
    content.includes("outcome = await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, tick)"),
    'handleCheckoutCompleted anropas utan webhookEventRowId (finalize_paid_order behöver den inte längre)',
  )
  const finalUpdateIndex = content.indexOf(".update({ status: outcome, processed_at: new Date().toISOString(), last_error: null })")
  const catchBlockEndIndex = content.indexOf("return textResponse('Internt fel - försök igen.', 500)")
  assertTrue(
    finalUpdateIndex !== -1 && catchBlockEndIndex !== -1 && finalUpdateIndex > catchBlockEndIndex,
    'webhook_events-slutuppdateringen står EFTER catch-blocket (dvs efter att handlern lyckats helt, QR+mejlschemaläggning inkluderat)',
  )

  // QR MÅSTE fortfarande ske FÖRE scheduleConfirmationEmail (i
  // förgrunden) - INTE flyttad till bakgrunden.
  const qrIndex = content.indexOf('tick(`qr-parallel')
  const scheduleCallIndex = content.indexOf('scheduleConfirmationEmail({')
  assertTrue(
    qrIndex !== -1 && scheduleCallIndex !== -1 && qrIndex < scheduleCallIndex,
    'QR-uppladdningen sker FÖRE scheduleConfirmationEmail anropas - i förgrunden, inte flyttad till bakgrunden (skulle annars ge en trasig bild på köparens egen biljettsida)',
  )
  assertTrue(
    content.includes('await Promise.all(') && content.includes('result.tickets.map(async (ticket)'),
    'QR-generering+uppladdning är parallelliserad (Promise.all), inte en sekventiell for-loop',
  )

  assertTrue(
    content.includes('const task = attemptConfirmationEmail({ ...input, force: false })') &&
      content.includes('edgeRuntime.waitUntil(task)'),
    'scheduleConfirmationEmail anropar den DELADE attemptConfirmationEmail med force:false, via EdgeRuntime.waitUntil - väntar INTE in mejlutskicket innan svaret',
  )
}

// --- _shared/attemptConfirmationEmail.ts: delad claim+skicka+spår-logik ---
{
  const content = read('supabase/functions/_shared/attemptConfirmationEmail.ts')
  const claimIndex = content.indexOf('await claimConfirmationEmail(')
  const sendIndex = content.indexOf('await sendConfirmationEmail(')
  assertTrue(claimIndex !== -1 && sendIndex !== -1 && claimIndex < sendIndex, 'Claimen vinns FÖRE sendConfirmationEmail anropas')
  assertTrue(!content.includes('webhook_events'), 'attemptConfirmationEmail rör ALDRIG webhook_events - ett misslyckat mejl påverkar aldrig idempotensstatusen')
  assertTrue(
    content.includes('shortEmailErrorCode(err)') && content.includes('confirmation_email_last_error'),
    'Ett fel skriver ett kort spår (shortEmailErrorCode) till confirmation_email_last_error',
  )
  assertTrue(!content.includes('throw'), 'attemptConfirmationEmail kastar ALDRIG vidare - try/catch runt hela utskicket, ingen unhandled rejection i bakgrunden')

  // Granskning 2026-10-13, fråga 2b: om Resend lyckas men markeringen
  // (confirmation_email_sent_at) misslyckas, görs ETT omförsök av
  // samma UPDATE innan vi ger upp - och ger upp skriver vi en EGEN,
  // greppbar felkod ('mark_sent_failed') istället för att bara logga
  // tyst. sent:true oavsett (mejlet gick verkligen iväg).
  const firstMarkIndex = content.indexOf("confirmation_email_sent_at: new Date().toISOString()")
  const secondMarkIndex = content.indexOf("confirmation_email_sent_at: new Date().toISOString()", firstMarkIndex + 1)
  assertTrue(
    firstMarkIndex !== -1 && secondMarkIndex !== -1,
    'Markeringen av confirmation_email_sent_at görs TVÅ gånger (ett omförsök) innan den ger upp',
  )
  assertTrue(
    content.includes("confirmation_email_last_error: 'mark_sent_failed'"),
    "Ger den ändå upp (två misslyckade försök) skrivs en egen felkod 'mark_sent_failed' - synlig i admin-list-stuck-emails",
  )
  assertTrue(content.includes('return { sent: true }'), 'Returnerar ALLTID sent:true efter ett lyckat Resend-anrop, oavsett om markeringen lyckades - mejlet gick verkligen iväg')
}

// --- admin-resend-tickets: force=true, retry-confirmation-emails: force=false ---
{
  const adminResend = read('supabase/functions/admin-resend-tickets/index.ts')
  assertTrue(
    adminResend.includes('await attemptConfirmationEmail({') && adminResend.includes('force: true,'),
    'admin-resend-tickets använder DEN DELADE attemptConfirmationEmail med force:true (medveten, manuell ombegäran - kan skicka om ett redan skickat mejl)',
  )
  assertTrue(
    adminResend.includes("result.reason === 'already_sent_or_claimed'") && adminResend.includes('409'),
    'admin-resend-tickets svarar tydligt (409) om en annan claim redan pågår, istället för att tyst misslyckas',
  )

  const retryFn = read('supabase/functions/retry-confirmation-emails/index.ts')
  assertTrue(
    retryFn.includes('await attemptConfirmationEmail({') && retryFn.includes('force: false,'),
    'retry-confirmation-emails använder force:false - skickar ALDRIG om ett redan skickat mejl automatiskt',
  )
  assertTrue(
    retryFn.includes(".lt('confirmation_email_attempts', MAX_ATTEMPTS)") && retryFn.includes('const MAX_ATTEMPTS = 5'),
    'retry-confirmation-emails har en gräns på antal automatiska försök (5) - en permanent trasig adress försöks inte om i all evighet',
  )
  assertTrue(
    retryFn.includes("const cronSecret = Deno.env.get('CRON_SECRET')") && retryFn.includes('timingSafeEqual'),
    'retry-confirmation-emails autentiseras med CRON_SECRET, samma mönster som release-expired-orders',
  )
}

// --- admin-list-stuck-emails: läsning, organizer-scopad ---
{
  const listFn = read('supabase/functions/admin-list-stuck-emails/index.ts')
  assertTrue(listFn.includes('resolveOrganizer(req)'), 'admin-list-stuck-emails kräver inloggad arrangör')
  assertTrue(
    listFn.includes(".eq('events.organizer_id', auth.organizerId)"),
    'Listan scopas till den inloggade arrangörens egna event - visar inte andra arrangörers ordrar',
  )
  assertTrue(
    !listFn.includes('.update(') && !listFn.includes('.insert(') && !listFn.includes('.delete('),
    'admin-list-stuck-emails är ren läsning - ingen skrivning, ingen automatisk räddning',
  )
}

// --- GitHub Actions-workflow + config.toml ---
{
  const workflow = read('.github/workflows/retry-confirmation-emails.yml')
  assertTrue(workflow.includes('CRON_SECRET'), 'Workflowen skickar CRON_SECRET, samma mönster som release-expired-orders.yml')

  const configToml = read('supabase/config.toml')
  assertTrue(
    configToml.includes('[functions.retry-confirmation-emails]') && /\[functions\.retry-confirmation-emails\]\nverify_jwt = false/.test(configToml),
    'retry-confirmation-emails har verify_jwt=false (CRON_SECRET-skyddad, inte Supabase-JWT)',
  )
  assertTrue(
    configToml.includes('[functions.admin-list-stuck-emails]') && /\[functions\.admin-list-stuck-emails\]\nverify_jwt = true/.test(configToml),
    'admin-list-stuck-emails har verify_jwt=true, samma som övriga admin-*-funktioner',
  )
}

// --- _shared/sendConfirmationEmail.ts: timeouts (rätt API för varje) ---
{
  const content = read('supabase/functions/_shared/sendConfirmationEmail.ts')
  assertTrue(
    content.includes('signal: AbortSignal.timeout(8000)'),
    'Resend-anropet (en vanlig fetch()) har en AbortSignal.timeout (8 s) - inget tak fanns tidigare',
  )
  assertTrue(
    content.includes('export async function fetchPaymentMethodType(paymentIntentId: string | null)') &&
      content.includes('{ timeout: 5000 }') &&
      !content.includes('{ signal: AbortSignal.timeout(5000) }'),
    "fetchPaymentMethodType tar paymentIntentId direkt och har en timeout (5 s) på Stripe-anropet via RequestOptions.timeout - INTE signal (Stripe-nodens RequestOptions-typ saknar den egenskapen; hittat av en riktig deno check, se chatten)",
  )
}

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
