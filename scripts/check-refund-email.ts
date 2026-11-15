// Kontroller för återbetalningsmejlet (ordern "Skicka mejl till köparen vid
// full återbetalning i Stripe" 2026-11). Deno-skript, samma mönster som
// check-charge-refunded.ts.
//
// Kör: deno run --allow-read --allow-env scripts/check-refund-email.ts

import {
  attemptRefundEmail,
  buildRefundEmail,
  formatRefundAmount,
  shouldSendRefundEmail,
} from '../supabase/functions/_shared/refundEmail.ts'

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : ` - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`}`)
  if (!ok) failures++
}
function assertTrue(actual: unknown, label: string) {
  assertEqual(Boolean(actual), true, label)
}

// === 1. Villkor (shouldSendRefundEmail) ===

const base = { fullRefund: true, cancelled: true, totalOre: 108000, archivedReason: null, buyerEmail: 'a@example.com' }
assertEqual(shouldSendRefundEmail(base), true, 'Full återbetalning, avbokad nu, betald, riktig order, e-post finns -> mejl')
assertEqual(shouldSendRefundEmail({ ...base, fullRefund: false }), false, 'Delåterbetalning -> inget mejl')
assertEqual(shouldSendRefundEmail({ ...base, cancelled: false }), false, 'Redan avbokad / omlevererat event (cancelled=false) -> inget mejl')
assertEqual(shouldSendRefundEmail({ ...base, totalOre: 0 }), false, 'Gratisorder (total_ore=0) -> inget mejl')
assertEqual(shouldSendRefundEmail({ ...base, totalOre: null }), false, 'total_ore saknas -> inget mejl')
assertEqual(shouldSendRefundEmail({ ...base, archivedReason: 'test' }), false, "archived_reason='test' -> inget mejl")
assertEqual(shouldSendRefundEmail({ ...base, archivedReason: 'hidden' }), true, "archived_reason='hidden' är inte en testorder -> mejl")
assertEqual(shouldSendRefundEmail({ ...base, buyerEmail: null }), false, 'Saknad e-post (null) -> inget mejl')
assertEqual(shouldSendRefundEmail({ ...base, buyerEmail: '  ' }), false, 'Tom e-post -> inget mejl')

// === 2. Belopp och mall ===

assertEqual(formatRefundAmount(108000).replace(/\s/g, ' '), '1 080 kr', 'Belopp 108000 öre -> "1 080 kr"')
assertEqual(formatRefundAmount(25000).replace(/\s/g, ' '), '250 kr', '25000 öre -> "250 kr"')
assertEqual(formatRefundAmount(12050).replace(/\s/g, ' '), '120,50 kr', 'Öre-belopp -> två decimaler')

// 2026-12-05 18:00 UTC = 19:00 Europe/Stockholm (vintertid), lördag.
const email = buildRefundEmail({
  buyerName: 'Anna <b>Andersson</b>',
  eventTitle: 'Julshowen & Co',
  eventStartsAt: '2026-12-05T18:00:00Z',
  organizerName: 'Sollentuna Dans & Scenskola',
  refundedOre: 108000,
  orderId: '11111111-2222-3333-4444-555555555555',
})
assertEqual(email.subject, 'Din order har avbokats och återbetalats – Julshowen & Co', 'Ämnesraden följer ordern')
assertTrue(email.text.startsWith('Hej Anna <b>Andersson</b>,'), 'Text: hälsning med köparens namn')
assertTrue(/lördag 5 december 2026/.test(email.text), 'Text: veckodag + datum i Europe/Stockholm')
assertTrue(/19[:.]00/.test(email.text), 'Text: klockslag 19:00 (Stockholm, inte UTC 18:00)')
assertTrue(/har avbokats och 1\s080 kr har återbetalats till din ursprungliga betalningsmetod/.test(email.text), 'Text: avbokad + belopp')
assertTrue(email.text.includes('5–10 bankdagar'), 'Text: 5–10 bankdagar')
assertTrue(email.text.includes('Apple Pay'), 'Text: Apple Pay-upplysningen')
assertTrue(email.text.includes('Biljetterna i ordern är nu ogiltiga och kan inte användas vid insläppet.'), 'Text: biljetterna ogiltiga')
assertTrue(email.text.includes('Vänliga hälsningar,\nSollentuna Dans & Scenskola'), 'Text: arrangörens namn från data i signaturen')
assertTrue(!email.html.includes('<b>Andersson'), 'HTML: köparens namn är escapat')
assertTrue(email.html.includes('Anna &lt;b&gt;Andersson&lt;/b&gt;'), 'HTML: escapat namn syns som text')
assertTrue(email.html.includes('Julshowen &amp; Co'), 'HTML: eventtiteln escapad')
assertTrue(!/<img|qr|ticket_code/i.test(email.html), 'HTML: ingen QR/biljettbild')

const noOrganizer = buildRefundEmail({
  buyerName: 'B',
  eventTitle: 'X',
  eventStartsAt: '2026-07-01T10:00:00Z',
  organizerName: null,
  refundedOre: 5000,
  orderId: 'o',
})
assertTrue(noOrganizer.text.includes('Vänliga hälsningar,\nArrangören'), 'Saknat arrangörsnamn -> "Arrangören"')

// === 3. attemptRefundEmail med fejkad Supabase + mockad fetch ===

type OrderRow = Record<string, unknown> | null
function fakeSupabase(row: OrderRow, error: { message: string } | null = null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error }),
  }
  return { from: () => chain } as never
}
const orderRow = (over: Record<string, unknown> = {}) => ({
  buyer_name: 'Anna',
  buyer_email: 'anna@example.com',
  total_ore: 108000,
  archived_reason: null,
  events: { title: 'Julshowen', starts_at: '2026-12-05T18:00:00Z', organizers: { name: 'SDS' } },
  ...over,
})

Deno.env.set('RESEND_API_KEY', 'test-key')
const realFetch = globalThis.fetch
let fetchCalls: { body: Record<string, unknown>; headers: Record<string, string> }[] = []
function mockFetch(status: number) {
  fetchCalls = []
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    fetchCalls.push({
      body: JSON.parse(init.body as string),
      headers: init.headers as Record<string, string>,
    })
    return Promise.resolve(new Response(JSON.stringify({ id: 'resend-id-1' }), { status }))
  }) as typeof fetch
}
const origError = console.error
const origLog = console.log
console.error = () => {}
console.log = () => {}

const common = { orderId: 'order-1', fullRefund: true, cancelled: true, refundedOre: 108000 }

mockFetch(200)
const sentRes = await attemptRefundEmail({ supabase: fakeSupabase(orderRow()), ...common })
assertEqual(sentRes, { sent: true, emailId: 'resend-id-1' }, 'Allt uppfyllt -> skickat, Resend-id returneras')
assertEqual(fetchCalls.length, 1, 'Exakt ett Resend-anrop')
assertEqual(fetchCalls[0]?.body.to, 'anna@example.com', 'Mottagare = orders.buyer_email')
assertTrue(String(fetchCalls[0]?.body.subject).includes('Julshowen'), 'Ämne innehåller eventtiteln')
assertEqual(fetchCalls[0]?.headers['Idempotency-Key'], 'refund-email/order-1', 'Idempotency-Key satt per order')
assertTrue(!('attachments' in (fetchCalls[0]?.body ?? {})), 'Inga bilagor (inga biljetter igen)')

const noSend = async (label: string, params: Parameters<typeof attemptRefundEmail>[0]) => {
  mockFetch(200)
  const r = await attemptRefundEmail(params)
  assertEqual([r.sent, fetchCalls.length], [false, 0], label)
}
await noSend('Delåterbetalning -> inget Resend-anrop', { supabase: fakeSupabase(orderRow()), ...common, fullRefund: false })
await noSend('cancelled=false -> inget Resend-anrop', { supabase: fakeSupabase(orderRow()), ...common, cancelled: false })
await noSend('Gratisorder -> inget Resend-anrop', { supabase: fakeSupabase(orderRow({ total_ore: 0 })), ...common })
await noSend('Testorder -> inget Resend-anrop', { supabase: fakeSupabase(orderRow({ archived_reason: 'test' })), ...common })
await noSend('Saknad e-post -> inget Resend-anrop', { supabase: fakeSupabase(orderRow({ buyer_email: null })), ...common })
await noSend('Order hittas inte -> inget Resend-anrop', { supabase: fakeSupabase(null), ...common })

// Fel får aldrig kastas vidare (webhooken ska inte svara 500).
mockFetch(500)
const resendDown = await attemptRefundEmail({ supabase: fakeSupabase(orderRow()), ...common })
assertEqual(resendDown, { sent: false, reason: 'error' }, 'Resend 500 -> sväljs, ger reason=error, kastar inte')
const dbDown = await attemptRefundEmail({ supabase: fakeSupabase(null, { message: 'db nere' }), ...common })
assertEqual(dbDown, { sent: false, reason: 'error' }, 'DB-fel vid orderläsning -> sväljs, kastar inte')
globalThis.fetch = (() => Promise.reject(new DOMException('timeout', 'TimeoutError'))) as typeof fetch
const timeout = await attemptRefundEmail({ supabase: fakeSupabase(orderRow()), ...common })
assertEqual(timeout, { sent: false, reason: 'error' }, 'Timeout mot Resend -> sväljs')

globalThis.fetch = realFetch
console.error = origError
console.log = origLog

// === 4. Statiska kontroller av stripe-webhook ===

const root = new URL('..', import.meta.url)
const webhook = Deno.readTextFileSync(new URL('supabase/functions/stripe-webhook/index.ts', root))
const fnStart = webhook.indexOf('async function handleChargeRefunded')
const fnEnd = webhook.indexOf('await instrumentEdgeFunctions()')
const handler = webhook.slice(fnStart, fnEnd)
const partialIdx = handler.indexOf('if (!isFullRefund(charge))')
const cancelIdx = handler.indexOf('await cancelPaidOrder(')
const scheduleIdx = handler.indexOf('scheduleRefundEmail(')
assertTrue(partialIdx > -1 && cancelIdx > partialIdx, 'Delåterbetalningsgrenen returnerar INNAN cancelPaidOrder (ingen avbokning, inget mejl)')
assertTrue(scheduleIdx > cancelIdx, 'Mejlet köas först efter cancelPaidOrder')
assertTrue(/if \(result\.cancelled\) \{\s*scheduleRefundEmail\(/.test(handler), 'Mejlet köas bara om result.cancelled')
assertTrue(!/await\s+attemptRefundEmail|await\s+scheduleRefundEmail/.test(handler), 'Webhooken väntar inte på mejlet (bakgrundsuppgift)')
const cancelFn = Deno.readTextFileSync(new URL('supabase/functions/admin-cancel-order/index.ts', root))
assertTrue(!cancelFn.includes('refundEmail'), 'admin-cancel-order är orörd (inget återbetalningsmejl där)')

console.log(failures === 0 ? '\nAlla kontroller OK' : `\n${failures} kontroll(er) FAILADE`)
if (failures > 0) Deno.exit(1)
