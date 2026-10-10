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
// -> { events: { slug, title, venue, date, from_price_ore, free_ticket_names, poster_landscape_url, poster_portrait_url, organizer_name, sales_open_at, sales_state }[] }
//
// from_price_ore rättad och free_ticket_names tillagt (ordern
// "Förberedelse för CORE-appen" 2026-10-10, B) - se
// _shared/ticketPricing.ts.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'
import { computeSalesState } from '../_shared/salesState.ts'
import { computePricingSummary } from '../_shared/ticketPricing.ts'

interface PublicEvent {
  slug: string
  title: string
  venue: string | null
  date: string | null
  from_price_ore: number | null
  poster_landscape_url: string | null
  poster_portrait_url: string | null
  organizer_name: string | null
  // Schemalagt biljettsläpp (ordern 2026-10-03, 1.3) - additiva fält,
  // befintliga fält ovan ändras eller tas INTE bort (Squarespace-snutten
  // "Kommande evenemang" använder dem redan).
  sales_open_at: string | null
  sales_state: 'upcoming' | 'sold_out' | 'open'
  // free_ticket_names (ordern "Förberedelse för CORE-appen" 2026-10-10, B)
  // - namn på biljettyper med price_ore=0, tom lista om inga. from_price_ore
  // samtidigt RÄTTAD i samma order: räknar nu bara BETALDA typer (se
  // _shared/ticketPricing.ts filkommentar för bakgrunden/beviset).
  free_ticket_names: string[]
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
    // capacity/sold_count/sales_open_at hämtas bara för att BERÄKNA
    // sales_state internt - capacity/sold_count exponeras aldrig i svaret
    // (se filkommentaren), bara det färdiga tillståndet.
    .select(
      'id, slug, title, venue, starts_at, status, poster_landscape_url, poster_portrait_url, organizers(name), sales_open_at, capacity, sold_count',
    )
    .eq('status', 'published')
    .order('starts_at', { ascending: true })

  if (eventsError) {
    return jsonResponse({ error: `Kunde inte hämta events: ${eventsError.message}` }, 500)
  }

  const publishedEvents = events ?? []
  const eventIds = publishedEvents.map((e) => e.id)

  // Biljettyper per event (pris + namn, för from_price_ore/
  // free_ticket_names - se _shared/ticketPricing.ts) - bara för visning,
  // ingen köplogik här.
  const ticketTypesByEventId = new Map<string, { price_ore: number; name: string }[]>()
  if (eventIds.length > 0) {
    const { data: ticketTypes, error: ticketTypesError } = await supabase
      .from('ticket_types')
      .select('event_id, price_ore, name')
      .in('event_id', eventIds)

    if (ticketTypesError) {
      return jsonResponse({ error: `Kunde inte hämta biljettyper: ${ticketTypesError.message}` }, 500)
    }

    for (const tt of ticketTypes ?? []) {
      const list = ticketTypesByEventId.get(tt.event_id) ?? []
      list.push({ price_ore: tt.price_ore, name: tt.name })
      ticketTypesByEventId.set(tt.event_id, list)
    }
  }

  const now = new Date()
  const result: PublicEvent[] = publishedEvents.map((ev) => {
    const organizer = Array.isArray(ev.organizers) ? ev.organizers[0] : ev.organizers
    const pricing = computePricingSummary(ticketTypesByEventId.get(ev.id) ?? [])
    return {
      slug: ev.slug,
      title: ev.title,
      venue: ev.venue,
      date: toIso8601Seconds(ev.starts_at),
      from_price_ore: pricing.from_price_ore,
      free_ticket_names: pricing.free_ticket_names,
      poster_landscape_url: ev.poster_landscape_url,
      poster_portrait_url: ev.poster_portrait_url,
      organizer_name: organizer?.name ?? null,
      sales_open_at: toIso8601Seconds(ev.sales_open_at),
      sales_state: computeSalesState({
        salesOpenAt: ev.sales_open_at,
        soldCount: ev.sold_count,
        capacity: ev.capacity,
        now,
      }),
    }
  })

  return jsonResponse({ events: result }, 200)
})
