// Kontroller för DEBUG_TIMING-instrumenteringen (ordern "Webhooken är
// för långsam" 2026-10-13, STEG B0). Deno-skript, samma mönster som
// övriga check-*.ts.
//
// 1. Riktigt enhetstest av startTimer: no-op (ingen loggrad) när
//    DEBUG_TIMING inte är satt, loggar [timing] <label> <ms> när den
//    är satt till "true".
// 2. Statiska kontroller: tick() är inkopplad i BÅDA
//    checkout.session.completed- och charge.refunded-vägarna (inte
//    bara en av dem), och inga nya loggrader innehåller köparens
//    namn/e-post eller belopp.
//
// Kör: deno run --allow-read --allow-env scripts/check-timing.ts

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}
function assertTrue(actual: unknown, label: string) {
  assertEqual(Boolean(actual), true, label)
}

// === 1. startTimer - måste importeras EFTER att DEBUG_TIMING sätts/
// inte sätts i Deno.env, eftersom modulen läser den vid import-tid.
// Två separata delprocesser (via Deno.Command) för att testa båda
// lägena rent, utan att importordningen i detta skript själv spökar.

const timingModule = new URL('../supabase/functions/stripe-webhook/timing.ts', import.meta.url)

async function runWithEnv(debugTiming: string | undefined): Promise<string> {
  const script = `
    import { startTimer } from "${timingModule.href}"
    const tick = startTimer()
    tick('steg-1')
    tick('steg-2')
  `
  const env: Record<string, string> = {}
  if (debugTiming !== undefined) env.DEBUG_TIMING = debugTiming
  const command = new Deno.Command(Deno.execPath(), {
    args: ['eval', '--ext=ts', script],
    env,
    clearEnv: true,
    stdout: 'piped',
    stderr: 'piped',
  })
  const { stdout, stderr } = await command.output()
  return new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr)
}

{
  const output = await runWithEnv(undefined)
  assertTrue(!output.includes('[timing]'), 'DEBUG_TIMING osatt -> INGA [timing]-loggrader (no-op, inget overhead, inget brus)')
}
{
  const output = await runWithEnv('false')
  assertTrue(!output.includes('[timing]'), "DEBUG_TIMING='false' -> fortfarande inga loggrader")
}
{
  const output = await runWithEnv('true')
  assertTrue(output.includes('[timing] steg-1:') && output.includes('[timing] steg-2:'), "DEBUG_TIMING='true' -> loggar varje steg")
}

// === 2. Statiska kontroller av stripe-webhook/index.ts ===

const root = new URL('../', import.meta.url)
function read(relPath: string): string {
  return Deno.readTextFileSync(new URL(relPath, root))
}

