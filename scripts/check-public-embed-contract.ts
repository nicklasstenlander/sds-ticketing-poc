// Kontraktstest för public-embed (ordern "Förberedelse för CORE-appen"
// 2026-10-10, avsnitt 3). Samma stil som scripts/check-scan-ticket.ts -
// validerar docs/public-embed.example.json mot EXAKT den nyckeluppsättning
// och de typer docs/PUBLIC_EMBED_API.md dokumenterar, plus negativa
// kontroller som bevisar att valideraren faktiskt upptäcker avvikelser.
//
// Kör: deno run --allow-env --allow-read scripts/check-public-embed-contract.ts

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}

const EVENT_KEYS = [
  'slug',
  'title',
  'organizer_name',
  'starts_at',
  'venue',
  'from_price_ore',
  'free_ticket_names',
  'poster_landscape_url',
  'poster_portrait_url',
  'purchase_url',
  'sales_open_at',
  'sales_state',
]

function validateEvent(value: unknown): string[] {
  const errors: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['eventet är inte ett objekt']
  }
  const obj = value as Record<string, unknown>

  const actualKeys = Object.keys(obj).sort()
  const expectedKeys = [...EVENT_KEYS].sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    errors.push(`fel nycklar: fick [${actualKeys.join(', ')}], väntade exakt [${expectedKeys.join(', ')}]`)
  }

  if (typeof obj.slug !== 'string' || obj.slug.length === 0) errors.push('slug måste vara en icke-tom text')
  if (typeof obj.title !== 'string' || obj.title.length === 0) errors.push('title måste vara en icke-tom text')
  if (typeof obj.purchase_url !== 'string' || !obj.purchase_url.startsWith('https://')) {
    errors.push('purchase_url måste vara en absolut https-text')
  }
  if (obj.starts_at !== null && typeof obj.starts_at !== 'string') errors.push('starts_at måste vara text eller null')

  for (const key of ['organizer_name', 'venue', 'poster_landscape_url', 'poster_portrait_url', 'sales_open_at']) {
    const v = obj[key]
    if (v !== null && typeof v !== 'string') errors.push(`${key} måste vara text eller null`)
  }

  if (obj.from_price_ore !== null && typeof obj.from_price_ore !== 'number') {
    errors.push('from_price_ore måste vara ett heltal eller null')
  }
  if (typeof obj.from_price_ore === 'number' && obj.from_price_ore <= 0) {
    errors.push('from_price_ore måste vara > 0 när den inte är null (0 kr-typer räknas som gratis, inte betalda)')
  }

  if (!Array.isArray(obj.free_ticket_names)) {
    errors.push('free_ticket_names måste vara en lista')
  } else if (obj.free_ticket_names.some((n) => typeof n !== 'string')) {
    errors.push('free_ticket_names måste bara innehålla text')
  }

  if (!['upcoming', 'open', 'sold_out'].includes(obj.sales_state as string)) {
    errors.push(`sales_state måste vara "upcoming"/"open"/"sold_out", fick ${JSON.stringify(obj.sales_state)}`)
  }

  // poster-URL:er måste (när satta) peka på projektets betrodda Storage-
  // prefix - servern ska aldrig returnera en annan URL (se
  // _shared/posterUrl.ts).
  const TRUSTED_PREFIX = 'https://oyqgxnmwojjjpoubdlfa.supabase.co/storage/v1/object/public/'
  for (const key of ['poster_landscape_url', 'poster_portrait_url']) {
    const v = obj[key]
    if (typeof v === 'string' && !v.startsWith(TRUSTED_PREFIX)) {
      errors.push(`${key} pekar inte på projektets betrodda Storage-prefix: ${v}`)
    }
  }

  return errors
}

