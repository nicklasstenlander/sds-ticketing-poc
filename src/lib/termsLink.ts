// Footerns "Köpvillkor"-länk (ordern "Köpvillkor som egen sida i Rideau"
// 2026-10-07, uppföljning 2026-10-08) ska bara visas när villkorstexten
// för given slug faktiskt är klar (DRAFT=false) - annars riskerar en
// ogranskad utkasttext att nås via en länk i sidfoten på VARJE publik
// sida (köpsida, bekräftelsesida), inte bara via direktnavigering till
// /villkor/:slug.
//
// Egen fil, ren funktion utan React/JSX (importeras både från
// Layout.tsx OCH från scripts/check-terms-link.ts - samma mönster som
// determineScanOutcome.ts: logiken ska gå att testa utan att rendera
// någon komponent). Registret skickas in som parameter istället för att
// importeras direkt härifrån, så testet kan skicka in egna, kontrollerade
// fixtur-register utan att bero på det faktiska DRAFT-läget i
// src/content/terms/sds.ts just nu (som kommer ändras till false den dag
// Nicklas granskat texten).
export interface TermsLinkContent {
  DRAFT: boolean
}

export function shouldShowTermsLink(
  termsSlug: string | undefined,
  registry: Record<string, TermsLinkContent>,
): boolean {
  if (!termsSlug) return false
  const content = registry[termsSlug]
  if (!content) return false
  return !content.DRAFT
}
