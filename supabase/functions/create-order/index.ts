// create-order
//
// Publik funktion (anropas från /kop/:slug). Tar emot en KUNDVAGN - en
// eller flera rader, var och en en biljettyp + ett antal (t.ex. 2
// Ordinarie + 1 Barn i samma köp, se Tilläggsordern 2026-08-05 "Flera
// biljettyper i samma köp"). En valfri rabattkod tillämpas på hela
// kundvagnen. Reserverar kapacitet atomiskt för HELA kundvagnen i EN
// kontroll mot eventets delade pool (se rättelseordern 2026-08-05, delad
// kapacitetspool), skapar en order-header i status "pending" plus en
// order_items-rad per kundvagnsrad, och skapar en Stripe Checkout Session
// med flera line_items.
//
// Biljetter skapas INTE här längre - det görs först av stripe-webhook när
// betalningen faktiskt bekräftats (checkout.session.completed).
//
// Rabattkodens used_count ökas INTE här - bara vid bekräftad betalning (i
// stripe-webhook), annars skulle koden förbrukas av övergivna checkouts.
//
// Returnerar { checkout_url } - frontenden gör en fullständig
// sidomdirigering (window.location.href) dit.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { createStripeClient, CHECKOUT_EXPIRY_MINUTES } from '../_shared/stripe.ts'

interface CartItemInput {
  ticket_type_id?: string
  qty?: number
}

