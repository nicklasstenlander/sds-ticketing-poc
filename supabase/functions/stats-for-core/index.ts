// stats-for-core
//
// Skrivskyddad statistik per föreställning, åt CORE-webbens
// (sds-dashboard) nya flik "Föreställningar" (ordern "Föreställningar-
// statistik från Rideau till CORE" 2026-10-13, Fas 1b). Hämtas av
// Cloudflare Workern sds-cogwork-proxy (Fas 2, inte byggd än), ALDRIG
// direkt av webbläsaren - CORE_STATS_TOKEN är en server-till-server-
// hemlighet.
//
// Rör INGET i betal-/mejlspåret: läser bara via EN rpc (core_event_
// stats, se migrationen för aggregeringslogiken), skriver ingenting.
//
// Auth: statisk bearer-token (CORE_STATS_TOKEN), SAMMA mönster som
// retry-confirmation-emails - konstant-tids jämförelse, fail-closed om
// hemligheten saknas i miljön (kontrolleras FÖRE token-jämförelsen).
// INGEN Supabase-JWT här (verify_jwt=false i config.toml) - proxyn
// autentiserar SIN egen anropare (CORE-admin) separat i Fas 2, den här
// funktionen vet bara om "rätt proxy-hemlighet eller inte".
//
// Arrangören bestäms ENBART av miljövariabeln CORE_STATS_ORGANIZER_ID,
// satt server-side som en Supabase secret - ALDRIG från en header,
// query-parameter eller något annat klienten skickar. Det finns
// medvetet INGEN väg att be om en ANNAN arrangörs statistik än den
// som är hårdkodad i den här miljön.
//
// Svaret innehåller bara aggregat (se core_event_stats) - inga
// köparnamn, e-postadresser eller order-id:n. Cache-Control: no-store
// eftersom cachning sker ETT STEG BORT (Cloudflare KV, Fas 2) - den
// här funktionen ska alltid ge ett färskt svar när den anropas.
import { instrumentEdgeFunctions } from '../_shared/sentry.ts'
import { handleOptions, corsHeaders } from '../_shared/cors.ts'
import { bearerTokenFrom, timingSafeEqual } from '../_shared/adminToken.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

function statsResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

await instrumentEdgeFunctions()

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET') {
    return statsResponse({ error: 'method_not_allowed' }, 405)
  }

  const statsToken = Deno.env.get('CORE_STATS_TOKEN')
  const organizerId = Deno.env.get('CORE_STATS_ORGANIZER_ID')
  if (!statsToken || !organizerId) {
    console.error('stats-for-core: CORE_STATS_TOKEN eller CORE_STATS_ORGANIZER_ID saknas i miljön')
    return statsResponse({ error: 'not_configured' }, 500)
  }

  const provided = bearerTokenFrom(req)
  if (!provided || !timingSafeEqual(provided, statsToken)) {
    return statsResponse({ error: 'unauthorized' }, 401)
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('core_event_stats', { p_organizer_id: organizerId })

  if (error) {
    console.error('stats-for-core: core_event_stats misslyckades', error.message)
    return statsResponse({ error: 'stats_failed' }, 500)
  }

  return statsResponse(
    {
      generated_at: new Date().toISOString(),
      // Granskning 2026-10-13, beslut punkt 1: core_event_stats
      // kan INTE dra av partiella återbetalningar (se migrationens
      // egen kommentar - beloppet persisteras ingenstans i schemat
      // idag). Snarare än att tyst kalla revenue_ore "netto" när det
      // inte är det för det fallet, flaggas läget explicit här så
      // CORE kan märka siffran i UI:t (Fas 3). Byts till
      // 'net_after_partial_refunds' den dagen refunded_ore faktiskt
      // finns och dras av (planerat efter 2 nov, se beslutet).
      revenue_basis: 'gross_before_partial_refunds',
      // Granskning 2026-10-13, beslut punkt 3: order_items.unit_price_ore
      // (grunden för revenue_ore) är redan priset KUNDEN BETALADE,
      // dvs inklusive moms (samma princip som export-sales/kvittot -
      // moms läggs aldrig på separat, bara extraheras ur beloppet för
      // bokföring). Flaggas explicit här så CORE aldrig av misstag
      // lägger på moms en gång till.
      revenue_includes_vat: true,
      events: data ?? [],
    },
    200,
  )
})
