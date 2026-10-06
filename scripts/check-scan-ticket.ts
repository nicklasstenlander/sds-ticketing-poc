// Kontroll av determineScanOutcome i supabase/functions/scan-ticket/index.ts
// (ordern "Före försäljning" 2026-10-05, 1.2 - inställt event; ordern
// "Skannern ska veta vilken föreställning den släpper in till"
// 2026-10-06, A1 - fel föreställning).
//
// Kör: deno run --allow-env scripts/check-scan-ticket.ts

import { determineScanOutcome } from '../supabase/functions/scan-ticket/determineScanOutcome.ts'

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}

const EVENT_A = 'aaaaaaaa-0000-0000-0000-000000000000'
const EVENT_B = 'bbbbbbbb-0000-0000-0000-000000000000'

// === Grundfallen utan event_id (gammal appversion - requestedEventId
// null) - oförändrat beteende, samma tre resultat som förut. ===

assertEqual(
  determineScanOutcome({
    ticketStatus: 'valid',
    eventStatus: 'published',
    ticketEventId: EVENT_A,
    requestedEventId: null,
    ticketEventTitle: 'Vinterföreställningen',
    ticketEventStartsAt: '2026-12-12T14:00:00Z',
  }),
  { result: 'ok', message: null },
  'Inget event_id (gammal app), giltig biljett -> ok, oförändrat',
)
assertEqual(
  determineScanOutcome({
    ticketStatus: 'checked_in',
    eventStatus: 'published',
    ticketEventId: EVENT_A,
    requestedEventId: null,
    ticketEventTitle: 'Vinterföreställningen',
    ticketEventStartsAt: '2026-12-12T14:00:00Z',
  }),
  { result: 'duplicate', message: null },
  'Inget event_id, redan incheckad -> duplicate, oförändrat',
)
assertEqual(
  determineScanOutcome({
    ticketStatus: 'void',
    eventStatus: 'published',
    ticketEventId: EVENT_A,
    requestedEventId: null,
    ticketEventTitle: 'Vinterföreställningen',
    ticketEventStartsAt: '2026-12-12T14:00:00Z',
  }),
  { result: 'invalid', message: null },
  'Inget event_id, annullerad biljett -> invalid (inget meddelande), oförändrat',
)

// === Rätt föreställning (event_id matchar biljettens eget event) -
// exakt som utan event_id. ===

assertEqual(
  determineScanOutcome({
    ticketStatus: 'valid',
    eventStatus: 'published',
    ticketEventId: EVENT_A,
    requestedEventId: EVENT_A,
    ticketEventTitle: 'Vinterföreställningen',
    ticketEventStartsAt: '2026-12-12T14:00:00Z',
  }),
  { result: 'ok', message: null },
  'event_id matchar biljettens event -> ok',
)

// === Fel föreställning - avvisas ALLTID med "invalid" + förklarande
// meddelande, oavsett biljettens egen status - avslöjar ALDRIG om
// biljetten redan är incheckad (måste visa samma sak oavsett
// ticketStatus, aldrig "duplicate"). ===

assertEqual(
  determineScanOutcome({
    ticketStatus: 'valid',
    eventStatus: 'published',
    ticketEventId: EVENT_B,
    requestedEventId: EVENT_A,
    ticketEventTitle: 'TEST skanner B',
    ticketEventStartsAt: '2026-12-12T14:00:00Z',
  }),
  { result: 'invalid', message: 'Biljetten gäller TEST skanner B, 12 dec kl. 15:00' },
  'Oanvänd biljett, FEL föreställning vald -> invalid + "Biljetten gäller ..."',
)
assertEqual(
  determineScanOutcome({
    ticketStatus: 'checked_in',
    eventStatus: 'published',
    ticketEventId: EVENT_B,
    requestedEventId: EVENT_A,
    ticketEventTitle: 'TEST skanner B',
    ticketEventStartsAt: '2026-12-12T14:00:00Z',
  }),
  { result: 'invalid', message: 'Biljetten gäller TEST skanner B, 12 dec kl. 15:00' },
  'REDAN INCHECKAD biljett (på sitt eget event), FEL föreställning vald -> invalid + samma meddelande, INTE "duplicate" (avslöjar inte att den redan är använd)',
)
assertEqual(
  determineScanOutcome({
    ticketStatus: 'void',
    eventStatus: 'published',
    ticketEventId: EVENT_B,
    requestedEventId: EVENT_A,
    ticketEventTitle: 'TEST skanner B',
    ticketEventStartsAt: '2026-12-12T14:00:00Z',
  }),
  { result: 'invalid', message: 'Biljetten gäller TEST skanner B, 12 dec kl. 15:00' },
  'Annullerad biljett, FEL föreställning vald -> samma "fel föreställning"-meddelande, inte tyst',
)
assertEqual(
  determineScanOutcome({
    ticketStatus: 'valid',
    eventStatus: 'published',
    ticketEventId: EVENT_B,
    requestedEventId: EVENT_A,
    ticketEventTitle: null,
    ticketEventStartsAt: null,
  }),
  { result: 'invalid', message: 'Biljetten gäller en annan föreställning' },
  'Fel föreställning, saknad titel/starttid -> rimlig reservtext istället för att krascha',
)

