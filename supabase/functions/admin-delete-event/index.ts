// admin-delete-event
//
// Raderar eller ställer in ett event, beroende på om det har BETALDA
// ordrar (status = 'paid'). ALDRIG en rå delete av event-raden när
// betalda ordrar finns kopplade - events.id refereras av orders.event_id
// och tickets.event_id (ingen "on delete cascade", se
// 20260101000000_init.sql), och att radera event-raden skulle antingen
// krascha på foreign key-constrainten eller lämna föräldralösa rader
// bakom sig, vilket i sin tur skulle förstöra export-sales
// bokföringsunderlag för redan betalda ordrar.
//
// Overksamma ordrar (pending/expired/cancelled - aldrig levererade
// biljetter) blockerar DÄREMOT inte radering, och städas bort explicit
// innan event-raden raderas.
//
// Kräver giltig admin-sessionstoken, precis som övriga admin-funktioner.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { bearerTokenFrom, verifyAdminToken } from '../_shared/adminToken.ts'
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

  const adminPin = Deno.env.get('ADMIN_PIN')
  if (!adminPin) {
    return jsonResponse({ error: 'ADMIN_PIN är inte konfigurerad på servern.' }, 500)
  }

  const token = bearerTokenFrom(req)
  if (!(await verifyAdminToken(adminPin, token))) {
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
    .select('id, status')
    .eq('id', eventId)
    .maybeSingle()

  if (eventError) {
    return jsonResponse({ error: `Databasfel: ${eventError.message}` }, 500)
  }
  if (!event) {
    return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
  }

  // Redan inställt - idempotent, gör inget om igen (t.ex. om admin råkar
  // klicka "Radera" två gånger innan listan hunnit ladda om).
  if (event.status === 'cancelled') {
    return jsonResponse({ result: 'cancelled' })
  }

  // Räknar ENDAST betalda ordrar. Bara "paid" har biljetter (skapade av
  // stripe-webhook) och ett bokföringsunderlag i export-sales som måste
  // bevaras - "pending"/"expired"/"cancelled" representerar ingen
  // levererad biljett och ska inte i sig blockera radering (rättat efter
  // en observerad bugg: ett event med bara kvarvarande expired-ordrar
  // från tidigare tester av expiry-flödet blev felaktigt "cancelled" i
  // stället för raderat).
  const { count: paidOrderCount, error: countError } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'paid')

  if (countError) {
    return jsonResponse({ error: `Kunde inte kontrollera ordrar: ${countError.message}` }, 500)
  }

  if (paidOrderCount && paidOrderCount > 0) {
    const { error: cancelError } = await supabase
      .from('events')
      .update({ status: 'cancelled' })
      .eq('id', eventId)

    if (cancelError) {
      return jsonResponse({ error: `Kunde inte ställa in eventet: ${cancelError.message}` }, 500)
    }

    return jsonResponse({ result: 'cancelled' })
  }

  // Inga betalda ordrar - men det kan fortfarande finnas overksamma rader
  // (pending/expired/cancelled) kvar från köpförsök som aldrig fullföljdes.
  // orders.event_id och tickets.event_id refererar events(id) utan "on
  // delete cascade" (se 20260101000000_init.sql), så dessa måste städas
  // bort explicit innan event-raden raderas - annars stoppar databasens
  // egen foreign key-constraint hela raderingen. Ingen "paid"-order kan
  // finnas kvar här (vi har redan bekräftat paidOrderCount === 0), så
  // tickets-tabellen borde redan vara tom för detta event (tickets skapas
  // bara av stripe-webhook för betalda ordrar) - raden nedan är ändå med
  // som ett billigt skyddsnät mot att anta det utan att kolla.
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
  // radera admins arbete) - vi kopplar loss den till "alla event"
  // (event_id = null) snarare än att radera eller blockera.
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
