// admin-events
//
// Listar ALLA events (både draft och published) för INLOGGAD arrangörs
// admin-vy. Kräver en giltig Supabase Auth-JWT (se _shared/organizerAuth.ts)
// - PIN-baserad admin-sessionstoken är borttagen (Tilläggsordern
// 2026-08-05, "Flera arrangörer: riktiga inloggningar och dataisolering").
// organizer_id härleds ALLTID från JWT:n via organizer_members, ALDRIG
// från klienten - listan filtreras strikt på den inloggade användarens
// egen arrangör.
//
// capacity/sold_count ligger direkt på events (delad kapacitetspool, se
// rättelseordern 2026-08-05) och kommer med rakt av i selecten nedan.
// Varje event kompletteras här bara med en liten ticket_types_summary
// (antal typer, lägsta/högsta pris) - bekvämt för listvyn utan att varje
// anropare måste räkna själv.
//
// Arkiverade event (ordern "Arkiv för ordrar och event" 2026-10-12)
// exkluderas som STANDARD - precis som adminlistan redan är tänkt att
// visa "det aktiva", inte allt som någonsin funnits. ?include_archived=1
// tar med dem igen (växeln "Visa arkiverade" i AdminPage.tsx). Varje
// event kompletteras också med order_count (ALLA ordrar, oavsett status)
// - UI:t använder det för att avgöra om "Radera" överhuvudtaget ska
// visas (bara draft+0 ordrar är raderbart, se admin-delete-event) eller
// om det måste bli "Arkivera" istället.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'

interface TicketTypeSummary {
  ticket_type_count: number
  min_price_ore: number | null
  max_price_ore: number | null
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const auth = await resolveOrganizer(req)
  if (!auth) {
    return jsonResponse({ error: 'Ej behörig. Logga in i admin igen.' }, 401)
  }

  const url = new URL(req.url)
  const includeArchived = url.searchParams.get('include_archived') === '1'

  const supabase = createAdminClient()
  let query = supabase
    .from('events')
    .select(
      'id, slug, title, venue, starts_at, status, created_at, capacity, sold_count, poster_landscape_url, poster_portrait_url, sales_open_at, archived_at, archived_by, archived_reason',
    )
    .eq('organizer_id', auth.organizerId)
    .order('starts_at', { ascending: true })
  if (!includeArchived) {
    query = query.is('archived_at', null)
  }
  const { data, error } = await query

  if (error) {
    return jsonResponse({ error: `Kunde inte hämta events: ${error.message}` }, 500)
  }

  // Additivt fält (steg 2, embed-generatorn) - arrangörens egen slug,
  // för "data-organizer"-läget. Läcker ingen ny data (samma slug är
  // redan publik via varje events egen köplänk).
  const { data: organizerRow, error: organizerError } = await supabase
    .from('organizers')
    .select('slug')
    .eq('id', auth.organizerId)
    .single()

  if (organizerError) {
    return jsonResponse({ error: `Kunde inte hämta arrangören: ${organizerError.message}` }, 500)
  }

  const eventRows = data ?? []
  const eventIds = eventRows.map((e) => e.id)

  const summaries = new Map<string, TicketTypeSummary>()
  if (eventIds.length > 0) {
    const { data: ticketTypes, error: ticketTypesError } = await supabase
      .from('ticket_types')
      .select('event_id, price_ore')
      .in('event_id', eventIds)

    if (ticketTypesError) {
      return jsonResponse({ error: `Kunde inte hämta biljettyper: ${ticketTypesError.message}` }, 500)
    }

    for (const tt of ticketTypes ?? []) {
      const existing = summaries.get(tt.event_id)
      if (!existing) {
        summaries.set(tt.event_id, {
          ticket_type_count: 1,
          min_price_ore: tt.price_ore,
          max_price_ore: tt.price_ore,
        })
      } else {
        existing.ticket_type_count += 1
        existing.min_price_ore = Math.min(existing.min_price_ore ?? tt.price_ore, tt.price_ore)
        existing.max_price_ore = Math.max(existing.max_price_ore ?? tt.price_ore, tt.price_ore)
      }
    }
  }

  // order_count (ALLA statusar) - avgör om "Radera" får visas för
  // eventet i UI:t, se filkommentaren. En rad per order med dess
  // event_id räcker, räknas i minnet precis som ticket_types_summary
  // ovan - billigare än N egna count-queries.
  const orderCounts = new Map<string, number>()
  if (eventIds.length > 0) {
    const { data: orderRows, error: orderRowsError } = await supabase
      .from('orders')
      .select('event_id')
      .in('event_id', eventIds)

    if (orderRowsError) {
      return jsonResponse({ error: `Kunde inte hämta ordrar: ${orderRowsError.message}` }, 500)
    }

    for (const o of orderRows ?? []) {
      orderCounts.set(o.event_id, (orderCounts.get(o.event_id) ?? 0) + 1)
    }
  }

  const events = eventRows.map((e) => ({
    ...e,
    starts_at: toIso8601Seconds(e.starts_at),
    created_at: toIso8601Seconds(e.created_at),
    ticket_types_summary: summaries.get(e.id) ?? {
      ticket_type_count: 0,
      min_price_ore: null,
      max_price_ore: null,
    },
    order_count: orderCounts.get(e.id) ?? 0,
  }))

  return jsonResponse({ events, organizer_slug: organizerRow.slug })
})
