// Kontroll av determineScanOutcome/buildTicketTypeInfo i
// supabase/functions/scan-ticket/determineScanOutcome.ts (ordern "Före
// försäljning" 2026-10-05, 1.2 - inställt event; ordern "Skannern ska
// veta vilken föreställning den släpper in till" 2026-10-06, A1 - fel
// föreställning; ordern "Skannern ska visa vilken typ av biljett som
// skannas" 2026-10-07, A2 - biljettyp/gratis-flagga/köpsammansättning,
// och validateScanResponseShape/docs/scan-response.example.json).
//
// Kör: deno run --allow-env --allow-read scripts/check-scan-ticket.ts

import { buildTicketTypeInfo, determineScanOutcome, type OrderItemForScan } from '../supabase/functions/scan-ticket/determineScanOutcome.ts'

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
  { result: 'ok', message: null, showTicketType: true },
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
  { result: 'duplicate', message: null, showTicketType: true },
  'Inget event_id, redan incheckad -> duplicate, oförändrat (showTicketType=true, ordern A2 kräver synlig typ även vid "redan incheckad")',
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
  { result: 'invalid', message: null, showTicketType: true },
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
  { result: 'ok', message: null, showTicketType: true },
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
  { result: 'invalid', message: 'Biljetten gäller TEST skanner B, 12 dec kl. 15:00', showTicketType: false },
  'Oanvänd biljett, FEL föreställning vald -> invalid + "Biljetten gäller ...", showTicketType=false (ordern A2 - typen döljs vid fel föreställning)',
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
  { result: 'invalid', message: 'Biljetten gäller TEST skanner B, 12 dec kl. 15:00', showTicketType: false },
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
  { result: 'invalid', message: 'Biljetten gäller TEST skanner B, 12 dec kl. 15:00', showTicketType: false },
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
  { result: 'invalid', message: 'Biljetten gäller en annan föreställning', showTicketType: false },
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
  { result: 'invalid', message: 'Föreställningen är inställd', showTicketType: false },
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
  { result: 'ok', message: null, showTicketType: true },
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

// === buildTicketTypeInfo (ordern "Skannern ska visa vilken typ av
// biljett som skannas" 2026-10-07, A2) - ren beräkning, testbar utan en
// riktig order_items-fråga. Täcker ordertextens egen lista: biljett med
// typ, med gratistyp, utan typ (null), rabatterad vuxenbiljett (inte
// gratis), redan incheckad med typ, och att inga personuppgifter finns
// i svaret. ===

const TYPE_ADULT = 'cccccccc-0000-0000-0000-000000000000'
const TYPE_CHILD = 'dddddddd-0000-0000-0000-000000000000'

const MIXED_ORDER: OrderItemForScan[] = [
  { ticket_type_id: TYPE_ADULT, qty: 1, listPriceOre: 15000, typeName: 'Vuxen' },
  { ticket_type_id: TYPE_CHILD, qty: 1, listPriceOre: 0, typeName: 'Barn 0–3 år' },
]

assertEqual(
  buildTicketTypeInfo({ showTicketType: true, ownTicketTypeId: TYPE_ADULT, orderItems: MIXED_ORDER }),
  {
    ticket_type: 'Vuxen',
    ticket_is_free: false,
    order_summary: [
      { name: 'Vuxen', qty: 1 },
      { name: 'Barn 0–3 år', qty: 1 },
    ],
  },
  'Biljett med typ (Vuxen, betald) -> ticket_type satt, ticket_is_free=false, order_summary med båda raderna',
)

assertEqual(
  buildTicketTypeInfo({ showTicketType: true, ownTicketTypeId: TYPE_CHILD, orderItems: MIXED_ORDER }),
  {
    ticket_type: 'Barn 0–3 år',
    ticket_is_free: true,
    order_summary: [
      { name: 'Vuxen', qty: 1 },
      { name: 'Barn 0–3 år', qty: 1 },
    ],
  },
  'Biljett med gratistyp (Barn 0–3 år, listpris 0) -> ticket_is_free=true',
)

assertEqual(
  buildTicketTypeInfo({ showTicketType: true, ownTicketTypeId: null, orderItems: MIXED_ORDER }),
  {
    ticket_type: null,
    ticket_is_free: null,
    order_summary: [
      { name: 'Vuxen', qty: 1 },
      { name: 'Barn 0–3 år', qty: 1 },
    ],
  },
  'Biljett UTAN typ (ticket_type_id null, t.ex. en gammal testbiljett) -> ticket_type/ticket_is_free=null, men order_summary ändå med (köpets sammansättning är oberoende av just den raden)',
)

