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
// -> { status: "pending" | "paid" | "expired" | "cancelled", ticket_count: number | null }
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

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
    .select('id, status, qty')
    .eq('id', orderId)
    .maybeSingle()

  if (error) {
    return jsonResponse({ error: `Databasfel: ${error.message}` }, 500)
  }
  if (!order) {
    return jsonResponse({ error: 'Ordern hittades inte.' }, 404)
  }

  return jsonResponse({
    status: order.status,
    ticket_count: order.status === 'paid' ? order.qty : null,
  })
})
