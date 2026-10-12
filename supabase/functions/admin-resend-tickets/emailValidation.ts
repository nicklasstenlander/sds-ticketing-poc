// Ren valideringsfunktion för admin-resend-tickets "to"-fältet (ordern
// "Avbokning, återbetalning, omsändning och köparmeddelanden" 2026-10-
// 12, STEG 2.1) - egen fil, skild från index.ts, av samma skäl som
// scan-ticket/determineScanOutcome.ts: testbar utan Deno.serve-
// sidoeffekten, se scripts/check-cancel-order.ts.
//
// Avsiktligt strikt: EN enda adress, inget kommaseparerat eller
// listliknande - fel här ska hellre avvisas tydligt än att tyst skicka
// till fel eller flera mottagare.
const SINGLE_EMAIL_PATTERN = /^[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+$/

export function isSingleValidEmail(value: string): boolean {
  return SINGLE_EMAIL_PATTERN.test(value)
}
