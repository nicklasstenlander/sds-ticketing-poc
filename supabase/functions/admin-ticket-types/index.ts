// admin-ticket-types
//
// CRUD för biljettyper (ticket_types) inom ett event. Kräver giltig
// Supabase Auth-JWT (se _shared/organizerAuth.ts). Ett enda POST-anrop
// med ett "action"-fält (create/update/delete) istället för separata
// funktioner - samma yta som resten av admin-API:et men slipper tre
// nästan identiska edge functions för en så pass liten resurs.
//
// Dataisolering (Tilläggsordern 2026-08-05): ticket_types har ingen egen
// organizer_id-kolumn, ägarskap härleds alltid transitivt via
// ticket_types.event_id -> events.organizer_id. Varje create/update/delete
// kontrollerar explicit att det berörda eventet tillhör den inloggade
// användarens arrangör - annars 404, avslöjar inte att raden existerar.
//
// Ingen capacity på biljettypen (rättelseordern 2026-08-05, delad
// kapacitetspool) - kapacitet hanteras uteslutande på eventet
// (admin-update-event), biljettyper har bara namn/pris/moms och ett
// sold_count som enbart är rapportering.
//
// Radering: samma villkorade logik som event-radering (Tilläggsordern
// avsnitt 5) - en biljettyp utan PAID-ordrar raderas, en med paid-ordrar
// kan inte tas bort (ingen "inaktivera"-flagga i v1, se Tilläggsordern).
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

const VALID_VAT_RATES = [0, 6, 12, 25]

interface Body {
  action?: 'create' | 'update' | 'delete'
  event_id?: string
  ticket_type_id?: string
  name?: string
  price_ore?: number
  vat_rate?: number
  sort_order?: number
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

  let body: Body
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const supabase = createAdminClient()

  if (body.action === 'create') {
    const eventId = (body.event_id ?? '').trim()
    const name = (body.name ?? '').trim()
    const priceOre = Number(body.price_ore)
    const vatRate = body.vat_rate === undefined ? 6 : Number(body.vat_rate)

    if (!eventId) return jsonResponse({ error: 'event_id krävs.' }, 400)
    if (!name) return jsonResponse({ error: 'Namn krävs.' }, 400)
    if (!Number.isInteger(priceOre) || priceOre < 0) {
      return jsonResponse({ error: 'Pris måste vara ett heltal (öre) >= 0.' }, 400)
    }
    if (!VALID_VAT_RATES.includes(vatRate)) {
      return jsonResponse({ error: 'Momssats måste vara 0, 6, 12 eller 25 procent.' }, 400)
    }

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, status, organizer_id')
      .eq('id', eventId)
      .maybeSingle()
    if (eventError) return jsonResponse({ error: `Databasfel: ${eventError.message}` }, 500)
    if (!event || event.organizer_id !== auth.organizerId) {
      return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
    }
    if (event.status === 'cancelled') {
      return jsonResponse({ error: 'Eventet är inställt och kan inte redigeras.' }, 409)
    }

    const { data, error } = await supabase
      .from('ticket_types')
      .insert({
        event_id: eventId,
        name,
        price_ore: priceOre,
        vat_rate: vatRate,
        sort_order: Number.isInteger(body.sort_order) ? body.sort_order : 0,
      })
      .select()
      .single()

    if (error) return jsonResponse({ error: `Kunde inte skapa biljettyp: ${error.message}` }, 500)
    return jsonResponse({ ticket_type: data }, 201)
  }

