// Delad Stripe-klient för alla edge functions i detta proof-of-concept.
//
// Vi använder det officiella npm-paketet "stripe" via Denos npm:-specifier-
// stöd (samma mönster som QR-genereringen i create-order använder för
// "qrcode") - inget hemmabygge av HTTP-anrop mot Stripes API.
//
// VIKTIGT - endast Test mode: STRIPE_SECRET_KEY ska vara en sk_test_-nyckel
// under hela denna PoC. Byt aldrig till en sk_live_-nyckel utan en
// uttrycklig, separat instruktion - se README.md.
import Stripe from 'npm:stripe@17'

let cachedClient: Stripe | null = null

export function createStripeClient(): Stripe {
  if (cachedClient) return cachedClient
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY saknas i miljön för edge function.')
  }
  if (!secretKey.startsWith('sk_test_')) {
    // Hård spärr: denna PoC ska ALDRIG kunna ta betalt på riktigt. Om någon
    // av misstag konfigurerar en live-nyckel vägrar vi starta hellre än att
    // riskera en oavsiktlig produktionsladdning.
    throw new Error(
      'STRIPE_SECRET_KEY måste vara en Test mode-nyckel (sk_test_...) i denna PoC.',
    )
  }
  cachedClient = new Stripe(secretKey, {
    apiVersion: '2024-06-20',
  })
  return cachedClient
}

// Hur länge en Stripe Checkout-session (och därmed motsvarande order i
// status "pending") är giltig innan den räknas som utgången. Stripes eget
// minimivärde för anpassad expires_at är 30 minuter (annars faller det
// tillbaka på Stripes default, 24 timmar) - vi vill hellre frigöra
// reserverad kapacitet snabbt om köparen aldrig fullföljer betalningen.
export const CHECKOUT_EXPIRY_MINUTES = 30
