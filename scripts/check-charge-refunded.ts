// Kontroller för charge.refunded-hanteringen (ordern "Avbokning,
// återbetalning, omsändning och köparmeddelanden" 2026-10-12, STEG 3).
// Deno-skript, samma mönster som check-cancel-order.ts/check-archive.ts.
//
// Två sorters kontroller:
//
// 1. Riktiga enhetstester av de rena funktionerna i _shared/refundLookup.ts:
//    isFullRefund (full kontra delvis återbetalning), connectedAccountOption
//    (direct kontra connect-scopning) och extractOrderIdFromSession
//    (reservuppslaget mot Stripe).
//
// 2. Statiska textkontroller av källkoden för saker som kräver en riktig
//    databas/Stripe-anslutning för att testas på riktigt i den här
//    sessionen: att migrationen är additiv utan backfill, att
//    handleChargeRefunded faktiskt återanvänder cancelPaidOrder istället
//    för att lägga egen avbokningslogik, och att en delvis återbetalning
//    aldrig rör orderstatus.
//
// Kör: deno run --allow-read scripts/check-charge-refunded.ts

import { isFullRefund, connectedAccountOption, extractOrderIdFromSession } from '../supabase/functions/_shared/refundLookup.ts'

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}
function assertTrue(actual: unknown, label: string) {
  assertEqual(Boolean(actual), true, label)
}

// === 1a. isFullRefund ===

assertEqual(isFullRefund({ amount: 10000, amount_refunded: 10000 }), true, 'Hela beloppet återbetalt -> full återbetalning')
assertEqual(isFullRefund({ amount: 10000, amount_refunded: 5000 }), false, 'Halva beloppet återbetalt -> delvis')
assertEqual(isFullRefund({ amount: 10000, amount_refunded: 0 }), false, '0 återbetalt (borde aldrig hända för charge.refunded, men ofarligt) -> inte full')
assertEqual(isFullRefund({ amount: 10000, amount_refunded: 10001 }), true, 'Överåterbetalt (orealistiskt i praktiken) räknas ändå som fullt - >=, inte ===')

// === 1b. connectedAccountOption ===

assertEqual(connectedAccountOption(null), undefined, 'direct-läge (SDS, inget event.account) -> inget stripeAccount-alternativ')
assertEqual(connectedAccountOption('acct_123'), { stripeAccount: 'acct_123' }, 'connect-läge (Testscenen/Accepteas, event.account satt) -> scopat till det kontot')

// === 1c. extractOrderIdFromSession ===

assertEqual(extractOrderIdFromSession({ client_reference_id: 'order-1' }), 'order-1', 'client_reference_id prioriteras')
assertEqual(extractOrderIdFromSession({ client_reference_id: null, metadata: { order_id: 'order-2' } }), 'order-2', 'Faller tillbaka på metadata.order_id om client_reference_id saknas')
assertEqual(extractOrderIdFromSession({ client_reference_id: null, metadata: null }), null, 'Saknar båda -> null, kraschar inte')
assertEqual(extractOrderIdFromSession({}), null, 'Tomt objekt -> null')

// === 2. Statiska kontroller av källkoden ===

const root = new URL('..', import.meta.url)
function read(relPath: string): string {
  return Deno.readTextFileSync(new URL(relPath, root))
}

{
  const migration = read('supabase/migrations/20261012050000_order_stripe_payment_intent.sql')
  assertTrue(migration.includes('begin;') && migration.includes('commit;'), 'Migrationen är omsluten av begin/commit')
  assertTrue(migration.includes('add column stripe_payment_intent_id text'), 'Lägger till kolumnen additivt (ingen NOT NULL, inget default)')
  assertTrue(
    !/add column stripe_payment_intent_id text not null/i.test(migration),
    'Kolumnen är INTE NOT NULL (den egna "is not null" i indexvillkoret nedan är ett annat, giltigt uttryck) - historiska ordrar har null för alltid, ingen backfill',
  )
  assertTrue(!/\bupdate\s+orders\b/i.test(migration), 'Ingen UPDATE av befintliga rader - ingen backfill')
  assertTrue(
    migration.includes('create unique index if not exists orders_stripe_payment_intent_id_idx') &&
      migration.includes('where stripe_payment_intent_id is not null'),
    'Partiellt unikt index för uppslag via kolumnen, krockar inte med historiska null-rader',
  )
}

{
  const rollback = read('supabase/rollbacks/20261012050000_order_stripe_payment_intent_rollback.sql')
  assertTrue(rollback.includes('begin;') && rollback.includes('commit;'), 'Reservfilen är omsluten av begin/commit')
  assertTrue(rollback.includes('drop column if exists stripe_payment_intent_id'), 'Reservfilen droppar kolumnen (index försvinner automatiskt med den)')
}

{
  const content = read('supabase/functions/stripe-webhook/index.ts')
  // Sedan STEG B (ordern "Webhooken: misslyckade händelser måste kunna
  // försökas igen" 2026-10-12) görs statusbytet+stripe_payment_intent_id
  // inte längre som en egen .update() i handleCheckoutCompleted - det
  // sker nu INUTI finalize_paid_order (samma transaktion som biljetterna
  // och rabattkodsräkningen). Se check-webhook-retry.ts för kontrollen av
  // SQL-funktionens UPDATE-sats; här räcker det att se att
  // paymentIntentId faktiskt skickas in till den.
  assertTrue(
    content.includes('await finalizePaidOrder(supabase, order.id, paymentIntentId, ticketCodes)'),
    'handleCheckoutCompleted skickar paymentIntentId in till finalizePaidOrder (som sätter stripe_payment_intent_id i SAMMA UPDATE som status=paid, inuti finalize_paid_order)',
  )
  assertTrue(
    content.includes("else if (event.type === 'charge.refunded')") &&
      content.includes('await handleChargeRefunded(event.data.object as Stripe.Charge, event.account ?? null, tick)'),
    'Deno.serve-dispatchen hanterar charge.refunded och trådar igenom event.account (Connect-scopning) - samt tick (STEG B0, DEBUG_TIMING)',
  )
  assertTrue(
    content.includes(
      'async function handleChargeRefunded(charge: Stripe.Charge, connectedAccountId: string | null, tick: Tick = () => {})',
    ),
    'handleChargeRefunded finns med rätt signatur (inkl. den valfria tick-parametern från STEG B0)',
  )
  {
    const partialRefundCheckIndex = content.indexOf('if (!isFullRefund(charge))')
    const cancelCallIndex = content.indexOf('await cancelPaidOrder(supabase, orderId)')
    assertTrue(
      partialRefundCheckIndex !== -1 && cancelCallIndex !== -1 && partialRefundCheckIndex < cancelCallIndex,
      'Kontrollen för delvis återbetalning (tidig return) står FÖRE anropet till cancelPaidOrder i källkoden - en delvis återbetalning kan aldrig nå avbokningen',
    )
  }
  assertTrue(
    content.includes('await cancelPaidOrder(supabase, orderId)'),
    'Full återbetalning anropar den DELADE cancelPaidOrder - lägger ingen egen avbokningslogik ovanpå (samma krav som admin-cancel-order redan uppfyller)',
  )
  assertTrue(
    !content.includes("status: 'cancelled'") && !content.includes("status:'cancelled'"),
    'stripe-webhook sätter ALDRIG status=cancelled själv - bara cancel_paid_order (via cancelPaidOrder) gör det, exakt samma krav som admin-cancel-order redan uppfyller',
  )
}

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