  if (body.action === 'update') {
    const ticketTypeId = (body.ticket_type_id ?? '').trim()
    if (!ticketTypeId) return jsonResponse({ error: 'ticket_type_id krävs.' }, 400)

    const { data: current, error: currentError } = await supabase
      .from('ticket_types')
      .select('id, sold_count, events!inner(organizer_id)')
      .eq('id', ticketTypeId)
      .maybeSingle()
    if (currentError) return jsonResponse({ error: `Databasfel: ${currentError.message}` }, 500)
    const currentEvent = current ? (Array.isArray(current.events) ? current.events[0] : current.events) : null
    if (!current || !currentEvent || currentEvent.organizer_id !== auth.organizerId) {
      return jsonResponse({ error: 'Biljettypen hittades inte.' }, 404)
    }

    const update: Record<string, unknown> = {}

    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return jsonResponse({ error: 'Namn kan inte vara tomt.' }, 400)
      update.name = name
    }
    if (body.price_ore !== undefined) {
      const priceOre = Number(body.price_ore)
      if (!Number.isInteger(priceOre) || priceOre < 0) {
        return jsonResponse({ error: 'Pris måste vara ett heltal (öre) >= 0.' }, 400)
      }
      update.price_ore = priceOre
    }
    if (body.vat_rate !== undefined) {
      const vatRate = Number(body.vat_rate)
      if (!VALID_VAT_RATES.includes(vatRate)) {
        return jsonResponse({ error: 'Momssats måste vara 0, 6, 12 eller 25 procent.' }, 400)
      }
      update.vat_rate = vatRate
    }
    if (body.sort_order !== undefined && Number.isInteger(body.sort_order)) {
      update.sort_order = body.sort_order
    }

    if (Object.keys(update).length === 0) {
      return jsonResponse({ error: 'Inga fält att uppdatera skickades.' }, 400)
    }

    const { data, error } = await supabase
      .from('ticket_types')
      .update(update)
      .eq('id', ticketTypeId)
      .select()
      .single()

    if (error) return jsonResponse({ error: `Kunde inte uppdatera biljettyp: ${error.message}` }, 500)
    return jsonResponse({ ticket_type: data })
  }

  if (body.action === 'delete') {
    const ticketTypeId = (body.ticket_type_id ?? '').trim()
    if (!ticketTypeId) return jsonResponse({ error: 'ticket_type_id krävs.' }, 400)

    const { data: ticketType, error: ticketTypeError } = await supabase
      .from('ticket_types')
      .select('id, events!inner(organizer_id)')
      .eq('id', ticketTypeId)
      .maybeSingle()
    if (ticketTypeError) return jsonResponse({ error: `Databasfel: ${ticketTypeError.message}` }, 500)
    const ownerEvent = ticketType ? (Array.isArray(ticketType.events) ? ticketType.events[0] : ticketType.events) : null
    if (!ticketType || !ownerEvent || ownerEvent.organizer_id !== auth.organizerId) {
      return jsonResponse({ error: 'Biljettypen hittades inte.' }, 404)
    }

    const { count: paidOrderCount, error: countError } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_type_id', ticketTypeId)
      .eq('status', 'paid')
    if (countError) return jsonResponse({ error: `Kunde inte kontrollera ordrar: ${countError.message}` }, 500)

    if (paidOrderCount && paidOrderCount > 0) {
      return jsonResponse(
        { error: `Biljettypen har ${paidOrderCount} sålda biljetter och kan inte raderas.` },
        409,
      )
    }

    // Inga paid-ordrar - men overksamma rader (pending/expired) kan
    // fortfarande referera denna typ. orders.ticket_type_id har ingen
    // "on delete cascade", så nolla referensen explicit innan radering
    // (samma mönster som event-radering städar orders/tickets).
    const { error: clearOrdersError } = await supabase
      .from('orders')
      .update({ ticket_type_id: null })
      .eq('ticket_type_id', ticketTypeId)
    if (clearOrdersError) {
      return jsonResponse({ error: `Kunde inte städa ordrar: ${clearOrdersError.message}` }, 500)
    }

    const { error: deleteError } = await supabase.from('ticket_types').delete().eq('id', ticketTypeId)
    if (deleteError) return jsonResponse({ error: `Kunde inte radera biljettyp: ${deleteError.message}` }, 500)

    return jsonResponse({ result: 'deleted' })
  }

  return jsonResponse({ error: 'action måste vara "create", "update" eller "delete".' }, 400)
})
