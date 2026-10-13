// admin-resend-tickets
//
// Skickar om bekräftelsemailet (biljetter + kvitto + PDF) för en redan
// betald order (ordern "Avbokning, återbetalning, omsändning och
// köparmeddelanden" 2026-10-12, STEG 2.1). Återanvänder EXAKT samma
// _shared/attemptConfirmationEmail.ts som stripe-webhooks bakgrunds-
// uppgift och retry-confirmation-emails (ordern "Webhooken är för
// långsam" 2026-10-13, punkt 3) - samma claim, samma HTML, samma
// PDF-bygge, samma Resend-anrop.
//
// force=true vid claim_confirmation_email: detta är en MEDVETEN,
// manuell ombegäran - ska kunna skicka om ÄVEN ett redan levererat
// mejl (köparen bad om det igen, eller vill ha det till en annan
// adress). Den tidsbaserade claimed_at-spärren gäller ändå, så ett
// admin-klick som råkar krocka med webhookens egen bakgrundsuppgift
// för SAMMA order (en smal tidslucka direkt efter betalning) kan
// fortfarande inte skicka parallellt - se claim_confirmation_email-
// migrationens kommentar.
//
// Krav: ordern tillhör arrangörens event, har status 'paid' och är
// INTE arkiverad. Alla andra fall (fel arrangör, fel status, arkiverad,
// hittas inte alls) ger samma 404 - avslöjar inte om ordern finns hos
// någon annan arrangör.
//
// to (valfritt): skickar till en ANNAN adress än köparens egen (t.ex.
// om köparen skrev fel vid köpet) - exakt EN giltig adress, ingen lista.
//
// QR-koder (STEG 2 tillägg D): om en biljetts QR-fil av någon anledning
// saknas i Storage (t.ex. ett tidigare avbrutet uppladdningsförsök)
// genereras den om här istället för att hela anropet felar. Loggas när
// det inträffar (bara order-id + antal, aldrig personuppgifter).
//
// Loggar bara order-id och resultat - ALDRIG e-post eller namn.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { attemptConfirmationEmail } from '../_shared/attemptConfirmationEmail.ts'
import { isSingleValidEmail } from './emailValidation.ts'
// @deno-types="npm:@types/qrcode@1"
import QRCode from 'npm:qrcode@1.5.3'

interface ResendBody {
  order_id?: string
  to?: string
}

