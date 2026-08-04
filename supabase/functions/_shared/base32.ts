// Crockford base32-alfabet - inga tvetydiga tecken (0/O, 1/I/L, U saknas
// helt för att undvika sammanblandning med V).
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Base32-kodar (Crockford-varianten) en godtycklig byte-array. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]
    bits += 8
    while (bits >= 5) {
      output += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f]
  }
  return output
}

/**
 * Genererar en biljettkod med 128 bitars slumpmässighet (16 bytes från
 * crypto.getRandomValues), Crockford base32-kodad. Koden är alltså aldrig
 * sekventiell och går inte att härleda från order-id:t - varje anrop hämtar
 * ny kryptografiskt säker slumpdata direkt från Deno/webbläsarens CSPRNG.
 * Resultat: 26 tecken, t.ex. "8QK2R7ZXNPB4W0VE1TS93CMHYA".
 */
export function generateTicketCode(): string {
  const randomBytes = new Uint8Array(16) // 16 * 8 = 128 bitar
  crypto.getRandomValues(randomBytes)
  return base32Encode(randomBytes)
}
