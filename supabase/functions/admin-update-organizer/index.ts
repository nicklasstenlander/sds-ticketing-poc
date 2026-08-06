// admin-update-organizer
//
// Tilläggsordern 2026-08-06 ("Flera användare per arrangör"). Låter en
// arrangörs-admin (eller en platform-admin med ett workspace valt) ändra
// sin EGEN arrangörs namn. organizer_id härleds via resolveOrganizer(req),
// aldrig från klientdata - en arrangörs-admin kan alltså inte ändra en
// annan arrangörs namn genom att skicka ett annat id, för det skickas
// inget id alls från klienten.
//
// Bara `name` i denna order - inte `slug` (skulle bryta befintliga
// länkar/QR-koder som pekar på slug-baserade URL:er) och inte
// `contact_email` (rörs inte här).
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'

interface UpdateOrganizerBody {
  name?: string
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const auth = await resolveOrganizer(req)
  if (!auth) {
    return jsonResponse({ error: 'Ej behörig.' }, 401)
  }

  let body: UpdateOrganizerBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const name = (body.name ?? '').trim()
  if (!name) {
    return jsonResponse({ error: 'Namn krävs.' }, 400)
  }

  const supabase = createAdminClient()

  const { error: updateError } = await supabase
    .from('organizers')
    .update({ name })
    .eq('id', auth.organizerId)

  if (updateError) {
    return jsonResponse({ error: `Kunde inte spara namnet: ${updateError.message}` }, 500)
  }

  return jsonResponse({ name })
})
