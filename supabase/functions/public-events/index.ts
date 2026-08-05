// public-events
//
// Tokenfri, publik endpoint avsedd att anropas direkt från en Squarespace
// Code Block (klientsidig JS på en publik webbsida) - INGEN Authorization-
// header krävs eller kontrolleras här, till skillnad från list-events
// (som kräver SCANNER_BEARER_TOKEN, rätt för iOS-appen men fel att lägga i
// klartext i sidkod som vem som helst kan läsa).
//
// Läcker ingen ny data: events/ticket_types SELECT-policyerna tillåter
// redan anon att läsa exakt detta (status='published') direkt via
// PostgREST. Den här funktionen är bara en bekvämare, MER BEGRÄNSAD form
// av samma publika data - service role används internt (samma mönster
// som övriga funktioner) men svaret exponerar avsiktligt minimalt:
// ingen sold_count/capacity/checked_in_count eller interna ID:n utöver
// slug (som redan är tänkt att vara publik, den utgör själva köp-URL:en).
//
// GET public-events (inga query-params, inga headers)
// -> { events: { slug, title, venue, date, from_price_ore, poster_landscape_url, poster_portrait_url }[] }
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'

interface PublicEvent {
  slug: string
  title: string
  venue: string | null
  date: string | null
  from_price_ore: number | null
  poster_landscape_url: string | null
  poster_portrait_url: string | null
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const supabase = createAdminClient()

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, slug, title, venue, starts_at, status, poster_landscape_url, poster_portrait_url')
    .eq('status', 'published')
    .order('starts_at', { ascending: true })

  if (eventsError) {
    return jsonResponse({ error: `Kunde inte hämta events: ${eventsError.message}` }, 500)
  }

  const publishedEvents = events ?? []
  const eventIds = publishedEvents.map((e) => e.id)

  // Lägsta pris per event bland dess biljettyper (eller enda priset om
  // bara en typ finns) - bara för visning, ingen köplogik här.
  const minPriceByEventId = new Map<string, number>()
  if (eventIds.length > 0) {
    const { data: ticketTypes, error: ticketTypesError } = await supabase
      .from('ticket_types')
      .select('event_id, price_ore')
      .in('event_id', eventIds)

    if (ticketTypesError) {
      return jsonResponse({ error: `Kunde inte hämta biljettyper: ${ticketTypesError.message}` }, 500)
    }

    for (const tt of ticketTypes ?? []) {
      const current = minPriceByEventId.get(tt.event_id)
      if (current === undefined || tt.price_ore < current) {
        minPriceByEventId.set(tt.event_id, tt.price_ore)
      }
    }
  }

  const result: PublicEvent[] = publishedEvents.map((ev) => ({
    slug: ev.slug,
    title: ev.title,
    venue: ev.venue,
    date: toIso8601Seconds(ev.starts_at),
    from_price_ore: minPriceByEventId.get(ev.id) ?? null,
    poster_landscape_url: ev.poster_landscape_url,
    poster_portrait_url: ev.poster_portrait_url,
  }))

  return jsonResponse({ events: result }, 200)
})
