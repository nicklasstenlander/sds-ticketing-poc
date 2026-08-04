// Stateless, kort-levande admin-sessionstoken.
//
// PIN-koden (ADMIN_PIN, en Supabase secret) jämförs ENDAST server-side i
// admin-auth-funktionen - den skickas aldrig till eller jämförs i
// klient-JS. När PIN:en stämmer utfärdar vi en signerad token
// ("<payload-base64url>.<hmac-base64url>") som admin-frontenden sparar i
// sessionStorage och skickar med som Authorization-header i efterföljande
// anrop till admin-create-event/admin-events/admin-event-tickets. Dessa
// funktioner verifierar signaturen (HMAC-SHA256 med ADMIN_PIN som nyckel)
// och att token inte gått ut - PIN-koden lämnar alltså aldrig servern.
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000 // 12 timmar

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (padded.length % 4)) % 4)
  const binary = atob(padded + padding)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hmacSign(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return new Uint8Array(signature)
}

export async function issueAdminToken(adminPin: string): Promise<{ token: string; expiresAt: string }> {
  const expiresAt = Date.now() + TOKEN_TTL_MS
  const payload = JSON.stringify({ exp: expiresAt })
  const payloadB64 = toBase64Url(new TextEncoder().encode(payload))
  const signature = await hmacSign(adminPin, payloadB64)
  const token = `${payloadB64}.${toBase64Url(signature)}`
  return { token, expiresAt: new Date(expiresAt).toISOString() }
}

export async function verifyAdminToken(adminPin: string, token: string | null): Promise<boolean> {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payloadB64, signatureB64] = parts
  try {
    const expectedSignature = await hmacSign(adminPin, payloadB64)
    const providedSignature = fromBase64Url(signatureB64)
    if (expectedSignature.length !== providedSignature.length) return false
    let diff = 0
    for (let i = 0; i < expectedSignature.length; i++) {
      diff |= expectedSignature[i] ^ providedSignature[i]
    }
    if (diff !== 0) return false

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as { exp: number }
    return typeof payload.exp === 'number' && Date.now() < payload.exp
  } catch {
    return false
  }
}

/** Läser ut bearer-token från Authorization-headern, om någon finns. */
export function bearerTokenFrom(req: Request): string | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

/**
 * Jämför två strängar i konstant tid (oberoende av var första avvikande
 * tecken finns) för att undvika timing-attacker mot PIN-koden och
 * SCANNER_BEARER_TOKEN. Ett vanligt `===` avbryter jämförelsen vid första
 * avvikande tecken, vilket i teorin läcker information via svarstiden -
 * irrelevant för en PoC men billigt att göra rätt.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  // Jämför alltid lika många bytes som den längre strängen, så att även
  // längdskillnaden inte avslöjas via tidig retur.
  const length = Math.max(aBytes.length, bBytes.length)
  let diff = aBytes.length ^ bBytes.length
  for (let i = 0; i < length; i++) {
    const x = i < aBytes.length ? aBytes[i] : 0
    const y = i < bBytes.length ? bBytes[i] : 0
    diff |= x ^ y
  }
  return diff === 0
}
