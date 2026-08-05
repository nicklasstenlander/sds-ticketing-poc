// admin-list-organizers
//
// Uppföljning 2026-08-05 ("platform-admin"). Listar alla arrangörer så
// att en plattformsadmin kan välja vilket workspace hen vill agera i
// (se _shared/organizerAuth.ts - X-Organizer-Id-headern på efterföljande
// admin-*-anrop). Kontrollerar platform_admins DIREKT här istället för
// via resolveOrganizer(), eftersom hela poängen med den här funktionen
// är att köras INNAN något organizer_id är valt - resolveOrganizer
// kräver redan ett valt workspace för platform-admins.
//
// Vanliga arrangörsanvändare (ej platform-admin) får 403 - frontend
// tolkar det som "ingen workspace-växlare ska visas", inte som ett fel.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization')
  const match = authHeader?.match(/^Bearer\s+(.+)$/i)
  const jwt = match?.[1]
  if (!jwt) {
    return jsonResponse({ error: 'Ej behörig.' }, 401)
  }

  const supabase = createAdminClient()

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt)
  if (userError || !userData?.user) {
    return jsonResponse({ error: 'Ej behörig.' }, 401)
  }

  const { data: platformAdmin } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (!platformAdmin) {
    return jsonResponse({ error: 'Ej behörig.' }, 403)
  }

  const { data: organizers, error } = await supabase.from('organizers').select('id, name, slug').order('name')

  if (error) {
    return jsonResponse({ error: `Databasfel: ${error.message}` }, 500)
  }

  return jsonResponse({ organizers: organizers ?? [] })
})
