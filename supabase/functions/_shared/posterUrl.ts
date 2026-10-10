// Betrodd affisch-URL, server-sidan (ordern "Förberedelse för CORE-
// appen" 2026-10-10). Samma regel som embed.js redan tillämpar
// klientsidan (isTrustedPosterUrl, ordern 2.1: "affischer visas bara om
// URL:en börjar med projektets Storage-adress") - CORE-appen laddar
// bilderna direkt själv utan att gå via embed.js, så kontrollen måste
// också finnas här, på servern, inte bara i widgetens egen klientkod.
const TRUSTED_POSTER_PREFIX = 'https://oyqgxnmwojjjpoubdlfa.supabase.co/storage/v1/object/public/'

export function trustedPosterUrl(url: string | null): string | null {
  if (!url || !url.startsWith(TRUSTED_POSTER_PREFIX)) return null
  return url
}
