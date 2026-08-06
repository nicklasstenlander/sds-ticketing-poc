// admin-invite-member
//
// Tilläggsordern 2026-08-06 ("Flera användare per arrangör"). Låter en
// VANLIG arrangörs-admin (ej platform-admin-behörighet krävs) bjuda in en
// kollega till sin EGEN arrangör - organizer_id härleds via
// resolveOrganizer(req), aldrig från klientdata. Skiljer sig från
// platform-create-organizer på så sätt att ingen ny organizers-rad skapas
// här - bara en ny organizer_members-rad kopplad till anroparens
// befintliga arrangör.
//
// Återanvänder samma Supabase-inbjudningsmönster (auth.admin.
// inviteUserByEmail) och samma välkomstsida (#/admin/valkommen) som redan
// finns från onboarding-ordern - inget nytt att bygga där.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'

interface InviteMemberBody {
  email?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

  let body: InviteMemberBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const email = (body.email ?? '').trim()
  if (!email || !EMAIL_RE.test(email)) {
    return jsonResponse({ error: 'En giltig e-postadress krävs.' }, 400)
  }

  const supabase = createAdminClient()

  const frontendBaseUrl = (Deno.env.get('FRONTEND_BASE_URL') ?? '').replace(/\/+$/, '')
  if (!frontendBaseUrl) {
    return jsonResponse({ error: 'FRONTEND_BASE_URL är inte konfigurerad på servern.' }, 500)
  }

  // Till skillnad från platform-create-organizer finns ingen nyskapad
  // organizers-rad att bevara vid ett misslyckande här - om inbjudan
  // misslyckas (vanligast: e-postadressen har redan ett konto, oavsett om
  // det är kopplat till samma eller en annan arrangör) skapar vi helt
  // enkelt ingen organizer_members-rad och returnerar ett tydligt fel.
  // Att koppla en BEFINTLIG användare till ytterligare en arrangör är
  // inte i scope för denna order - se ordertextens punkt 6.
  const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: `${frontendBaseUrl}/#/admin/valkommen` },
  )

  if (inviteError || !inviteData?.user) {
    const alreadyRegistered = /already|registrerad|exists/i.test(inviteError?.message ?? '')
    const message = alreadyRegistered
      ? 'Den här e-postadressen har redan ett konto. Kontakta oss om personen ska läggas till här.'
      : `Inbjudan kunde inte skickas (${inviteError?.message ?? 'okänt fel'}).`
    return jsonResponse({ error: message }, alreadyRegistered ? 409 : 502)
  }

  const { error: memberError } = await supabase
    .from('organizer_members')
    .insert({ organizer_id: auth.organizerId, user_id: inviteData.user.id, role: 'admin' })

  if (memberError) {
    return jsonResponse(
      {
        error: `Inbjudan skickades till ${email}, men kopplingen till arrangören misslyckades (${memberError.message}). Kräver manuell uppföljning.`,
      },
      502,
    )
  }

  return jsonResponse({ invited_email: email }, 201)
})
