// admin-events
//
// Listar ALLA events (både draft och published) för admin-vyn. Kräver
// giltig admin-sessionstoken. Anon-nyckeln ser bara publicerade events
// (via RLS), så admin-listan måste gå via en service-role-funktion för
// att även visa utkast.
//
// capacity/sold_count ligger direkt på events (delad kapacitetspool, se
// rättelseordern 2026-08-05) och kommer med rakt av i selecten nedan.
// Varje event kompletteras här bara med en liten ticket_types_summary
// (antal typer, lägsta/högsta pris) - bekvämt för listvyn utan att varje
// anropare måste räkna själv.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { bearerTokenFrom, verifyAdminToken } from '../_shared/adminToken.ts'
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

  const adminPin = Deno.env.get('ADMIN_PIN')
  if (!adminPin) {
    return jsonResponse({ error: 'ADMIN_PIN är inte konfigurerad på servern.' }, 500)
  }

  const token = bearerTokenFrom(req)
  if (!(await verifyAdminToken(adminPin, token))) {
    return jsonResponse({ error: 'Ej behörig. Logga in i admin igen.' }, 401)
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('events')
    .select('id, slug, title, venue, starts_at, status, created_at, capacity, sold_count, poster_landscape_url, poster_portrait_url')
    .order('starts_at', { ascending: true })

  if (error) {
    return jsonResponse({ error: `Kunde inte hämta events: ${error.message}` }, 500)
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

  const events = eventRows.map((e) => ({
    ...e,
    starts_at: toIso8601Seconds(e.starts_at),
    created_at: toIso8601Seconds(e.created_at),
    ticket_types_summary: summaries.get(e.id) ?? {
      ticket_type_count: 0,
      min_price_ore: null,
      max_price_ore: null,
    },
  }))

  return jsonResponse({ events })
})
