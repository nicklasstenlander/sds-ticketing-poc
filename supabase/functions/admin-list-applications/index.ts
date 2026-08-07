// admin-list-applications
//
// Tilläggsordern 2026-08-06/07, "Ansökningsformulär för nya arrangörer".
// Platform-admin-skyddad. Returnerar väntande ansökningar separat från
// tidigare hanterade (godkända/avslagna), så admin-UI:t kan visa
// "Väntande ansökningar" som en egen, alltid synlig-vid-innehåll sektion
// och "Tidigare ansökningar" hopfällbart (se ordertextens punkt 3).
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { requirePlatformAdmin } from '../_shared/platformAdmin.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const auth = await requirePlatformAdmin(req)
  if (!auth.ok) {
    return jsonResponse({ error: 'Ej behörig.' }, auth.status)
  }

  const supabase = createAdminClient()

  const { data: pending, error: pendingError } = await supabase
    .from('organizer_applications')
    .select('id, organizer_name, contact_email, message, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (pendingError) {
    return jsonResponse({ error: `Databasfel: ${pendingError.message}` }, 500)
  }

  const { data: reviewed, error: reviewedError } = await supabase
    .from('organizer_applications')
    .select('id, organizer_name, contact_email, message, created_at, status, reviewed_at')
    .in('status', ['approved', 'rejected'])
    .order('reviewed_at', { ascending: false })
    .limit(50)

  if (reviewedError) {
    return jsonResponse({ error: `Databasfel: ${reviewedError.message}` }, 500)
  }

  return jsonResponse({ pending: pending ?? [], reviewed: reviewed ?? [] })
})
