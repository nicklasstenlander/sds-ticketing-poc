// admin-duplicate-event
//
// Duplicerar ett event: skapar en kopia med samma titel (prefix "Kopia
// av "), lokal och platsantal, samt en kopia av varje biljettyp (namn,
// pris, moms, sorteringsordning). Kräver giltig Supabase Auth-JWT (se
// _shared/organizerAuth.ts), och källeventet måste tillhöra den
// inloggade användarens egen arrangör - samma 404-för-annan-arrangörs-
// event-mönster som admin-update-event/admin-delete-event (avslöjar
// inte att raden existerar hos någon annan).
//
// Kopian skapas MEDVETET som "draft" med tomt starts_at, och affischer
// kopieras INTE - se migrationen (20260805020000_duplicate_event.sql)
// för full motivering. Historik (ordrar, biljetter, incheckningar,
// rabattkodsanvändning) kopieras aldrig - det hör till källeventet.
//
// Själva kopieringen (event + dess biljettyper) sker i en enda
// transaktion via den security definer-Postgres-funktionen
// duplicate_event(), så att ett event aldrig kan skapas utan sina
// biljettyper vid ett halvvägs-fel - samma mönster som
// reserve_shared_capacity_multi. Ägarskapskontrollen sker HÄR, inte i
// DB-funktionen - duplicate_event() litar på att den redan är gjord.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

interface DuplicateEventBody {
  event_id?: string
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

  let body: DuplicateEventBody
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

  const { data: source, error: sourceError } = await supabase
    .from('events')
    .select('id, organizer_id')
    .eq('id', eventId)
    .maybeSingle()

  if (sourceError) {
    return jsonResponse({ error: `Databasfel: ${sourceError.message}` }, 500)
  }
  // Ingen träff ELLER en annan arrangörs event - samma 404 i båda fallen.
  if (!source || source.organizer_id !== auth.organizerId) {
    return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
  }

  const { data, error } = await supabase.rpc('duplicate_event', { p_event_id: eventId })

  if (error) {
    return jsonResponse({ error: `Kunde inte duplicera eventet: ${error.message}` }, 500)
  }

  const result = Array.isArray(data) ? data[0] : data
  if (!result) {
    return jsonResponse({ error: 'Kunde inte duplicera eventet.' }, 500)
  }

  return jsonResponse({ event_id: result.new_event_id, slug: result.new_slug }, 201)
})