interface CreateOrderBody {
  slug?: string
  items?: CartItemInput[]
  name?: string
  email?: string
  discount_code?: string
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_TOTAL_QTY = 6

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

interface CartLine {
  ticketTypeId: string
  name: string
  qty: number
  unitPriceOre: number
  vatRate: number
  unitPriceAfterOre: number
}

/** Validerar en rabattkod mot ett event. Returnerar ett köparvänligt
 * felmeddelande om koden inte gäller - ALDRIG tyst ignorerad. */
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

/**
 * Applicerar en rabattkod på kundvagnens rader, i-place (sätter
 * unitPriceAfterOre på varje rad). Se Tilläggsordern avsnitt 3:
 *   - percent: samma procentsats på varje rads unit_price_ore direkt -
 *     exakt och radvis oberoende, ingen tvärradsreconciliation behövs.
 *   - amount: fördelas proportionellt mot varje rads andel av
 *     totalsumman. Radernas MÅL-rabatt (line-nivå, innan konvertering
 *     till ett enhetspris) avrundas med "störst rest"-metoden så att
 *     summan alltid exakt matchar discount_codes.value (fyllnadsöre
 *     läggs på den dyraste raden). Det målet konverteras sedan till ett
 *     enhetspris (radens rabatt / antal, avrundat) - i vanliga fall
 *     (jämna belopp, antal som går jämnt upp) blir resultatet identiskt;
 *     i extremfall med udda kombinationer kan enhetspriset avrunda bort
 *     enstaka ören jämfört med det exakta radmålet. Den faktiskt
 *     REALISERADE rabatten (vad kunden faktiskt debiteras mindre) räknas
 *     alltid ärligt ut i efterhand från de färdiga enhetspriserna, se
 *     discountAmountOre i anropande kod - ingen risk för att
 *     bokföringen och det som faktiskt debiterats går isär.
 */
function applyDiscountToLines(lines: CartLine[], code: DiscountCodeRow): void {
  if (code.discount_type === 'percent') {
    for (const line of lines) {
      line.unitPriceAfterOre = Math.round((line.unitPriceOre * (100 - code.value)) / 100)
    }
    return
  }

  // amount
  const totalSubtotal = lines.reduce((sum, l) => sum + l.unitPriceOre * l.qty, 0)
  if (totalSubtotal <= 0) {
    for (const line of lines) line.unitPriceAfterOre = line.unitPriceOre
    return
  }

  const lineTargets = lines.map((l) => Math.floor((code.value * (l.unitPriceOre * l.qty)) / totalSubtotal))
  const distributed = lineTargets.reduce((sum, v) => sum + v, 0)
  const remainder = code.value - distributed
  if (remainder > 0) {
    let priciestIdx = 0
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].unitPriceOre > lines[priciestIdx].unitPriceOre) priciestIdx = i
    }
    lineTargets[priciestIdx] += remainder
  }

  lines.forEach((line, i) => {
    const perUnitDiscount = Math.round(lineTargets[i] / line.qty)
    line.unitPriceAfterOre = Math.max(0, line.unitPriceOre - perUnitDiscount)
  })
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
  const buyerName = (body.name ?? '').trim()
  const buyerEmail = (body.email ?? '').trim().toLowerCase()
  const discountCodeInput = (body.discount_code ?? '').trim()
  const rawItems = Array.isArray(body.items) ? body.items : []

  if (!slug) return jsonResponse({ error: 'Event saknas.' }, 400)
  if (!buyerName) return jsonResponse({ error: 'Namn krävs.' }, 400)
  if (!EMAIL_REGEX.test(buyerEmail)) {
    return jsonResponse({ error: 'Ogiltig e-postadress.' }, 400)
  }
  if (rawItems.length === 0) {
    return jsonResponse({ error: 'Kundvagnen är tom - välj minst en biljett.' }, 400)
  }

  const parsedItems: { ticketTypeId: string; qty: number }[] = []
  const seenTicketTypeIds = new Set<string>()
  for (const item of rawItems) {
    const ticketTypeId = (item.ticket_type_id ?? '').trim()
    const qty = Number(item.qty)
    if (!ticketTypeId) return jsonResponse({ error: 'ticket_type_id saknas på en rad.' }, 400)
    if (!Number.isInteger(qty) || qty < 1) {
      return jsonResponse({ error: 'Antal måste vara ett heltal >= 1 på varje rad.' }, 400)
    }
    if (seenTicketTypeIds.has(ticketTypeId)) {
      return jsonResponse({ error: 'En biljettyp kan bara förekomma en gång i kundvagnen.' }, 400)
    }
    seenTicketTypeIds.add(ticketTypeId)
    parsedItems.push({ ticketTypeId, qty })
  }

  const totalQty = parsedItems.reduce((sum, i) => sum + i.qty, 0)
  if (totalQty > MAX_TOTAL_QTY) {
    return jsonResponse({ error: `Max ${MAX_TOTAL_QTY} biljetter per köp.` }, 400)
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

  const { data: ticketTypeRows, error: ticketTypesError } = await supabase
    .from('ticket_types')
    .select('id, event_id, name, price_ore, vat_rate')
    .in(
      'id',
      parsedItems.map((i) => i.ticketTypeId),
    )

  if (ticketTypesError) {
    return jsonResponse({ error: `Databasfel: ${ticketTypesError.message}` }, 500)
  }

  const ticketTypeById = new Map((ticketTypeRows ?? []).map((t) => [t.id, t]))
  const lines: CartLine[] = []
  for (const item of parsedItems) {
    const tt = ticketTypeById.get(item.ticketTypeId)
    if (!tt || tt.event_id !== event.id) {
      return jsonResponse({ error: 'En eller flera biljettyper hittades inte för det här eventet.' }, 404)
    }
    lines.push({
      ticketTypeId: tt.id,
      name: tt.name,
      qty: item.qty,
      unitPriceOre: tt.price_ore,
      vatRate: tt.vat_rate,
      unitPriceAfterOre: tt.price_ore,
    })
  }

  // Rabattkod - valfri, tillämpas på hela kundvagnen. Ogiltig/utgången/
  // slut kod ger 400 med ett tydligt felmeddelande, aldrig tyst ignorerad.
  let discountCode: DiscountCodeRow | null = null
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
    applyDiscountToLines(lines, discountCode)
  }

  const totalOre = lines.reduce((sum, l) => sum + l.unitPriceAfterOre * l.qty, 0)
  const discountAmountOre = lines.reduce(
    (sum, l) => sum + (l.unitPriceOre - l.unitPriceAfterOre) * l.qty,
    0,
  )

  // Atomisk kapacitetsreservation för HELA kundvagnen i en enda kontroll
  // mot eventets delade pool - nekas hela ordern om totalen inte får
  // plats, även om en enskild rad för sig hade fått plats.
  const itemsJson = parsedItems.map((i) => ({ ticket_type_id: i.ticketTypeId, qty: i.qty }))
  const { data: reserved, error: reserveError } = await supabase.rpc('reserve_shared_capacity_multi', {
    p_event_id: event.id,
    p_items: itemsJson,
    p_total_qty: totalQty,
  })

  if (reserveError) {
    return jsonResponse({ error: `Kunde inte reservera platser: ${reserveError.message}` }, 500)
  }
  if (!reserved || reserved.length === 0) {
    return jsonResponse({ error: 'slutsålt' }, 409)
  }

  const expiresAt = new Date(Date.now() + CHECKOUT_EXPIRY_MINUTES * 60 * 1000)

  // orders är numera en header - ticket_type_id/price_ore/vat_rate/qty
  // lämnas null (de finns kvar i schemat bara för historiska,
  // förkundvagns-ordrar). total_ore + order_items är sanningen för nya
  // köp.
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      event_id: event.id,
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      status: 'pending',
      total_ore: totalOre,
      expires_at: expiresAt.toISOString(),
      discount_code_id: discountCode?.id ?? null,
      discount_amount_ore: discountAmountOre,
    })
    .select()
    .single()

  async function rollbackCapacity() {
    await supabase.rpc('release_shared_capacity_multi', {
      p_event_id: event.id,
      p_items: itemsJson,
      p_total_qty: totalQty,
    })
  }

  if (orderError || !order) {
    await rollbackCapacity()
    return jsonResponse({ error: `Kunde inte skapa order: ${orderError?.message}` }, 500)
  }

  const { error: itemsError } = await supabase.from('order_items').insert(
    lines.map((l) => ({
      order_id: order.id,
      ticket_type_id: l.ticketTypeId,
      qty: l.qty,
      unit_price_ore: l.unitPriceAfterOre,
      vat_rate: l.vatRate,
    })),
  )

  if (itemsError) {
    await supabase.from('orders').delete().eq('id', order.id)
    await rollbackCapacity()
    return jsonResponse({ error: `Kunde inte skapa orderrader: ${itemsError.message}` }, 500)
  }

  // Skapa Stripe Checkout Session (Test mode - se _shared/stripe.ts) - ett
  // line_item per kundvagnsrad, med biljettypens namn i product_data.name.
  let session
  try {
    const stripe = createStripeClient()
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: buyerEmail,
      client_reference_id: order.id,
      line_items: lines.map((l) => ({
        quantity: l.qty,
        price_data: {
          currency: 'sek',
          unit_amount: l.unitPriceAfterOre,
          product_data: {
            name: `${event.title} — ${l.name}`,
            description: event.venue ? `${event.venue}` : undefined,
          },
        },
      })),
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      success_url: `${frontendBaseUrl}/#/kop/${event.slug}/klar?order=${order.id}`,
      cancel_url: `${frontendBaseUrl}/#/kop/${event.slug}`,
      metadata: {
        order_id: order.id,
        event_id: event.id,
      },
    })
  } catch (err) {
    await supabase.from('order_items').delete().eq('order_id', order.id)
    await supabase.from('orders').delete().eq('id', order.id)
    await rollbackCapacity()
    const message = err instanceof Error ? err.message : 'Okänt Stripe-fel.'
    return jsonResponse({ error: `Kunde inte skapa Stripe Checkout-session: ${message}` }, 502)
  }

  if (!session.url) {
    await supabase.from('order_items').delete().eq('order_id', order.id)
    await supabase.from('orders').delete().eq('id', order.id)
    await rollbackCapacity()
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
