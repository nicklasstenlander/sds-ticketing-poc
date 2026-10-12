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
//   checkout.session.completed - betalning bekräftad: slutför ordern
//     atomärt via finalize_paid_order (status pending->paid, biljetter,
//     rabattkodsräkning - EN transaktion, se _shared/finalizeOrder.ts),
//     skicka sedan bekräftelsemail OM det inte redan skickats
//     (orders.confirmation_email_sent_at). Se STEG B nedan.
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
//   charge.refunded - en betalning återbetalades, helt eller delvis
//     (ordern "Avbokning, återbetalning, omsändning och köparmeddelanden"
//     2026-10-12, STEG 3). Full återbetalning: avbokar ordern via EXAKT
//     samma delade logik som admin-cancel-order (_shared/cancelOrder.ts) -
//     ingen separat kod för "avbokad av admin" vs "avbokad via Stripe-
//     återbetalning". Delvis återbetalning: ändrar ingenting, loggar bara
//     order-id och belopp. Gratisordrar (0 kr) har aldrig någon Stripe-
//     charge alls och når därför aldrig denna hanterare - det är
//     avsiktligt, inte en lucka. Måste läggas till som händelse i Stripe
//     Dashboard separat (se README avsnitt 8/8b): på PLATTFORMS-
//     destinationen för payment_mode='direct'-arrangörer (SDS), på
//     CONNECT-destinationen för payment_mode='connect'-arrangörer
//     (Testscenen, Accepteas) - precis som för checkout.session.* resp.
//     account.updated ovan.
//
// STEG B (ordern "Webhooken: misslyckade händelser måste kunna försökas
// igen" 2026-10-12): idempotensspärren (webhook_events) har en
// statuskolumn, inte bara radens existens (se
// stripe-webhook/webhookEventRetry.ts och
// supabase/migrations/20261012060000_webhook_events_status.sql för hela
// resonemanget). Handlarna KASTAR vid ett riktigt fel (databas, Storage,
// Resend) - webhooken svarar då 500 så att Stripe försöker igen. "Inget
// att göra" (ordern saknas, redan slutförd) ger 200 utan att kasta. En
// betalning som kommer in för en order i ett läge som kräver en människa
// (t.ex. redan 'expired') markeras 'needs_attention' i webhook_events och
// svarar 200 - ingen idé att Stripe försöker igen, problemet är inte
// tekniskt.
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
import { cancelPaidOrder } from '../_shared/cancelOrder.ts'
import { isFullRefund, findOrderIdForRefund } from '../_shared/refundLookup.ts'
import { finalizePaidOrder, mapFinalizeOutcome, type FinalizeHandlerOutcome } from '../_shared/finalizeOrder.ts'
import { decideRetryAction, type WebhookEventStatus } from './webhookEventRetry.ts'
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
 * totalQty som reserve/release_shared_capacity_multi förväntar sig.
 * Kastar vid ett riktigt databasfel (STEG B punkt 4) - en tom kundvagn
 * p.g.a. ETT FEL ska inte tolkas som "inget att frigöra". */