// === Kontrollordning (ordern A1): inställt event FÖRE fel föreställning
// - ett inställt event som också råkar vara "fel" ska visa "inställd",
// inte "gäller en annan föreställning". ===

assertEqual(
  determineScanOutcome({
    ticketStatus: 'valid',
    eventStatus: 'cancelled',
    ticketEventId: EVENT_B,
    requestedEventId: EVENT_A,
    ticketEventTitle: 'TEST skanner B',
    ticketEventStartsAt: '2026-12-12T14:00:00Z',
  }),
  { result: 'invalid', message: 'Föreställningen är inställd' },
  'Inställt OCH fel föreställning samtidigt -> "inställd" vinner (kontrollordningen i ordern)',
)

// === Eventets status null/okänt ska inte krascha och inte felaktigt
// avvisas som inställt. ===

assertEqual(
  determineScanOutcome({
    ticketStatus: 'valid',
    eventStatus: null,
    ticketEventId: EVENT_A,
    requestedEventId: EVENT_A,
    ticketEventTitle: 'Vinterföreställningen',
    ticketEventStartsAt: '2026-12-12T14:00:00Z',
  }),
  { result: 'ok', message: null },
  'Okänd eventstatus (null) behandlas INTE som inställt',
)

// === "result" är alltid en av exakt de tre värden appen redan känner
// till (IOS_HANDOFF.md) - aldrig ett nytt, okänt värde. ===

const ALL_KNOWN_RESULTS = ['ok', 'duplicate', 'invalid']
const combos: Parameters<typeof determineScanOutcome>[0][] = [
  { ticketStatus: 'valid', eventStatus: 'published', ticketEventId: EVENT_A, requestedEventId: null, ticketEventTitle: 't', ticketEventStartsAt: null },
  { ticketStatus: 'checked_in', eventStatus: 'published', ticketEventId: EVENT_A, requestedEventId: null, ticketEventTitle: 't', ticketEventStartsAt: null },
  { ticketStatus: 'void', eventStatus: 'published', ticketEventId: EVENT_A, requestedEventId: null, ticketEventTitle: 't', ticketEventStartsAt: null },
  { ticketStatus: 'valid', eventStatus: 'cancelled', ticketEventId: EVENT_A, requestedEventId: null, ticketEventTitle: 't', ticketEventStartsAt: null },
  { ticketStatus: 'valid', eventStatus: 'published', ticketEventId: EVENT_B, requestedEventId: EVENT_A, ticketEventTitle: 't', ticketEventStartsAt: null },
]
for (const c of combos) {
  const outcome = determineScanOutcome(c)
  assertEqual(
    ALL_KNOWN_RESULTS.includes(outcome.result),
    true,
    `result "${outcome.result}" (${JSON.stringify(c)}) är ett av de tre värden appen känner till`,
  )
}

// === event_id-formatvalidering (UUID_PATTERN i index.ts) - testas här
// direkt mot samma reguljära uttryck, eftersom valideringen sker på
// request-nivå i index.ts (ett tydligt 400-svar), inte i den rena
// beslutsfunktionen. ===

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
assertEqual(UUID_PATTERN.test(EVENT_A), true, 'Giltigt UUID-format accepteras')
assertEqual(UUID_PATTERN.test('inte-ett-uuid'), false, 'Ogiltigt format avvisas (-> 400 i index.ts)')
assertEqual(UUID_PATTERN.test(''), false, 'Tom sträng avvisas som format (index.ts behandlar dock tom sträng som "inget skickat", inte 400 - se || null)')

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
