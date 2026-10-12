// Kontroller för webhook-omförsök (ordern "Webhooken: misslyckade
// händelser måste kunna försökas igen" 2026-10-12, STEG B). Deno-
// skript, samma mönster som check-cancel-order.ts/check-archive.ts.
//
// Två sorters kontroller:
//
// 1. Riktiga enhetstester av de rena funktionerna: decideRetryAction
//    (webhook_events-statusmaskinen) och mapFinalizeOutcome
//    (finalize_paid_order -> 'done'/'needs_attention'/'not_found').
//
// 2. Statiska textkontroller av källkoden/migrationerna för saker som
//    kräver en riktig databas för att testas på riktigt i den här
//    miljön (inget Docker/lokal Postgres tillgängligt här): att
//    finalize_paid_order-migrationen är additiv och har rätt
//    säkerhetsgrants, att stripe-webhook faktiskt kastar vid riktiga
//    fel istället för att svälja dem, att mejlet skickas FÖRE
//    confirmation_email_sent_at sätts, och att inget felmeddelande i
//    stripe-webhook interpolerar köparens namn/e-post.
//
// Kör: deno run --allow-read scripts/check-webhook-retry.ts

import { decideRetryAction, STILL_RUNNING_THRESHOLD_MS } from '../supabase/functions/stripe-webhook/webhookEventRetry.ts'
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

// === 1a. decideRetryAction ===

assertEqual(decideRetryAction('done', 0), 'already_done', "'done' -> already_done oavsett ålder (STEG B: redan 'done' ger 200)")
assertEqual(decideRetryAction('needs_attention', 999_999_999), 'already_done', "'needs_attention' -> already_done (terminal, försöks inte om)")
assertEqual(decideRetryAction('received', 0), 'still_running', 'Samtidig dubbelleverans: andra leveransen ser en NYSS skapad received-rad (ålder 0ms) -> still_running, inte retry')
assertEqual(
  decideRetryAction('received', STILL_RUNNING_THRESHOLD_MS - 1),
  'still_running',
  'received, precis under tröskeln -> fortfarande still_running',
)
assertEqual(decideRetryAction('received', STILL_RUNNING_THRESHOLD_MS), 'retry', 'received, exakt på tröskeln -> räknas som kraschad, retry')
assertEqual(decideRetryAction('received', STILL_RUNNING_THRESHOLD_MS + 1), 'retry', 'received, över tröskeln -> kraschad körning -> retry')
assertEqual(decideRetryAction('failed', 0), 'retry', "'failed' -> retry oavsett ålder (ett riktigt fel ska kunna försökas om direkt)")
assertEqual(decideRetryAction('failed', 999_999_999), 'retry', "'failed', gammal -> fortfarande retry")

// === 1b. mapFinalizeOutcome ===

assertEqual(mapFinalizeOutcome('finalized'), 'done', 'Första lyckade slutförandet -> done')
assertEqual(mapFinalizeOutcome('already_paid'), 'done', 'Omkörning av en redan betald order -> done (ingen dubbel biljett/mejl/rabattkodsräkning)')
assertEqual(mapFinalizeOutcome('not_found'), 'not_found', 'Ordern finns inte -> not_found (200, inget att göra)')
assertEqual(mapFinalizeOutcome('expired'), 'needs_attention', "En betalning för en 'expired'-order -> needs_attention, inte tyst ignorerat")
assertEqual(mapFinalizeOutcome('cancelled'), 'needs_attention', "Samma för 'cancelled'")
assertEqual(mapFinalizeOutcome('some_future_status'), 'needs_attention', 'Ett okänt framtida status-värde -> needs_attention som säker fallback, inte done')

// === 2. Statiska kontroller av källkoden ===

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

