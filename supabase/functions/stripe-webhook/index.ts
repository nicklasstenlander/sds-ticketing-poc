// stripe-webhook
//
// Tar emot webhooks från Stripe (Test mode). Detta är den ENDA plats i
// systemet där en order övergår från "pending" till "paid" och där
// biljetter faktiskt skapas - klienten kan aldrig trigga detta själv, så
// ingen kan få biljetter utan en av Stripe bekräftad betalning.
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

async function sendConfirmationEmail(params: {
  buyerName: string
  buyerEmail: string
  eventTitle: string
  eventVenue: string | null
  eventStartsAt: string
  orderId: string
  tickets: { ticket_code: string; qrUrl: string }[]
}) {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const resendFrom = Deno.env.get('RESEND_FROM') ?? 'biljett@resend.dev'

  if (!resendApiKey) {
    console.warn('RESEND_API_KEY saknas - hoppar över mailutskick (endast för lokal utveckling).')
    return
  }

  const eventDate = new Date(params.eventStartsAt).toLocaleString('sv-SE', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  })

  // Samma mönster som tidigare (icke-Stripe-versionen av create-order):
  // QR-bilderna länkas som riktiga https-URL:er till Storage, inte
  // data-URI:er, eftersom Gmail m.fl. blockerar data-URI-bilder i mail.
  const ticketsHtml = params.tickets
    .map(
      (ticket) => `
        <div style="margin:24px 0;padding:16px;border:1px solid #ddd;border-radius:8px;text-align:center;">
          <img src="${ticket.qrUrl}" alt="QR-kod för biljett" width="220" height="220" style="display:block;margin:0 auto 12px;" />
          <div style="font-family:monospace;font-size:16px;letter-spacing:2px;">${ticket.ticket_code}</div>
        </div>
      `,
    )
    .join('')

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h1 style="font-size:20px;">Din biljett till ${params.eventTitle}</h1>
      <p>Hej ${params.buyerName},</p>
      <p>Tack för ditt köp! Här är din/dina biljett(er) till <strong>${params.eventTitle}</strong>${params.eventVenue ? ` på ${params.eventVenue}` : ''}, ${eventDate}.</p>
      <p>Visa QR-koden vid entrén, eller uppge koden i klartext om bilden inte laddas.</p>
      ${ticketsHtml}
      <p style="color:#666;font-size:13px;">Ordernummer: ${params.orderId}</p>
    </div>
  `

  const emailResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFrom,
      to: params.buyerEmail,
      subject: `Din biljett till ${params.eventTitle}`,
      html,
    }),
  })

  if (!emailResponse.ok) {
    const errText = await emailResponse.text()
    console.error('Resend-fel:', errText)
  }
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
    .select('id, event_id, buyer_name, buyer_email, status, discount_code_id')
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
    .select('id, slug, title, venue, starts_at')
    .eq('id', order.event_id)
    .maybeSingle()

  if (eventError || !event) {
    console.error('Hittade inget event för order', order.id, eventError?.message)
    return
  }

  const { data: orderItems, error: orderItemsError } = await supabase
    .from('order_items')
    .select('id, ticket_type_id, qty')
    .eq('order_id', order.id)

  if (orderItemsError || !orderItems || orderItems.length === 0) {
    console.error('Hittade inga order_items för betald order', order.id, orderItemsError?.message)
    return
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

  const ticketsWithQr: { ticket_code: string; qrUrl: string }[] = []
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
    ticketsWithQr.push({ ticket_code: ticket.ticket_code, qrUrl: publicUrlData.publicUrl })
  }

  // Mailutskicket köas i bakgrunden via EdgeRuntime.waitUntil() istället för
  // att awaitas här. Stripe förväntar sig ett snabbt 200-svar på webhooken
  // (annars räknas den som misslyckad och skickas om) - Resend-anropet ska
  // inte få fördröja det svaret. EdgeRuntime är en global som bara finns i
  // Supabase Edge Functions-runtimen (inte i lokal `deno test` etc), därför
  // det defensiva fallbacket till en vanlig (fire-and-forget) await.
  const emailPromise = sendConfirmationEmail({
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    eventTitle: event.title,
    eventVenue: event.venue,
    eventStartsAt: event.starts_at,
    orderId: order.id,
    tickets: ticketsWithQr,
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

  const { error: updateError } = await supabase
    .from('orders')
    .update({ status: 'expired' })
    .eq('id', order.id)
    .eq('status', 'pending')

  if (updateError) {
    console.error('Kunde inte markera order som expired', order.id, updateError.message)
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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Okänt fel.'
    console.error('Ogiltig Stripe-webhook-signatur:', message)
    return textResponse(`Ogiltig signatur: ${message}`, 400)
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
