// Serverns EGEN källa för vilken version av köpvillkoren som gäller per
// arrangör just nu (förberett av ordern "Köpvillkor godkända, gå live"
// 2026-10-12, uppföljning: versionsspår på orders.terms_version).
//
// Varför en egen karta här istället för att läsa src/content/terms/ eller
// ta emot versionen från klienten:
// - En Supabase Edge Function (Deno) kan inte importera från src/ (Vite-
//   appens bygge) - de är separata deploy-mål. Samma begränsning som
//   gjorde att prisformatet fick dupliceras mellan src/lib/formatPrice.ts
//   och public/embed.js.
// - Versionen får ALDRIG komma från klienten: en direkt POST till
//   create-order (utanför köpsidans UI) kan skicka vilket värde som
//   helst. Ordern ska bevisa vad köparen godkände vid en tvist - då
//   måste värdet komma från en källa köparen inte kontrollerar.
//
// MÅSTE hållas i synk för hand: när en ny godkänd textversion publiceras
// i src/content/terms/<slug>.ts (VERSION-konstanten där), uppdatera
// samma arrangörs rad här i SAMMA leverans.
export const TERMS_VERSION_BY_ORGANIZER_SLUG: Record<string, number> = {
  sds: 1,
}

/** Null om arrangören saknar en registrerad villkorsversion här - samma
 * "ignorera helt" semantik som requiresTerms/terms_url redan har i
 * create-order/index.ts. */
export function resolveTermsVersion(organizerSlug: string | null | undefined): number | null {
  if (!organizerSlug) return null
  return TERMS_VERSION_BY_ORGANIZER_SLUG[organizerSlug] ?? null
}
