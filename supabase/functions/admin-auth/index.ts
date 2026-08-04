// admin-auth
//
// Verifierar admin-PIN-koden SERVER-SIDA (mot Supabase secreten ADMIN_PIN).
// Klienten skickar aldrig något annat än den PIN användaren skrivit in, och
// jämförelsen sker aldrig i klient-JS - bara här. Vid korrekt PIN utfärdas
// en kortlivad, HMAC-signerad sessionstoken (se _shared/adminToken.ts) som
// admin-UI:t sedan skickar som "Authorization: Bearer <token>" till
// admin-create-event / admin-events / admin-event-tickets.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { issueAdminToken, timingSafeEqual } from '../_shared/adminToken.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const adminPin = Deno.env.get('ADMIN_PIN')
  if (!adminPin) {
    return jsonResponse({ error: 'ADMIN_PIN är inte konfigurerad på servern.' }, 500)
  }

  let body: { pin?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const suppliedPin = (body.pin ?? '').trim()
  if (!suppliedPin || !timingSafeEqual(suppliedPin, adminPin)) {
    return jsonResponse({ error: 'Fel PIN-kod.' }, 401)
  }

  const { token, expiresAt } = await issueAdminToken(adminPin)
  return jsonResponse({ token, expires_at: expiresAt }, 200)
})
