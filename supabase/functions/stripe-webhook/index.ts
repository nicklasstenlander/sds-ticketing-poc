// stripe-webhook
//
// Tar emot webhooks från Stripe (Live mode - se README avsnitt 8/8b för
// hur de två destinationerna, plattform och Connect, är konfigurerade).
// Detta är den ENDA plats i systemet där en order övergår från
// "pending" till "paid" och där biljetter faktiskt skapas - klienten
// kan aldrig trigga detta själv, så ingen kan få biljetter utan en av
// Stripe bekräftad betalning.
//
// Hanterar:
//   checkout.session.completed - betalning bekräftad: markera ordern paid,
//     skapa biljetter (per order_items-rad, en kundvagn kan ha flera
//     biljettyper - se Tilläggsordern 2026-08-05) + QR-koder, skicka
//     bekräftelsemail (i bakgrunden via EdgeRuntime.waitUntil så att vi
//     kan svara Stripe snabbt).
//   checkout.session.expired - sessionen gick ut utan betalning: markera
//     ordern expired och återför HELA kundvagnens reserverade kapacitet i
//     en enda kontroll mot eventets delade pool (se rättelseordern,
//     2026-08-05).
//   account.updated - Stripe Connect-kontostatus ändrad (Tilläggsordern
//     2026-08-06, "Stripe Connect - eget underkonto per arrangör"): sätter
//     stripe_onboarding_complete=true när kontot faktiskt kan ta emot
//     betalningar. Kräver att webhook-endpointen i Stripe Dashboard har
//     "Listen to events on Connected accounts" ikryssad, annars kommer
//     dessa events aldrig fram (se README avsnitt 8b).
//
// Idempotens: Stripe kan leverera samma event flera gånger (retries). Vi
// försöker INSERT:a (provider, provider_event_id) i webhook_events INNAN vi
// gör några ändringar - misslyckas den INSERT:en (unique violation, kod
// 23505) har eventet redan hanterats en gång och vi svarar 200 direkt utan
// att upprepa arbetet (framför allt: utan att skicka mailet igen eller
// skapa dubbla biljetter).
//
// verify_jwt = false i config.toml (se kommentaren där) - Stripe skickar
// ingen Supabase-JWT, bara en stripe-signature-header som vi verifierar
// själva nedan.
import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { createStripeClient } from '../_shared/stripe.ts'
import { generateTicketCode } from '../_shared/base32.ts'
// sendConfirmationEmail/fetchPaymentMethodType flyttade till _shared
// (ordern "Avbokning, återbetalning, omsändning och köparmeddelanden"
// 2026-10-12, STEG 2.1) - OFÖRÄNDRAD kod, bara flyttad, så att
// admin-resend-tickets kan återanvända exakt samma funktion, PDF-bilaga
// inkluderad, istället för en egen kopia.
import { sendConfirmationEmail, fetchPaymentMethodType } from '../_shared/sendConfirmationEmail.ts'
import { shouldReleaseAfterExpiryUpdate } from './expiryGuard.ts'
// @deno-types="npm:@types/qrcode@1"
import QRCode from 'npm:qrcode@1.5.3'
import type Stripe from 'npm:stripe@17'

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: corsHeaders })
}

interface OrderItemRow {
  ticket_type_id: string
  qty: number
}

/** Läser order_items för en order och bygger både p_items-jsonb och
 * totalQty som reserve/release_shared_capacity_multi förväntar sig. */
async function loadCartItems(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
): Promise<{ items: { ticket_type_id: string; qty: number }[]; totalQty: number }> {
  const { data, error } = await supabase
    .from('order_items')
    .select('ticket_type_id, qty')
    .eq('order_id', orderId)

  if (error) {
    console.error('Kunde inte hämta order_items', orderId, error.message)
    return { items: [], totalQty: 0 }
  }

  const rows = (data ?? []) as OrderItemRow[]
  return {
    items: rows.map((r) => ({ ticket_type_id: r.ticket_type_id, qty: r.qty })),
    totalQty: rows.reduce((sum, r) => sum + r.qty, 0),
  }
}

