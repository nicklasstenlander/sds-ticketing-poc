// Kontroll av determineScanOutcome i supabase/functions/scan-ticket/index.ts
// (ordern "Före försäljning" 2026-10-05, 1.2 - inställt event ska avvisa
// skanningen, "fel event" lämnat orört eftersom appen inte skickar
// event_id, se filkommentaren i scan-ticket/index.ts).
//
// Kör: deno run --allow-env scripts/check-scan-ticket.ts

import { determineScanOutcome } from '../supabase/functions/scan-ticket/determineScanOutcome.ts'

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}

// === Grundfallen (oförändrat beteende, samma tre resultat som förut) ===

assertEqual(
  determineScanOutcome({ ticketStatus: 'valid', eventStatus: 'published' }),
  { result: 'ok', message: null },
  'Giltig biljett, publicerat event -> ok',
)
assertEqual(
  determineScanOutcome({ ticketStatus: 'checked_in', eventStatus: 'published' }),
  { result: 'duplicate', message: null },
  'Redan incheckad, publicerat event -> duplicate',
)
assertEqual(
  determineScanOutcome({ ticketStatus: 'void', eventStatus: 'published' }),
  { result: 'invalid', message: null },
  'Annullerad biljett, publicerat event -> invalid (inget meddelande)',
)

// === Inställt event - avvisar ALLTID, oavsett biljettens egen status ===

assertEqual(
  determineScanOutcome({ ticketStatus: 'valid', eventStatus: 'cancelled' }),
  { result: 'invalid', message: 'Föreställningen är inställd' },
  'Oanvänd, annars giltig biljett till INSTÄLLT event -> invalid + meddelande',
)
assertEqual(
  determineScanOutcome({ ticketStatus: 'checked_in', eventStatus: 'cancelled' }),
  { result: 'invalid', message: 'Föreställningen är inställd' },
  'Redan incheckad biljett till INSTÄLLT event -> invalid + meddelande (inte duplicate)',
)
assertEqual(
  determineScanOutcome({ ticketStatus: 'void', eventStatus: 'cancelled' }),
  { result: 'invalid', message: 'Föreställningen är inställd' },
  'Annullerad biljett till INSTÄLLT event -> invalid + meddelande',
)

// === Eventets status null/okänt (t.ex. om events-raden av någon
// anledning saknas) ska inte krascha och inte felaktigt avvisas som
// inställt - bara eventStatus === 'cancelled' ska trigga meddelandet. ===

assertEqual(
  determineScanOutcome({ ticketStatus: 'valid', eventStatus: null }),
  { result: 'ok', message: null },
  'Okänd eventstatus (null) behandlas INTE som inställt',
)
assertEqual(
  determineScanOutcome({ ticketStatus: 'valid', eventStatus: 'draft' }),
  { result: 'ok', message: null },
  'Utkast-event (inte cancelled) påverkar inte resultatet',
)

// === "result" är alltid en av exakt de tre värden appen redan känner
// till (IOS_HANDOFF.md) - aldrig ett nytt, okänt värde. ===

const ALL_KNOWN_RESULTS = ['ok', 'duplicate', 'invalid']
const combos: { ticketStatus: 'valid' | 'checked_in' | 'void'; eventStatus: string | null }[] = [
  { ticketStatus: 'valid', eventStatus: 'published' },
  { ticketStatus: 'checked_in', eventStatus: 'published' },
  { ticketStatus: 'void', eventStatus: 'published' },
  { ticketStatus: 'valid', eventStatus: 'cancelled' },
  { ticketStatus: 'checked_in', eventStatus: 'cancelled' },
  { ticketStatus: 'void', eventStatus: 'cancelled' },
]
for (const c of combos) {
  const outcome = determineScanOutcome(c)
  assertEqual(
    ALL_KNOWN_RESULTS.includes(outcome.result),
    true,
    `result "${outcome.result}" (${JSON.stringify(c)}) är ett av de tre värden appen känner till`,
  )
}

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
