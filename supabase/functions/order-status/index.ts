// order-status
//
// Publik, minimal-exponerande funktion som bekräftelsesidan (/kop/:slug/klar)
// pollar mot efter en Stripe Checkout-redirect. Returnerar ENDAST status
// (och vid "paid", antal biljetter) - aldrig köparens namn/e-post eller
// andra fält från orders-raden.
//
// Detta är det rekommenderade alternativet (se Tilläggsorder, avsnitt 4)
// till en bred `create policy ... on orders for select to anon using (true)`
// -policy, som skulle exponera HELA raden (inklusive buyer_email/buyer_name)
// till anon-nyckeln så fort frontend gör en bredare select någon annan
// gång. En liten service-role-funktion med ett smalt svarsformat håller
// samma säkerhetsnivå som resten av repot (admin-event-tickets,
// scan-ticket m.fl. gör samma sak: aldrig lita på RLS ensamt för att
// begränsa vad anon kan se).
//
// GET order-status?order_id=<uuid>
// -> { status: "pending" | "paid" | "expired" | "cancelled", ticket_count: number | null,
//      tickets: { ticket_code: string, qr_url: string }[] | null,
//      event: { title: string, venue: string | null, starts_at: string | null } | null }
//
// "event" (ordern 2026-10-04: biljettkortet på bekräftelsesidan ska visa
// titel/datum/plats ovanför QR-koden, precis som mailet redan gör) - bara
// de tre fält som redan är publika via events SELECT-policyn, inget nytt
// läcker.
//
// `tickets` exponeras bara när status === 'paid', och innehåller ENDAST
// biljettkod + QR-bild-URL - inget annat från tickets-raden (t.ex.
// holder_name). Se Tilläggsordern "ScenPass-designmockupen" avsnitt 3.2:
// bekräftelsesidan ska visa den RIKTIGA QR-bilden (samma som redan
// skickas i mailet), inte ett fejkmönster. Bilderna ligger redan publikt
// i Storage-bucketen "qr" (laddas upp av stripe-webhook som
// <order_id>/<ticket.id>.png) - ingen ny lagring behövs, bara att bygga
// den publika URL:en här.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const url = new URL(req.url)
  const orderId = url.searchParams.get('order_id')
  if (!orderId) {
    return jsonResponse({ error: 'order_id krävs som query-param.' }, 400)
  }

  const supabase = createAdminClient()

  const { data: order, error } = await supabase
    .from('orders')
    .select('id, status, events(title, venue, starts_at)')
    .eq('id', orderId)
    .maybeSingle()

  if (error) {
    return jsonResponse({ error: `Databasfel: ${error.message}` }, 500)
  }
  if (!order) {
    return jsonResponse({ error: 'Ordern hittades inte.' }, 404)
  }

  // Samma försvarsmönster som public-events/public-embed för en embeddad
  // to-one-relation - PostgREST/klienttyperna kan ge antingen ett objekt
  // eller en array beroende på sammanhang.
  const event = Array.isArray(order.events) ? order.events[0] : order.events

  let tickets: { ticket_code: string; qr_url: string }[] | null = null

  if (order.status === 'paid') {
    const { data: ticketRows, error: ticketsError } = await supabase
      .from('tickets')
      .select('id, ticket_code')
      .eq('order_id', order.id)
      .order('ticket_code', { ascending: true })

    if (ticketsError) {
      return jsonResponse({ error: `Kunde inte hämta biljetter: ${ticketsError.message}` }, 500)
    }

    tickets = (ticketRows ?? []).map((t) => {
      const path = `${order.id}/${t.id}.png`
      const { data: publicUrlData } = supabase.storage.from('qr').getPublicUrl(path)
      return { ticket_code: t.ticket_code, qr_url: publicUrlData.publicUrl }
    })
  }

  // ticket_count räknas från de faktiska skapade tickets-raderna, inte
  // orders.qty (som lämnas null för nya kundvagns-ordrar - se
  // Tilläggsordern 2026-08-05, flera biljettyper i samma köp). Det är
  // dessutom mer robust än att summera order_items.qty, eftersom det
  // speglar vad som FAKTISKT skapades av stripe-webhook.
  return jsonResponse({
    status: order.status,
    ticket_count: order.status === 'paid' ? (tickets?.length ?? 0) : null,
    tickets,
    event: event
      ? { title: event.title, venue: event.venue, starts_at: toIso8601Seconds(event.starts_at) }
      : null,
  })
})