function single<T>(rel: T | T[] | null): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const supabase = createAdminClient()
  const orderId = session.client_reference_id ?? session.metadata?.order_id
  if (!orderId) {
    console.error('checkout.session.completed utan client_reference_id/metadata.order_id', session.id)
    return
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, event_id, buyer_name, buyer_email, status, discount_code_id, total_ore')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError || !order) {
    console.error('Hittade ingen order för Stripe-session', session.id, orderError?.message)
    return
  }

  // Redan hanterad (t.ex. om webhook_events-spärren av någon anledning
  // passerades förbi men ordern redan är paid) - gör inget mer.
  if (order.status !== 'pending') return

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, slug, title, venue, starts_at, organizer_id')
    .eq('id', order.event_id)
    .maybeSingle()

  if (eventError || !event) {
    console.error('Hittade inget event för order', order.id, eventError?.message)
    return
  }

  const { data: orderItems, error: orderItemsError } = await supabase
    .from('order_items')
    .select('id, ticket_type_id, qty, unit_price_ore, vat_rate, ticket_types(name)')
    .eq('order_id', order.id)

  if (orderItemsError || !orderItems || orderItems.length === 0) {
    console.error('Hittade inga order_items för betald order', order.id, orderItemsError?.message)
    return
  }

  // Kvittodel i biljettmailet (ordern 2026-10-01, A5) - säljarens
  // legal_name/org_number. Saknas legal_name för arrangören: hoppa över
  // säljarraden helt, kraschar inte - se filkommentaren vid
  // sendConfirmationEmail. terms_url (ordern "Före försäljning"
  // 2026-10-05, 1.3) - samma fält som redan styr köpsidans
  // villkorskryssruta (create-order), återanvänds här bara för att visa
  // en länk i mailet.
  const { data: organizerRow, error: organizerRowError } = await supabase
    .from('organizers')
    .select('legal_name, org_number, terms_url')
    .eq('id', event.organizer_id)
    .maybeSingle()
  if (organizerRowError) {
    console.error('Kunde inte hämta arrangör för kvitto', order.id, organizerRowError.message)
  }

  const paidAt = new Date().toISOString()
  const { error: updateOrderError } = await supabase
    .from('orders')
    .update({ status: 'paid', paid_at: paidAt })
    .eq('id', order.id)
    .eq('status', 'pending') // extra skydd mot dubbelbearbetning vid race

  if (updateOrderError) {
    console.error('Kunde inte markera order som paid', order.id, updateOrderError.message)
    return
  }

  // Skapa biljetter med slumpmässiga koder - en rad per order_items-rad
  // (kundvagnen kan blanda flera biljettyper i samma order), qty biljetter
  // per rad, alla med rätt ticket_type_id.
  const ticketRows = orderItems.flatMap((item) =>
    Array.from({ length: item.qty }, () => ({
      order_id: order.id,
      event_id: event.id,
      ticket_type_id: item.ticket_type_id,
      ticket_code: generateTicketCode(),
      holder_name: order.buyer_name,
      status: 'valid' as const,
    })),
  )

  const { data: tickets, error: ticketsError } = await supabase
    .from('tickets')
    .insert(ticketRows)
    .select()

  if (ticketsError || !tickets) {
    console.error('Kunde inte skapa biljetter för betald order', order.id, ticketsError?.message)
    return
  }

  // Rabattkodens used_count ökas bara vid bekräftad betalning (här),
  // aldrig i create-order - annars förbrukas koden av övergivna
  // checkouts. Sker en gång per order oavsett hur många rader den har.
  if (order.discount_code_id) {
    const { error: discountUpdateError } = await supabase.rpc('increment_discount_code_used_count', {
      p_discount_code_id: order.discount_code_id,
    })
    if (discountUpdateError) {
      console.error('Kunde inte öka used_count för rabattkod', order.discount_code_id, discountUpdateError.message)
    }
  }

  // Biljettypens namn per ticket_type_id - för biljett-PDF:ens
  // "BILJETTYP"-rad (ordern "Biljett-PDF" 2026-10-05). Samma namnkälla
  // som kvittots lines nedan (orderItems.ticket_types(name)).
  const ticketTypeNameById = new Map(orderItems.map((item) => [item.ticket_type_id, single(item.ticket_types)?.name ?? null]))

  const ticketsWithQr: { ticket_code: string; qrUrl: string; typeName: string | null }[] = []
  for (const ticket of tickets) {
    const pngBuffer: Uint8Array = await QRCode.toBuffer(ticket.ticket_code, {
      type: 'png',
      margin: 2,
      width: 320,
      errorCorrectionLevel: 'M',
    })

    const path = `${order.id}/${ticket.id}.png`
    const { error: uploadError } = await supabase.storage
      .from('qr')
      .upload(path, pngBuffer, { contentType: 'image/png', upsert: true })

    if (uploadError) {
      console.error('Kunde inte ladda upp QR-kod', ticket.id, uploadError.message)
      continue
    }

    const { data: publicUrlData } = supabase.storage.from('qr').getPublicUrl(path)
    ticketsWithQr.push({
      ticket_code: ticket.ticket_code,
      qrUrl: publicUrlData.publicUrl,
      typeName: ticketTypeNameById.get(ticket.ticket_type_id) ?? null,
    })
  }

  // Mailutskicket köas i bakgrunden via EdgeRuntime.waitUntil() istället för
  // att awaitas här. Stripe förväntar sig ett snabbt 200-svar på webhooken
  // (annars räknas den som misslyckad och skickas om) - Resend-anropet ska
  // inte få fördröja det svaret. EdgeRuntime är en global som bara finns i
  // Supabase Edge Functions-runtimen (inte i lokal `deno test` etc), därför
  // det defensiva fallbacket till en vanlig (fire-and-forget) await.
  const paymentMethod = await fetchPaymentMethodType(session)
  const emailPromise = sendConfirmationEmail({
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    eventTitle: event.title,
    eventVenue: event.venue,
    eventStartsAt: event.starts_at,
    orderId: order.id,
    paidAt,
    tickets: ticketsWithQr,
    termsUrl: organizerRow?.terms_url ?? null,
    receipt: {
      sellerLegalName: organizerRow?.legal_name ?? null,
      sellerOrgNumber: organizerRow?.org_number ?? null,
      totalOre: order.total_ore ?? 0,
      paymentMethod,
      lines: orderItems.map((item) => ({
        name: single(item.ticket_types)?.name ?? 'Biljett',
        qty: item.qty,
        unitPriceOre: item.unit_price_ore,
        vatRate: item.vat_rate,
      })),
    },
  })

  const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
    .EdgeRuntime
  if (edgeRuntime) {
    edgeRuntime.waitUntil(emailPromise)
  } else {
    await emailPromise
  }
}

