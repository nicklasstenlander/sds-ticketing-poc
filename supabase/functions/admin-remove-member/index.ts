// admin-remove-member
//
// Tilläggsordern 2026-08-06 ("Flera användare per arrangör"). Tar bort en
// organizer_members-rad ur anroparens EGEN arrangör. Rör aldrig kontot i
// auth.users - personen kan fortfarande logga in, men resolveOrganizer()
// hittar ingen matchande arrangör längre och nekar admin-åtkomst, precis
// som för vem som helst utan medlemskap.
//
// Två skyddsregler (se ordertextens punkt 3):
// 1. Blockerar om det skulle ta bort den SISTA medlemmen - en arrangör
//    utan någon inloggningsbar användare är ett dödläge ingen kan
//    reparera själv.
// 2. Ingen självborttagning i denna version - för att undvika att av
//    misstag låsa ut sig ur en arrangör man fortfarande behöver komma åt.
//    Om det behövs, görs det via en annan medlem eller platform-admin.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'

interface RemoveMemberBody {
  member_id?: string
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

  let body: RemoveMemberBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const memberId = (body.member_id ?? '').trim()
  if (!memberId) {
    return jsonResponse({ error: 'member_id krävs.' }, 400)
  }

  const supabase = createAdminClient()

  // Samma 404-mönster som övriga admin-funktioner (se organizerAuth.ts-
  // kommentaren och admin-duplicate-event) om raden inte finns ELLER
  // tillhör en annan arrangör - avslöja aldrig att den finns hos någon
  // annan.
  const { data: member, error: memberError } = await supabase
    .from('organizer_members')
    .select('id, organizer_id, user_id')
    .eq('id', memberId)
    .maybeSingle()

  if (memberError || !member || member.organizer_id !== auth.organizerId) {
    return jsonResponse({ error: 'Medlemmen hittades inte.' }, 404)
  }

  if (member.user_id === auth.userId) {
    return jsonResponse(
      { error: 'Du kan inte ta bort dig själv. Be en annan medlem eller oss om hjälp.' },
      400,
    )
  }

  const { count, error: countError } = await supabase
    .from('organizer_members')
    .select('id', { count: 'exact', head: true })
    .eq('organizer_id', auth.organizerId)

  if (countError) {
    return jsonResponse({ error: `Databasfel: ${countError.message}` }, 500)
  }

  if ((count ?? 0) <= 1) {
    return jsonResponse(
      { error: 'Kan inte ta bort den sista medlemmen - arrangören skulle då sakna en inloggningsbar användare.' },
      400,
    )
  }

  const { error: deleteError } = await supabase.from('organizer_members').delete().eq('id', memberId)

  if (deleteError) {
    return jsonResponse({ error: `Kunde inte ta bort medlemmen: ${deleteError.message}` }, 500)
  }

  return jsonResponse({ result: 'removed' })
})