async function loadCartItems(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
): Promise<{ items: { ticket_type_id: string; qty: number }[]; totalQty: number }> {
  const { data, error } = await supabase
    .from('order_items')
    .select('ticket_type_id, qty')
    .eq('order_id', orderId)

  if (error) throw new Error(`Kunde inte hämta order_items för order ${orderId}: ${error.message}`)

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

// checkout.session.completed (STEG B, se filkommentaren högst upp).
// Returnerar 'done' (vanliga fallet, eller "inget att göra") eller
// 'needs_attention' (en bekräftad betalning kom in för en order som
// redan avgjorts åt annat håll - t.ex. 'expired' - och kapaciteten kan
// redan vara frisläppt, se order-code-webhook-aterforsok.md STEG A
// punkt 4). Kastar vid ett riktigt fel - Deno.serve markerar då
// webhook_events-raden 'failed' och svarar 500 så att Stripe försöker
// igen.
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<FinalizeHandlerOutcome> {
  const supabase = createAdminClient()
  const orderId = session.client_reference_id ?? session.metadata?.order_id
  if (!orderId) {
    console.log('checkout.session.completed utan order-id - inget att göra', session.id)
    return 'done'
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, event_id, buyer_name, buyer_email, total_ore, confirmation_email_sent_at')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) throw new Error(`Kunde inte hämta order ${orderId}: ${orderError.message}`)
  if (!order) {
    console.log('Order saknas - inget att göra', orderId)
    return 'done'
  }

  const { data: orderItems, error: orderItemsError } = await supabase
    .from('order_items')
    .select('id, ticket_type_id, qty, unit_price_ore, vat_rate, ticket_types(name)')
    .eq('order_id', order.id)

  if (orderItemsError) throw new Error(`Kunde inte hämta order_items för order ${order.id}: ${orderItemsError.message}`)
  if (!orderItems || orderItems.length === 0) {
    throw new Error(`Order ${order.id} saknar order_items - kan inte slutföras`)
  }

  // stripe_payment_intent_id (STEG 3 punkt 1) - session.payment_intent
  // kan i teorin vara en expanderad PaymentIntent-instans istället för
  // bara id:t (samma typmässiga osäkerhet som fetchPaymentMethodType
  // redan hanterar nedanför), därför samma typeof-kontroll här.
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null

  // Biljettkoderna genereras HÄR (TypeScript, samma CSPRNG-baserade
  // Crockford base32-kod som alltid) och skickas in till den atomära
  // SQL-funktionen - se migrationens kommentar för varför. Kastas bort
  // ofarligt om finalize_paid_order inte vinner statusbytet (redan
  // paid/expired/cancelled).
  const totalQty = orderItems.reduce((sum, item) => sum + item.qty, 0)
  const ticketCodes = Array.from({ length: totalQty }, () => generateTicketCode())

  const result = await finalizePaidOrder(supabase, order.id, paymentIntentId, ticketCodes)
  const handlerOutcome = mapFinalizeOutcome(result.outcome)

  if (handlerOutcome === 'not_found') {
    console.log('Order hittades inte vid slutförande - inget att göra', order.id)
    return 'done'
  }
  if (handlerOutcome === 'needs_attention') {
    console.log('Betalning för order i oväntat läge - needs_attention', order.id, result.outcome)
    return 'needs_attention'
  }

  // Från här: 'finalized' (första gången) eller 'already_paid'
  // (omkörning) - i BÅDA fallen finns biljetterna nu. Mejlet skickas
  // bara om det inte redan skickats.
  if (order.confirmation_email_sent_at) return 'done'

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, slug, title, venue, starts_at, organizer_id')
    .eq('id', order.event_id)
    .maybeSingle()

  if (eventError) throw new Error(`Kunde inte hämta event för order ${order.id}: ${eventError.message}`)
  if (!event) throw new Error(`Order ${order.id} saknar event ${order.event_id}`)

  // Kvittodel i biljettmailet (ordern 2026-10-01, A5) - säljarens
  // legal_name/org_number. terms_url (ordern "Före försäljning"
  // 2026-10-05, 1.3) - samma fält som redan styr köpsidans
  // villkorskryssruta (create-order), återanvänds här bara för att visa
  // en länk i mailet. En HELT saknad säljarrad (organizer_id pekar på
  // en rad som inte finns) är ett datafel - kastas (STEG B punkt 2).
  // Saknas bara legal_name (arrangören har inte fyllt i det) är det
  // INTE ett fel - kvittot hoppar då bara över säljarraden, se
  // sendConfirmationEmail.
  const { data: organizerRow, error: organizerRowError } = await supabase
    .from('organizers')
    .select('legal_name, org_number, terms_url')
    .eq('id', event.organizer_id)
    .maybeSingle()
  if (organizerRowError) throw new Error(`Kunde inte hämta arrangör för order ${order.id}: ${organizerRowError.message}`)
  if (!organizerRow) throw new Error(`Order ${order.id}: arrangör ${event.organizer_id} saknas`)

  // Biljettypens namn per ticket_type_id - för biljett-PDF:ens
  // "BILJETTYP"-rad (ordern "Biljett-PDF" 2026-10-05). Samma namnkälla
  // som kvittots lines nedan (orderItems.ticket_types(name)).
  const ticketTypeNameById = new Map(orderItems.map((item) => [item.ticket_type_id, single(item.ticket_types)?.name ?? null]))

  // QR-uppladdningen är redan idempotent (upsert:true, sökväg
  // <order_id>/<ticket_id>.png) - samma biljett-id ger alltid samma
  // sökväg, så en omkörning skriver bara över samma objekt. Ett fel
  // här kastas nu (STEG B punkt 2) istället för att tyst hoppa över
  // just den biljetten.
  const ticketsWithQr: { ticket_code: string; qrUrl: string; typeName: string | null }[] = []
  for (const ticket of result.tickets) {
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

    if (uploadError) throw new Error(`Kunde inte ladda upp QR-kod för biljett ${ticket.id}: ${uploadError.message}`)

    const { data: publicUrlData } = supabase.storage.from('qr').getPublicUrl(path)
    ticketsWithQr.push({
      ticket_code: ticket.ticket_code,
      qrUrl: publicUrlData.publicUrl,
      typeName: ticketTypeNameById.get(ticket.ticket_type_id) ?? null,
    })
  }

  // Mejlet AWAITAS nu synkront (till skillnad från tidigare, då det
  // köades via EdgeRuntime.waitUntil för att inte fördröja svaret till
  // Stripe) - confirmation_email_sent_at får bara sättas EFTER att
  // Resend bekräftat, och det kräver att vi väntar in svaret innan
  // webhooken svarar. Ett Resend-fel kastar nu (se
  // _shared/sendConfirmationEmail.ts) och gör att HELA den här
  // körningen räknas som failed - en omkörning hoppar över redan
  // skapade biljetter (finalize_paid_order ger 'already_paid') och
  // försöker bara skicka mejlet igen.
  const paymentMethod = await fetchPaymentMethodType(session)
  await sendConfirmationEmail({
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    eventTitle: event.title,
    eventVenue: event.venue,
    eventStartsAt: event.starts_at,
    orderId: order.id,
    // orders.paid_at FRÅN finalize_paid_order - den FAKTISKA
    // betalningstidpunkten, inte tidpunkten för det här anropet. Rättat
    // (STEG B-granskningen 2026-10-12, fråga 1a): den gamla koden
    // återanvände explicit samma tidsstämpel för DB-skrivningen och
    // mejlet - en "new Date()" här hade visat dagens datum på kvittot
    // vid en omkörning (outcome='already_paid'), inte köpdatumet.
    // result.paidAt är null bara för 'expired'/'cancelled'/'not_found',
    // som redan returnerat innan den här punkten - fallbacket är alltså
    // bara defensivt, ska aldrig faktiskt användas.
    paidAt: result.paidAt ?? new Date().toISOString(),
    tickets: ticketsWithQr,
    termsUrl: organizerRow.terms_url,
    receipt: {
      sellerLegalName: organizerRow.legal_name,
      sellerOrgNumber: organizerRow.org_number,
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

  // Villkorat (is .is('confirmation_email_sent_at', null)) som ett
  // extra skydd mot en osannolik samtidig dubbelkörning för SAMMA
  // order - men till skillnad från biljetterna/rabattkoden (som är
  // skyddade av finalize_paid_orders transaktion) är konsekvensen av
  // att FÖRLORA den här racet bara att två processer båda lyckades
  // skicka mejlet, inte att data blir fel. Kastas inte vid 0 träffade
  // rader - mejlet skickades trots allt, bara markeringen blev en
  // no-op.
  const { error: markSentError } = await supabase
    .from('orders')
    .update({ confirmation_email_sent_at: new Date().toISOString() })
    .eq('id', order.id)
    .is('confirmation_email_sent_at', null)
  if (markSentError) throw new Error(`Kunde inte markera mejl som skickat för order ${order.id}: ${markSentError.message}`)

  return 'done'
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
//
// INTE del av STEG B (ordern "Webhooken: misslyckade händelser måste
// kunna försökas igen" 2026-10-12) - nämns inte i den ordern, och rör
// Connect-onboardingstatus, inte pengar/kapacitet/biljetter. Svälj-
// mönstret (logga, kasta aldrig) är alltså MEDVETET oförändrat här,
// trots att det är samma typ av gap som i övriga handlare innan STEG B.
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

async function handleCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
  const supabase = createAdminClient()
  const orderId = session.client_reference_id ?? session.metadata?.order_id
  if (!orderId) {
    console.log('checkout.session.expired utan order-id - inget att göra', session.id)
    return
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, event_id, status')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) throw new Error(`Kunde inte hämta order ${orderId}: ${orderError.message}`)
  if (!order) {
    console.log('Order saknas - inget att göra', orderId)
    return
  }
  if (order.status !== 'pending') return // oförändrad semantik - redan avgjort åt annat håll

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

  if (updateError) throw new Error(`Kunde inte markera order ${order.id} som expired: ${updateError.message}`)
  if (!shouldReleaseAfterExpiryUpdate(updatedRows)) {
    // En annan process (typiskt release_expired_orders) hann flippa
    // ordern till expired precis innan oss - frigör INTE kapacitet
    // igen, den gjorde redan det. Oförändrad semantik.
    return
  }

  const { items, totalQty } = await loadCartItems(supabase, order.id)
  if (totalQty > 0) {
    const { error: releaseError } = await supabase.rpc('release_shared_capacity_multi', {
      p_event_id: order.event_id,
      p_items: items,
      p_total_qty: totalQty,
    })
    if (releaseError) throw new Error(`Kunde inte frigöra kapacitet för order ${order.id}: ${releaseError.message}`)
  }
}

// charge.refunded (STEG 3, se filkommentaren högst upp). connectedAccountId
// är event.account från Stripe-eventet - satt för Connect-scopade
// leveranser (payment_mode='connect'-arrangörer), null för
// plattformsleveranser (payment_mode='direct', t.ex. SDS). Behövs bara för
// reservuppslaget (findOrderIdForRefund) - stripe_payment_intent_id-
// kolumnen är kontofri, den är redan vår egen rad.
async function handleChargeRefunded(charge: Stripe.Charge, connectedAccountId: string | null): Promise<void> {
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!paymentIntentId) {
    console.log('charge.refunded utan payment_intent - inget att göra', charge.id)
    return
  }

  const supabase = createAdminClient()
  const stripe = createStripeClient()
  // findOrderIdForRefund kastar numera vid ett riktigt fel i något av
  // uppslagsstegen (STEG B punkt 4) - bara "inget hittades" ger null.
  const orderId = await findOrderIdForRefund(supabase, stripe, paymentIntentId, connectedAccountId)

  if (!orderId) {
    console.log('Ingen order hittad för återbetald charge - inget att göra', charge.id)
    return
  }

  if (!isFullRefund(charge)) {
    // Delvis återbetalning (STEG 3 punkt 3) - ändra ingenting, bara
    // logga. Inga personuppgifter i loggraden, bara order-id och belopp.
    console.log('charge.refunded (delvis) - ingen avbokning', orderId, charge.amount_refunded, '/', charge.amount, 'öre')
    return
  }

  // Full återbetalning - EXAKT samma delade avbokningslogik som
  // admin-cancel-order. cancel_paid_order är själv idempotent
  // (status='paid'-villkorat), så en redan avbokad order (manuellt
  // avbokad sedan innan, eller samma charge.refunded-event levererat
  // igen av Stripe) ger cancelled:false - ingen dubbel frigörning av
  // kapacitet. Kastar den vid ett riktigt fel (_shared/cancelOrder.ts)
  // - låter det nu propagera (STEG B punkt 4) istället för att svälja
  // det här.
  const result = await cancelPaidOrder(supabase, orderId)
  console.log('charge.refunded (full) ->', orderId, result.cancelled ? 'avbokad' : 'redan avbokad/fel status sedan innan')
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

  // STEG B (se filkommentaren högst upp): webhook_events har nu en
  // statuskolumn. Försök INSERT:a en NY rad ('received'). Krockar den
  // (23505 - samma event-id finns redan) läser vi den befintliga raden
  // och avgör vad som ska hända via decideRetryAction (ren, testad
  // logik - se webhookEventRetry.ts).
  const { data: insertedRow, error: insertEventError } = await supabase
    .from('webhook_events')
    .insert({
      provider: 'stripe',
      provider_event_id: event.id,
      payload: event as unknown as Record<string, unknown>,
      status: 'received',
      attempts: 1,
    })
    .select('id, attempts')
    .single()

  let eventRowId: string
  let attempts: number

  if (insertEventError) {
    if (insertEventError.code !== '23505') {
      console.error('Kunde inte spara webhook_events-rad', insertEventError.message)
      return textResponse('Databasfel.', 500)
    }

    const { data: existingRow, error: readError } = await supabase
      .from('webhook_events')
      .select('id, status, attempts, created_at')
      .eq('provider', 'stripe')
      .eq('provider_event_id', event.id)
      .single()

    if (readError || !existingRow) {
      console.error('webhook_events: kunde inte läsa befintlig rad', event.id, readError?.message)
      return textResponse('Databasfel.', 500)
    }

    const ageMs = Date.now() - new Date(existingRow.created_at as string).getTime()
    const decision = decideRetryAction(existingRow.status as WebhookEventStatus, ageMs)

    if (decision === 'already_done') {
      return textResponse('redan hanterad', 200)
    }
    if (decision === 'still_running') {
      // En annan körning av SAMMA event-id pågår troligen fortfarande
      // - be Stripe försöka igen lite senare istället för att bearbeta
      // händelsen samtidigt i två körningar.
      return textResponse('bearbetas redan', 409)
    }

    // decision === 'retry': 'failed', eller en 'received'-rad som är
    // äldre än tröskeln (en kraschad körning). Ge den en ny chans.
    //
    // Rättat (hittat av en oberoende granskning 2026-10-12, STEG B):
    // decideRetryAction har INGEN åldersspärr för 'failed' - en rad som
    // precis blev 'failed' ger 'retry' direkt. Två NÄSTAN SAMTIDIGA
    // leveranser (Stripes egen automatiska omförsök som råkar krocka
    // med t.ex. en manuell "Resend" i Stripe Dashboard medan någon
    // felsöker en failed-rad) skulle annars BÅDA läsa samma rad, BÅDA
    // besluta "retry", och BÅDA anropa handlern samtidigt för samma
    // order - vilket kan ge ett dubbelt mejlutskick (se
    // handleCheckoutCompleted: confirmation_email_sent_at läses i
    // BÖRJAN av körningen, innan mejlet skickas, så två samtidiga
    // körningar kan båda hinna läsa null och båda skicka).
    //
    // Fixen är en optimistisk lås (compare-and-swap): UPDATE:en
    // villkoras på att raden FORTFARANDE har den status vi just läste
    // (.eq('status', existingRow.status)). Postgres radlås serialiserar
    // två samtidiga UPDATE-anrop mot SAMMA rad - bara det som kommer
    // först vinner (status matchar fortfarande), det andra ser statusen
    // redan ändrad till 'received' och träffar NOLL rader. En förlorad
    // CAS tolkas som "en annan leverans tog redan över det här
    // försöket" - svara 409 precis som 'still_running', INTE ett fel.
    const { data: retriedRow, error: retryError } = await supabase
      .from('webhook_events')
      .update({ status: 'received', attempts: existingRow.attempts + 1, last_error: null })
      .eq('id', existingRow.id)
      .eq('status', existingRow.status)
      .select('id, attempts')
      .maybeSingle()

    if (retryError) {
      console.error('webhook_events: kunde inte markera rad för omförsök', event.id, retryError.message)
      return textResponse('Databasfel.', 500)
    }
    if (!retriedRow) {
      // Förlorade CAS:en - en annan samtidig leverans tog redan över.
      return textResponse('bearbetas redan', 409)
    }

    eventRowId = retriedRow.id
    attempts = retriedRow.attempts
  } else {
    eventRowId = insertedRow.id
    attempts = insertedRow.attempts
  }

  let outcome: FinalizeHandlerOutcome = 'done'
  try {
    if (event.type === 'checkout.session.completed') {
      outcome = await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
    } else if (event.type === 'checkout.session.expired') {
      await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session)
    } else if (event.type === 'account.updated') {
      await handleAccountUpdated(event.data.object as Stripe.Account)
    } else if (event.type === 'charge.refunded') {
      await handleChargeRefunded(event.data.object as Stripe.Charge, event.account ?? null)
    }
    // Övriga eventtyper (vi prenumererar bara på dessa i Stripe Dashboard,
    // men om fler skulle skickas ändå kvitterar vi dem tyst med 200/'done').
  } catch (err) {
    // Riktigt fel (STEG B punkt 4) - markera raden 'failed' och svara
    // 500 så att Stripe försöker igen. last_error trunkeras och
    // innehåller ALDRIG namn/e-post/betalningsuppgifter - bara det
    // Postgres/Stripe-klienten själva rapporterar.
    const message = err instanceof Error ? err.message : 'Okänt fel.'
    console.error('Fel vid hantering av Stripe-webhook (försök', attempts, ')', event.type, event.id, message)

    const { error: failError } = await supabase
      .from('webhook_events')
      .update({ status: 'failed', last_error: message.slice(0, 500) })
      .eq('id', eventRowId)
    if (failError) {
      console.error('webhook_events: kunde inte markera rad som failed', event.id, failError.message)
    }

    return textResponse('Internt fel - försök igen.', 500)
  }

  const { error: finalStatusError } = await supabase
    .from('webhook_events')
    .update({ status: outcome, processed_at: new Date().toISOString(), last_error: null })
    .eq('id', eventRowId)
  if (finalStatusError) {
    console.error('webhook_events: kunde inte markera rad som', outcome, event.id, finalStatusError.message)
  }

  if (outcome === 'needs_attention') {
    // Enkel fråga Nicklas kan köra: select * from webhook_events where
    // status = 'needs_attention'. Loggar bara order-id och event-id/typ
    // (order-id loggas redan inne i handleCheckoutCompleted).
    console.log('webhook_events: needs_attention', 'event', event.id, 'typ', event.type)
  }

  return textResponse('ok', 200)
})