function validateResponse(value: unknown): string[] {
  const errors: string[] = []
  if (typeof value !== 'object' || value === null) return ['svaret är inte ett objekt']
  const obj = value as Record<string, unknown>

  const actualKeys = Object.keys(obj).sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(['events', 'server_time'])) {
    errors.push(`toppnivå har fel nycklar: fick [${actualKeys.join(', ')}], väntade exakt [events, server_time]`)
  }
  if (typeof obj.server_time !== 'string') errors.push('server_time måste vara text (ISO 8601)')
  if (!Array.isArray(obj.events)) {
    errors.push('events måste vara en lista')
  } else {
    obj.events.forEach((ev, i) => {
      for (const err of validateEvent(ev)) errors.push(`events[${i}]: ${err}`)
    })
  }
  return errors
}

const exampleFileUrl = new URL('../docs/public-embed.example.json', import.meta.url)
const example = JSON.parse(await Deno.readTextFile(exampleFileUrl))

const responseErrors = validateResponse(example)
assertEqual(responseErrors, [], 'docs/public-embed.example.json har exakt rätt toppnivå-nycklar och alla event-objekt är giltiga')

assertEqual(Array.isArray(example.events) && example.events.length >= 5, true, 'Exempelfilen innehåller minst 5 event (verklig + syntetiska)')

const states = new Set((example.events as { sales_state: string }[]).map((e) => e.sales_state))
assertEqual(states.has('upcoming'), true, 'Exempelfilen täcker sales_state="upcoming"')
assertEqual(states.has('open'), true, 'Exempelfilen täcker sales_state="open"')
assertEqual(states.has('sold_out'), true, 'Exempelfilen täcker sales_state="sold_out"')

const hasNullPosters = (example.events as Record<string, unknown>[]).some(
  (e) => e.poster_landscape_url === null && e.poster_portrait_url === null,
)
assertEqual(hasNullPosters, true, 'Exempelfilen täcker båda affischerna null')

const hasNullVenue = (example.events as Record<string, unknown>[]).some((e) => e.venue === null)
assertEqual(hasNullVenue, true, 'Exempelfilen täcker venue: null')

const hasNullFromPrice = (example.events as Record<string, unknown>[]).some((e) => e.from_price_ore === null)
assertEqual(hasNullFromPrice, true, 'Exempelfilen täcker from_price_ore: null')

const hasEmptyFreeNames = (example.events as { free_ticket_names: unknown[] }[]).some(
  (e) => Array.isArray(e.free_ticket_names) && e.free_ticket_names.length === 0,
)
assertEqual(hasEmptyFreeNames, true, 'Exempelfilen täcker en tom free_ticket_names')

const testSlapp = (example.events as { slug: string; from_price_ore: number | null; free_ticket_names: string[] }[]).find(
  (e) => e.slug === 'test-slapp',
)
assertEqual(testSlapp?.from_price_ore, 300, 'test-slapp: from_price_ore är 300 (Billig, den billigaste BETALDA typen) - INTE 0 (Barn, gratis)')
assertEqual(testSlapp?.free_ticket_names, ['Barn'], 'test-slapp: free_ticket_names listar gratistypen separat')

// === Negativa kontroller - bevisar att valideraren faktiskt upptäcker fel ===

assertEqual(
  validateEvent({ ...(example.events[0] as object), extra_field: 'ska inte få finnas' }).length > 0,
  true,
  'En extra, odokumenterad nyckel på ett event upptäcks',
)
assertEqual(
  validateEvent({ ...(example.events[0] as object), from_price_ore: 0 }).length > 0,
  true,
  'from_price_ore=0 (borde vara null - 0 kr-typer är gratis, inte "betalda för 0 kr") upptäcks',
)
assertEqual(
  validateEvent({ ...(example.events[0] as object), sales_state: 'closed' }).length > 0,
  true,
  'sales_state="closed" (finns inte i kontraktet, se PUBLIC_EMBED_API.md) upptäcks',
)
assertEqual(
  validateEvent({ ...(example.events[0] as object), poster_landscape_url: 'https://evil.example.com/x.jpg' }).length > 0,
  true,
  'En affisch-URL utanför projektets betrodda Storage-prefix upptäcks',
)
assertEqual(
  validateEvent({ ...(example.events[0] as object), free_ticket_names: [1, 2] }).length > 0,
  true,
  'free_ticket_names med icke-text-element upptäcks',
)

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
