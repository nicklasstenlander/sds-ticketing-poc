// admin-list-members
//
// Tilläggsordern 2026-08-06 ("Flera användare per arrangör"). Returnerar
// den inloggade användarens EGEN arrangör (id+namn, för att kunna
// förifylla namnfältet i UI:t utan ett separat anrop) plus alla dess
// organizer_members, joinat med auth.users för e-post och
// last_sign_in_at - samma inbjuden/aktiv-härledning som redan används i
// admin-list-organizers för platform-vyn, återanvänt här istället för
// omskrivet.
//
// is_self på varje medlemsrad låter frontend gråtona "Ta bort"-länken för
// den inloggade användarens egen rad UTAN att behöva exponera user_id -
// självborttagning är explicit utanför scope för denna order (se admin-
// remove-member, som ändå blockerar det server-side ifall UI:t kringgås).
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const auth = await resolveOrganizer(req)
  if (!auth) {
    return jsonResponse({ error: 'Ej behörig.' }, 401)
  }

  const supabase = createAdminClient()

  const { data: organizer, error: organizerError } = await supabase
    .from('organizers')
    .select('id, name')
    .eq('id', auth.organizerId)
    .single()

  if (organizerError || !organizer) {
    return jsonResponse({ error: 'Arrangören hittades inte.' }, 404)
  }

  const { data: members, error: membersError } = await supabase
    .from('organizer_members')
    .select('id, user_id, created_at')
    .eq('organizer_id', auth.organizerId)
    .order('created_at')

  if (membersError) {
    return jsonResponse({ error: `Databasfel: ${membersError.message}` }, 500)
  }

  const result = []
  for (const member of members ?? []) {
    const { data: userResult } = await supabase.auth.admin.getUserById(member.user_id)
    result.push({
      id: member.id,
      email: userResult?.user?.email ?? '(okänd e-post)',
      status: userResult?.user?.last_sign_in_at ? 'active' : 'invited',
      is_self: member.user_id === auth.userId,
    })
  }

  return jsonResponse({ organizer: { id: organizer.id, name: organizer.name }, members: result })
})
