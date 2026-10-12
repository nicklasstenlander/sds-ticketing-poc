// admin-archive-orders
//
// Arkiverar eller återställer ett eller flera ordrar direkt (ordern
// "Arkiv för ordrar och event" 2026-10-12, DEL 2 punkt 1 - "order-
// arkivering som tillägg", enskilt och flerval). Rör INTE eventet de
// tillhör - till skillnad från admin-archive-event, som kaskaderar från
// event till ordrar, går den här vägen bara åt det hållet: en enskild
// order kan arkiveras utan att hela eventet döljs.
//
// "Radera aldrig något": DELETE:ar aldrig en rad, bara flaggar. Rör inte
// sold_count/capacity, inte Stripe, inte tickets.
//
// Kräver giltig Supabase Auth-JWT. Varje order_id måste höra till ett
// event som tillhör den inloggade användarens egen arrangör - annars
// avvisas HELA anropet (inget delvis utfört) med 404, samma
// "avslöja-ingenting-om-andra-arrangörers-data"-princip som övriga
// admin-funktioner.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

type ArchiveReason = 'test' | 'hidden'
const VALID_REASONS: ArchiveReason[] = ['test', 'hidden']
const MAX_ORDER_IDS = 200

interface ArchiveOrdersBody {
  order_ids?: string[]
  action?: 'archive' | 'restore'
  reason?: ArchiveReason
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

  let body: ArchiveOrdersBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const orderIds = Array.from(new Set((body.order_ids ?? []).map((id) => id.trim()).filter(Boolean)))
  if (orderIds.length === 0) {
    return jsonResponse({ error: 'order_ids krävs (minst en).' }, 400)
  }
  if (orderIds.length > MAX_ORDER_IDS) {
    return jsonResponse({ error: `Högst ${MAX_ORDER_IDS} ordrar åt gången.` }, 400)
  }

  if (body.action !== 'archive' && body.action !== 'restore') {
    return jsonResponse({ error: 'action måste vara "archive" eller "restore".' }, 400)
  }

  if (body.action === 'archive' && !VALID_REASONS.includes(body.reason as ArchiveReason)) {
    return jsonResponse({ error: 'reason måste vara "test" eller "hidden" vid arkivering.' }, 400)
  }

  const supabase = createAdminClient()

  // Ägarskap: varje order_id måste höra till ETT event som tillhör den
  // inloggade arrangören. events!inner filtrerar bort ordrar vars event
  // hör till en annan arrangör precis som att de inte matchade alls.
  const { data: owned, error: ownedError } = await supabase
    .from('orders')
    .select('id, events!inner(organizer_id)')
    .in('id', orderIds)
    .eq('events.organizer_id', auth.organizerId)

  if (ownedError) {
    return jsonResponse({ error: `Databasfel: ${ownedError.message}` }, 500)
  }

  const ownedIds = new Set((owned ?? []).map((o) => o.id))
  if (ownedIds.size !== orderIds.length) {
    return jsonResponse({ error: 'En eller flera ordrar hittades inte.' }, 404)
  }

  if (body.action === 'archive') {
    const archivedAt = new Date().toISOString()
    const { data: archived, error: updateError } = await supabase
      .from('orders')
      .update({ archived_at: archivedAt, archived_by: auth.userId, archived_reason: body.reason })
      .in('id', orderIds)
      .is('archived_at', null) // idempotent - hoppar tyst över redan arkiverade
      .select('id')

    if (updateError) {
      return jsonResponse({ error: `Kunde inte arkivera ordrarna: ${updateError.message}` }, 500)
    }

    return jsonResponse({ result: 'archived', count: archived?.length ?? 0 })
  }

  // action === 'restore'
  const { data: restored, error: restoreError } = await supabase
    .from('orders')
    .update({ archived_at: null, archived_by: null, archived_reason: null })
    .in('id', orderIds)
    .not('archived_at', 'is', null)
    .select('id')

  if (restoreError) {
    return jsonResponse({ error: `Kunde inte återställa ordrarna: ${restoreError.message}` }, 500)
  }

  return jsonResponse({ result: 'restored', count: restored?.length ?? 0 })
})
