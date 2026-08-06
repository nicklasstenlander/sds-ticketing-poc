// platform-create-organizer
//
// Tilläggsordern 2026-08-06 ("Självbetjänad onboarding av nya
// arrangörer"). Platform-admin-skyddad (samma direkta kontroll som
// admin-list-organizers - inte resolveOrganizer(), eftersom det inte
// finns något valt workspace att agera i här, tvärtom är hela poängen att
// SKAPA ett nytt sådant).
//
// Flöde: skapa organizers-raden -> skicka Supabase Auths inbyggda
// inbjudan (auth.admin.inviteUserByEmail) -> koppla den inbjudna
// användaren till arrangören via organizer_members. Se kommentaren vid
// steg 4 nedan för varför organizers-raden INTE rullas tillbaka om
// inbjudan misslyckas.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

interface CreateOrganizerBody {
  name?: string
  slug?: string
  contact_email?: string
}

// Samma slugify-algoritm som admin-create-event (events.slug) - inte för
// att slugsen delar namnrymd (organizers.slug och events.slug är separata
// unika kolumner i olika tabeller), utan för att svenska bokstäver och
// specialtecken ska hanteras konsekvent överallt i produkten.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/é/g, 'e')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
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

  let body: CreateOrganizerBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const name = (body.name ?? '').trim()
  const contactEmail = (body.contact_email ?? '').trim()

  if (!name) return jsonResponse({ error: 'Namn krävs.' }, 400)
  if (!contactEmail || !EMAIL_RE.test(contactEmail)) {
    return jsonResponse({ error: 'En giltig kontakt-e-postadress krävs.' }, 400)
  }

  const baseSlug = body.slug?.trim() ? slugify(body.slug) : slugify(name)
  if (!baseSlug) return jsonResponse({ error: 'Kunde inte generera en slug från namnet.' }, 400)

  // Slug måste vara unik bland arrangörer (organizers.slug har en unique-
  // constraint i databasen som sista skyddsnät, men vi vill ge ett
  // begripligt 400-fel istället för ett rått databasfel om den redan är
  // upptagen, och samma retry-med-suffix-mönster som event-slugs
  // (admin-create-event) ifall den automatgenererade varianten krockar).
  let slug = baseSlug
  for (let attempt = 2; attempt <= 20; attempt++) {
    const { data: existing } = await supabase
      .from('organizers')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (!existing) break
    slug = `${baseSlug}-${attempt}`
  }

  const frontendBaseUrl = (Deno.env.get('FRONTEND_BASE_URL') ?? '').replace(/\/+$/, '')
  if (!frontendBaseUrl) {
    return jsonResponse({ error: 'FRONTEND_BASE_URL är inte konfigurerad på servern.' }, 500)
  }

  // === 1. Skapa organizers-raden ===
  const { data: organizer, error: organizerError } = await supabase
    .from('organizers')
    .insert({ name, slug, contact_email: contactEmail })
    .select('id, name, slug')
    .single()

  if (organizerError || !organizer) {
    return jsonResponse(
      { error: `Kunde inte skapa arrangören: ${organizerError?.message ?? 'okänt fel'}` },
      500,
    )
  }

  // === 2. Skicka Supabase Auths inbyggda inbjudan ===
  const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
    contactEmail,
    { redirectTo: `${frontendBaseUrl}/#/admin/valkommen` },
  )

  // === Om inbjudan misslyckas: rulla INTE tillbaka organizers-raden. ===
  // En arrangör utan kopplad inloggning är ett känt, hanterbart tillstånd
  // (syns i arrangörslistan med status "inbjuden", ingen som kan logga in
  // ännu) - en tyst bortslängd arrangörsrad hade varit svårare att
  // felsöka i efterhand (t.ex. om ett annat fel än "redan registrerad"
  // orsakade det, eller om organizern redan hunnit refereras någon
  // annanstans). Vanligaste orsaken är att e-postadressen redan har ett
  // Supabase Auth-konto (från en annan arrangör, eller ett gammalt
  // testkonto) - Supabase svarar då typiskt med ett fel vars meddelande
  // nämner att användaren redan är registrerad.
  if (inviteError || !inviteData?.user) {
    const alreadyRegistered = /already|registrerad|exists/i.test(inviteError?.message ?? '')
    const message = alreadyRegistered
      ? `Arrangören "${name}" skapades, men ${contactEmail} har redan ett konto och kunde inte bjudas in på nytt. Arrangören saknar nu en kopplad inloggning - kontakta kontot manuellt eller använd en annan e-postadress.`
      : `Arrangören "${name}" skapades, men inbjudan kunde inte skickas (${inviteError?.message ?? 'okänt fel'}). Arrangören saknar nu en kopplad inloggning och kräver manuell uppföljning.`
    return jsonResponse({ error: message, organizer_id: organizer.id }, 502)
  }

  // === 3. Koppla den (nyss inbjudna, ännu ej aktiverade) användaren till
  // arrangören. inviteData.user.id finns redan tillgänglig här trots att
  // kontot inte är aktiverat (lösenord inte satt) än - annars skulle det
  // finnas ett fönster där kontot existerar men inte hör till någon
  // arrangör. ===
  const { error: memberError } = await supabase
    .from('organizer_members')
    .insert({ organizer_id: organizer.id, user_id: inviteData.user.id, role: 'admin' })

  if (memberError) {
    return jsonResponse(
      {
        error: `Arrangören "${name}" skapades och inbjudan skickades till ${contactEmail}, men kopplingen till arrangören misslyckades (${memberError.message}). Kräver manuell uppföljning i organizer_members.`,
        organizer_id: organizer.id,
      },
      502,
    )
  }

  return jsonResponse(
    { organizer_id: organizer.id, slug: organizer.slug, invited_email: contactEmail },
    201,
  )
})
