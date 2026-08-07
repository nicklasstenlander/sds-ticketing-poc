// Delad platform-admin-auktoriseringskontroll (Tilläggsordern 2026-08-06/
// 07, "Ansökningsformulär för nya arrangörer"). Bryter ut samma
// JWT-verifiering + platform_admins-uppslag som tidigare fanns duplicerad
// i platform-create-organizer och admin-list-organizers var för sig -
// nu delad av dem plus admin-approve-application/admin-reject-
// application/admin-list-applications.
//
// Används av funktioner som körs INNAN något arrangörs-workspace är valt
// (skapa/godkänna/avslå/lista arrangörer eller ansökningar) -
// resolveOrganizer() (organizerAuth.ts) räcker inte här eftersom den
// kräver ett redan valt organizer_id via X-Organizer-Id, vilket per
// definition inte finns något meningsfullt värde för i de här flödena.
import { createAdminClient } from './supabaseAdmin.ts'

export type PlatformAdminCheck =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 }

export async function requirePlatformAdmin(req: Request): Promise<PlatformAdminCheck> {
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization')
  const match = authHeader?.match(/^Bearer\s+(.+)$/i)
  const jwt = match?.[1]
  if (!jwt) return { ok: false, status: 401 }

  const supabase = createAdminClient()

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt)
  if (userError || !userData?.user) return { ok: false, status: 401 }

  const { data: platformAdmin } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (!platformAdmin) return { ok: false, status: 403 }

  return { ok: true, userId: userData.user.id }
}
