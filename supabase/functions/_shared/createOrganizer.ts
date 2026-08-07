// Delad organizer-skapande-logik (Tilläggsordern 2026-08-06/07,
// "Ansökningsformulär för nya arrangörer" - se ordertextens punkt 3:
// "kör samma logik som platform-create-organizer redan gör -
// refaktorera till en delad intern funktion om det inte redan är gjort,
// så det inte finns två parallella organizer-skapande-implementationer
// att hålla i synk"). Utbruten oförändrad ur platform-create-organizer,
// som nu bara gör auth-kontrollen + body-parsning och sedan anropar
// createOrganizerAndInvite() nedan. admin-approve-application anropar
// SAMMA funktion när en ansökan godkänns.
//
// Flöde: skapa organizers-raden -> skicka Supabase Auths inbyggda
// inbjudan (auth.admin.inviteUserByEmail) -> koppla den inbjudna
// användaren till arrangören via organizer_members. Se kommentaren vid
// steg 2 nedan för varför organizers-raden INTE rullas tillbaka om
// inbjudan misslyckas - det resonemanget gäller lika mycket när
// anropet kommer från en godkänd ansökan som från platform-create-
// organizer direkt.
import { createAdminClient } from './supabaseAdmin.ts'

export interface CreateOrganizerParams {
  name: string
  contactEmail: string
  slug?: string
}

export interface CreateOrganizerSuccess {
  ok: true
  status: 201
  organizer_id: string
  slug: string
  invited_email: string
}

export interface CreateOrganizerFailure {
  ok: false
  status: 400 | 500 | 502
  error: string
  // Satt bara i 502-fallet: organizers-raden skapades, men inbjudan/
  // organizer_members-kopplingen misslyckades. Anroparen (t.ex.
  // admin-approve-application) behöver veta att en organizer FAKTISKT
  // finns, så en ansökan inte råkar godkännas två gånger och skapa två
  // organizers med samma namn.
  organizer_id?: string
}

export type CreateOrganizerResult = CreateOrganizerSuccess | CreateOrganizerFailure

// Samma slugify-algoritm som admin-create-event (events.slug) och den
// tidigare inline-versionen i platform-create-organizer.
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

export async function createOrganizerAndInvite(
  params: CreateOrganizerParams,
): Promise<CreateOrganizerResult> {
  const name = params.name.trim()
  const contactEmail = params.contactEmail.trim()

  if (!name) return { ok: false, status: 400, error: 'Namn krävs.' }
  if (!contactEmail || !EMAIL_RE.test(contactEmail)) {
    return { ok: false, status: 400, error: 'En giltig kontakt-e-postadress krävs.' }
  }

  const baseSlug = params.slug?.trim() ? slugify(params.slug) : slugify(name)
  if (!baseSlug) {
    return { ok: false, status: 400, error: 'Kunde inte generera en slug från namnet.' }
  }

  const supabase = createAdminClient()

  // Slug måste vara unik bland arrangörer (organizers.slug har en unique-
  // constraint i databasen som sista skyddsnät, men vi vill ge ett
  // begripligt fel istället för ett rått databasfel om den redan är
  // upptagen, och samma retry-med-suffix-mönster som event-slugs).
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
    return { ok: false, status: 500, error: 'FRONTEND_BASE_URL är inte konfigurerad på servern.' }
  }

  // === 1. Skapa organizers-raden ===
  const { data: organizer, error: organizerError } = await supabase
    .from('organizers')
    .insert({ name, slug, contact_email: contactEmail })
    .select('id, name, slug')
    .single()

  if (organizerError || !organizer) {
    return {
      ok: false,
      status: 500,
      error: `Kunde inte skapa arrangören: ${organizerError?.message ?? 'okänt fel'}`,
    }
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
  // felsöka i efterhand. Vanligaste orsaken är att e-postadressen redan
  // har ett Supabase Auth-konto.
  if (inviteError || !inviteData?.user) {
    const alreadyRegistered = /already|registrerad|exists/i.test(inviteError?.message ?? '')
    const message = alreadyRegistered
      ? `Arrangören "${name}" skapades, men ${contactEmail} har redan ett konto och kunde inte bjudas in på nytt. Arrangören saknar nu en kopplad inloggning - kontakta kontot manuellt eller använd en annan e-postadress.`
      : `Arrangören "${name}" skapades, men inbjudan kunde inte skickas (${inviteError?.message ?? 'okänt fel'}). Arrangören saknar nu en kopplad inloggning och kräver manuell uppföljning.`
    return { ok: false, status: 502, error: message, organizer_id: organizer.id }
  }

  // === 3. Koppla den (nyss inbjudna, ännu ej aktiverade) användaren till
  // arrangören. ===
  const { error: memberError } = await supabase
    .from('organizer_members')
    .insert({ organizer_id: organizer.id, user_id: inviteData.user.id, role: 'admin' })

  if (memberError) {
    return {
      ok: false,
      status: 502,
      error: `Arrangören "${name}" skapades och inbjudan skickades till ${contactEmail}, men kopplingen till arrangören misslyckades (${memberError.message}). Kräver manuell uppföljning i organizer_members.`,
      organizer_id: organizer.id,
    }
  }

  return { ok: true, status: 201, organizer_id: organizer.id, slug: organizer.slug, invited_email: contactEmail }
}
