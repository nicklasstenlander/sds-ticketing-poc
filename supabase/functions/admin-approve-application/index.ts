// admin-approve-application
//
// Tilläggsordern 2026-08-06/07, "Ansökningsformulär för nya arrangörer".
// Platform-admin-skyddad. Kör EXAKT samma organizer-skapande-logik som
// platform-create-organizer (_shared/createOrganizer.ts) - se den filens
// kommentar för varför den är delad. Den sökande får först NU sin
// inbjudan, aldrig vid själva formulärinskicket.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { requirePlatformAdmin } from '../_shared/platformAdmin.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { createOrganizerAndInvite } from '../_shared/createOrganizer.ts'

interface ApproveBody {
  application_id?: string
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

  let body: ApproveBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const applicationId = (body.application_id ?? '').trim()
  if (!applicationId) return jsonResponse({ error: 'application_id krävs.' }, 400)

  const supabase = createAdminClient()

  const { data: application, error: applicationError } = await supabase
    .from('organizer_applications')
    .select('id, organizer_name, contact_email, status')
    .eq('id', applicationId)
    .maybeSingle()

  if (applicationError || !application) {
    return jsonResponse({ error: 'Ansökan hittades inte.' }, 404)
  }

  if (application.status !== 'pending') {
    return jsonResponse({ error: 'Ansökan är redan hanterad.' }, 409)
  }

  const result = await createOrganizerAndInvite({
    name: application.organizer_name,
    contactEmail: application.contact_email,
  })

  // Markera ansökan som godkänd så fort en organizer FAKTISKT existerar -
  // även i det delvis misslyckade 502-fallet (organizer skapad men
  // inbjudan/kopplingen misslyckades), annars skulle ett förnyat klick på
  // "Godkänn" skapa en andra, dubblerad organizer för samma ansökan (se
  // createOrganizer.ts kommentar om varför organizers-raden aldrig rullas
  // tillbaka). Bara det renodlade skapande-felet (ingen organizer_id
  // alls) lämnar ansökan kvar som pending, så admin kan försöka igen.
  if (result.ok || result.organizer_id) {
    await supabase
      .from('organizer_applications')
      .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: auth.userId })
      .eq('id', applicationId)
  }

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