// --- finalize_paid_order-migrationen ---
{
  const migration = read('supabase/migrations/20261012080000_finalize_paid_order_function.sql')
  const codeOnly = stripSqlComments(migration)

  assertTrue(migration.includes('begin;') && migration.includes('commit;'), 'finalize_paid_order-migrationen är omsluten av begin/commit')
  assertTrue(migration.includes('create or replace function'), 'create or replace - ingen drop')
  assertTrue(!/\bsecurity definer\b/i.test(codeOnly), 'INGEN security definer i någon KODRAD (samma motivering som cancel_paid_order)')
  assertTrue(
    codeOnly.includes("where id = p_order_id") && codeOnly.includes("and status = 'pending'"),
    'Statusbytet är villkorat på status=pending (atomärt)',
  )
  assertTrue(
    codeOnly.includes("set status = 'paid'") && codeOnly.includes('stripe_payment_intent_id = p_payment_intent_id'),
    'stripe_payment_intent_id sätts i SAMMA UPDATE-sats som status=paid (STEG 3 punkt 1, nu flyttat in i finalize_paid_order)',
  )
  assertTrue(
    migration.includes('returns table(outcome text, event_id uuid, paid_at timestamptz, tickets jsonb)') &&
      codeOnly.includes('o.paid_at into v_current_status, v_event_id, v_paid_at'),
    "Funktionen returnerar den FAKTISKA orders.paid_at (både för 'finalized' och 'already_paid') - inte bara ett outcome/event_id/tickets (STEG B-granskningen 2026-10-12, fråga 1a: kvittodatumet i mejlet ska vara köpdatumet, inte 'nu' vid en omkörning)",
  )
  assertTrue(codeOnly.includes("v_outcome := 'finalized'"), "Vinner statusbytet -> outcome 'finalized'")
  assertTrue(codeOnly.includes("v_outcome := 'already_paid'"), "Redan paid -> outcome 'already_paid', INTE tyst ignorerat")
  assertTrue(codeOnly.includes("v_outcome := 'not_found'"), "Ordern finns inte -> outcome 'not_found'")
  assertTrue(
    codeOnly.includes('v_outcome := v_current_status'),
    "Alla ANDRA statusar (expired/cancelled/...) returneras RAKT AV som outcome - inte tyst ignorerat (STEG B punkt 3)",
  )
  assertTrue(codeOnly.includes('raise exception'), 'Function har en explicit sanity-kontroll (fel antal biljettkoder) istället för att tyst skapa fel antal biljetter')
  assertTrue(
    migration.includes('revoke all on function finalize_paid_order(uuid, text, text[]) from public') &&
      migration.includes('revoke all on function finalize_paid_order(uuid, text, text[]) from anon') &&
      migration.includes('revoke all on function finalize_paid_order(uuid, text, text[]) from authenticated'),
    'EXECUTE revokeras explicit per roll (samma lärdom som cancel_paid_order/lock_down_definer_functions)',
  )
  assertTrue(
    migration.includes('grant execute on function finalize_paid_order(uuid, text, text[]) to service_role'),
    'EXECUTE beviljas explicit till service_role',
  )
}

// --- paidAt tar vägen genom hela kedjan (STEG B-granskningen
// 2026-10-12, fråga 1a) - kvittodatumet i mejlet ska vara den FAKTISKA
// betalningstidpunkten, inte "nu" vid en omkörning. ---
{
  const wrapper = read('supabase/functions/_shared/finalizeOrder.ts')
  assertTrue(wrapper.includes('paidAt: row.paid_at'), 'finalizePaidOrder exponerar paid_at från SQL-funktionen som paidAt')

  const webhook = read('supabase/functions/stripe-webhook/index.ts')
  assertTrue(
    webhook.includes('paidAt: result.paidAt'),
    'handleCheckoutCompleted skickar result.paidAt (den FAKTISKA betalningstidpunkten) till mejlet - inte en nyss skapad new Date()',
  )
}

// --- Oberoende granskning 2026-10-12: två samtidiga retry-beslut för
// SAMMA webhook_events-rad får bara låta EN av dem faktiskt köra
// handlern (annars kan confirmation_email_sent_at-kollen i
// handleCheckoutCompleted passeras av båda, och mejlet skickas två
// gånger - biljetterna/rabattkoden skyddas redan av finalize_paid_
// orders transaktion, men själva retry-beslutet gjorde det INTE säkert
// att gå vidare). ---
{
  const webhook = read('supabase/functions/stripe-webhook/index.ts')
  const retrySection = webhook.slice(webhook.indexOf("// decision === 'retry'"), webhook.indexOf('let outcome:'))

  assertTrue(
    retrySection.includes(".update({ status: 'received', attempts: existingRow.attempts + 1, last_error: null })") &&
      retrySection.includes('.eq(\'status\', existingRow.status)'),
    'Omförsöksuppdateringen är villkorad (compare-and-swap) på den status vi just läste - inte ett ovillkorat UPDATE baserat bara på id',
  )
  assertTrue(
    retrySection.includes('.maybeSingle()') && !retrySection.includes('.single()'),
    'Använder maybeSingle() för omförsöks-UPDATE:en - noll träffade rader (förlorad CAS) är ett GILTIGT utfall, inte ett databasfel',
  )
  assertTrue(
    retrySection.includes('if (!retriedRow) {') && retrySection.includes("return textResponse('bearbetas redan', 409)"),
    'Förlorad CAS (en annan samtidig leverans tog redan över) ger 409, INTE att handlern körs av båda',
  )
}

