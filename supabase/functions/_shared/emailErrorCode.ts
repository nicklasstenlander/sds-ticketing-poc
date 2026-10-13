// Ren avgörandelogik (ordern "Webhooken är för långsam" 2026-10-13, ny
// plan punkt 2) - mappar ett fel från ett mejlutskicksförsök till en
// kort, PII-fri felkod för orders.confirmation_email_last_error.
// ALDRIG rå feltext: Resends svarstext kan eka tillbaka köparens
// e-postadress vid en valideringsfel (samma lärdom som
// _shared/sendConfirmationEmail.ts redan tillämpar på webhook_events.
// last_error).
//
// Flyttad till _shared (granskning 2026-10-13, punkt 2/3) - används av
// _shared/attemptConfirmationEmail.ts, som delas av stripe-webhooks
// bakgrundsuppgift, retry-confirmation-emails och admin-resend-tickets.
export function shortEmailErrorCode(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout'
    const resendMatch = err.message.match(/^Resend svarade (\d+)/)
    if (resendMatch) return `resend_http_${resendMatch[1]}`
    return 'send_failed'
  }
  return 'unknown_error'
}
