// public-apply-organizer
//
// Tilläggsordern 2026-08-06/07, "Ansökningsformulär för nya arrangörer
// (Squarespace -> godkännande -> portal)". Publik, ingen auth - avsedd
// att anropas direkt från en Squarespace Code Block (samma mönster som
// create-order/public-events), där en hemlig token inte kan gömmas.
//
// Ytan är medvetet smal: funktionen kan bara skapa en rad i en
// ansökningskö (organizer_applications, status='pending') - ALDRIG ett
// konto, ALDRIG en Auth-inbjudan, ALDRIG ett mail till den sökande. Det
// gör missbruksrisken mycket lägre än ett tidigare (ersatt) utkast som
// öppnade upp kontoskapande direkt - se migrationsfilens kommentar och
// ordertextens punkt 0.
//
// Flöde: honeypot -> hastighetsbegränsning per IP -> fältvalidering ->
// skapa ansökningsrad -> notismail till platform-admins (best effort,
// misslyckas mailet blockeras ändå inte svaret till den sökande) ->
// {success:true}.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

interface ApplyBody {
  organizer_name?: string
  email?: string
  message?: string
  website?: string // honeypot - dolt fält i Squarespace-formuläret, ska alltid vara tomt för en riktig människa
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FORM_NAME = 'organizer_application'
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 timme
const RATE_LIMIT_MAX_ATTEMPTS = 3 // en 4:e ansökan från samma IP inom fönstret nekas

function getClientIp(req: Request): string {
  // Supabase Edge Functions körs bakom en proxy - x-forwarded-for
  // innehåller kedjan av mellanled, klientens egen IP är den FÖRSTA.
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0].trim()
  return req.headers.get('cf-connecting-ip') ?? 'okänd'
}

async function sendAdminNotification(params: { organizerName: string; email: string; message: string }) {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const resendFrom = Deno.env.get('RESEND_FROM') ?? 'biljett@resend.dev'
  const frontendBaseUrl = (Deno.env.get('FRONTEND_BASE_URL') ?? '').replace(/\/+$/, '')

  if (!resendApiKey) {
    console.warn('RESEND_API_KEY saknas - hoppar över notismail till platform-admins.')
    return
  }

  const supabase = createAdminClient()
  const { data: platformAdmins, error } = await supabase.from('platform_admins').select('user_id')
  if (error || !platformAdmins || platformAdmins.length === 0) {
    console.warn('Kunde inte hämta platform-admins för notismail:', error?.message)
    return
  }

  const adminEmails: string[] = []
  for (const admin of platformAdmins) {
    const { data: userResult } = await supabase.auth.admin.getUserById(admin.user_id)
    if (userResult?.user?.email) adminEmails.push(userResult.user.email)
  }
  if (adminEmails.length === 0) return

  const applicationsUrl = frontendBaseUrl ? `${frontendBaseUrl}/#/admin/organizers` : null

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h1 style="font-size:20px;">Ny arrangörsansökan: ${params.organizerName}</h1>
      <p><strong>E-post:</strong> ${params.email}</p>
      ${params.message ? `<p><strong>Meddelande:</strong> ${params.message}</p>` : ''}
      ${applicationsUrl ? `<p><a href="${applicationsUrl}">Öppna ansökningslistan i admin →</a></p>` : ''}
    </div>
  `

  const emailResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFrom,
      to: adminEmails,
      subject: `Ny arrangörsansökan: ${params.organizerName}`,
      html,
    }),
  })

  if (!emailResponse.ok) {
    const errText = await emailResponse.text()
    console.error('Resend-fel (notismail till platform-admins):', errText)
  }
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  let body: ApplyBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  // === 1. Honeypot ===
  // Ifyllt av bottar som fyller i ALLA synliga fält blint - avvisa tyst
  // med success:true (aldrig avslöja för en bot att den blockerades),
  // ingen rad skapas, inget räknas mot hastighetsbegränsningen.
  if ((body.website ?? '').trim() !== '') {
    return jsonResponse({ success: true })
  }

  const supabase = createAdminClient()
  const clientIp = getClientIp(req)

  // === 2. Hastighetsbegränsning per IP ===
  // Loggar det här anropet FÖRST, räknar sedan alla anrop (inklusive det
  // här) inom fönstret - det gör att en 4:e, 5:e, 6:e osv ansökan i rad
  // förblir nekad, inte bara exakt den 4:e.
  await supabase.from('form_submission_attempts').insert({ form: FORM_NAME, ip_address: clientIp })

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const { count: attemptCount } = await supabase
    .from('form_submission_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('form', FORM_NAME)
    .eq('ip_address', clientIp)
    .gte('created_at', windowStart)

  if ((attemptCount ?? 0) > RATE_LIMIT_MAX_ATTEMPTS) {
    return jsonResponse({ error: 'För många ansökningar från samma nätverk. Försök igen senare.' }, 429)
  }

  // === 3. Fältvalidering ===
  const organizerName = (body.organizer_name ?? '').trim()
  const email = (body.email ?? '').trim()
  const message = (body.message ?? '').trim()

  if (!organizerName) return jsonResponse({ error: 'Arrangörsnamn krävs.' }, 400)
  if (!email || !EMAIL_RE.test(email)) {
    return jsonResponse({ error: 'En giltig e-postadress krävs.' }, 400)
  }

  // === 4. Skapa ansökningsraden ===
  const { error: insertError } = await supabase.from('organizer_applications').insert({
    organizer_name: organizerName,
    contact_email: email,
    message: message || null,
    status: 'pending',
  })

  if (insertError) {
    return jsonResponse({ error: `Kunde inte spara ansökan: ${insertError.message}` }, 500)
  }

  // === 5. Notismail till platform-admins (best effort) ===
  // Ett misslyckat Resend-anrop ska inte förvandla en i övrigt lyckad
  // ansökan till ett felsvar för den sökande - samma princip som
  // biljettmailen i stripe-webhook.
  try {
    await sendAdminNotification({ organizerName, email, message })
  } catch (err) {
    console.error('Kunde inte skicka notismail till platform-admins:', err)
  }

  // === 6. Inget mail till den sökande här - se admin-approve-application
  // för när/hur de faktiskt får återkoppling. ===
  return jsonResponse({ success: true })
})
