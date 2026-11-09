// admin-waitlist
//
// Väntelistan för en speltid i admin (2026-11). Admin erbjuder platser
// själv - inget skickas automatiskt.
//
// GET  ?event_id=…                          -> { entries, waitlist_enabled, free_seats }
// POST { action: 'offer',  event_id, entry_ids: [...] } -> mejl med köplänk
// POST { action: 'remove', event_id, entry_id }         -> tar bort ur kön
//
// Speltiden måste tillhöra den inloggade arrangören (resolveOrganizer);
// annars 404, samma mönster som övriga admin-*-funktioner. Ett erbjudande
// reserverar ingen plats - mejlet säger "först till kvarn".
//
// Loggar bara id:n och antal - aldrig namn eller e-post.
import { instrumentEdgeFunctions } from '../_shared/sentry.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { sendWaitlistOffer } from '../_shared/waitlistEmail.ts'

interface WaitlistBody {
  action?: 'offer' | 'remove'
  event_id?: string
  entry_ids?: string[]
  entry_id?: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_OFFERS_PER_CALL = 50

await instrumentEdgeFunctions()

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  const auth = await resolveOrganizer(req)
  if (!auth) {
    return jsonResponse({ error: 'Ej behörig. Logga in i admin igen.' }, 401)
  }

  const supabase = createAdminClient()

  async function loadEvent(eventId: string) {
    if (!UUID_PATTERN.test(eventId)) return null
    const { data } = await supabase
      .from('events')
      .select('id, slug, title, venue, starts_at, capacity, sold_count, organizer_id, waitlist_enabled, organizers(name)')
      .eq('id', eventId)
      .maybeSingle()
    if (!data || data.organizer_id !== auth!.organizerId) return null
    return data
  }

  if (req.method === 'GET') {
    const eventId = new URL(req.url).searchParams.get('event_id') ?? ''
    const event = await loadEvent(eventId)
    if (!event) return jsonResponse({ error: 'Speltiden hittades inte.' }, 404)
    const { data: entries, error } = await supabase
      .from('waitlist_entries')
      .select('id, name, email, qty, status, created_at, offered_at')
      .eq('event_id', event.id)
      .neq('status', 'removed')
      .order('created_at', { ascending: true })
    if (error) return jsonResponse({ error: `Databasfel: ${error.message}` }, 500)
    return jsonResponse({
      entries: entries ?? [],
      waitlist_enabled: event.waitlist_enabled,
      free_seats: Math.max(0, event.capacity - event.sold_count),
    })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  let body: WaitlistBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const event = await loadEvent((body.event_id ?? '').trim())
  if (!event) return jsonResponse({ error: 'Speltiden hittades inte.' }, 404)

  if (body.action === 'remove') {
    const entryId = (body.entry_id ?? '').trim()
    if (!UUID_PATTERN.test(entryId)) return jsonResponse({ error: 'entry_id krävs.' }, 400)
    const { data, error } = await supabase
      .from('waitlist_entries')
      .update({ status: 'removed' })
      .eq('id', entryId)
      .eq('event_id', event.id)
      .select('id')
    if (error) return jsonResponse({ error: `Databasfel: ${error.message}` }, 500)
    if (!data || data.length === 0) return jsonResponse({ error: 'Raden hittades inte.' }, 404)
    return jsonResponse({ result: 'removed' })
  }

  if (body.action === 'offer') {
    const ids = [...new Set((body.entry_ids ?? []).filter((id) => UUID_PATTERN.test(id)))]
    if (ids.length === 0) return jsonResponse({ error: 'Välj minst en person i kön.' }, 400)
    if (ids.length > MAX_OFFERS_PER_CALL) {
      return jsonResponse({ error: `Högst ${MAX_OFFERS_PER_CALL} åt gången.` }, 400)
    }

    const frontendBaseUrl = (Deno.env.get('FRONTEND_BASE_URL') ?? '').replace(/\/+$/, '')
    if (!frontendBaseUrl) {
      return jsonResponse({ error: 'FRONTEND_BASE_URL är inte konfigurerad på servern.' }, 500)
    }

    const { data: entries, error } = await supabase
      .from('waitlist_entries')
      .select('id, name, email')
      .eq('event_id', event.id)
      .in('id', ids)
      .neq('status', 'removed')
    if (error) return jsonResponse({ error: `Databasfel: ${error.message}` }, 500)

    const organizer = Array.isArray(event.organizers) ? event.organizers[0] : event.organizers
    const purchaseUrl = `${frontendBaseUrl}/#/kop/${event.slug}`
    let sent = 0
    let failed = 0
    for (const entry of entries ?? []) {
      try {
        await sendWaitlistOffer(entry.email, {
          name: entry.name,
          eventTitle: event.title,
          eventVenue: event.venue,
          eventStartsAt: event.starts_at,
          purchaseUrl,
          organizerName: organizer?.name ?? null,
        })
        await supabase
          .from('waitlist_entries')
          .update({ status: 'offered', offered_at: new Date().toISOString() })
          .eq('id', entry.id)
        sent += 1
      } catch (err) {
        failed += 1
        console.error('admin-waitlist: kunde inte mejla rad', entry.id, err instanceof Error ? err.message : err)
      }
    }
    console.log(`admin-waitlist: erbjudande skickat till ${sent} (${failed} misslyckades) för event ${event.id}.`)
    return jsonResponse({ result: 'offered', sent, failed })
  }

  return jsonResponse({ error: 'Okänd åtgärd.' }, 400)
})
