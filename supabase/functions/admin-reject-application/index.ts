// admin-reject-application
//
// Tilläggsordern 2026-08-06/07, "Ansökningsformulär för nya arrangörer".
// Platform-admin-skyddad. Sätter bara status='rejected' - ingen
// organizer/konto skapas, inget mail skickas till den sökande i denna
// version (se ordertextens punkt 3, "Avslå").
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { requirePlatformAdmin } from '../_shared/platformAdmin.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

interface RejectBody {
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

  let body: RejectBody
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
    .select('id, status')
    .eq('id', applicationId)
    .maybeSingle()

  if (applicationError || !application) {
    return jsonResponse({ error: 'Ansökan hittades inte.' }, 404)
  }

  if (application.status !== 'pending') {
    return jsonResponse({ error: 'Ansökan är redan hanterad.' }, 409)
  }

  const { error: updateError } = await supabase
    .from('organizer_applications')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: auth.userId })
    .eq('id', applicationId)

  if (updateError) {
    return jsonResponse({ error: `Kunde inte avslå ansökan: ${updateError.message}` }, 500)
  }

  return jsonResponse({ success: true })
})
