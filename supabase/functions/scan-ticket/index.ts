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
//              checked_in_at: string | null,
//              message: string | null }
//
// "message" (ordern "Före försäljning" 2026-10-05, 1.2) är ETT NYTT,
// ADDITIVT fält - inget nytt "result"-värde läggs till (IOS_HANDOFF.md
// dokumenterar bara ok/duplicate/invalid, och appen färgkodar på exakt
// dessa tre). Fältet är alltid med i svaret (null när det inte används),
// så formen är förutsägbar. Används just nu bara för att förklara VARFÖR
// en biljett till ett inställt event avvisas med "invalid" - en vanlig
// Swift Codable-struct ignorerar okända/extra JSON-nycklar som standard,
// så detta BÖR inte kräva en app-ändring, men det är inte verifierat mot
// den faktiska iOS-koden (som inte finns i det här repot) - flaggat i
// rapporten till Nicklas, inte antaget.
//
// OBS - ingen event_id skickas med i requesten idag (varken i detta
// kontrakt eller i IOS_HANDOFF.md:s exempel) - scanningen är alltså INTE
// begränsad till ett visst event server-side. En biljett till FEL event
// kan därför inte avvisas här utan en separat ändring av iOS-appen (se
// rapporten).
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { bearerTokenFrom, timingSafeEqual } from '../_shared/adminToken.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'
import { determineScanOutcome } from './determineScanOutcome.ts'

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
    .select('id, holder_name, status, checked_in_at, event_id, events(title, status)')
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
      message: null,
    })
  }

  // event (titel+status) kan komma som objekt eller array beroende på
  // PostgREST-version.
  const eventRelation = ticket.events as unknown
  const event = Array.isArray(eventRelation) ? (eventRelation[0] ?? null) : (eventRelation as { title?: string; status?: string } | null)
  const eventTitle = event?.title ?? null

  const outcome = determineScanOutcome({
    ticketStatus: ticket.status as 'valid' | 'checked_in' | 'void',
    eventStatus: event?.status ?? null,
  })

  // checked_in_at i svaret: NU för en ny incheckning ("ok"), det
  // URSPRUNGLIGA incheckningstillfället för "duplicate" (oförändrat),
  // annars null (void, eller inställt event - oavsett biljettens egen
  // status).
  let checkedInAtResponse: string | null = null

  if (outcome.result === 'ok') {
    const checkedInAt = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('tickets')
      .update({ status: 'checked_in', checked_in_at: checkedInAt, checked_in_by: device })
      .eq('id', ticket.id)

    if (updateError) {
      return jsonResponse({ error: `Kunde inte checka in: ${updateError.message}` }, 500)
    }
    checkedInAtResponse = toIso8601Seconds(checkedInAt)
  } else if (outcome.result === 'duplicate') {
    checkedInAtResponse = toIso8601Seconds(ticket.checked_in_at)
  }

  await supabase.from('ticket_scans').insert({
    ticket_id: ticket.id,
    device,
    result: outcome.result,
  })

  return jsonResponse({
    result: outcome.result,
    holder_name: ticket.holder_name,
    event_title: eventTitle,
    ticket_type: null,
    checked_in_at: checkedInAtResponse,
    message: outcome.message,
  })
})
