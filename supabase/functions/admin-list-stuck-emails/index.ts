// admin-list-stuck-emails
//
// Lista över betalda ordrar (för den inloggade arrangören) där
// bekräftelsemejlet INTE har skickats (ordern "Webhooken är för
// långsam" 2026-10-13, ny plan punkt 2 - "en lista i admin"). Läsning,
// ingen åtgärd. Komplement till retry-confirmation-emails (som
// försöker skicka om automatiskt) - ger synlighet oavsett hur sällan
// det schemalagda jobbet faktiskt hinner köra (GitHub Actions' "on:
// schedule" är best effort, se den funktionens kommentar).
//
// En order som visas här kan antingen vänta på att retry-confirmation-
// emails försöker (om under MAX_ATTEMPTS i den funktionen), eller
// behöva en manuell admin-resend-tickets-ombegäran (force=true,
// kringgår aldrig av attempts-gränsen).
//
// GET admin-list-stuck-emails
// -> { orders: { order_id, buyer_name, buyer_email, event_title,
//      paid_at, attempts, last_error }[] }
//
// Samma auktorisering som övriga admin-*-funktioner (resolveOrganizer)
// - visar bara ordrar för den inloggade arrangörens egna event.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const auth = await resolveOrganizer(req)
  if (!auth) {
    return jsonResponse({ error: 'Ej behörig. Logga in i admin igen.' }, 401)
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, buyer_name, buyer_email, paid_at, confirmation_email_attempts, confirmation_email_last_error, events!inner(title, organizer_id)',
    )
    .eq('status', 'paid')
    .is('confirmation_email_sent_at', null)
    .eq('events.organizer_id', auth.organizerId)
    .order('paid_at', { ascending: true })

  if (error) {
    return jsonResponse({ error: `Databasfel: ${error.message}` }, 500)
  }

  function single<T>(rel: T | T[] | null): T | null {
    if (Array.isArray(rel)) return rel[0] ?? null
    return rel
  }

  const orders = (data ?? []).map((order) => ({
    order_id: order.id,
    buyer_name: order.buyer_name,
    buyer_email: order.buyer_email,
    event_title: single(order.events)?.title ?? null,
    paid_at: order.paid_at,
    attempts: order.confirmation_email_attempts,
    last_error: order.confirmation_email_last_error,
  }))

  return jsonResponse({ orders })
})
