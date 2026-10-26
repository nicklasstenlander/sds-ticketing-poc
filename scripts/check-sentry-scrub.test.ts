#!/usr/bin/env node
// Skrubbning av person- och betaldata innan något skickas till Sentry.
// Kör: node --experimental-strip-types scripts/check-sentry-scrub.test.ts
import { scrubBreadcrumb, scrubSentryEvent, scrubSentrySpan } from '../supabase/functions/_shared/sentryPrivacy.ts'

let failures = 0
function assertTrue(ok: boolean, label: string) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) failures++
}

const event = {
  tags: { runtime: 'deno' },
  request: {
    url: 'https://proj.supabase.co/functions/v1/create-order?email=buyer@example.com&token=super-secret-token&ok=1',
    query_string: 'email=buyer%40example.com&token=super-secret-token&ok=1',
    data: { email: 'buyer@example.com', name: 'Ada Lovelace', card: '4242424242424242', note: 'ok' },
    headers: {
      authorization: 'Bearer sk_test_abcdefghijklmnopqrstuvwxyz',
      'content-type': 'application/json',
      'stripe-signature': 'whsec_abcdefghijklmnopqrstuvwxyz',
    },
    cookies: 'session=abc',
  },
  user: { id: 'user-1', email: 'buyer@example.com', ip_address: '203.0.113.5', username: 'Ada' },
  extra: { note: 'Köp av buyer@example.com, tel +46701234567 och 0701234567' },
  exception: {
    values: [{ type: 'Error', value: 'Sentry verification error from sds-ticketing-poc', stacktrace: { frames: [{ filename: 'src/lib/sentry.ts', function: 'init' }] } }],
  },
}

const scrubbed = scrubSentryEvent(event)
const serialized = JSON.stringify(scrubbed)

assertTrue(!serialized.includes('buyer@example.com'), 'e-post finns inte kvar i eventet')
assertTrue(!serialized.includes('Ada Lovelace'), 'köparnamn finns inte kvar')
assertTrue(!serialized.includes('4242424242424242'), 'kortnummer finns inte kvar')
assertTrue(!serialized.includes('super-secret-token'), 'token i query finns inte kvar')
assertTrue(!serialized.includes('sk_test_abcdefghijklmnopqrstuvwxyz'), 'Stripe-nyckel finns inte kvar')
assertTrue(!serialized.includes('whsec_abcdefghijklmnopqrstuvwxyz'), 'webhook-secret finns inte kvar')
assertTrue(!serialized.includes('+46701234567'), 'internationellt telefonnummer finns inte kvar')
assertTrue(!serialized.includes('0701234567'), 'svenskt mobilnummer finns inte kvar')
assertTrue(!serialized.includes('203.0.113.5'), 'IP-adress finns inte kvar')
assertTrue(scrubbed.request.data === undefined, 'request-kropp tas bort')
assertTrue(scrubbed.request.cookies === undefined, 'cookies tas bort')
assertTrue(serialized.includes('ok=1'), 'ofarlig query-param blir kvar')
assertTrue(serialized.includes('application/json'), 'content-type blir kvar')
assertTrue(serialized.includes('Sentry verification error from sds-ticketing-poc'), 'felmeddelandet blir kvar')
assertTrue(serialized.includes('src/lib/sentry.ts'), 'filnamn i stacken blir kvar')
assertTrue(scrubbed.user.id === 'user-1', 'icke-känsligt user-id blir kvar')
assertTrue(scrubbed.user.email === undefined, 'user.email tas bort')
assertTrue(scrubbed.tags.edge_function === 'create-order', 'edge function-tagg sätts från funktions-URL')

const browserEvent = scrubSentryEvent({
  tags: { runtime: 'browser' },
  request: { url: 'https://biljetter.example.se/?email=buyer@example.com#/kop/test-event' },
})
const browserSerialized = JSON.stringify(browserEvent)
assertTrue(!browserSerialized.includes('buyer@example.com'), 'e-post i sidans query skrubbas')
assertTrue(browserSerialized.includes('/kop/test-event'), 'hash-routen blir kvar')
assertTrue(browserEvent.tags.edge_function === undefined, 'webbläsarevent får ingen edge_function-tagg')

const span = scrubSentrySpan({
  name: 'GET /order-status?order_id=abc&email=buyer@example.com',
  attributes: {
    'http.url': 'https://proj.supabase.co/functions/v1/order-status?email=buyer@example.com&ok=1',
    'http.request.header.authorization': 'Bearer sk_test_abcdefghijklmnopqrstuvwxyz',
  },
})
const spanSerialized = JSON.stringify(span)
assertTrue(span.name === 'GET /order-status', 'query tas bort från span-namn')
assertTrue(!spanSerialized.includes('buyer@example.com'), 'e-post tas bort från span')
assertTrue(!spanSerialized.includes('sk_test_abcdefghijklmnopqrstuvwxyz'), 'nyckel tas bort från span-attribut')
assertTrue(spanSerialized.includes('ok=1'), 'ofarlig query blir kvar på span-URL')

const crumb = scrubBreadcrumb({
  category: 'fetch',
  message: 'POST buyer@example.com',
  data: { url: 'https://api.stripe.com/v1/checkout/sessions', body: { email: 'buyer@example.com' }, status_code: 200 },
})
const crumbSerialized = JSON.stringify(crumb)
assertTrue(crumb.data.body === undefined, 'breadcrumb-kropp tas bort')
assertTrue(!crumbSerialized.includes('buyer@example.com'), 'e-post i breadcrumb skrubbas')
assertTrue(crumbSerialized.includes('200'), 'statuskod i breadcrumb blir kvar')

if (failures > 0) {
  console.error(`${failures} test misslyckades`)
  process.exit(1)
}
console.log('alla skrubbtester gröna')
