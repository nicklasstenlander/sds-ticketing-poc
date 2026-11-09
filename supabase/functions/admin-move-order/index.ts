// admin-move-order
//
// Flyttar en betald order till en annan speltid av samma föreställning
// (2026-11). Hela ordern flyttas; gamla biljetter makuleras och nya
// biljetter med nya QR-koder skickas till köparen i ett nytt
// bekräftelsemejl. Själva flytten är atomär i databasfunktionen
// move_paid_order (se migrationen 20261109010000) - den här funktionen
// sköter bara behörighet, biljettkoder, QR-filer och mejlet.
//
// POST { order_id, target_event_id }
//
// Svar:
//   200 { result: 'moved', email_sent: boolean, ticket_count }
//   404 ordern hittas inte (fel arrangör/status/arkiverad - avslöjar inte vilket)
//   409 { error, code } - flytten gick inte (fullt, incheckad, fel biljettyper ...)
//
// Mejlet: samma mall och samma helper (attemptConfirmationEmail) som
// "Skicka biljetter igen", med force=true. Misslyckas mejlet är flytten
// ändå genomförd (svarar email_sent=false) - admin kan då använda
// "Skicka biljetter igen" på ordern.
//
// Loggar bara order-id och utfall - aldrig namn eller e-post.
import { instrumentEdgeFunctions } from '../_shared/sentry.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { generateTicketCode } from '../_shared/base32.ts'
import { attemptConfirmationEmail } from '../_shared/attemptConfirmationEmail.ts'
// @deno-types="npm:@types/qrcode@1"
import QRCode from 'npm:qrcode@1.5.3'

interface MoveBody {
  order_id?: string
  target_event_id?: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const OUTCOME_MESSAGES: Record<string, string> = {
  same_event: 'Ordern ligger redan på den speltiden.',
  invalid_target: 'Ordern kan bara flyttas till en annan publicerad speltid av samma föreställning.',
  checked_in: 'Minst en biljett på ordern är redan incheckad och kan inte flyttas.',
  type_mismatch: 'Speltiden saknar en biljettyp med samma namn som ordern - lägg till den först.',
  no_capacity: 'Det finns inte plats för hela ordern på den speltiden.',
}

function single<T>(rel: T | T[] | null): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel
}

await instrumentEdgeFunctions()

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

  let body: MoveBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const orderId = (body.order_id ?? '').trim()
  const targetEventId = (body.target_event_id ?? '').trim()
  if (!UUID_PATTERN.test(orderId) || !UUID_PATTERN.test(targetEventId)) {
    return jsonResponse({ error: 'order_id och target_event_id krävs.' }, 400)
  }

  const supabase = createAdminClient()

  // Antal biljetter (= antal nya koder). Ägarskapet kontrolleras igen,
  // låst, i move_paid_order - det här är bara för att veta hur många
  // koder som behövs och för att svara 404 tidigt.
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('qty, orders!inner(id, status, archived_at, events!inner(organizer_id))')
    .eq('order_id', orderId)
  if (itemsError) {
    return jsonResponse({ error: `Databasfel: ${itemsError.message}` }, 500)
  }
  const first = items?.[0]
  const firstOrder = first ? single(first.orders) : null
  const firstEvent = firstOrder ? single(firstOrder.events) : null
  if (!first || !firstOrder || !firstEvent || firstEvent.organizer_id !== auth.organizerId || firstOrder.status !== 'paid' || firstOrder.archived_at) {
    return jsonResponse({ error: 'Ordern hittades inte.' }, 404)
  }
  const totalQty = (items ?? []).reduce((sum, item) => sum + item.qty, 0)
  const ticketCodes = Array.from({ length: totalQty }, () => generateTicketCode())

  const { data: moveRow, error: moveError } = await supabase
    .rpc('move_paid_order', {
      p_order_id: orderId,
      p_target_event_id: targetEventId,
      p_organizer_id: auth.organizerId,
      p_ticket_codes: ticketCodes,
      p_moved_by: auth.userId,
    })
    .maybeSingle()
  if (moveError) {
    return jsonResponse({ error: `Kunde inte flytta ordern: ${moveError.message}` }, 500)
  }
  const move = moveRow as unknown as {
    outcome: string
    from_event_id: string | null
    to_event_id: string | null
    tickets: { id: string; ticket_code: string; ticket_type_id: string }[] | null
  } | null

  if (!move || move.outcome === 'not_found') {
    return jsonResponse({ error: 'Ordern hittades inte.' }, 404)
  }
  if (move.outcome !== 'moved') {
    return jsonResponse(
      { error: OUTCOME_MESSAGES[move.outcome] ?? 'Ordern kunde inte flyttas.', code: move.outcome },
      409,
    )
  }
  console.log(`admin-move-order: order ${orderId} flyttad ${move.from_event_id} -> ${move.to_event_id}.`)

  const newTickets = move.tickets ?? []

  // --- Från och med här är flytten genomförd. Fel nedan ger
  // email_sent=false, aldrig ett felsvar - admin kan skicka om. ---
  const emailSent = await sendMovedTickets(supabase, orderId, newTickets).catch((err) => {
    console.error('admin-move-order: kunde inte skicka nya biljetter för order', orderId, err instanceof Error ? err.message : err)
    return false
  })

  return jsonResponse({ result: 'moved', email_sent: emailSent, ticket_count: newTickets.length })
})