const DISCOUNTED_ADULT_ORDER: OrderItemForScan[] = [
  // Samma Vuxen-rad, men en 100%-rabattkod har nollat det DEBITERADE
  // priset (unit_price_ore) - listPriceOre (radens pris FÖRE koden,
  // order_items.list_price_ore) är fortfarande 15000, så raden ska INTE
  // räknas som en gratis biljettyp. Det är precis denna distinktion
  // list_price_ore (migrationen 20261007000100) finns till för -
  // unit_price_ore hade felaktigt gett ticket_is_free=true här.
  { ticket_type_id: TYPE_ADULT, qty: 1, listPriceOre: 15000, typeName: 'Vuxen' },
]
assertEqual(
  buildTicketTypeInfo({ showTicketType: true, ownTicketTypeId: TYPE_ADULT, orderItems: DISCOUNTED_ADULT_ORDER }),
  {
    ticket_type: 'Vuxen',
    ticket_is_free: false,
    order_summary: [{ name: 'Vuxen', qty: 1 }],
  },
  'RABATTERAD vuxenbiljett (100%-kod gav unit_price_ore=0, men listPriceOre=15000) -> ticket_is_free=false, INTE gratis (ordertextens egna ord: "är alltså inte gratis i det här läget")',
)

const PRE_MIGRATION_ORDER: OrderItemForScan[] = [
  // Ett köp gjort INNAN migrationen 20261007000100 (ingen backfill av
  // befintliga rader, se migrationsfilen) - list_price_ore är null i
  // databasen för den här raden, inte 0. null!==0, så "null===0" hade
  // gett false (fel) om koden inte uttryckligen testar för null.
  { ticket_type_id: TYPE_ADULT, qty: 1, listPriceOre: null, typeName: 'Vuxen' },
]
assertEqual(
  buildTicketTypeInfo({ showTicketType: true, ownTicketTypeId: TYPE_ADULT, orderItems: PRE_MIGRATION_ORDER }),
  {
    ticket_type: 'Vuxen',
    ticket_is_free: null,
    order_summary: [{ name: 'Vuxen', qty: 1 }],
  },
  'Köp gjort FÖRE migrationen 20261007000100 (list_price_ore=null i databasen, ingen backfill) -> ticket_is_free=null ("okänt"), INTE false - null är inte samma sak som "inte gratis"',
)

assertEqual(
  buildTicketTypeInfo({ showTicketType: true, ownTicketTypeId: TYPE_ADULT, orderItems: MIXED_ORDER }),
  buildTicketTypeInfo({ showTicketType: true, ownTicketTypeId: TYPE_ADULT, orderItems: MIXED_ORDER }),
  'REDAN INCHECKAD biljett med typ - buildTicketTypeInfo bryr sig inte om ticketStatus/result alls (showTicketType=true täcker både "ok" och "duplicate", se determineScanOutcome), samma typinfo oavsett',
)

assertEqual(
  buildTicketTypeInfo({ showTicketType: false, ownTicketTypeId: TYPE_ADULT, orderItems: MIXED_ORDER }),
  { ticket_type: null, ticket_is_free: null, order_summary: null },
  'showTicketType=false (fel föreställning/inställt) -> alla tre null, oavsett att order_items faktiskt finns',
)

const SEVEN_ROW_ORDER: OrderItemForScan[] = Array.from({ length: 7 }, (_, i) => ({
  ticket_type_id: `type-${i}`,
  qty: 1,
  listPriceOre: 10000,
  typeName: `Typ ${i + 1}`,
}))
assertEqual(
  buildTicketTypeInfo({ showTicketType: true, ownTicketTypeId: 'type-0', orderItems: SEVEN_ROW_ORDER }).order_summary?.length,
  6,
  'order_summary begränsas till högst 6 rader (ordertexten) även om kundvagnen har fler typer',
)

// Inga personuppgifter i svaret - buildTicketTypeInfo har bara tillgång
// till ticket_type_id/qty/listPriceOre/typeName, aldrig holder_name/
// buyer_name/buyer_email, så det här är egentligen en typkontroll: ett
// fält som "email" eller "holder_name" får inte förekomma i NÅGON nyckel
// i returvärdet, oavsett indata.
const infoWithPossiblePII = buildTicketTypeInfo({ showTicketType: true, ownTicketTypeId: TYPE_ADULT, orderItems: MIXED_ORDER })
const infoKeys = JSON.stringify(infoWithPossiblePII)
assertEqual(
  /holder_name|buyer_name|buyer_email|email/i.test(infoKeys),
  false,
  'Inga personuppgifter (holder_name/buyer_name/buyer_email) förekommer någonstans i buildTicketTypeInfo-svaret',
)

