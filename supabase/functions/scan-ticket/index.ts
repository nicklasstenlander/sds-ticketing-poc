// scan-ticket
//
// Anropas av den framtida iOS-scanner-appen när en QR-kod skannas.
// Servern är den enda källan till sanning - klienten (iOS-appen) ska ALDRIG
// avgöra själv om en biljett är giltig, den bara visar det resultat denna
// funktion returnerar. Autentiseras med en statisk bearer-token (Supabase
// secret SCANNER_BEARER_TOKEN).
//
// Request:  { ticket_code: string, device?: string }
// Response: { result: "ok" | "duplicate" | "invalid",
//              holder_name: string | null,
//              event_title: string | null,
//              ticket_type: null,
//              checked_in_at: string | null }
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { bearerTokenFrom, timingSafeEqual } from '../_shared/adminToken.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'

interface ScanBody {
  ticket_code?: string
  device?: string
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const scannerToken = Deno.env.get('SCANNER_BEARER_TOKEN')
  if (!scannerToken) {
    return jsonResponse({ error: 'SCANNER_BEARER_TOKEN är inte konfigurerad på servern.' }, 500)
  }

  const token = bearerTokenFrom(req)
  if (!token || !timingSafeEqual(token, scannerToken)) {
    return jsonResponse({ error: 'Ej behörig.' }, 401)
  }

  let body: ScanBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const ticketCode = (body.ticket_code ?? '').trim().toUpperCase()
  const device = (body.device ?? 'okänd enhet').trim()

  if (!ticketCode) {
    return jsonResponse({ error: 'ticket_code krävs.' }, 400)
  }

  const supabase = createAdminClient()

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id, holder_name, status, checked_in_at, event_id, events(title)')
    .eq('ticket_code', ticketCode)
    .maybeSingle()

  if (ticketError) {
    return jsonResponse({ error: `Databasfel: ${ticketError.message}` }, 500)
  }

  // Okänd kod -> logga som "invalid" (utan ticket_id) och avvisa.
  if (!ticket) {
    await supabase.from('ticket_scans').insert({
      ticket_id: null,
      device,
      result: 'invalid',
    })
    return jsonResponse({
      result: 'invalid',
      holder_name: null,
      event_title: null,
      ticket_type: null,
      checked_in_at: null,
    })
  }

  // eventTitle kan komma som objekt eller array beroende på PostgREST-version.
  const eventRelation = ticket.events as unknown
  const eventTitle = Array.isArray(eventRelation)
    ? (eventRelation[0]?.title ?? null)
    : ((eventRelation as { title?: string } | null)?.title ?? null)

  if (ticket.status === 'valid') {
    const checkedInAt = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('tickets')
      .update({ status: 'checked_in', checked_in_at: checkedInAt, checked_in_by: device })
      .eq('id', ticket.id)

    if (updateError) {
      return jsonResponse({ error: `Kunde inte checka in: ${updateError.message}` }, 500)
    }

    await supabase.from('ticket_scans').insert({
      ticket_id: ticket.id,
      device,
      result: 'ok',
    })

    return jsonResponse({
      result: 'ok',
      holder_name: ticket.holder_name,
      event_title: eventTitle,
      ticket_type: null,
      checked_in_at: toIso8601Seconds(checkedInAt),
    })
  }

  if (ticket.status === 'checked_in') {
    await supabase.from('ticket_scans').insert({
      ticket_id: ticket.id,
      device,
      result: 'duplicate',
    })

    return jsonResponse({
      result: 'duplicate',
      holder_name: ticket.holder_name,
      event_title: eventTitle,
      ticket_type: null,
      checked_in_at: toIso8601Seconds(ticket.checked_in_at), // ursprunglig incheckningstid, oförändrad
    })
  }

  // status === 'void' - annullerad biljett, behandlas som ogiltig.
  await supabase.from('ticket_scans').insert({
    ticket_id: ticket.id,
    device,
    result: 'invalid',
  })

  return jsonResponse({
    result: 'invalid',
    holder_name: ticket.holder_name,
    event_title: eventTitle,
    ticket_type: null,
    checked_in_at: null,
  })
})
