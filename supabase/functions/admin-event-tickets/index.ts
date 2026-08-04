// admin-event-tickets
//
// Returnerar ett event samt dess biljetter (status, incheckningstid m.m.)
// för admin-detaljvyn. Kräver giltig admin-sessionstoken. event_id skickas
// som query-param: /admin-event-tickets?event_id=<uuid>
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { bearerTokenFrom, verifyAdminToken } from '../_shared/adminToken.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const adminPin = Deno.env.get('ADMIN_PIN')
  if (!adminPin) {
    return jsonResponse({ error: 'ADMIN_PIN är inte konfigurerad på servern.' }, 500)
  }

  const token = bearerTokenFrom(req)
  if (!(await verifyAdminToken(adminPin, token))) {
    return jsonResponse({ error: 'Ej behörig. Logga in i admin igen.' }, 401)
  }

  const url = new URL(req.url)
  const eventId = url.searchParams.get('event_id')
  if (!eventId) {
    return jsonResponse({ error: 'event_id krävs som query-param.' }, 400)
  }

  const supabase = createAdminClient()

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, slug, title, venue, starts_at, capacity, sold_count, status, created_at, price_ore, vat_rate')
    .eq('id', eventId)
    .maybeSingle()

  if (eventError) {
    return jsonResponse({ error: `Kunde inte hämta event: ${eventError.message}` }, 500)
  }
  if (!event) {
    return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
  }

  const { data: tickets, error: ticketsError } = await supabase
    .from('tickets')
    .select('id, order_id, ticket_code, holder_name, status, checked_in_at, checked_in_by')
    .eq('event_id', eventId)
    .order('checked_in_at', { ascending: true, nullsFirst: false })

  if (ticketsError) {
    return jsonResponse({ error: `Kunde inte hämta biljetter: ${ticketsError.message}` }, 500)
  }

  // Samma ISO 8601-format (UTC, inga fraktionella sekunder) som resten av
  // API:et - se _shared/time.ts.
  const formattedEvent = {
    ...event,
    starts_at: toIso8601Seconds(event.starts_at),
    created_at: toIso8601Seconds(event.created_at),
  }
  const formattedTickets = (tickets ?? []).map((t) => ({
    ...t,
    checked_in_at: toIso8601Seconds(t.checked_in_at),
  }))

  return jsonResponse({ event: formattedEvent, tickets: formattedTickets })
})
