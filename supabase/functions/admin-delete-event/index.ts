// admin-delete-event
//
// Raderar ett event PERMANENT - bara tillåtet för ett utkast (status=
// 'draft') som helt saknar ordrar (ordern "Arkiv för ordrar och event"
// 2026-10-12, DEL 2 punkt 3: "stäng av hård radering för event som har
// några ordrar alls, oavsett status - hänvisa till arkivera"). Ett
// arkiverat event (archived_at satt) får ALDRIG raderas, oavsett
// ordrar - arkivet är tänkt att vara permanent, "radera aldrig något".
//
// Tidigare (före den ordern) tillät den här funktionen radering av ett
// event med bara overksamma ordrar (pending/expired/cancelled, aldrig
// levererade biljetter) och föll tillbaka till ett "mjukt" cancelled-
// status när BETALDA ordrar fanns. Nu finns admin-archive-event för det
// mjuka fallet - den här funktionen är bara kvar för det EXTREMA fallet:
// ett helt orört utkast, admin skapade av misstag. events.id refereras
// av orders.event_id/tickets.event_id (ingen "on delete cascade", se
// 20260101000000_init.sql), så raderingen städar dessa explicit innan
// event-raden själv raderas.
//
// Kräver giltig Supabase Auth-JWT (se _shared/organizerAuth.ts), och
// eventet måste tillhöra den inloggade användarens egen arrangör
// (Tilläggsordern 2026-08-05) - samma 404-för-annan-arrangörs-event-
// mönster som admin-update-event.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

interface DeleteEventBody {
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

  let body: DeleteEventBody
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

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, status, organizer_id, archived_at')
    .eq('id', eventId)
    .maybeSingle()

  if (eventError) {
    return jsonResponse({ error: `Databasfel: ${eventError.message}` }, 500)
  }
  if (!event || event.organizer_id !== auth.organizerId) {
    return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
  }

  // Arkiverade event raderas ALDRIG (ordern 2026-10-12, DEL 2 punkt 3) -
  // kontrolleras före allt annat nedan.
  if (event.archived_at) {
    return jsonResponse({ error: 'Arkiverade event kan inte raderas.' }, 400)
  }

  // Legacy - ett event som blev "cancelled" under DEN GAMLA logiken
  // (innan arkivfunktionen fanns, se filkommentaren) kan fortfarande
  // finnas. Idempotent, gör inget om igen.
  if (event.status === 'cancelled') {
    return jsonResponse({ result: 'cancelled' })
  }

  // Räknar ALLA ordrar, oavsett status (2026-10-12, DEL 2 punkt 3 - till
  // skillnad från den gamla "bara betalda blockerar"-regeln). Finns det
  // några ordrar alls ska admin arkivera eventet istället för att
  // radera det.
  const { count: orderCount, error: countError } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)

  if (countError) {
    return jsonResponse({ error: `Kunde inte kontrollera ordrar: ${countError.message}` }, 500)
  }

  if (orderCount && orderCount > 0) {
    return jsonResponse(
      { error: 'Eventet har ordrar och kan inte raderas - arkivera det istället.' },
      400,
    )
  }

  // Radering får bara finnas kvar för utkast utan ordrar (2026-10-12,
  // DEL 2 punkt 3) - ett publicerat event, även utan ordrar, har kunnat
  // vara synligt/länkat publikt och ska arkiveras, inte raderas.
  if (event.status !== 'draft') {
    return jsonResponse(
      { error: 'Bara opublicerade utkast utan ordrar kan raderas - arkivera eventet istället.' },
      400,
    )
  }

  // Vi vet redan att orderCount === 0 här, så tickets/orders-raderingen
  // nedan är i praktiken en no-op - kvar som ett billigt skyddsnät mot
  // att anta det utan att faktiskt köra det (t.ex. en biljett utan
  // order_id-koppling, om en sådan någonsin skulle uppstå).
  const { error: deleteTicketsError } = await supabase.from('tickets').delete().eq('event_id', eventId)
  if (deleteTicketsError) {
    return jsonResponse({ error: `Kunde inte städa biljetter: ${deleteTicketsError.message}` }, 500)
  }

  const { error: deleteOrdersError } = await supabase.from('orders').delete().eq('event_id', eventId)
  if (deleteOrdersError) {
    return jsonResponse({ error: `Kunde inte städa ordrar: ${deleteOrdersError.message}` }, 500)
  }

  // ticket_types.event_id refererar events(id) utan cascade, precis som
  // orders/tickets gjorde ovan - måste städas explicit innan event-raden
  // kan raderas. Inga paid-ordrar finns kvar (kontrollerat ovan), så det
  // finns ingen bokföringsdata i export-sales att förlora här.
  const { error: deleteTicketTypesError } = await supabase.from('ticket_types').delete().eq('event_id', eventId)
  if (deleteTicketTypesError) {
    return jsonResponse({ error: `Kunde inte städa biljettyper: ${deleteTicketTypesError.message}` }, 500)
  }

  // Rabattkoder knutna till just detta event (event_id satt) skulle annars
  // blockera raderingen via samma foreign key-mönster. Koden i sig har ett
  // värde oberoende av eventet (historik/spårbarhet för redan gjorda köp
  // på andra event om den återanvänts, eller bara för att inte tyst
  // radera admins arbete) - vi kopplar loss den till "alla event för samma
  // arrangör" (event_id = null) snarare än att radera eller blockera. Ingen
  // ägarbyte sker - koden har redan samma organizer_id som eventet hade.
  const { error: unlinkDiscountCodesError } = await supabase
    .from('discount_codes')
    .update({ event_id: null })
    .eq('event_id', eventId)
  if (unlinkDiscountCodesError) {
    return jsonResponse({ error: `Kunde inte koppla loss rabattkoder: ${unlinkDiscountCodesError.message}` }, 500)
  }

  const { error: deleteError } = await supabase.from('events').delete().eq('id', eventId)

  if (deleteError) {
    return jsonResponse({ error: `Kunde inte radera eventet: ${deleteError.message}` }, 500)
  }

  return jsonResponse({ result: 'deleted' })
})