async function sendMovedTickets(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
  tickets: { id: string; ticket_code: string; ticket_type_id: string }[],
): Promise<boolean> {
  // QR-filer för de nya biljetterna, samma sökväg och format som
  // stripe-webhook (qr/<order_id>/<ticket_id>.png).
  const qrUrlById = new Map<string, string>()
  await Promise.all(
    tickets.map(async (ticket) => {
      const path = `${orderId}/${ticket.id}.png`
      const png: Uint8Array = await QRCode.toBuffer(ticket.ticket_code, {
        type: 'png',
        margin: 2,
        width: 320,
        errorCorrectionLevel: 'M',
      })
      const { error } = await supabase.storage.from('qr').upload(path, png, { contentType: 'image/png', upsert: true })
      if (error) throw new Error(`QR-uppladdning misslyckades: ${error.message}`)
      qrUrlById.set(ticket.id, supabase.storage.from('qr').getPublicUrl(path).data.publicUrl)
    }),
  )

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, buyer_name, buyer_email, paid_at, total_ore, events!inner(organizer_id, title, venue, starts_at)')
    .eq('id', orderId)
    .single()
  if (orderError || !order) throw new Error(orderError?.message ?? 'ordern saknas')
  const event = single(order.events)
  if (!event) throw new Error('eventet saknas')

  const [{ data: organizerRow }, { data: orderItems, error: itemsError }] = await Promise.all([
    supabase.from('organizers').select('legal_name, org_number, terms_url').eq('id', event.organizer_id).maybeSingle(),
    supabase.from('order_items').select('ticket_type_id, qty, unit_price_ore, vat_rate, ticket_types(name)').eq('order_id', orderId),
  ])
  if (itemsError || !orderItems) throw new Error(itemsError?.message ?? 'orderrader saknas')

  const typeNameById = new Map(orderItems.map((item) => [item.ticket_type_id, single(item.ticket_types)?.name ?? null]))

  const result = await attemptConfirmationEmail({
    supabase,
    orderId,
    paymentIntentId: null,
    paidAt: order.paid_at as string,
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    totalOre: order.total_ore,
    eventTitle: event.title,
    eventVenue: event.venue,
    eventStartsAt: event.starts_at as string,
    organizerLegalName: organizerRow?.legal_name ?? null,
    organizerOrgNumber: organizerRow?.org_number ?? null,
    organizerTermsUrl: organizerRow?.terms_url ?? null,
    orderItems: orderItems.map((item) => ({
      typeName: single(item.ticket_types)?.name ?? null,
      qty: item.qty,
      unitPriceOre: item.unit_price_ore,
      vatRate: item.vat_rate,
    })),
    ticketsWithQr: tickets.map((t) => ({
      ticket_code: t.ticket_code,
      qrUrl: qrUrlById.get(t.id) as string,
      typeName: typeNameById.get(t.ticket_type_id) ?? null,
    })),
    force: true,
  })
  return result.sent
}
