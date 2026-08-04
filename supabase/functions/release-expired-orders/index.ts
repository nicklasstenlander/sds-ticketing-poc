// release-expired-orders
//
// Säkerhetsnät utöver checkout.session.expired-webhooken (se
// stripe-webhook och migrationen 20260101000300_stripe_vat_export.sql,
// funktionen release_expired_orders()). Om en Stripe-webhook-leverans av
// någon anledning uteblir skulle en "pending"-order annars bli hängande
// för alltid med sin kapacitet reserverad. Detta jobb körs periodiskt
// (schemalagt via ett GitHub Actions-workflow, se
// .github/workflows/release-expired-orders.yml och README.md) och städar
// bort alla ordrar som passerat sin expires_at utan att bli paid/expired.
//
// Autentiseras med en statisk bearer-token (Supabase secret CRON_SECRET),
// samma konstant-tid-jämförelsemönster som SCANNER_BEARER_TOKEN. Detta är
// INTE en admin-sessionstoken (ingen PIN-inloggning inblandad) eftersom
// anroparen är ett schemalagt jobb utan mänsklig inloggning.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { bearerTokenFrom, timingSafeEqual } from '../_shared/adminToken.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    return jsonResponse({ error: 'CRON_SECRET är inte konfigurerad på servern.' }, 500)
  }

  const token = bearerTokenFrom(req)
  if (!token || !timingSafeEqual(token, cronSecret)) {
    return jsonResponse({ error: 'Ej behörig.' }, 401)
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('release_expired_orders')

  if (error) {
    return jsonResponse({ error: `Kunde inte städa utgångna ordrar: ${error.message}` }, 500)
  }

  const releasedOrderIds = (data ?? []).map(
    (row: { released_order_id: string }) => row.released_order_id,
  )

  return jsonResponse({ released_count: releasedOrderIds.length, released_order_ids: releasedOrderIds })
})
