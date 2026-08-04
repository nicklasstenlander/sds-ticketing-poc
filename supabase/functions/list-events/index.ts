// list-events
//
// Anropas av den framtida iOS-scanner-appen. Returnerar publicerade events
// (id, titel, datum, antal sålda biljetter) så appen kan visa en lista att
// välja event att scanna mot. Autentiseras med en statisk bearer-token
// (Supabase secret SCANNER_BEARER_TOKEN) - samma token som scan-ticket.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { bearerTokenFrom, timingSafeEqual } from '../_shared/adminToken.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const scannerToken = Deno.env.get('SCANNER_BEARER_TOKEN')
  if (!scannerToken) {
    return jsonResponse({ error: 'SCANNER_BEARER_TOKEN är inte konfigurerad på servern.' }, 500)
  }

  const token = bearerTokenFrom(req)
  if (!token || !timingSafeEqual(token, scannerToken)) {
    return jsonResponse({ error: 'Ej behörig.' }, 401)
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('events')
    .select('id, title, venue, starts_at, capacity, sold_count')
    .eq('status', 'published')
    .order('starts_at', { ascending: true })

  if (error) {
    return jsonResponse({ error: `Kunde inte hämta events: ${error.message}` }, 500)
  }

  const publishedEvents = data ?? []

  // checked_in_count är obligatoriskt i svaret: med två entréer igång kan
  // appen inte räkna incheckningar lokalt (varje enhet ser bara sina egna
  // scanningar), så servern måste räkna det. Ett samlat anrop mot tickets
  // (istället för en fråga per event) håller detta till en enda extra
  // databasrundtur oavsett hur många publicerade events det finns.
  const eventIds = publishedEvents.map((e) => e.id)
  const checkedInCounts = new Map<string, number>()

  if (eventIds.length > 0) {
    const { data: checkedInTickets, error: countError } = await supabase
      .from('tickets')
      .select('event_id')
      .eq('status', 'checked_in')
      .in('event_id', eventIds)

    if (countError) {
      return jsonResponse(
        { error: `Kunde inte räkna incheckningar: ${countError.message}` },
        500,
      )
    }

    for (const row of checkedInTickets ?? []) {
      checkedInCounts.set(row.event_id, (checkedInCounts.get(row.event_id) ?? 0) + 1)
    }
  }

  const events = publishedEvents.map((e) => ({
    id: e.id,
    title: e.title,
    venue: e.venue,
    date: toIso8601Seconds(e.starts_at),
    capacity: e.capacity,
    sold_count: e.sold_count,
    checked_in_count: checkedInCounts.get(e.id) ?? 0,
  }))

  return jsonResponse({ events })
})
