// public-join-waitlist
//
// Publik funktion (köpsidan /kop/:slug): ställer någon i kö till en
// slutsåld speltid (2026-11). Fungerar bara när arrangören slagit på
// väntelistan för speltiden (events.waitlist_enabled) OCH speltiden
// faktiskt är slutsåld - finns det platser ska man köpa direkt.
//
// POST { event_slug, name, email, qty, website }
//   website = honeypot (dolt fält, ska alltid vara tomt), samma skydd
//   som public-apply-organizer.
//
// Svar: 200 { result: 'joined' | 'already_joined' }
//       400 ogiltiga fält, 404 speltiden finns inte/väntelistan är av,
//       409 { code: 'not_sold_out' } det finns platser att köpa
//
// Ingen bekräftelse avslöjar om en ANNAN adress står i kön; samma adress
// två gånger ger 'already_joined'. Loggar aldrig namn eller e-post.
import { instrumentEdgeFunctions } from '../_shared/sentry.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

interface JoinBody {
  event_slug?: string
  name?: string
  email?: string
  qty?: number
  website?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_NAME_LENGTH = 120
const MAX_EMAIL_LENGTH = 254
const MAX_QTY = 10

await instrumentEdgeFunctions()

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  let body: JoinBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  // Honeypot: svara som om allt gick bra, men spara inget.
  if (body.website && body.website.trim() !== '') {
    return jsonResponse({ result: 'joined' })
  }

  const slug = (body.event_slug ?? '').trim()
  const name = (body.name ?? '').trim()
  const email = (body.email ?? '').trim()
  const qty = Number(body.qty)
  if (!slug) return jsonResponse({ error: 'Speltiden saknas.' }, 400)
  if (!name || name.length > MAX_NAME_LENGTH) return jsonResponse({ error: 'Fyll i ditt namn.' }, 400)
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return jsonResponse({ error: 'Fyll i en giltig e-postadress.' }, 400)
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    return jsonResponse({ error: `Antal biljetter måste vara 1–${MAX_QTY}.` }, 400)
  }

  const supabase = createAdminClient()
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, status, archived_at, capacity, sold_count, waitlist_enabled')
    .eq('slug', slug)
    .maybeSingle()
  if (eventError) {
    return jsonResponse({ error: `Databasfel: ${eventError.message}` }, 500)
  }
  if (!event || event.status !== 'published' || event.archived_at || !event.waitlist_enabled) {
    return jsonResponse({ error: 'Väntelistan finns inte för den här speltiden.' }, 404)
  }
  if (event.capacity > 0 && event.sold_count < event.capacity) {
    return jsonResponse({ error: 'Det finns platser kvar – du kan köpa biljetter direkt.', code: 'not_sold_out' }, 409)
  }

  const { error: insertError } = await supabase
    .from('waitlist_entries')
    .insert({ event_id: event.id, name, email, qty })
  if (insertError) {
    // 23505 = unik-index (samma adress står redan i kö till speltiden).
    if (insertError.code === '23505') {
      return jsonResponse({ result: 'already_joined' })
    }
    return jsonResponse({ error: `Kunde inte spara: ${insertError.message}` }, 500)
  }

  console.log(`public-join-waitlist: ny plats i kön för event ${event.id}.`)
  return jsonResponse({ result: 'joined' })
})
