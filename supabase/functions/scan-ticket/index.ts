// scan-ticket
//
// Anropas av den framtida iOS-scanner-appen när en QR-kod skannas.
// Servern är den enda källan till sanning - klienten (iOS-appen) ska ALDRIG
// avgöra själv om en biljett är giltig, den bara visar det resultat denna
// funktion returnerar. Autentiseras med en statisk bearer-token (Supabase
// secret SCANNER_BEARER_TOKEN).
//
// Request:  { ticket_code: string, device?: string, event_id?: string }
// Response: { result: "ok" | "duplicate" | "invalid",
//              holder_name: string | null,
//              event_title: string | null,
//              ticket_type: string | null,
//              ticket_is_free: boolean | null,
//              order_summary: { name: string, qty: number }[] | null,
//              checked_in_at: string | null,
//              message: string | null }
//
// "message" (ordern "Före försäljning" 2026-10-05, 1.2) är ETT NYTT,
// ADDITIVT fält - inget nytt "result"-värde läggs till (IOS_HANDOFF.md
// dokumenterar bara ok/duplicate/invalid, och appen färgkodar på exakt
// dessa tre). Fältet är alltid med i svaret (null när det inte används),
// så formen är förutsägbar. Används för att förklara VARFÖR en biljett
// avvisas (inställt event, eller - se nedan - fel föreställning) - en
// vanlig Swift Codable-struct ignorerar okända/extra JSON-nycklar som
// standard, så detta BÖR inte kräva en app-ändring, men det är inte
// verifierat mot den faktiska iOS-koden (som inte finns i det här
// repot) - flaggat i rapporten till Nicklas, inte antaget.
//
// "event_id" (ordern "Skannern ska veta vilken föreställning den
// släpper in till" 2026-10-06, A1) - VALFRITT fält, bakåtkompatibelt:
// saknas det (gamla appversioner) är beteendet EXAKT som innan denna
// order. Skickas det och skiljer sig från biljettens eget event, avvisas
// biljetten ("invalid") med en förklarande "message" - UTAN att checka
// in den eller avslöja om den redan är incheckad (se
// determineScanOutcome.ts för den fullständiga kontrollordningen).
//
// "ticket_type"/"ticket_is_free"/"order_summary" (ordern "Skannern ska
// visa vilken typ av biljett som skannas" 2026-10-07, A2) - TRE NYA,
// ADDITIVA fält, alltid med i svaret (null när de inte används). Fylls i
// för alla svar där biljetten faktiskt hittades i databasen OCH
// determineScanOutcome satte showTicketType=true (dvs INTE "inställt
// event" eller "fel föreställning" - se determineScanOutcome.ts). En
// biljett utan ticket_type_id (bör inte förekomma längre, se
// migrationen 20261007000000) ger ticket_type=null, ticket_is_free=null,
// men kan ändå ha order_summary (köpets sammansättning är oberoende av
// just DEN HÄR biljettraden). "ticket_is_free" använder order_items.
// list_price_ore (radens pris FÖRE en ev. rabattkod, migrationen
// 20261007000100) - INTE unit_price_ore (det rabatterade priset) och
// INTE typens nuvarande pris. Den faktiska beräkningen ligger i
// buildTicketTypeInfo (determineScanOutcome.ts), ren och testbar utan
// DB-åtkomst - se dess filkommentar för varför unit_price_ore inte
// duger (en vuxenbiljett med en 100%-kod skulle annars se ut som en
// genuint gratis biljettyp). Inga personuppgifter i något av de tre
// fälten.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { bearerTokenFrom, timingSafeEqual } from '../_shared/adminToken.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'
import { buildTicketTypeInfo, determineScanOutcome, type OrderItemForScan } from './determineScanOutcome.ts'

