// admin-events
//
// Listar ALLA events (både draft och published) för admin-vyn, inklusive
// sold_count/capacity. Kräver giltig admin-sessionstoken. Anon-nyckeln ser
// bara publicerade events (via RLS), så admin-listan måste gå via en
// service-role-funktion för att även visa utkast.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { bearerTokenFrom, verifyAdminToken } from '../_shared/adminToken.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const adminPin = Deno.env.get('ADMIN_PIN')
  if (!adminPin) {
    return jsonResponse({ error: 'ADMIN_PIN är inte konfigurerad på servern.' }, 500)
  }

  const token = bearerTokenFrom(req)
  if (!(await verifyAdminToken(adminPin, token))) {
    return jsonResponse({ error: 'Ej behörig. Logga in i admin igen.' }, 401)
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('events')
    .select('id, slug, title, venue, starts_at, capacity, sold_count, status, created_at')
    .order('starts_at', { ascending: true })

  if (error) {
    return jsonResponse({ error: `Kunde inte hämta events: ${error.message}` }, 500)
  }

  // Samma ISO 8601-format (UTC, inga fraktionella sekunder) som resten av
  // API:et - se _shared/time.ts.
  const events = (data ?? []).map((e) => ({
    ...e,
    starts_at: toIso8601Seconds(e.starts_at),
    created_at: toIso8601Seconds(e.created_at),
  }))

  return jsonResponse({ events })
})
