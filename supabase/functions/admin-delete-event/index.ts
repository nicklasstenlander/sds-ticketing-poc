// admin-delete-event
//
// Raderar eller ställer in ett event, beroende på om det har kopplade
// ordrar. ALDRIG en rå SQL delete på en rad med ordrar kopplade till sig -
// events.id refereras av orders.event_id, och att radera event-raden skulle
// antingen krascha på en FK-constraint eller (om ingen FK finns) lämna
// föräldralösa ordrar bakom sig, vilket i sin tur skulle förstöra
// export-sales bokföringsunderlag för redan betalda ordrar.
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

  // Räknar ALLA ordrar oavsett status (pending/paid/expired/cancelled) -
  // inte bara betalda. Även en order som aldrig fullföljde betalningen
  // representerar en faktisk kundinteraktion mot eventet, och exporten kan
  // i teorin behöva slå upp den historiken senare.
  const { count: orderCount, error: countError } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)

  if (countError) {
    return jsonResponse({ error: `Kunde inte kontrollera ordrar: ${countError.message}` }, 500)
  }

  if (orderCount && orderCount > 0) {
    const { error: cancelError } = await supabase
      .from('events')
      .update({ status: 'cancelled' })
      .eq('id', eventId)

    if (cancelError) {
      return jsonResponse({ error: `Kunde inte ställa in eventet: ${cancelError.message}` }, 500)
    }

    return jsonResponse({ result: 'cancelled' })
  }

  const { error: deleteError } = await supabase.from('events').delete().eq('id', eventId)

  if (deleteError) {
    return jsonResponse({ error: `Kunde inte radera eventet: ${deleteError.message}` }, 500)
  }

  return jsonResponse({ result: 'deleted' })
})
