// admin-archive-event
//
// Arkiverar eller återställer ett event (ordern "Arkiv för ordrar och
// event" 2026-10-12, DEL 2 punkt 1). Event-fokuserat: att arkivera ett
// event kaskaderar till att arkivera alla dess ÄNNU OARKIVERADE ordrar
// (oavsett status - pending/paid/expired/cancelled) med samma orsak,
// tidpunkt och utförare. En order som redan arkiverats ENSKILT (via
// admin-archive-orders, annan orsak och/eller annan tidpunkt) matchas
// INTE av .is('archived_at', null) nedan - den rörs alltså inte, skrivs
// aldrig över.
//
// Återställning är den SPEGELVÄNDA principen, inte "återställ allt":
// bara ordrar vars archived_at EXAKT matchar den tidsstämpel den här
// kaskaden själv satte (archivedAtBeforeRestore, läst FÖRE eventet
// nollställs) återställs. En order som arkiverats enskilt - antingen
// FÖRE event-arkiveringen (orörd av kaskaden, annan tidpunkt) eller
// EFTER (omöjligt att skriva över en redan arkiverad rad, se ovan) -
// har per definition en annan archived_at-tidsstämpel, och lämnas
// därför orörd här. Uppföljning 2026-10-12 efter en fråga om exakt
// detta: ursprunglig version återställde ALLA ordrar oavsett ursprung,
// vilket hade skrivit över/återställt enskilt arkiverade ordrar fel -
// rättat innan deploy, aldrig i drift.
//
// "Radera aldrig något": den här funktionen DELETE:ar aldrig en rad,
// bara flaggar. Rör inte sold_count/capacity, inte Stripe, inte tickets.
//
// Kräver giltig Supabase Auth-JWT (se _shared/organizerAuth.ts), och
// eventet måste tillhöra den inloggade användarens egen arrangör - samma
// 404-för-annan-arrangörs-event-mönster som admin-update-event/
// admin-delete-event.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

type ArchiveReason = 'test' | 'hidden'
const VALID_REASONS: ArchiveReason[] = ['test', 'hidden']

interface ArchiveEventBody {
  event_id?: string
  action?: 'archive' | 'restore'
  reason?: ArchiveReason
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

  let body: ArchiveEventBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const eventId = (body.event_id ?? '').trim()
  if (!eventId) {
    return jsonResponse({ error: 'event_id krävs.' }, 400)
  }

  if (body.action !== 'archive' && body.action !== 'restore') {
    return jsonResponse({ error: 'action måste vara "archive" eller "restore".' }, 400)
  }

  if (body.action === 'archive' && !VALID_REASONS.includes(body.reason as ArchiveReason)) {
    return jsonResponse({ error: 'reason måste vara "test" eller "hidden" vid arkivering.' }, 400)
  }

  const supabase = createAdminClient()

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, organizer_id, archived_at')
    .eq('id', eventId)
    .maybeSingle()

  if (eventError) {
    return jsonResponse({ error: `Databasfel: ${eventError.message}` }, 500)
  }
  if (!event || event.organizer_id !== auth.organizerId) {
    return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
  }

  if (body.action === 'archive') {
    // Idempotent - redan arkiverat, gör inget om igen (t.ex. dubbelklick
    // innan listan hunnit ladda om).
    if (event.archived_at) {
      return jsonResponse({ result: 'archived', archived_order_count: 0 })
    }

    const archivedAt = new Date().toISOString()
    const { error: updateEventError } = await supabase
      .from('events')
      .update({ archived_at: archivedAt, archived_by: auth.userId, archived_reason: body.reason })
      .eq('id', eventId)

    if (updateEventError) {
      return jsonResponse({ error: `Kunde inte arkivera eventet: ${updateEventError.message}` }, 500)
    }

    const { data: archivedOrders, error: updateOrdersError } = await supabase
      .from('orders')
      .update({ archived_at: archivedAt, archived_by: auth.userId, archived_reason: body.reason })
      .eq('event_id', eventId)
      .is('archived_at', null)
      .select('id')

    if (updateOrdersError) {
      return jsonResponse({ error: `Eventet arkiverades men ordrarna kunde inte: ${updateOrdersError.message}` }, 500)
    }

    return jsonResponse({ result: 'archived', archived_order_count: archivedOrders?.length ?? 0 })
  }

  // action === 'restore'
  if (!event.archived_at) {
    return jsonResponse({ result: 'restored', restored_order_count: 0 })
  }
  // Läst FÖRE eventet nollställs nedan - det här är nyckeln som skiljer
  // "arkiverad AV DEN HÄR event-kaskaden" från "arkiverad enskilt", se
  // filkommentaren.
  const archivedAtBeforeRestore = event.archived_at

  const { error: restoreEventError } = await supabase
    .from('events')
    .update({ archived_at: null, archived_by: null, archived_reason: null })
    .eq('id', eventId)

  if (restoreEventError) {
    return jsonResponse({ error: `Kunde inte återställa eventet: ${restoreEventError.message}` }, 500)
  }

  const { data: restoredOrders, error: restoreOrdersError } = await supabase
    .from('orders')
    .update({ archived_at: null, archived_by: null, archived_reason: null })
    .eq('event_id', eventId)
    .eq('archived_at', archivedAtBeforeRestore)
    .select('id')

  if (restoreOrdersError) {
    return jsonResponse({ error: `Eventet återställdes men ordrarna kunde inte: ${restoreOrdersError.message}` }, 500)
  }

  return jsonResponse({ result: 'restored', restored_order_count: restoredOrders?.length ?? 0 })
})
