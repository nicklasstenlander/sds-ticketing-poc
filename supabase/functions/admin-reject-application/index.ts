// admin-reject-application
//
// Tilläggsordern 2026-08-06/07, "Ansökningsformulär för nya arrangörer".
// Platform-admin-skyddad. Sätter status='rejected' - ingen organizer/
// konto skapas.
//
// Uppdaterad i Tilläggsordern 2026-08-07 ("Radera arrangör i UI +
// avslagsmail till nekade ansökningar", punkt 2): skickar nu ett kort,
// vänligt avslagsmail till den sökande - ALDRIG en motivering till
// varför (se ordertexten: "ni vill inte behöva försvara ett beslut i en
// automatiserad text"). reply-to sätts till SUPPORT_REPLY_TO_EMAIL så
// ett svar faktiskt når en riktig inkorg, inte studsar mot
// Resend-avsändaradressen.
//
// Mailet skickas EFTER att status='rejected' redan sparats, och ett
// misslyckat Resend-anrop hindrar aldrig statusuppdateringen från att
// gälla - exakt samma princip som notismailet i public-apply-organizer
// och biljettmailen i stripe-webhook (ett Resend-fel är alltid
// best-effort, aldrig en anledning att rulla tillbaka eller svara med
// fel till anroparen).
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { requirePlatformAdmin } from '../_shared/platformAdmin.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

interface RejectBody {
  application_id?: string
}

async function sendRejectionEmail(contactEmail: string) {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const resendFrom = Deno.env.get('RESEND_FROM') ?? 'biljett@resend.dev'
  // Faller tillbaka till avsändaradressen om ingen dedikerad supportadress
  // är satt som secret - bättre än att helt sakna reply-to, men
  // SUPPORT_REPLY_TO_EMAIL bör sättas till en riktig, bevakad inkorg.
  const replyTo = Deno.env.get('SUPPORT_REPLY_TO_EMAIL') ?? resendFrom

  if (!resendApiKey) {
    console.warn('RESEND_API_KEY saknas - hoppar över avslagsmail.')
    return
  }

  const html = `
    <p>Hej,</p>
    <p>Tack för din ansökan om att bli arrangör på Rideau. Vi kan tyvärr
    inte gå vidare med den just nu.</p>
    <p>Om du vill diskutera det här eller försöka igen, svara gärna på
    det här mailet så återkommer vi.</p>
    <p>Vänliga hälsningar,<br>Rideau</p>
  `

  const emailResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFrom,
      to: contactEmail,
      reply_to: replyTo,
      subject: 'Din ansökan till Rideau',
      html,
    }),
  })

  if (!emailResponse.ok) {
    const errText = await emailResponse.text()
    console.error('Resend-fel (avslagsmail):', errText)
  }
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
    .select('id, status, contact_email')
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

  // Best effort, efter att statusen redan är sparad - se filkommentaren
  // högst upp för varför.
  try {
    await sendRejectionEmail(application.contact_email)
  } catch (err) {
    console.error('Kunde inte skicka avslagsmail:', err)
  }

  return jsonResponse({ success: true })
})
