// admin-event-tickets
//
// Returnerar ett event, dess biljettyper och dess biljetter (status,
// incheckningstid m.m.) för admin-detaljvyn. Kräver giltig Supabase
// Auth-JWT (se _shared/organizerAuth.ts), och eventet måste tillhöra den
// inloggade användarens egen arrangör (Tilläggsordern 2026-08-05) - samma
// 404-för-annan-arrangörs-event-mönster som admin-update-event.
// event_id skickas som query-param: /admin-event-tickets?event_id=<uuid>
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const auth = await resolveOrganizer(req)
  if (!auth) {
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
    .select('id, slug, title, venue, starts_at, status, created_at, capacity, sold_count, poster_landscape_url, poster_portrait_url, organizer_id')
    .eq('id', eventId)
    .maybeSingle()

  if (eventError) {
    return jsonResponse({ error: `Kunde inte hämta event: ${eventError.message}` }, 500)
  }
  if (!event || event.organizer_id !== auth.organizerId) {
    return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
  }

  const { data: ticketTypes, error: ticketTypesError } = await supabase
    .from('ticket_types')
    .select('id, event_id, name, price_ore, vat_rate, sold_count, sort_order, created_at')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true })

  if (ticketTypesError) {
    return jsonResponse({ error: `Kunde inte hämta biljettyper: ${ticketTypesError.message}` }, 500)
  }

  const { data: tickets, error: ticketsError } = await supabase
    .from('tickets')
    .select('id, order_id, ticket_type_id, ticket_code, holder_name, status, checked_in_at, checked_in_by')
    .eq('event_id', eventId)
    .order('checked_in_at', { ascending: true, nullsFirst: false })

  if (ticketsError) {
    return jsonResponse({ error: `Kunde inte hämta biljetter: ${ticketsError.message}` }, 500)
  }

  const { organizer_id: _organizerId, ...eventWithoutOrganizerId } = event
  const formattedEvent = {
    ...eventWithoutOrganizerId,
    starts_at: toIso8601Seconds(event.starts_at),
    created_at: toIso8601Seconds(event.created_at),
  }
  const formattedTicketTypes = (ticketTypes ?? []).map((t) => ({
    ...t,
    created_at: toIso8601Seconds(t.created_at),
  }))
  const formattedTickets = (tickets ?? []).map((t) => ({
    ...t,
    checked_in_at: toIso8601Seconds(t.checked_in_at),
  }))

  return jsonResponse({ event: formattedEvent, ticket_types: formattedTicketTypes, tickets: formattedTickets })
})
