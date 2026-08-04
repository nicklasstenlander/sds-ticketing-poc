// create-order
//
// Publik funktion (anropas från /kop/:slug). Reserverar kapacitet atomiskt,
// skapar order + biljetter med kryptografiskt slumpmässiga koder, genererar
// en QR-PNG per biljett, laddar upp den till Storage-bucketet "qr" och
// mailar köparen kvittot via Resend.
//
// QR-generering: vi använder npm-paketet "qrcode" (ren JS, ingen
// canvas/native-dependency krävs för PNG-output - det använder pngjs
// internt) via Denos npm:-specifier-stöd. Det är ett väldokumenterat,
// vedertaget bibliotek - inget hemmabygge och inget anrop till en extern
// QR-webbtjänst.
//
// QR-koden innehåller ENDAST den råa ticket_code-strängen som klartext -
// ingen URL, ingen JSON, ingen signatur. Scannern slår upp koden mot
// databasen server-side (scan-ticket), så det finns inget att förfalska
// genom att bara läsa QR-bilden.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { generateTicketCode } from '../_shared/base32.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
// @deno-types="npm:@types/qrcode@1"
import QRCode from 'npm:qrcode@1.5.3'

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

  const supabase = createAdminClient()

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, slug, title, venue, starts_at, capacity, sold_count, status')
    .eq('slug', slug)
    .maybeSingle()

  if (eventError) {
    return jsonResponse({ error: `Databasfel: ${eventError.message}` }, 500)
  }
  if (!event || event.status !== 'published') {
    return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
  }

  // Atomisk kapacitetsreservation - detta enda UPDATE-anrop är det som
  // avgör om det finns plats. Villkoret sold_count + qty <= capacity
  // kontrolleras av databasen i samma sats som uppdateringen, så två
  // samtidiga köp kan aldrig båda lyckas över kapacitetsgränsen (ingen
  // read-then-write-race).
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

  // Skapa order
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      event_id: event.id,
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      qty,
      status: 'confirmed',
    })
    .select()
    .single()

  if (orderError || !order) {
    // Rulla tillbaka kapacitetsreservationen om ordern inte kunde skapas.
    await supabase.rpc('release_event_capacity', { p_event_id: event.id, p_qty: qty })
    return jsonResponse({ error: `Kunde inte skapa order: ${orderError?.message}` }, 500)
  }

  // Skapa biljetter med slumpmässiga koder
  const ticketCodes = Array.from({ length: qty }, () => generateTicketCode())
  const ticketRows = ticketCodes.map((code) => ({
    order_id: order.id,
    event_id: event.id,
    ticket_code: code,
    holder_name: buyerName,
    status: 'valid' as const,
  }))

  const { data: tickets, error: ticketsError } = await supabase
    .from('tickets')
    .insert(ticketRows)
    .select()

  if (ticketsError || !tickets) {
    return jsonResponse({ error: `Kunde inte skapa biljetter: ${ticketsError?.message}` }, 500)
  }

  // Generera QR-PNG per biljett och ladda upp till Storage-bucketet "qr".
  const qrUrls: string[] = []
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
      return jsonResponse({ error: `Kunde inte ladda upp QR-kod: ${uploadError.message}` }, 500)
    }

    const { data: publicUrlData } = supabase.storage.from('qr').getPublicUrl(path)
    qrUrls.push(publicUrlData.publicUrl)
  }

  // Skicka bekräftelsemail via Resend.
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const resendFrom = Deno.env.get('RESEND_FROM') ?? 'biljett@resend.dev'

  if (resendApiKey) {
    const eventDate = new Date(event.starts_at).toLocaleString('sv-SE', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'Europe/Stockholm',
    })

    // OBS: Vi bäddar in QR-bilderna som <img src="https://...supabase.co/.../qr/...">
    // som pekar på Storage-URL:en - INTE som data-URI. Gmail (och flera
    // andra klienter) blockerar/renderar inte data-URI-bilder i mail, så en
    // riktig https-URL krävs. Som fallback (om bilden av någon anledning
    // inte visas) skriver vi även ut koden i klartext under varje QR-bild.
    const ticketsHtml = tickets
      .map((ticket, i) => {
        return `
          <div style="margin:24px 0;padding:16px;border:1px solid #ddd;border-radius:8px;text-align:center;">
            <img src="${qrUrls[i]}" alt="QR-kod för biljett" width="220" height="220" style="display:block;margin:0 auto 12px;" />
            <div style="font-family:monospace;font-size:16px;letter-spacing:2px;">${ticket.ticket_code}</div>
          </div>
        `
      })
      .join('')

    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h1 style="font-size:20px;">Din biljett till ${event.title}</h1>
        <p>Hej ${buyerName},</p>
        <p>Tack för ditt köp! Här är din/dina biljett(er) till <strong>${event.title}</strong>${event.venue ? ` på ${event.venue}` : ''}, ${eventDate}.</p>
        <p>Visa QR-koden vid entrén, eller uppge koden i klartext om bilden inte laddas.</p>
        ${ticketsHtml}
        <p style="color:#666;font-size:13px;">Ordernummer: ${order.id}</p>
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
        to: buyerEmail,
        subject: `Din biljett till ${event.title}`,
        html,
      }),
    })

    if (!emailResponse.ok) {
      // Vi låter köpet lyckas ändå (biljetterna finns i databasen och visas
      // i klartext på klar-sidan) men loggar felet för felsökning.
      const errText = await emailResponse.text()
      console.error('Resend-fel:', errText)
    }
  } else {
    console.warn('RESEND_API_KEY saknas - hoppar över mailutskick (endast för lokal utveckling).')
  }

  return jsonResponse(
    {
      order_id: order.id,
      tickets: tickets.map((t) => ({ id: t.id, ticket_code: t.ticket_code })),
    },
    201,
  )
})