// Tilläggsordern 2026-08-06 ("Stripe Connect - eget underkonto per
// arrangör"). account.updated skickas av Stripe för Connect-konton -
// fångar bland annat när ett konto går från "onboarding påbörjad" till
// "kan faktiskt ta emot betalningar". Vi sätter stripe_onboarding_complete
// bara när BÅDA charges_enabled och details_submitted är true - ett konto
// kan ha details_submitted=true men ändå inte charges_enabled (t.ex. om
// Stripe begär mer verifiering), och vi vill inte flagga ett sådant konto
// som klart att ta betalt.
//
// Matchar på stripe_account_id, inte organizer_id - detta event kommer
// inte med någon Supabase-koppling alls, bara Stripes egna account.id.
async function handleAccountUpdated(account: Stripe.Account) {
  if (!account.charges_enabled || !account.details_submitted) return

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('organizers')
    .update({ stripe_onboarding_complete: true })
    .eq('stripe_account_id', account.id)

  if (error) {
    console.error('Kunde inte sätta stripe_onboarding_complete för konto', account.id, error.message)
  }
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  const supabase = createAdminClient()
  const orderId = session.client_reference_id ?? session.metadata?.order_id
  if (!orderId) return

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, event_id, status')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError || !order) return
  if (order.status !== 'pending') return

  // Rättad bugg (STEG 1-rapporten, 2026-10-12): .update() ger INGET fel
  // om noll rader matchade villkoret - bara om något gick fel. Måste
  // alltså kedja .select() och kontrollera hur många rader som
  // FAKTISKT uppdaterades, annars kan ett race mot release_expired_
  // orders (cronet) leda till att kapacitet frigörs två gånger för
  // samma order. Se expiryGuard.ts för den rena kontrollen, och
  // release_expired_orders (20260106000100_order_items_cart.sql) som
  // redan gjorde detta rätt via UPDATE ... RETURNING.
  const { data: updatedRows, error: updateError } = await supabase
    .from('orders')
    .update({ status: 'expired' })
    .eq('id', order.id)
    .eq('status', 'pending')
    .select('id')

  if (updateError) {
    console.error('Kunde inte markera order som expired', order.id, updateError.message)
    return
  }
  if (!shouldReleaseAfterExpiryUpdate(updatedRows)) {
    // En annan process (typiskt release_expired_orders) hann flippa
    // ordern till expired precis innan oss - frigör INTE kapacitet
    // igen, den gjorde redan det.
    return
  }

  const { items, totalQty } = await loadCartItems(supabase, order.id)
  if (totalQty > 0) {
    await supabase.rpc('release_shared_capacity_multi', {
      p_event_id: order.event_id,
      p_items: items,
      p_total_qty: totalQty,
    })
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return textResponse('Metoden stöds inte.', 405)
  }

  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!webhookSecret) {
    return textResponse('STRIPE_WEBHOOK_SECRET är inte konfigurerad på servern.', 500)
  }
  // Tilläggsordern 2026-08-06 ("Stripe Connect - eget underkonto per
  // arrangör"): Stripes nuvarande Workbench-UI tillåter inte att en
  // befintlig händelsedestinations "Händelser från"-omfattning (Ditt konto
  // vs Anslutna konton) ändras i efterhand - fältet är låst efter att
  // destinationen skapats ("Det här fältet kan inte ändras"). Därför krävs
  // en HELT SEPARAT destination för account.updated (Anslutna konton), och
  // den destinationen får sin EGEN signeringshemlighet, skild från
  // STRIPE_WEBHOOK_SECRET. STRIPE_CONNECT_WEBHOOK_SECRET är valfri (inte
  // 500 om den saknas) eftersom den bara behövs av den nya destinationen -
  // en miljö som ännu inte satt upp Connect-webhooken ska fortsätta kunna
  // ta emot vanliga checkout.session.*-händelser utan avbrott.
  const connectWebhookSecret = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return textResponse('stripe-signature-header saknas.', 400)
  }

  // Signaturverifiering kräver den RÅA request-bodyn (inte JSON.parse:ad) -
  // annars stämmer inte HMAC-signaturen.
  const rawBody = await req.text()

  const stripe = createStripeClient()
  let event: Stripe.Event
  try {
    // constructEventAsync (inte constructEvent) - Denos crypto.subtle är
    // asynkront, till skillnad från Node.js där stripe-paketets synkrona
    // constructEvent normalt används.
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret)
  } catch (primaryErr) {
    // Prova den sekundära hemligheten (Connect-destinationen) innan vi ger
    // upp - se kommentaren ovanför connectWebhookSecret för varför det
    // finns två separata hemligheter att verifiera mot.
    if (connectWebhookSecret) {
      try {
        event = await stripe.webhooks.constructEventAsync(rawBody, signature, connectWebhookSecret)
      } catch (secondaryErr) {
        const message = secondaryErr instanceof Error ? secondaryErr.message : 'Okänt fel.'
        console.error('Ogiltig Stripe-webhook-signatur (båda hemligheterna testade):', message)
        return textResponse(`Ogiltig signatur: ${message}`, 400)
      }
    } else {
      const message = primaryErr instanceof Error ? primaryErr.message : 'Okänt fel.'
      console.error('Ogiltig Stripe-webhook-signatur:', message)
      return textResponse(`Ogiltig signatur: ${message}`, 400)
    }
  }

  const supabase = createAdminClient()

  // Idempotensspärr - se filkommentaren högst upp.
  const { error: insertEventError } = await supabase
    .from('webhook_events')
    .insert({ provider: 'stripe', provider_event_id: event.id, payload: event as unknown as Record<string, unknown> })

  if (insertEventError) {
    // 23505 = unique_violation - eventet är redan hanterat, svara 200 utan
    // att göra om arbetet.
    if (insertEventError.code === '23505') {
      return textResponse('redan hanterad', 200)
    }
    console.error('Kunde inte spara webhook_events-rad', insertEventError.message)
    return textResponse('Databasfel.', 500)
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
    } else if (event.type === 'checkout.session.expired') {
      await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session)
    } else if (event.type === 'account.updated') {
      await handleAccountUpdated(event.data.object as Stripe.Account)
    }
    // Övriga eventtyper (vi prenumererar bara på dessa två i Stripe Dashboard,
    // men om fler skulle skickas ändå kvitterar vi dem tyst med 200).
  } catch (err) {
    // Vi har redan skrivit webhook_events-raden, så en Stripe-retry skulle
    // annars bara träffa idempotensspärren och aldrig få en ny chans att
    // lyckas. Logga men svara ändå 200 - manuell felsökning via loggarna
    // + release-expired-orders/export-sales fångar upp resten.
    const message = err instanceof Error ? err.message : 'Okänt fel.'
    console.error('Fel vid hantering av Stripe-webhook:', message)
  }

  return textResponse('ok', 200)
})
