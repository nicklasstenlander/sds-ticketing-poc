// admin-delete-organizer
//
// Tilläggsordern 2026-08-07, "Radera arrangör i UI + avslagsmail till
// nekade ansökningar". Platform-admin-skyddad (requirePlatformAdmin, se
// _shared/platformAdmin.ts) - samma kontroll som admin-list-organizers/
// platform-create-organizer, körs INNAN något workspace är valt.
//
// Medvetet strängare än admin-delete-event: en arrangör med ETT ELLER
// FLERA event nekas raderingen helt, ingen "cancelled"-liknande
// mellanstatus i denna version. Att radera en hel arrangör är mycket
// större i konsekvens än att radera ett enskilt event, så tröskeln ska
// vara högre - se ordertextens punkt 1. En arrangör med riktig
// verksamhet ska alltså inte kunna tas bort från UI:t överhuvudtaget.
//
// organizer_members.organizer_id och discount_codes.organizer_id
// refererar organizers(id) utan "on delete cascade" (se
// 20260108000000_organizers_auth.sql) - organizer_members städas
// explicit innan organizers-raden raderas, precis som admin-delete-event
// städar tickets/orders/ticket_types innan events-raden raderas.
// discount_codes.organizer_id är NOT NULL och skulle i teorin kunna
// blockera raderingen (en global rabattkod skapad innan något event
// fanns) - om det händer får databasens egen foreign key-constraint
// stoppa raderingen och felet ytas tydligt till klienten, snarare än att
// vi gissar oss till att tyst radera eller koppla loss rabattkoder som
// kan vara i bruk.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { requirePlatformAdmin } from '../_shared/platformAdmin.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

interface DeleteOrganizerBody {
  organizer_id?: string
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const auth = await requirePlatformAdmin(req)
  if (!auth.ok) {
    return jsonResponse({ error: 'Ej behörig.' }, auth.status)
  }

  let body: DeleteOrganizerBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const organizerId = (body.organizer_id ?? '').trim()
  if (!organizerId) {
    return jsonResponse({ error: 'organizer_id krävs.' }, 400)
  }

  const supabase = createAdminClient()

  const { data: organizer, error: organizerError } = await supabase
    .from('organizers')
    .select('id, name')
    .eq('id', organizerId)
    .maybeSingle()

  if (organizerError) {
    return jsonResponse({ error: `Databasfel: ${organizerError.message}` }, 500)
  }
  if (!organizer) {
    return jsonResponse({ error: 'Arrangören hittades inte.' }, 404)
  }

  const { count: eventCount, error: eventCountError } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('organizer_id', organizerId)

  if (eventCountError) {
    return jsonResponse({ error: `Kunde inte kontrollera event: ${eventCountError.message}` }, 500)
  }

  if (eventCount && eventCount > 0) {
    return jsonResponse(
      { error: `Arrangören har ${eventCount} event och kan inte raderas.` },
      409,
    )
  }

  const { error: deleteMembersError } = await supabase
    .from('organizer_members')
    .delete()
    .eq('organizer_id', organizerId)

  if (deleteMembersError) {
    return jsonResponse({ error: `Kunde inte städa medlemmar: ${deleteMembersError.message}` }, 500)
  }

  const { error: deleteOrganizerError } = await supabase
    .from('organizers')
    .delete()
    .eq('id', organizerId)

  if (deleteOrganizerError) {
    return jsonResponse(
      { error: `Kunde inte radera arrangören: ${deleteOrganizerError.message}` },
      500,
    )
  }

  return jsonResponse({ result: 'deleted' })
})
