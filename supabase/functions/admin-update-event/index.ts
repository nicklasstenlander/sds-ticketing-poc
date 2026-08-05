// admin-update-event
//
// Redigerar ett befintligt event. PATCH-liknande semantik: bara fält som
// faktiskt skickas i body uppdateras, resten lämnas orörda. Kräver giltig
// Supabase Auth-JWT (se _shared/organizerAuth.ts), och - avgörande för
// dataisoleringen (Tilläggsordern 2026-08-05) - eventet måste TILLHÖRA
// den inloggade användarens egen arrangör. Ett event_id som pekar på en
// annan arrangörs event ger 404, INTE 403 - avslöjar inte ens att raden
// existerar.
//
// Pris/moms hanteras INTE längre här - se admin-ticket-types. capacity
// hanteras dock HÄR (rättelseordern 2026-08-05, delad kapacitetspool) -
// eventet har en delad pott platser som alla biljettyper tar från, ingen
// egen kapacitet per typ längre. Kapacitetskontroll mot sold_count sker
// alltså här, precis som innan biljettyper fanns.
//
// Publiceringsspärr (Tilläggsordern avsnitt 5): ett event kan bara sättas
// till status "published" om det har minst en biljettyp. Detta kontrolleras
// här, inte bara i frontend, eftersom backend-spärren är den som faktiskt
// gäller.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'

interface UpdateEventBody {
  event_id?: string
  title?: string
  venue?: string
  starts_at?: string
  capacity?: number
  status?: 'draft' | 'published'
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const auth = await resolveOrganizer(req)
  if (!auth) {
    return jsonResponse({ error: 'Ej behörig. Logga in i admin igen.' }, 401)
  }

  let body: UpdateEventBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const eventId = (body.event_id ?? '').trim()
  if (!eventId) {
    return jsonResponse({ error: 'event_id krävs.' }, 400)
  }

  const supabase = createAdminClient()

  const { data: current, error: currentError } = await supabase
    .from('events')
    .select('id, status, sold_count, organizer_id, starts_at')
    .eq('id', eventId)
    .maybeSingle()

  if (currentError) {
    return jsonResponse({ error: `Databasfel: ${currentError.message}` }, 500)
  }
  // Ingen träff ELLER en annan arrangörs event - samma 404 i båda fallen,
  // avslöjar inte att raden existerar hos någon annan.
  if (!current || current.organizer_id !== auth.organizerId) {
    return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
  }
  if (current.status === 'cancelled') {
    return jsonResponse(
      { error: 'Eventet är inställt och kan inte redigeras. Detta stöds inte i denna PoC.' },
      409,
    )
  }

  const update: Record<string, unknown> = {}

  if (body.title !== undefined) {
    const title = body.title.trim()
    if (!title) return jsonResponse({ error: 'Titel kan inte vara tom.' }, 400)
    update.title = title
  }

  if (body.venue !== undefined) {
    update.venue = body.venue.trim() || null
  }

  if (body.starts_at !== undefined) {
    if (!body.starts_at || Number.isNaN(Date.parse(body.starts_at))) {
      return jsonResponse({ error: 'Ogiltigt datum/tid.' }, 400)
    }
    update.starts_at = new Date(body.starts_at).toISOString()
  }

  if (body.capacity !== undefined) {
    const capacity = Number(body.capacity)
    if (!Number.isInteger(capacity) || capacity < 0) {
      return jsonResponse({ error: 'Platsantal måste vara ett heltal >= 0.' }, 400)
    }
    if (capacity < current.sold_count) {
      return jsonResponse(
        { error: `Kapaciteten kan inte sättas lägre än antal sålda biljetter (${current.sold_count}).` },
        400,
      )
    }
    update.capacity = capacity
  }

  if (body.status !== undefined) {
    if (body.status !== 'draft' && body.status !== 'published') {
      return jsonResponse(
        { error: 'status måste vara "draft" eller "published" (använd admin-delete-event för att ställa in ett event).' },
        400,
      )
    }
    if (body.status === 'published') {
      // Effektivt datum efter DENNA request: antingen ett nytt starts_at
      // som skickas i samma anrop, eller det som redan ligger lagrat.
      // Ett dublicerat event (Tilläggsordern "Duplicera event"
      // 2026-08-05) skapas medvetet utan datum - samma spärr som redan
      // fanns för biljettyper gäller nu datumet också, annars skulle en
      // kopia kunna publiceras (och synas publikt) utan att någon
      // uttryckligen satt en tid för den. DB-constrainten
      // events_published_requires_starts_at fångar detta även om denna
      // kodväg missas, men felmeddelandet här är mycket tydligare för
      // adminanvändaren än ett rått databasfel.
      const effectiveStartsAt = body.starts_at !== undefined ? update.starts_at : current.starts_at
      if (!effectiveStartsAt) {
        return jsonResponse(
          { error: 'Eventet måste ha ett datum satt innan det kan publiceras.' },
          400,
        )
      }
      const { count: ticketTypeCount, error: ticketTypeCountError } = await supabase
        .from('ticket_types')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventId)
      if (ticketTypeCountError) {
        return jsonResponse({ error: `Databasfel: ${ticketTypeCountError.message}` }, 500)
      }
      if (!ticketTypeCount || ticketTypeCount === 0) {
        return jsonResponse(
          { error: 'Eventet måste ha minst en biljettyp innan det kan publiceras.' },
          400,
        )
      }
    }
    update.status = body.status
  }

  if (Object.keys(update).length === 0) {
    return jsonResponse({ error: 'Inga fält att uppdatera skickades.' }, 400)
  }

  const { data, error } = await supabase
    .from('events')
    .update(update)
    .eq('id', eventId)
    .select()
    .single()

  if (error) {
    return jsonResponse({ error: `Kunde inte uppdatera event: ${error.message}` }, 500)
  }

  const formattedEvent = {
    ...data,
    starts_at: toIso8601Seconds(data.starts_at),
    created_at: toIso8601Seconds(data.created_at),
  }

  return jsonResponse({ event: formattedEvent })
})