// === validateScanResponseShape + docs/scan-response.example.json ===
//
// Validerar att ett scan-ticket-svar har EXAKT de nycklar och typer
// IOS_HANDOFF.md dokumenterar - inga fler, inga färre. Körs mot de fyra
// exempelsvaren i docs/scan-response.example.json (som appens egen
// avkodningstest också kan återanvända som fixtur), plus några
// medvetet trasiga svar för att bevisa att valideraren faktiskt
// upptäcker avvikelser och inte bara råkar släppa igenom allt.

function validateScanResponseShape(value: unknown): string[] {
  const errors: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['svaret är inte ett objekt']
  }
  const obj = value as Record<string, unknown>

  const expectedKeys = [
    'result',
    'holder_name',
    'event_title',
    'ticket_type',
    'ticket_is_free',
    'order_summary',
    'checked_in_at',
    'message',
  ]
  const actualKeys = Object.keys(obj).sort()
  const expectedSorted = [...expectedKeys].sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedSorted)) {
    errors.push(`fel nycklar: fick [${actualKeys.join(', ')}], väntade exakt [${expectedSorted.join(', ')}]`)
  }

  if (!['ok', 'duplicate', 'invalid'].includes(obj.result as string)) {
    errors.push(`result måste vara "ok"/"duplicate"/"invalid", fick ${JSON.stringify(obj.result)}`)
  }

  for (const key of ['holder_name', 'event_title', 'ticket_type', 'checked_in_at', 'message']) {
    const v = obj[key]
    if (v !== null && typeof v !== 'string') errors.push(`${key} måste vara text eller null, fick ${JSON.stringify(v)}`)
  }

  if (obj.ticket_is_free !== null && typeof obj.ticket_is_free !== 'boolean') {
    errors.push(`ticket_is_free måste vara sant/falskt eller null, fick ${JSON.stringify(obj.ticket_is_free)}`)
  }

  if (obj.order_summary !== null) {
    if (!Array.isArray(obj.order_summary)) {
      errors.push(`order_summary måste vara en lista eller null, fick ${JSON.stringify(obj.order_summary)}`)
    } else {
      if (obj.order_summary.length > 6) errors.push(`order_summary har ${obj.order_summary.length} rader, högst 6 tillåtna`)
      obj.order_summary.forEach((row: unknown, i: number) => {
        if (typeof row !== 'object' || row === null || Array.isArray(row)) {
          errors.push(`order_summary[${i}] är inte ett objekt`)
          return
        }
        const r = row as Record<string, unknown>
        const rowKeys = Object.keys(r).sort()
        if (JSON.stringify(rowKeys) !== JSON.stringify(['name', 'qty'])) {
          errors.push(`order_summary[${i}] har fel nycklar: [${rowKeys.join(', ')}], väntade exakt [name, qty]`)
        }
        if (typeof r.name !== 'string') errors.push(`order_summary[${i}].name måste vara text`)
        if (typeof r.qty !== 'number' || !Number.isInteger(r.qty)) errors.push(`order_summary[${i}].qty måste vara ett heltal`)
      })
    }
  }

  return errors
}

const exampleFileUrl = new URL('../docs/scan-response.example.json', import.meta.url)
const examples = JSON.parse(await Deno.readTextFile(exampleFileUrl)) as Record<string, unknown>

for (const [name, example] of Object.entries(examples)) {
  if (name === '_description') continue // ren dokumentation, inget svarsobjekt
  const errors = validateScanResponseShape(example)
  assertEqual(errors, [], `docs/scan-response.example.json: "${name}" har exakt rätt nycklar och typer`)
}

// Negativa kontroller - bevisar att valideraren faktiskt upptäcker fel,
// inte bara råkar returnera [] alltid.
assertEqual(
  validateScanResponseShape({ ...(examples.normal_ticket as object), extra_field: 'ska inte få finnas' }).length > 0,
  true,
  'En extra, odokumenterad nyckel i svaret upptäcks',
)
assertEqual(
  validateScanResponseShape({ ...(examples.normal_ticket as object), ticket_is_free: 'ja' }).length > 0,
  true,
  'ticket_is_free som sträng istället för boolean/null upptäcks',
)
assertEqual(
  validateScanResponseShape({
    ...(examples.normal_ticket as object),
    order_summary: Array.from({ length: 7 }, () => ({ name: 'Vuxen', qty: 1 })),
  }).length > 0,
  true,
  'order_summary med fler än 6 rader upptäcks',
)
assertEqual(
  validateScanResponseShape({
    ...(examples.normal_ticket as object),
    order_summary: [{ name: 'Vuxen', qty: 1, email: 'inte@tillåtet.se' }],
  }).length > 0,
  true,
  'En extra nyckel (t.ex. en personuppgift) i en order_summary-rad upptäcks',
)

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
