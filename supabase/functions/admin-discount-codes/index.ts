// admin-discount-codes
//
// CRUD (list/create/update) för rabattkoder. Kräver giltig Supabase
// Auth-JWT (se _shared/organizerAuth.ts). Rabattkoder har medvetet ingen
// anon-läspolicy (se migrationen) - all åtkomst går via den här
// admin-skyddade funktionen (för listning/hantering) eller create-order
// (för validering vid köp).
//
// Dataisolering (Tilläggsordern 2026-08-05): discount_codes.organizer_id
// (tillagd i 20260108000000_organizers_auth.sql, en dokumenterad avvikelse
// från ordern - se migrationens kommentar) scopar ALLA operationer här
// direkt, inte transitivt via event_id (som är nullable för globala
// koder och därför inte räcker som isoleringsgräns på egen hand). Om
// koden knyts till ett specifikt event (event_id satt) kontrolleras
// dessutom att just DET eventet tillhör samma arrangör - annars skulle en
// arrangör kunna knyta sin kod till en annan arrangörs event.
//
// "Radera" finns inte som operation i v1 (Tilläggsordern avsnitt 6) -
// koder inaktiveras istället (active = false) så att de fortfarande syns
// i exportunderlaget för redan gjorda köp.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

interface Body {
  action?: 'list' | 'create' | 'update'
  discount_code_id?: string
  code?: string
  discount_type?: 'percent' | 'amount'
  value?: number
  event_id?: string | null
  max_uses?: number | null
  valid_from?: string | null
  valid_until?: string | null
  active?: boolean
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const auth = await resolveOrganizer(req)
  if (!auth) {
    return jsonResponse({ error: 'Ej behörig. Logga in i admin igen.' }, 401)
  }

  const supabase = createAdminClient()

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('discount_codes')
      .select(
        'id, code, discount_type, value, event_id, max_uses, used_count, valid_from, valid_until, active, created_at, events(title)',
      )
      .eq('organizer_id', auth.organizerId)
      .order('created_at', { ascending: false })
    if (error) return jsonResponse({ error: `Kunde inte hämta rabattkoder: ${error.message}` }, 500)
    return jsonResponse({ discount_codes: data ?? [] })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  if (body.action === 'create') {
    const code = (body.code ?? '').trim().toUpperCase()
    const discountType = body.discount_type
    const value = Number(body.value)
    const eventId = body.event_id ? String(body.event_id) : null
    const maxUses = body.max_uses === null || body.max_uses === undefined ? null : Number(body.max_uses)
    const validFrom = body.valid_from ? new Date(body.valid_from).toISOString() : null
    const validUntil = body.valid_until ? new Date(body.valid_until).toISOString() : null

    if (!code) return jsonResponse({ error: 'Kod krävs.' }, 400)
    if (discountType !== 'percent' && discountType !== 'amount') {
      return jsonResponse({ error: 'Typ måste vara "percent" eller "amount".' }, 400)
    }
    if (!Number.isInteger(value)) {
      return jsonResponse({ error: 'Värde måste vara ett heltal.' }, 400)
    }
    if (discountType === 'percent' && (value < 1 || value > 100)) {
      return jsonResponse({ error: 'Procentrabatt måste vara mellan 1 och 100.' }, 400)
    }
    if (discountType === 'amount' && value < 0) {
      return jsonResponse({ error: 'Beloppsrabatt (öre) måste vara >= 0.' }, 400)
    }
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
      return jsonResponse({ error: 'Max antal användningar måste vara ett heltal >= 1, eller lämnas tomt.' }, 400)
    }

    // Ett event_id måste tillhöra samma arrangör som den inloggade
    // användaren - annars skulle koden kunna knytas till (och därmed
    // gälla rabatt på) en annan arrangörs event.
    if (eventId) {
      const { data: event, error: eventError } = await supabase
        .from('events')
        .select('id, organizer_id')
        .eq('id', eventId)
        .maybeSingle()
      if (eventError) return jsonResponse({ error: `Databasfel: ${eventError.message}` }, 500)
      if (!event || event.organizer_id !== auth.organizerId) {
        return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
      }
    }

    const { data: existing } = await supabase
      .from('discount_codes')
      .select('id')
      .ilike('code', code)
      .maybeSingle()
    if (existing) {
      return jsonResponse({ error: 'En rabattkod med den koden finns redan.' }, 409)
    }

    const { data, error } = await supabase
      .from('discount_codes')
      .insert({
        code,
        discount_type: discountType,
        value,
        event_id: eventId,
        max_uses: maxUses,
        valid_from: validFrom,
        valid_until: validUntil,
        active: true,
        organizer_id: auth.organizerId,
      })
      .select()
      .single()

    if (error) return jsonResponse({ error: `Kunde inte skapa rabattkod: ${error.message}` }, 500)
    return jsonResponse({ discount_code: data }, 201)
  }

  if (body.action === 'update') {
    const discountCodeId = (body.discount_code_id ?? '').trim()
    if (!discountCodeId) return jsonResponse({ error: 'discount_code_id krävs.' }, 400)

    const { data: current, error: currentError } = await supabase
      .from('discount_codes')
      .select('id, organizer_id')
      .eq('id', discountCodeId)
      .maybeSingle()
    if (currentError) return jsonResponse({ error: `Databasfel: ${currentError.message}` }, 500)
    if (!current || current.organizer_id !== auth.organizerId) {
      return jsonResponse({ error: 'Rabattkoden hittades inte.' }, 404)
    }

    const update: Record<string, unknown> = {}
    if (body.active !== undefined) update.active = Boolean(body.active)
    if (body.max_uses !== undefined) {
      update.max_uses = body.max_uses === null ? null : Number(body.max_uses)
    }
    if (body.valid_until !== undefined) {
      update.valid_until = body.valid_until ? new Date(body.valid_until).toISOString() : null
    }
    if (body.valid_from !== undefined) {
      update.valid_from = body.valid_from ? new Date(body.valid_from).toISOString() : null
    }

    if (Object.keys(update).length === 0) {
      return jsonResponse({ error: 'Inga fält att uppdatera skickades.' }, 400)
    }

    const { data, error } = await supabase
      .from('discount_codes')
      .update(update)
      .eq('id', discountCodeId)
      .select()
      .single()

    if (error) return jsonResponse({ error: `Kunde inte uppdatera rabattkod: ${error.message}` }, 500)
    return jsonResponse({ discount_code: data })
  }

  return jsonResponse({ error: 'action måste vara "create" eller "update" (använd GET för att lista).' }, 400)
})
