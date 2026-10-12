// admin-cancel-order
//
// Avbokar en betald order UTAN att röra Stripe (ordern "Avbokning,
// återbetalning, omsändning och köparmeddelanden" 2026-10-12, STEG
// 2.2). Behövs för gratisordrar (ingen charge i Stripe att återbetala)
// och för ordrar där återbetalningen redan gjorts för hand.
//
// I ETT svep (se cancel_paid_order, 20261012020000_cancel_order_
// function.sql, och _shared/cancelOrder.ts): sätter ordern till
// 'cancelled', sätter dess biljetter till 'void', frigör kapacitet
// EXAKT en gång. Atomärt i databasen - admin-cancel-order anropar bara
// den delade funktionen, lägger ingen egen logik ovanpå.
//
// Rör ALDRIG Stripe, gör INGEN återbetalning. Har ordern en betalning
// (total_ore > 0) svarar funktionen med en tydlig varning om att
// pengarna måste återbetalas i Stripe för hand - avbokningen genomförs
// ändå.
//
// En avbokning gäller HELA ordern - ingen delavbokning. Följer av
// gratisbiljettsregeln (checkFreeTicketLimit): en gratisbiljett kan
// inte bestå utan minst en betald biljett i samma order.
//
// Idempotent: avbokning av en redan avbokad order är ett lyckat tomt
// anrop (ingen ny void, ingen ny frigörning - cancel_paid_order matchar
// bara status='paid', en redan 'cancelled' order ger en tom
// resultatmängd).
//
// Kräver giltig Supabase Auth-JWT (se _shared/organizerAuth.ts), och
// ordern måste höra till ett event som tillhör den inloggade
// användarens egen arrangör - 404 annars, samma mönster som övriga
// admin-funktioner.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { cancelPaidOrder } from '../_shared/cancelOrder.ts'

interface CancelOrderBody {
  order_id?: string
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

  let body: CancelOrderBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const orderId = (body.order_id ?? '').trim()
  if (!orderId) {
    return jsonResponse({ error: 'order_id krävs.' }, 400)
  }

  const supabase = createAdminClient()

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, status, total_ore, events!inner(organizer_id)')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) {
    return jsonResponse({ error: `Databasfel: ${orderError.message}` }, 500)
  }
  const orderEvent = order ? (Array.isArray(order.events) ? order.events[0] : order.events) : null
  if (!order || !orderEvent || orderEvent.organizer_id !== auth.organizerId) {
    return jsonResponse({ error: 'Ordern hittades inte.' }, 404)
  }

  if (order.status !== 'paid' && order.status !== 'cancelled') {
    return jsonResponse({ error: 'Bara betalda ordrar kan avbokas.' }, 400)
  }

  // Redan avbokad - idempotent framgång, inget nytt RPC-anrop behövs
  // (cancel_paid_order hade ändå returnerat en tom resultatmängd för
  // det här fallet, men vi vet redan svaret utan att fråga databasen).
  if (order.status === 'cancelled') {
    return jsonResponse({ result: 'cancelled', already_cancelled: true, warning: null })
  }

  let result
  try {
    result = await cancelPaidOrder(supabase, orderId)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Kunde inte avboka ordern.' }, 500)
  }

  // result.cancelled ska alltid vara true här (vi har redan bekräftat
  // status==='paid' ovan, ingen annan process bör hinna före oss mellan
  // den läsningen och RPC-anropet i praktiken) - men om det ändå skulle
  // bli false (ett race) svarar vi ändå framgångsrikt, inte med ett fel.
  return jsonResponse({
    result: 'cancelled',
    already_cancelled: !result.cancelled,
    voided_ticket_count: result.voidedTicketCount,
    warning:
      order.total_ore > 0
        ? 'Ordern hade en betalning. Återbetala den i Stripe för hand - den här åtgärden rör inte Stripe.'
        : null,
  })
})