function single<T>(rel: T | T[] | null): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel
}

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

  let body: ResendBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const orderId = (body.order_id ?? '').trim()
  if (!orderId) {
    return jsonResponse({ error: 'order_id krävs.' }, 400)
  }

  const toOverride = body.to?.trim()
  if (toOverride && !isSingleValidEmail(toOverride)) {
    return jsonResponse({ error: 'to måste vara en enda giltig e-postadress.' }, 400)
  }

  const supabase = createAdminClient()

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(
      'id, buyer_name, buyer_email, status, paid_at, total_ore, discount_amount_ore, archived_at, event_id, events!inner(organizer_id, title, venue, starts_at)',
    )
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) {
    return jsonResponse({ error: `Databasfel: ${orderError.message}` }, 500)
  }
  const event = order ? single(order.events) : null
  // Samma 404 för: finns inte, fel arrangör, inte betald, arkiverad -
  // avslöjar aldrig VILKET av dessa det var (filkommentaren).
  if (!order || !event || event.organizer_id !== auth.organizerId || order.status !== 'paid' || order.archived_at) {
    return jsonResponse({ error: 'Ordern hittades inte.' }, 404)
  }

  const { data: organizerRow, error: organizerRowError } = await supabase
    .from('organizers')
    .select('legal_name, org_number, terms_url')
    .eq('id', event.organizer_id)
    .maybeSingle()
  if (organizerRowError) {
    return jsonResponse({ error: `Databasfel: ${organizerRowError.message}` }, 500)
  }

  const { data: orderItems, error: orderItemsError } = await supabase
    .from('order_items')
    .select('ticket_type_id, qty, unit_price_ore, vat_rate, ticket_types(name)')
    .eq('order_id', orderId)
  if (orderItemsError || !orderItems) {
    return jsonResponse({ error: `Kunde inte hämta ordern: ${orderItemsError?.message}` }, 500)
  }

  const { data: tickets, error: ticketsError } = await supabase
    .from('tickets')
    .select('id, ticket_code, ticket_type_id')
    .eq('order_id', orderId)
  if (ticketsError || !tickets || tickets.length === 0) {
    return jsonResponse({ error: `Hittade inga biljetter för ordern: ${ticketsError?.message}` }, 500)
  }

  // Finns QR-filen redan i Storage? EN list()-fråga för hela ordens
  // "mapp" (qr/<order_id>/) istället för en fråga per biljett.
  const { data: existingFiles, error: listError } = await supabase.storage.from('qr').list(orderId)
  if (listError) {
    return jsonResponse({ error: `Kunde inte läsa QR-lagringen: ${listError.message}` }, 500)
  }
  const existingNames = new Set((existingFiles ?? []).map((f) => f.name))

  const ticketTypeNameById = new Map(
    orderItems.map((item) => [item.ticket_type_id, single(item.ticket_types)?.name ?? null]),
  )

  let regeneratedCount = 0
  const ticketsWithQr: { ticket_code: string; qrUrl: string; typeName: string | null }[] = []
  for (const ticket of tickets) {
    const filename = `${ticket.id}.png`
    const path = `${orderId}/${filename}`

    if (!existingNames.has(filename)) {
      // Saknas - generera om istället för att fela (STEG 2 tillägg D).
      const pngBuffer: Uint8Array = await QRCode.toBuffer(ticket.ticket_code, {
        type: 'png',
        margin: 2,
        width: 320,
        errorCorrectionLevel: 'M',
      })
      const { error: uploadError } = await supabase.storage
        .from('qr')
        .upload(path, pngBuffer, { contentType: 'image/png', upsert: true })
      if (uploadError) {
        return jsonResponse({ error: `Kunde inte generera om QR-koden: ${uploadError.message}` }, 500)
      }
      regeneratedCount += 1
    }

    const { data: publicUrlData } = supabase.storage.from('qr').getPublicUrl(path)
    ticketsWithQr.push({
      ticket_code: ticket.ticket_code,
      qrUrl: publicUrlData.publicUrl,
      typeName: ticketTypeNameById.get(ticket.ticket_type_id) ?? null,
    })
  }

  if (regeneratedCount > 0) {
    // Ingen personuppgift i loggraden - bara order-id och antal.
    console.log(`admin-resend-tickets: genererade om ${regeneratedCount} saknad(e) QR-kod(er) för order ${orderId}.`)
  }

  const buyerEmail = toOverride || order.buyer_email

  // force: true - en MEDVETEN, manuell ombegäran (se filkommentaren)
  // ska kunna skicka om ÄVEN ett redan skickat mejl.
  // paymentIntentId: null, oförändrat från tidigare - ingen Session
  // att hämta det faktiska betalsättet ifrån här (bara stripe-webhook
  // har Session-objektet), kvittot visar då ingen betalsättsrad, exakt
  // som för en order utan sellerLegalName.
  const result = await attemptConfirmationEmail({
    supabase,
    orderId: order.id,
    paymentIntentId: null,
    paidAt: order.paid_at as string,
    buyerName: order.buyer_name,
    buyerEmail,
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
    ticketsWithQr,
    force: true,
  })

  if (!result.sent) {
    if (result.reason === 'already_sent_or_claimed') {
      // Ett annat utskick (webhookens egen bakgrundsuppgift, eller ett
      // annat admin-klick) pågår just nu för SAMMA order - inte ett
      // fel, bara "försök igen om en liten stund".
      return jsonResponse({ error: 'Ett utskick pågår redan för den här ordern - försök igen om en liten stund.' }, 409)
    }
    console.error('admin-resend-tickets: kunde inte skicka mailet för order', orderId, result.code)
    return jsonResponse({ error: 'Kunde inte skicka mailet.' }, 500)
  }

  console.log(`admin-resend-tickets: skickade om order ${orderId}.`)
  return jsonResponse({ result: 'sent', regenerated_qr_count: regeneratedCount })
})
