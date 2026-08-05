// create-order
//
// Publik funktion (anropas från /kop/:slug). Tar emot en biljettyp
// (ticket_type_id), ett antal av den typen (aldrig flera typer i samma
// köp - se Tilläggsordern avsnitt 0, antagande 1) och en valfri
// rabattkod. Reserverar kapacitet atomiskt PÅ BILJETTYPEN, skapar en
// order i status "pending" med en frusen pris/moms-ögonblicksbild
// (rabatterat pris om en giltig kod angavs), och skapar en Stripe
// Checkout Session i Test mode.
//
// Biljetter skapas INTE här längre - det görs först av stripe-webhook när
// betalningen faktiskt bekräftats (checkout.session.completed). Detta
// förhindrar att någon får biljetter utan att betala: fram tills webhooken
// kör finns bara en "pending"-order och en reserverad plats, inga biljetter.
//
// Rabattkodens used_count ökas INTE här - bara vid bekräftad betalning (i
// stripe-webhook), annars skulle koden förbrukas av övergivna checkouts.
//
// Returnerar { checkout_url } - frontenden gör en fullständig
// sidomdirigering (window.location.href) dit, inte en fetch/XHR, eftersom
// Stripe Checkout är en hostad sida som kräver en riktig navigering.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { createStripeClient, CHECKOUT_EXPIRY_MINUTES } from '../_shared/stripe.ts'

interface CreateOrderBody {
  slug?: string
  ticket_type_id?: string
  qty?: number
  name?: string
  email?: string
  discount_code?: string
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface DiscountCodeRow {
  id: string
  code: string
  discount_type: 'percent' | 'amount'
  value: number
  event_id: string | null
  max_uses: number | null
  used_count: number
  valid_from: string | null
  valid_until: string | null
  active: boolean
}

/** Validerar en rabattkod mot ett event. Kastar ett fel med ett
 * köparvänligt meddelande om koden inte gäller - koden ska ALDRIG bara
 * tyst ignoreras (se Tilläggsordern avsnitt 3). */
function validateDiscountCode(code: DiscountCodeRow, eventId: string): string | null {
  if (!code.active) return 'Rabattkoden är inte längre giltig.'
  const now = Date.now()
  if (code.valid_from && now < Date.parse(code.valid_from)) {
    return 'Rabattkoden gäller inte ännu.'
  }
  if (code.valid_until && now > Date.parse(code.valid_until)) {
    return 'Rabattkoden har gått ut.'
  }
  if (code.max_uses !== null && code.used_count >= code.max_uses) {
    return 'Rabattkoden är slut (max antal användningar nått).'
  }
  if (code.event_id !== null && code.event_id !== eventId) {
    return 'Rabattkoden gäller inte för det här eventet.'
  }
  return null
}

function applyDiscount(priceOre: number, code: DiscountCodeRow): number {
  if (code.discount_type === 'percent') {
    return Math.round((priceOre * (100 - code.value)) / 100)
  }
  return Math.max(0, priceOre - code.value)
}

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
  const ticketTypeId = (body.ticket_type_id ?? '').trim()
  const buyerName = (body.name ?? '').trim()
  const buyerEmail = (body.email ?? '').trim().toLowerCase()
  const qty = Number(body.qty)
  const discountCodeInput = (body.discount_code ?? '').trim()

  if (!slug) return jsonResponse({ error: 'Event saknas.' }, 400)
  if (!ticketTypeId) return jsonResponse({ error: 'Biljettyp saknas.' }, 400)
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
    .select('id, slug, title, venue, starts_at, status')
    .eq('slug', slug)
    .maybeSingle()

  if (eventError) {
    return jsonResponse({ error: `Databasfel: ${eventError.message}` }, 500)
  }
  if (!event || event.status !== 'published') {
    return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
  }

  const { data: ticketType, error: ticketTypeError } = await supabase
    .from('ticket_types')
    .select('id, event_id, name, price_ore, vat_rate, capacity, sold_count')
    .eq('id', ticketTypeId)
    .maybeSingle()

