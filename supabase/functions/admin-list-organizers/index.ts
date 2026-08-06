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
//
// Utökad (Tilläggsordern 2026-08-06, "Självbetjänad onboarding av nya
// arrangörer") med contact_email och en härledd status per arrangör:
// "invited" (inbjuden, ingen har loggat in än) eller "active" (minst en
// kopplad användare har loggat in minst en gång). Ingen egen kolumn att
// hålla synkad - härleds live från organizer_members + auth.users.
// last_sign_in_at via Auth Admin API (auth.users nås inte direkt via
// PostgREST, så vi slår upp varje unik user_id individuellt - listan över
// arrangörer är liten nog att N+1-uppslag inte är ett problem här).
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

  const { data: organizers, error } = await supabase
    .from('organizers')
    .select('id, name, slug, contact_email')
    .order('name')

  if (error) {
    return jsonResponse({ error: `Databasfel: ${error.message}` }, 500)
  }

  const { data: members, error: membersError } = await supabase
    .from('organizer_members')
    .select('organizer_id, user_id')

  if (membersError) {
    return jsonResponse({ error: `Databasfel: ${membersError.message}` }, 500)
  }

  // Slå upp last_sign_in_at för varje unik användare som är kopplad till
  // någon arrangör. getUserById() är Auth Admin API, inte PostgREST -
  // auth.users exponeras avsiktligt inte som en vanlig tabell.
  const uniqueUserIds = [...new Set((members ?? []).map((m) => m.user_id))]
  const lastSignInByUserId = new Map<string, string | null>()
  for (const userId of uniqueUserIds) {
    const { data: userResult } = await supabase.auth.admin.getUserById(userId)
    lastSignInByUserId.set(userId, userResult?.user?.last_sign_in_at ?? null)
  }

  const memberIdsByOrganizer = new Map<string, string[]>()
  for (const m of members ?? []) {
    const list = memberIdsByOrganizer.get(m.organizer_id) ?? []
    list.push(m.user_id)
    memberIdsByOrganizer.set(m.organizer_id, list)
  }

  const result = (organizers ?? []).map((org) => {
    const memberIds = memberIdsByOrganizer.get(org.id) ?? []
    const hasSignedIn = memberIds.some((userId) => lastSignInByUserId.get(userId))
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      contact_email: org.contact_email,
      status: hasSignedIn ? 'active' : 'invited',
    }
  })

  return jsonResponse({ organizers: result })
})
