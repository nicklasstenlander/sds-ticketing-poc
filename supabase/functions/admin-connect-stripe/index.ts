// admin-connect-stripe
//
// Tilläggsordern 2026-08-06 ("Stripe Connect - eget underkonto per
// arrangör"). Arrangörs-admin-skyddad precis som övriga admin-* -
// organizer_id härleds via resolveOrganizer(req), aldrig från klientdata.
//
// GET - status: returnerar { stripe_account_id, stripe_onboarding_complete }
// för anroparens egen arrangör, så Stripe-inställningssidan kan visa rätt
// läge ("Anslut Stripe-konto" vs "Anslutet ✓") utan att behöva ett separat
// admin-list-members-anrop bara för det.
//
// POST - starta/fortsätt onboarding (se ordertextens avsnitt 2):
//   1. Om arrangören redan har ett stripe_account_id: hoppa direkt till
//      steg 3 - en arrangör som inte slutfört KYC-flödet i ett svep ska
//      kunna komma tillbaka och fortsätta utan att ett nytt, separat
//      Connect-konto skapas varje gång.
//   2. Annars: skapa ett Standard-Connect-konto (se _shared/stripe.ts och
//      ordertextens avsnitt 0 för varför Standard och inte Express/
//      Custom), spara account.id på organizers.stripe_account_id.
//   3. Skapa en Account Link (Stripes hostade onboarding-flöde) och
//      returnera länken - frontend gör en fullständig sidomdirigering dit,
//      precis som Checkout-flödet redan gör i create-order.
//
// stripe_onboarding_complete sätts INTE här - det görs av stripe-webhook
// när Stripe bekräftar via account.updated att kontot faktiskt kan ta
// emot betalningar (charges_enabled && details_submitted). Att ett
// Connect-konto skapats betyder inte att det är klart att användas.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createStripeClient } from '../_shared/stripe.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const auth = await resolveOrganizer(req)
  if (!auth) {
    return jsonResponse({ error: 'Ej behörig.' }, 401)
  }

  const supabase = createAdminClient()

  const { data: organizer, error: organizerError } = await supabase
    .from('organizers')
    .select('id, contact_email, stripe_account_id, stripe_onboarding_complete')
    .eq('id', auth.organizerId)
    .single()

  if (organizerError || !organizer) {
    return jsonResponse({ error: 'Arrangören hittades inte.' }, 404)
  }

  if (req.method === 'GET') {
    return jsonResponse({
      stripe_account_id: organizer.stripe_account_id,
      stripe_onboarding_complete: organizer.stripe_onboarding_complete,
    })
  }

  const frontendBaseUrl = (Deno.env.get('FRONTEND_BASE_URL') ?? '').replace(/\/+$/, '')
  if (!frontendBaseUrl) {
    return jsonResponse({ error: 'FRONTEND_BASE_URL är inte konfigurerad på servern.' }, 500)
  }

  const stripe = createStripeClient()

  let stripeAccountId = organizer.stripe_account_id

  if (!stripeAccountId) {
    let account
    try {
      account = await stripe.accounts.create({
        type: 'standard',
        country: 'SE',
        email: organizer.contact_email ?? undefined,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Okänt Stripe-fel.'
      return jsonResponse({ error: `Kunde inte skapa Stripe-konto: ${message}` }, 502)
    }

    stripeAccountId = account.id

    const { error: saveError } = await supabase
      .from('organizers')
      .update({ stripe_account_id: stripeAccountId })
      .eq('id', auth.organizerId)

    if (saveError) {
      return jsonResponse(
        {
          error: `Stripe-kontot skapades (${stripeAccountId}) men kunde inte sparas: ${saveError.message}. Kräver manuell uppföljning.`,
        },
        502,
      )
    }
  }

  let link
  try {
    link = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${frontendBaseUrl}/#/admin/stripe-installning`,
      return_url: `${frontendBaseUrl}/#/admin/stripe-installning?klar=1`,
      type: 'account_onboarding',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Okänt Stripe-fel.'
    return jsonResponse({ error: `Kunde inte skapa onboarding-länk: ${message}` }, 502)
  }

  return jsonResponse({ url: link.url })
})
