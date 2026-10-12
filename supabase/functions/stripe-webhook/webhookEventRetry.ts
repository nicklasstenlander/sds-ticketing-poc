// Ren avgörandelogik för webhook_events-statusmaskinen (ordern
// "Webhooken: misslyckade händelser måste kunna försökas igen"
// 2026-10-12, STEG B punkt 1-3). Testbar utan databas - se
// scripts/check-webhook-retry.ts.
export type WebhookEventStatus = 'received' | 'done' | 'failed' | 'needs_attention'

// "Hur gammal får en 'received'-rad vara innan vi antar att
// bearbetningen som skapade den kraschade, istället för att bara
// fortfarande pågå?" Satt till 2 minuter - gott och väl längre än en
// enskild webhook-bearbetning normalt tar (databasfrågor + ev.
// Resend-anrop + PDF-bygge, typiskt under några sekunder), men kort
// nog att en genuint kraschad körning inte blockerar en legitim
// Stripe-retry i onödan länge.
export const STILL_RUNNING_THRESHOLD_MS = 2 * 60 * 1000

export type RetryDecision = 'already_done' | 'still_running' | 'retry'

/** Avgör vad en NY leverans av ett event-id ska göra när webhook_events
 * redan har en rad för det (INSERT-konflikt, kod 23505).
 *
 * - 'already_done': raden är 'done' eller 'needs_attention' - terminal,
 *   svara 200 utan att röra handlern.
 * - 'still_running': raden är 'received' och yngre än tröskeln - en
 *   annan körning (troligen) pågår fortfarande just nu. Svara så att
 *   Stripe försöker igen lite senare, istället för att bearbeta
 *   samma händelse samtidigt i två körningar.
 * - 'retry': raden är 'failed', eller 'received' men äldre än
 *   tröskeln (en kraschad körning som aldrig hann skriva en
 *   slutstatus). Ge den en ny chans. */
export function decideRetryAction(
  status: WebhookEventStatus,
  ageMs: number,
  stillRunningThresholdMs: number = STILL_RUNNING_THRESHOLD_MS,
): RetryDecision {
  if (status === 'done' || status === 'needs_attention') return 'already_done'
  if (status === 'received' && ageMs < stillRunningThresholdMs) return 'still_running'
  return 'retry'
}
