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
import { handleOptions, corsHeaders } from '../_shared/cors.ts'
import { bearerTokenFrom, timingSafeEqual } from '../_shared/adminToken.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

function statsResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

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

  return statsResponse({ generated_at: new Date().toISOString(), events: data ?? [] }, 200)
})