// --- Oberoende granskning 2026-10-12: Resends råa felsvar får aldrig
// landa i webhook_events.last_error (kan eka tillbaka köparens
// e-postadress vid en valideringsfel). ---
{
  const content = read('supabase/functions/_shared/sendConfirmationEmail.ts')
  const throwLine = content.match(/throw new Error\(`Resend[^`]*`\)/)?.[0] ?? ''
  assertTrue(throwLine.length > 0, 'Hittade Resend-throw-raden att kontrollera (sanity på regexen)')
  assertTrue(!throwLine.includes('errText'), 'Det KASTADE Resend-felet interpolerar INTE errText (Resends råa svarskropp) - bara statuskoden')
  assertTrue(content.includes('console.error(\'Resend-fel'), 'Den fulla Resend-svarstexten loggas ändå till konsolen (för felsökning) - bara inte in i det kastade felet')
}

// --- confirmation_email_sent_at-migrationen ---
{
  const migration = read('supabase/migrations/20261012070000_order_confirmation_email_sent_at.sql')
  assertTrue(migration.includes('begin;') && migration.includes('commit;'), 'confirmation_email_sent_at-migrationen är omsluten av begin/commit')
  assertTrue(migration.includes('add column confirmation_email_sent_at timestamptz'), 'Additiv, nullable kolumn (ingen NOT NULL, inget default)')
  assertTrue(!/\bnot null\b/i.test(migration), 'Ingen NOT NULL - ingen backfill krävs')
  assertTrue(!/\bupdate\s+orders\b/i.test(migration), 'Ingen UPDATE av befintliga rader - ingen backfill')
}

// --- webhook_events-statusmigrationen ---
{
  const migration = read('supabase/migrations/20261012060000_webhook_events_status.sql')
  assertTrue(migration.includes('begin;') && migration.includes('commit;'), 'webhook_events-statusmigrationen är omsluten av begin/commit')
  assertTrue(
    migration.includes("check (status in ('received', 'done', 'failed', 'needs_attention'))"),
    'Statuskolumnen har en check-constraint med exakt de fyra tillåtna värdena',
  )
  assertTrue(
    migration.includes("update webhook_events") && migration.includes("set status = 'done'"),
    "Befintliga rader skrivs EXPLICIT och SYNLIGT om till 'done' (den gamla modellen var INSERT=klar)",
  )
}

// --- stripe-webhook/index.ts: handlarna kastar vid riktiga fel ---
{
  const content = read('supabase/functions/stripe-webhook/index.ts')

  assertTrue(
    content.includes('await finalizePaidOrder(supabase, order.id, paymentIntentId, ticketCodes)'),
    'handleCheckoutCompleted slutför ordern via den delade, atomära finalizePaidOrder - lägger ingen egen biljett-/statuslogik',
  )
  assertTrue(!content.includes(".from('tickets')\n    .insert("), 'handleCheckoutCompleted gör INTE längre en egen rå tickets.insert (flyttat in i finalize_paid_order)')

  // Mejlet måste skickas FÖRE confirmation_email_sent_at sätts - annars
  // skulle ett Resend-fel kunna lämna kolumnen satt utan att mejlet
  // faktiskt gick iväg.
  const sendIndex = content.indexOf('await sendConfirmationEmail({')
  const markSentIndex = content.indexOf(".update({ confirmation_email_sent_at: new Date().toISOString() })")
  assertTrue(sendIndex !== -1 && markSentIndex !== -1 && sendIndex < markSentIndex, 'sendConfirmationEmail anropas FÖRE confirmation_email_sent_at sätts, inte efter')

  assertTrue(
    content.includes('if (order.confirmation_email_sent_at) return'),
    'En omkörning hoppar över mejlutskicket om det redan skickats (idempotens, STEG B punkt 2)',
  )

  // QR-uppladdning: fel ska KASTA, inte tyst "continue" till nästa biljett.
  assertTrue(
    !/uploadError\) \{\s*console\.error[^]*?continue/.test(content),
    'Ett QR-uppladdningsfel kastar numera (inte en tyst "continue" som hoppar över just den biljetten)',
  )
  assertTrue(content.includes('if (uploadError) throw new Error'), 'QR-uppladdningsfelet kastas explicit')

  // Saknad säljarrad (inte bara saknat legal_name) ska kasta.
  assertTrue(content.includes('if (!organizerRow) throw new Error'), 'En helt saknad arrangörsrad kastar (datafel) - skiljt från "legal_name saknas", som fortfarande är ofarligt')

  // handleCheckoutExpired: release-RPC-felet får inte tystas längre.
  assertTrue(
    content.includes("const { error: releaseError } = await supabase.rpc('release_shared_capacity_multi'") &&
      content.includes('if (releaseError) throw new Error'),
    'handleCheckoutExpired fångar och kastar nu release_shared_capacity_multi-felet (tidigare ignorerades det helt - inte ens ett error-fält lästes ut)',
  )

  // charge.refunded: findOrderIdForRefund/cancelPaidOrder får inte
  // längre svaljas i en lokal try/catch.
  assertTrue(
    !/findOrderIdForRefund[^]*?catch/.test(content.slice(content.indexOf('async function handleChargeRefunded'), content.indexOf('Deno.serve'))),
    'handleChargeRefunded sväljer inte längre fel från findOrderIdForRefund/cancelPaidOrder i en egen try/catch - de propagerar till dispatchen',
  )

  // Dispatchen: status-maskinen.
  assertTrue(content.includes("status: 'received'") && content.includes('attempts: 1'), 'Ny webhook_events-rad skapas med status=received, attempts=1')
  assertTrue(content.includes('decideRetryAction(existingRow.status'), 'En INSERT-konflikt läser den befintliga raden och avgör vad som ska hända via decideRetryAction')
  assertTrue(content.includes("return textResponse('bearbetas redan', 409)"), "'still_running' svarar 409, inte 200 - Stripe ska försöka igen senare")
  assertTrue(content.includes("status: 'failed'") && content.includes('last_error'), 'Ett riktigt fel markerar raden failed med last_error')
  assertTrue(content.includes("return textResponse('Internt fel - försök igen.', 500)"), 'Ett riktigt fel svarar 500 - inte 200 som i den gamla modellen')
  assertTrue(
    content.includes('status: outcome, processed_at: new Date().toISOString()'),
    "Lyckad körning markerar raden med UTFALLET ('done' eller 'needs_attention'), inte alltid 'done'",
  )

  // Inga personuppgifter i felmeddelanden/loggar i den här filen.
  const throwLines = content.match(/throw new Error\(`[^`]*`\)/g) ?? []
  assertTrue(throwLines.length > 0, 'Hittade minst ett throw new Error(...) att kontrollera (sanity på regexen själv)')
  const leakyThrow = throwLines.find((line) => /buyer_name|buyer_email/.test(line))
  assertTrue(!leakyThrow, `Inget throw new Error(...) interpolerar buyer_name/buyer_email${leakyThrow ? ` - hittade: ${leakyThrow}` : ''}`)
}

// --- _shared/sendConfirmationEmail.ts: Resend-fel kastar numera ---
{
  const content = read('supabase/functions/_shared/sendConfirmationEmail.ts')
  assertTrue(
    /if \(!emailResponse\.ok\) \{[^}]*throw new Error/.test(content),
    'Ett icke-OK Resend-svar kastar numera (tidigare bara console.error, aldrig ett fel som propagerade)',
  )
}

// --- _shared/refundLookup.ts: findOrderIdForRefund kastar vid riktiga fel ---
{
  const content = read('supabase/functions/_shared/refundLookup.ts')
  const fnBody = content.slice(content.indexOf('export async function findOrderIdForRefund'))
  assertTrue(fnBody.includes('throw new Error'), 'findOrderIdForRefund kastar numera vid ett DB-fel i det primära uppslaget')
  assertTrue(!fnBody.includes('try {') && !fnBody.includes('catch'), 'Stripe-uppslaget (checkout.sessions.list) sväljs inte längre i en egen try/catch - ett API-fel propagerar nu')
}

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
