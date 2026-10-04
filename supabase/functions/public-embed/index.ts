// public-embed
//
// Ordern "Schemalagt biljettsläpp och inbäddningsbar widget" (2026-10-03),
// steg 2, avsnitt 2.2. Tokenfri, publik endpoint för embed.js (widgeten som
// klistras in på t.ex. en Squarespace-sida) - samma resonemang som
// public-events: ingen Authorization-header, läcker ingen ny data (events/
// ticket_types SELECT-policyerna tillåter redan anon att läsa detta direkt
// via PostgREST).
//
// GET public-embed?events=slug1,slug2   (max 12, kommaseparerat)
// GET public-embed?organizer=<arrangörens slug>  (alla kommande publicerade
//   event för den arrangören, uppdateras av sig själv när nya läggs till)
// -> { events: [...], server_time: "<ISO>" }
//
// Returnerar BARA publicerade event vars starts_at inte har passerat.
// Exponerar ALDRIG sold_count/capacity/antal ordrar eller andra interna
// räknare - bara sales_state (upcoming|open|sold_out), beräknat server-
// side. Cache-Control: no-store (widgeten litar aldrig på en cachad,
// potentiellt inaktuell sales_state).
import { handleOptions, corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'
import { computeSalesState } from '../_shared/salesState.ts'

const MAX_EVENTS = 12
const SLUG_PATTERN = /^[a-z0-9-]+$/

interface EmbedEvent {
  slug: string
  title: string
  organizer_name: string | null
  starts_at: string | null
  venue: string | null
  from_price_ore: number | null
  poster_landscape_url: string | null
  poster_portrait_url: string | null
  sales_open_at: string | null
  sales_state: 'upcoming' | 'sold_out' | 'open'
}

function embedResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET') {
    return embedResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const url = new URL(req.url)
  const eventsParam = url.searchParams.get('events')
  const organizerParam = url.searchParams.get('organizer')

  const supabase = createAdminClient()
  const now = new Date()
  const nowIso = now.toISOString()

  // events/ticket_types SELECT-policyerna begränsar redan anon till
  // status='published' - men vi filtrerar explicit i frågan ändå (samma
  // mönster som public-events), dels som läsbarhet, dels som försvar i
  // djupet om RLS någon gång skulle ändras.
  let query = supabase
    .from('events')
    .select(
      'id, slug, title, venue, starts_at, status, poster_landscape_url, poster_portrait_url, organizers(name), sales_open_at, capacity, sold_count',
    )
    .eq('status', 'published')
    .gte('starts_at', nowIso)
    .order('starts_at', { ascending: true })
    .limit(MAX_EVENTS)

  if (organizerParam) {
    const organizerSlug = organizerParam.trim()
    if (!SLUG_PATTERN.test(organizerSlug)) {
      return embedResponse({ error: 'Ogiltig organizer-slug.' }, 400)
    }
    const { data: organizerRow, error: organizerError } = await supabase
      .from('organizers')
      .select('id')
      .eq('slug', organizerSlug)
      .eq('active', true)
      .maybeSingle()
    if (organizerError) {
      return embedResponse({ error: `Databasfel: ${organizerError.message}` }, 500)
    }
    if (!organizerRow) {
      // Okänd/inaktiv arrangör - samma "tomt svar" som en tom events-lista,
      // avslöjar inte om slugen finns eller ej.
      return embedResponse({ events: [], server_time: nowIso }, 200)
    }
    query = query.eq('organizer_id', organizerRow.id)
  } else if (eventsParam) {
    const slugs = eventsParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && SLUG_PATTERN.test(s))
      .slice(0, MAX_EVENTS)
    if (slugs.length === 0) {
      return embedResponse({ events: [], server_time: nowIso }, 200)
    }
    query = query.in('slug', slugs)
  } else {
    return embedResponse({ error: 'events eller organizer krävs.' }, 400)
  }

  const { data: eventRows, error: eventsError } = await query
  if (eventsError) {
    return embedResponse({ error: `Kunde inte hämta events: ${eventsError.message}` }, 500)
  }

  const rows = eventRows ?? []
  const eventIds = rows.map((e) => e.id)

  // Lägsta pris per event - EN sammanhållen fråga för alla event, inte en
  // per event (ordertextens krav 2.2). Samma mönster som public-events.
  const minPriceByEventId = new Map<string, number>()
  if (eventIds.length > 0) {
    const { data: ticketTypes, error: ticketTypesError } = await supabase
      .from('ticket_types')
      .select('event_id, price_ore')
      .in('event_id', eventIds)
    if (ticketTypesError) {
      return embedResponse({ error: `Kunde inte hämta biljettyper: ${ticketTypesError.message}` }, 500)
    }
    for (const tt of ticketTypes ?? []) {
      const current = minPriceByEventId.get(tt.event_id)
      if (current === undefined || tt.price_ore < current) {
        minPriceByEventId.set(tt.event_id, tt.price_ore)
      }
    }
  }

  const result: EmbedEvent[] = rows.map((ev) => {
    const organizer = Array.isArray(ev.organizers) ? ev.organizers[0] : ev.organizers
    return {
      slug: ev.slug,
      title: ev.title,
      organizer_name: organizer?.name ?? null,
      starts_at: toIso8601Seconds(ev.starts_at),
      venue: ev.venue,
      from_price_ore: minPriceByEventId.get(ev.id) ?? null,
      poster_landscape_url: ev.poster_landscape_url,
      poster_portrait_url: ev.poster_portrait_url,
      sales_open_at: toIso8601Seconds(ev.sales_open_at),
      sales_state: computeSalesState({
        salesOpenAt: ev.sales_open_at,
        soldCount: ev.sold_count,
        capacity: ev.capacity,
        now,
      }),
    }
  })

  return embedResponse({ events: result, server_time: nowIso }, 200)
})