  if (ticketTypeError) {
    return jsonResponse({ error: `Databasfel: ${ticketTypeError.message}` }, 500)
  }
  if (!ticketType || ticketType.event_id !== event.id) {
    return jsonResponse({ error: 'Biljettypen hittades inte för det här eventet.' }, 404)
  }

  // Rabattkod - valfri. Ogiltig/utgången/slut kod ger 400 med ett tydligt
  // felmeddelande, aldrig tyst ignorerad.
  let discountCode: DiscountCodeRow | null = null
  let priceOre = ticketType.price_ore
  if (discountCodeInput) {
    const { data: codeRow, error: codeError } = await supabase
      .from('discount_codes')
      .select(
        'id, code, discount_type, value, event_id, max_uses, used_count, valid_from, valid_until, active',
      )
      .ilike('code', discountCodeInput)
      .maybeSingle()

    if (codeError) {
      return jsonResponse({ error: `Databasfel: ${codeError.message}` }, 500)
    }
    if (!codeRow) {
      return jsonResponse({ error: 'Rabattkoden finns inte.' }, 400)
    }
    const validationError = validateDiscountCode(codeRow as DiscountCodeRow, event.id)
    if (validationError) {
      return jsonResponse({ error: validationError }, 400)
    }
    discountCode = codeRow as DiscountCodeRow
    priceOre = applyDiscount(ticketType.price_ore, discountCode)
  }
  const discountAmountOre = ticketType.price_ore - priceOre

  // Atomisk kapacitetsreservation - detta enda UPDATE-anrop är det som
  // avgör om det finns plats, atomiskt via WHERE-villkoret i samma sats.
  // Reserveras nu på biljettypen, inte på eventet.
  const { data: reserved, error: reserveError } = await supabase.rpc(
    'reserve_ticket_type_capacity',
    { p_ticket_type_id: ticketType.id, p_qty: qty },
  )

  if (reserveError) {
    return jsonResponse({ error: `Kunde inte reservera platser: ${reserveError.message}` }, 500)
  }
  if (!reserved || reserved.length === 0) {
    return jsonResponse({ error: 'slutsålt' }, 409)
  }

  const expiresAt = new Date(Date.now() + CHECKOUT_EXPIRY_MINUTES * 60 * 1000)

  // Skapa order i status "pending" - pris/moms fryses här (redan
  // rabatterat om en kod tillämpades). discount_amount_ore är enbart för
  // spårbarhet/visning, inte en andra beräkningskälla - price_ore är den
  // bindande sanningen.
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      event_id: event.id,
      ticket_type_id: ticketType.id,
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      qty,
      status: 'pending',
      price_ore: priceOre,
      vat_rate: ticketType.vat_rate,
      expires_at: expiresAt.toISOString(),
      discount_code_id: discountCode?.id ?? null,
      discount_amount_ore: discountAmountOre,
    })
    .select()
    .single()

  if (orderError || !order) {
    // Rulla tillbaka kapacitetsreservationen om ordern inte kunde skapas.
    await supabase.rpc('release_ticket_type_capacity', { p_ticket_type_id: ticketType.id, p_qty: qty })
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
            unit_amount: priceOre,
            product_data: {
              name: `${event.title} — ${ticketType.name}`,
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
        ticket_type_id: ticketType.id,
      },
    })
  } catch (err) {
    // Rulla tillbaka både kapacitetsreservationen och ordern om Stripe-
    // anropet misslyckas, så att köparen inte lämnas med en pending-order
    // som aldrig kommer kunna betalas.
    await supabase.from('orders').delete().eq('id', order.id)
    await supabase.rpc('release_ticket_type_capacity', { p_ticket_type_id: ticketType.id, p_qty: qty })
    const message = err instanceof Error ? err.message : 'Okänt Stripe-fel.'
    return jsonResponse({ error: `Kunde inte skapa Stripe Checkout-session: ${message}` }, 502)
  }

  if (!session.url) {
    await supabase.from('orders').delete().eq('id', order.id)
    await supabase.rpc('release_ticket_type_capacity', { p_ticket_type_id: ticketType.id, p_qty: qty })
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