{
  const content = read('supabase/functions/stripe-webhook/index.ts')

  assertTrue(
    content.includes("import { startTimer, type Tick } from './timing.ts'"),
    'index.ts importerar startTimer/Tick från den nya timing.ts',
  )
  assertTrue(content.includes('const tick = startTimer()'), 'Deno.serve skapar EN tick-funktion per begäran')

  {
    // Extra tick (begärd 2026-10-13) FÖRE det första DB-anropet, så
    // att "första kontakten med databasen" (anslutning + fråga)
    // isoleras som sitt EGET mätt segment, separat från efterföljande
    // anrop.
    const clientCreatedIndex = content.indexOf("tick('db-client-created')")
    const firstDbCallIndex = content.indexOf(".from('webhook_events')\n    .insert({")
    const bookkeepingTickIndex = content.indexOf("tick('webhook_events-bookkeeping')")
    assertTrue(
      clientCreatedIndex !== -1 && clientCreatedIndex < firstDbCallIndex && firstDbCallIndex < bookkeepingTickIndex,
      "En tick('db-client-created') står EFTER createAdminClient() men FÖRE det första DB-anropet (webhook_events-insert) - isolerar anslutningstiden som sitt eget segment",
    )
  }

  // checkout.session.completed-vägen (omarbetad 2026-10-13 - färre
  // DB-anrop, QR parallelliserad, mejlet flyttat till bakgrunden -
  // tick-etiketterna följer den nya strukturen).
  // (webhookEventRowId togs bort från handleCheckoutCompleted 2026-10-13
  // - se check-webhook-svarstid.ts: finalize_paid_order rör inte längre
  // webhook_events, så handlern behöver inte radens id.)
  assertTrue(
    content.includes('async function handleCheckoutCompleted(session: Stripe.Checkout.Session, tick: Tick = () => {})'),
    'handleCheckoutCompleted tar emot tick-funktionen (ingen webhookEventRowId längre)',
  )
  assertTrue(
    content.includes('outcome = await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, tick)'),
    'Dispatchen skickar tick in till handleCheckoutCompleted',
  )
  for (const label of [
    "tick('order_items-qty-select')",
    'finalize_paid_order (utvidgad',
    'qr-parallel (',
    "tick('schedule-confirmation-email",
  ]) {
    assertTrue(content.includes(label), `checkout.session.completed-vägen (förgrunden) har en tick för: ${label}`)
  }
  // Mejlet (betalsätt/PDF/Resend/mark-sent) körs numera i bakgrunden,
  // EFTER svaret - ingen tick behövs/kan ges där (ingen anropare väntar
  // in resultatet), så de GAMLA etiketterna ska INTE finnas kvar.
  for (const oldLabel of [
    "tick('order-select')",
    "tick('event-select')",
    "tick('organizer-select')",
    "tick('stripe-payment-method')",
    "tick('mark-email-sent')",
  ]) {
    assertTrue(!content.includes(oldLabel), `Den gamla etiketten ${oldLabel} finns INTE kvar (flyttad till bakgrunden, utan tick)`)
  }

  // charge.refunded-vägen
  assertTrue(
    content.includes(
      'async function handleChargeRefunded(charge: Stripe.Charge, connectedAccountId: string | null, tick: Tick = () => {})',
    ),
    'handleChargeRefunded tar emot tick-funktionen',
  )
  assertTrue(
    content.includes('await handleChargeRefunded(event.data.object as Stripe.Charge, event.account ?? null, tick)'),
    'Dispatchen skickar tick in till handleChargeRefunded',
  )
  for (const label of ["tick('find-order-id-for-refund')", "tick('cancel_paid_order')"]) {
    assertTrue(content.includes(label), `charge.refunded-vägen har en tick för: ${label}`)
  }

  // Oförändrade vägar - INTE i STEG B0:s omfattning.
  assertTrue(
    !content.match(/async function handleCheckoutExpired\([^)]*tick/) && !content.match(/async function handleAccountUpdated\([^)]*tick/),
    'handleCheckoutExpired/handleAccountUpdated rörs INTE av STEG B0 (bara checkout.session.completed och charge.refunded enligt ordern)',
  )

  // Ingen tick(...)-etikett interpolerar köpar-/beloppsfält - etiketter
  // är statiska stegnamn (högst en räknare eller eventtyp interpolerad,
  // t.ex. qr-loop (${result.tickets.length} ...) eller
  // signature-verify (${event.type})), aldrig buyer_name/buyer_email/
  // belopp.
  const tickLabels = [...content.matchAll(/tick\(([^)]*)\)/g)].map((m) => m[1])
  assertTrue(tickLabels.length > 0, 'Hittade tick(...)-anrop att kontrollera (sanity på regexen)')
  const leaky = tickLabels.find((l) => /buyer_name|buyer_email|order\.buyer|_ore|amount_refunded|total_ore/i.test(l))
  assertTrue(!leaky, `Ingen tick(...)-etikett interpolerar köpar-/beloppsfält${leaky ? ` - hittade: ${leaky}` : ''}`)
}

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
