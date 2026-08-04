// create-order
//
// Publik funktion (anropas från /kop/:slug). Reserverar kapacitet atomiskt,
// skapar en order i status "pending" med en frusen pris/moms-ögonblicksbild
// från eventet, och skapar en Stripe Checkout Session i Test mode.
//
// Biljetter skapas INTE här längre - det görs först av stripe-webhook när
// betalningen faktiskt bekräftats (checkout.session.completed). Detta
// förhindrar att någon får biljetter utan att betala: fram tills webhooken
// kör finns bara en "pending"-order och en reserverad plats, inga biljetter.
//
// Returnerar { checkout_url } - frontenden gör en fullständig
// sidomdirigering (window.location.href) dit, inte en fetch/XHR, eftersom
// Stripe Checkout är en hostad sida som kräver en riktig navigering.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { createStripeClient, CHECKOUT_EXPIRY_MINUTES } from '../_shared/stripe.ts'

interface CreateOrderBody {
  slug?: string
  name?: string
  email?: string
  qty?: number
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  let body: CreateOrderBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const slug = (body.slug ?? '').trim()
  const buyerName = (body.name ?? '').trim()
  const buyerEmail = (body.email ?? '').trim().toLowerCase()
  const qty = Number(body.qty)

  if (!slug) return jsonResponse({ error: 'Event saknas.' }, 400)
  if (!buyerName) return jsonResponse({ error: 'Namn krävs.' }, 400)
  if (!EMAIL_REGEX.test(buyerEmail)) {
    return jsonResponse({ error: 'Ogiltig e-postadress.' }, 400)
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > 6) {
    return jsonResponse({ error: 'Antal biljetter måste vara mellan 1 och 6.' }, 400)
  }

  const frontendBaseUrl = (Deno.env.get('FRONTEND_BASE_URL') ?? '').replace(/\/+$/, '')
  if (!frontendBaseUrl) {
    return jsonResponse({ error: 'FRONTEND_BASE_URL är inte konfigurerad på servern.' }, 500)
  }

  const supabase = createAdminClient()

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, slug, title, venue, starts_at, capacity, sold_count, status, price_ore, vat_rate')
    .eq('slug', slug)
    .maybeSingle()

  if (eventError) {
    return jsonResponse({ error: `Databasfel: ${eventError.message}` }, 500)
  }
  if (!event || event.status !== 'published') {
    return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
  }

  // Atomisk kapacitetsreservation - se motivering i den ursprungliga
  // kommentaren (bevarad): detta enda UPDATE-anrop är det som avgör om det
  // finns plats, atomiskt via WHERE-villkoret i samma sats.
  const { data: reserved, error: reserveError } = await supabase.rpc(
    'reserve_event_capacity',
    { p_event_id: event.id, p_qty: qty },
  )

  if (reserveError) {
    return jsonResponse({ error: `Kunde inte reservera platser: ${reserveError.message}` }, 500)
  }
  if (!reserved || reserved.length === 0) {
    return jsonResponse({ error: 'slutsålt' }, 409)
  }

  const expiresAt = new Date(Date.now() + CHECKOUT_EXPIRY_MINUTES * 60 * 1000)

  // Skapa order i status "pending" - pris/moms fryses här (ögonblicksbild
  // från eventet vid köptillfället, se migrationskommentaren i
  // 20260101000300_stripe_vat_export.sql) så att en senare ändring av
  // eventets pris/momssats aldrig kan ändra bokföringen för denna order i
  // efterhand.
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      event_id: event.id,
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      qty,
      status: 'pending',
      price_ore: event.price_ore,
      vat_rate: event.vat_rate,
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single()

  if (orderError || !order) {
    // Rulla tillbaka kapacitetsreservationen om ordern inte kunde skapas.
    await supabase.rpc('release_event_capacity', { p_event_id: event.id, p_qty: qty })
    return jsonResponse({ error: `Kunde inte skapa order: ${orderError?.message}` }, 500)
  }

  // Skapa Stripe Checkout Session (Test mode - se _shared/stripe.ts).
  let session
  try {
    const stripe = createStripeClient()
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: buyerEmail,
      client_reference_id: order.id,
      line_items: [
        {
          quantity: qty,
          price_data: {
            currency: 'sek',
            unit_amount: event.price_ore,
            product_data: {
              name: event.title,
              description: event.venue ? `${event.venue}` : undefined,
            },
          },
        },
      ],
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      success_url: `${frontendBaseUrl}/#/kop/${event.slug}/klar?order=${order.id}`,
      // Går tillbaka till köpsidan (inte bekräftelsesidan) om kunden avbryter
      // i Stripe Checkout utan att betala - ordern förblir "pending" (den
      // sätts inte "cancelled" av detta) och städas bort av
      // checkout.session.expired-webhooken eller release-expired-orders när
      // expires_at passeras, så kunden kan bara försöka igen direkt.
      cancel_url: `${frontendBaseUrl}/#/kop/${event.slug}`,
      metadata: {
        order_id: order.id,
        event_id: event.id,
      },
    })
  } catch (err) {
    // Rulla tillbaka både kapacitetsreservationen och ordern om Stripe-
    // anropet misslyckas, så att köparen inte lämnas med en pending-order
    // som aldrig kommer kunna betalas.
    await supabase.from('orders').delete().eq('id', order.id)
    await supabase.rpc('release_event_capacity', { p_event_id: event.id, p_qty: qty })
    const message = err instanceof Error ? err.message : 'Okänt Stripe-fel.'
    return jsonResponse({ error: `Kunde inte skapa Stripe Checkout-session: ${message}` }, 502)
  }

  if (!session.url) {
    await supabase.from('orders').delete().eq('id', order.id)
    await supabase.rpc('release_event_capacity', { p_event_id: event.id, p_qty: qty })
    return jsonResponse({ error: 'Stripe returnerade ingen checkout-URL.' }, 502)
  }

  const { error: updateError } = await supabase
    .from('orders')
    .update({ stripe_session_id: session.id })
    .eq('id', order.id)

  if (updateError) {
    return jsonResponse({ error: `Kunde inte spara Stripe-session: ${updateError.message}` }, 500)
  }

  return jsonResponse({ checkout_url: session.url }, 200)
})
