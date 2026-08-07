// platform-create-organizer
//
// Tilläggsordern 2026-08-06 ("Självbetjänad onboarding av nya
// arrangörer"). Platform-admin-skyddad via _shared/platformAdmin.ts
// (samma direkta kontroll som admin-list-organizers - inte
// resolveOrganizer(), eftersom det inte finns något valt workspace att
// agera i här, tvärtom är hela poängen att SKAPA ett nytt sådant).
//
// Refaktorerad (Tilläggsordern 2026-08-06/07, "Ansökningsformulär för
// nya arrangörer") - själva organizer-skapande-logiken (organizers-rad +
// Supabase-inbjudan + organizer_members-koppling) flyttades till
// _shared/createOrganizer.ts så admin-approve-application kan köra
// EXAKT samma kod när en ansökan godkänns, istället för en parallell
// implementation att hålla i synk. Den här filen gör nu bara
// auth-kontrollen + body-parsning.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { requirePlatformAdmin } from '../_shared/platformAdmin.ts'
import { createOrganizerAndInvite } from '../_shared/createOrganizer.ts'

interface CreateOrganizerBody {
  name?: string
  slug?: string
  contact_email?: string
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const auth = await requirePlatformAdmin(req)
  if (!auth.ok) {
    return jsonResponse({ error: 'Ej behörig.' }, auth.status)
  }

  let body: CreateOrganizerBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const result = await createOrganizerAndInvite({
    name: body.name ?? '',
    contactEmail: body.contact_email ?? '',
    slug: body.slug,
  })

  if (!result.ok) {
    return jsonResponse(
      { error: result.error, ...(result.organizer_id ? { organizer_id: result.organizer_id } : {}) },
      result.status,
    )
  }

  return jsonResponse(
    { organizer_id: result.organizer_id, slug: result.slug, invited_email: result.invited_email },
    201,
  )
})
