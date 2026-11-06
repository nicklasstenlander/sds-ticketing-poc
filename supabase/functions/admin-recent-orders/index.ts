// admin-recent-orders
//
// Senaste ordrarna för arrangören, 25 per sida, för tabellen "Senaste
// ordrar" på /admin/dashboard. Bara LÄSNING - inga skrivningar, ingen
// schemaändring. Kräver Supabase Auth-JWT (verify_jwt = true), och
// organizer_id härleds alltid server-side via resolveOrganizer(req) -
// samma mönster som admin-event-tickets.
//
// GET /admin-recent-orders?page=1
//   page: 1-baserad, default 1. En sida hämtas bara när admin-UI:t
//   faktiskt ber om den (klick på sidbyte), aldrig i förväg.
//
// Urval: ordrar med paid_at satt (dvs en biljett har faktiskt sålts -
// pending/utgångna checkouts syns inte), inte arkiverade, sorterade på
// paid_at nyast först. Status kan ändå vara 'cancelled' om ordern
// återbetalats i efterhand - den visas då med sin status.
//
// stripe_url byggs server-side: för payment_mode='connect' ligger
// betalningen på arrangörens eget Stripe-konto (konto-prefix i URL:en),
// för 'direct' på plattformskontot. Test/live avgörs av STRIPE_SECRET_KEY.
import { instrumentEdgeFunctions } from '../_shared/sentry.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'

await instrumentEdgeFunctions()

const PAGE_SIZE = 25

function stripePaymentUrl(paymentIntentId: string | null, stripeAccountId: string | null): string | null {
  if (!paymentIntentId) return null
  const isTest = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').startsWith('sk_test')
  const accountPart = stripeAccountId ? `${stripeAccountId}/` : ''
  return `https://dashboard.stripe.com/${accountPart}${isTest ? 'test/' : ''}payments/${paymentIntentId}`
}

interface OrderItemRow {
  qty: number
  unit_price_ore: number
  vat_rate: number
  ticket_types: { name: string } | null
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const auth = await resolveOrganizer(req)
  if (!auth) {
    return jsonResponse({ error: 'Ej behörig. Logga in i admin igen.' }, 401)
  }

  const url = new URL(req.url)
  const pageParam = Number.parseInt(url.searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = createAdminClient()

  const { data: organizer, error: organizerError } = await supabase
    .from('organizers')
    .select('id, payment_mode, stripe_account_id')
    .eq('id', auth.organizerId)
    .maybeSingle()

  if (organizerError || !organizer) {
    return jsonResponse({ error: 'Arrangören hittades inte.' }, 404)
  }

  const { data: orders, error: ordersError, count } = await supabase
    .from('orders')
    .select(
      'id, buyer_name, buyer_email, status, created_at, paid_at, total_ore, price_ore, qty, discount_amount_ore, stripe_payment_intent_id, confirmation_email_sent_at, event_id, events!inner(id, title, starts_at, venue, organizer_id), order_items(qty, unit_price_ore, vat_rate, ticket_types(name))',
      { count: 'exact' },
    )
    .eq('events.organizer_id', auth.organizerId)
    .not('paid_at', 'is', null)
    .is('archived_at', null)
    .order('paid_at', { ascending: false })
    .range(from, to)

  if (ordersError) {
    return jsonResponse({ error: `Kunde inte hämta ordrar: ${ordersError.message}` }, 500)
  }

  const stripeAccountForLinks = organizer.payment_mode === 'direct' ? null : organizer.stripe_account_id

  const formatted = (orders ?? []).map((o) => {
    const event = o.events as unknown as { id: string; title: string; starts_at: string | null; venue: string | null }
    const items = ((o.order_items as unknown as OrderItemRow[] | null) ?? []).map((i) => ({
      name: i.ticket_types?.name ?? null,
      qty: i.qty,
      unit_price_ore: i.unit_price_ore,
      vat_rate: i.vat_rate,
    }))
    const itemQty = items.reduce((sum, i) => sum + i.qty, 0)
    return {
      id: o.id,
      buyer_name: o.buyer_name,
      buyer_email: o.buyer_email,
      status: o.status,
      created_at: toIso8601Seconds(o.created_at),
      paid_at: toIso8601Seconds(o.paid_at),
      // Samma fallback som admin-event-tickets: order_items är sanningen
      // efter kundvagnen, äldre ordrar faller tillbaka på kolumnerna
      // direkt på ordern.
      total_ore: o.total_ore ?? (o.price_ore !== null && o.qty !== null ? o.price_ore * o.qty : null),
      ticket_qty: itemQty > 0 ? itemQty : (o.qty ?? 0),
      discount_amount_ore: o.discount_amount_ore ?? 0,
      confirmation_email_sent_at: toIso8601Seconds(o.confirmation_email_sent_at),
      stripe_payment_intent_id: o.stripe_payment_intent_id,
      stripe_url: stripePaymentUrl(o.stripe_payment_intent_id, stripeAccountForLinks),
      event: {
        id: event.id,
        title: event.title,
        starts_at: toIso8601Seconds(event.starts_at),
        venue: event.venue,
      },
      items,
    }
  })

  return jsonResponse({
    // Arrangörens id behövs av admin-UI:t för att lyssna på rätt
    // realtidskanal (se _shared/orderBroadcast.ts). Det är anroparens
    // EGEN arrangör - samma värde som admin-list-members redan returnerar.
    organizer_id: auth.organizerId,
    page,
    page_size: PAGE_SIZE,
    total: count ?? formatted.length,
    orders: formatted,
  })
})