/** PostgREST kan ge en inbäddad relation som objekt eller array beroende
 * på version/frågeform - samma normalisering som stripe-webhook/index.ts
 * egna `single()`, men inte delad därifrån (den är inte exporterad, och
 * de två funktionerna har inget annat gemensamt beroende värt att skapa). */
function single<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel ?? null
}

interface ScanBody {
  ticket_code?: string
  device?: string
  event_id?: string
}

// Löst UUID-format (vilken version som helst) - bara till för att ge ett
// tydligt 400-fel på uppenbart trasig indata innan vi ens frågar
// databasen, inte en strikt RFC-validering.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const requestedEventIdRaw = body.event_id?.trim()

  if (!ticketCode) {
    return jsonResponse({ error: 'ticket_code krävs.' }, 400)
  }

  // event_id är valfritt (bakåtkompatibelt, se filkommentaren), men om
  // det skickas måste det se ut som ett UUID - annars ett tydligt 400
  // istället för att tyst behandlas som "inget event_id skickat".
  if (requestedEventIdRaw && !UUID_PATTERN.test(requestedEventIdRaw)) {
    return jsonResponse({ error: 'event_id måste vara ett giltigt UUID.' }, 400)
  }
  const requestedEventId = requestedEventIdRaw || null

  const supabase = createAdminClient()

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id, holder_name, status, checked_in_at, event_id, order_id, ticket_type_id, events(title, status, starts_at)')
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
      ticket_is_free: null,
      order_summary: null,
      checked_in_at: null,
      message: null,
    })
  }

  // event (titel+status+starttid) kan komma som objekt eller array
  // beroende på PostgREST-version.
  const eventRelation = ticket.events as unknown
  const event = Array.isArray(eventRelation)
    ? (eventRelation[0] ?? null)
    : (eventRelation as { title?: string; status?: string; starts_at?: string } | null)
  const eventTitle = event?.title ?? null

  const outcome = determineScanOutcome({
    ticketStatus: ticket.status as 'valid' | 'checked_in' | 'void',
    eventStatus: event?.status ?? null,
    ticketEventId: ticket.event_id,
    requestedEventId,
    ticketEventTitle: eventTitle,
    ticketEventStartsAt: event?.starts_at ?? null,
  })

  // Biljettyp + köpsammansättning (ordern A2) - bara för svar där
  // biljetten hittades OCH inte avvisas för inställt event/fel
  // föreställning (showTicketType, se determineScanOutcome.ts). Den rena
  // beräkningen (ticket_type/ticket_is_free/order_summary) ligger i
  // buildTicketTypeInfo - index.ts hämtar bara raderna och normaliserar
  // PostgREST:s objekt-eller-array-form för den inbäddade relationen.
  let orderItemsForScan: OrderItemForScan[] = []
  if (outcome.showTicketType) {
    const { data: orderItems, error: orderItemsError } = await supabase
      .from('order_items')
      .select('ticket_type_id, qty, list_price_ore, ticket_types(name)')
      .eq('order_id', ticket.order_id)

    if (orderItemsError) {
      console.error('Kunde inte hämta order_items för scan-ticket', ticket.order_id, orderItemsError.message)
    } else if (orderItems) {
      orderItemsForScan = orderItems.map((item) => ({
        ticket_type_id: item.ticket_type_id,
        qty: item.qty,
        listPriceOre: item.list_price_ore,
        typeName: single<{ name: string }>(item.ticket_types as unknown as { name: string } | { name: string }[] | null)?.name ?? null,
      }))
    }
  }

  const { ticket_type: ticketType, ticket_is_free: ticketIsFree, order_summary: orderSummary } = buildTicketTypeInfo({
    showTicketType: outcome.showTicketType,
    ownTicketTypeId: ticket.ticket_type_id,
    orderItems: orderItemsForScan,
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
    ticket_type: ticketType,
    ticket_is_free: ticketIsFree,
    order_summary: orderSummary,
    checked_in_at: checkedInAtResponse,
    message: outcome.message,
  })
})
