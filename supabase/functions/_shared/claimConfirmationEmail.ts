// Delat TS-omslag för claim_confirmation_email (ordern "Webhooken är
// för långsam" 2026-10-13, ny plan, punkt 2 - "claim före utskick").
// Anropas av _shared/attemptConfirmationEmail.ts, som i sin tur
// används av stripe-webhooks bakgrundsuppgift, retry-confirmation-
// emails och admin-resend-tickets (punkt 3 - samma claim överallt).
import type { createAdminClient } from './supabaseAdmin.ts'

/** true = anroparen vann claimen och SKA skicka mejlet nu.
 * false = mejlet är redan skickat (om force=false), eller en annan
 * claim pågår - gör ingenting.
 *
 * force=true (admin-resend-tickets) kringgår "redan skickat"-
 * villkoret - en medveten, manuell ombegäran ska kunna skicka om även
 * ett redan levererat mejl. Den tidsbaserade claimed_at-spärren gäller
 * ändå, så två samtidiga försök för SAMMA order kan inte skicka
 * parallellt. Se migrationens kommentar för hela resonemanget. */
export async function claimConfirmationEmail(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
  force = false,
): Promise<boolean> {
  const { data, error } = await supabase
    .rpc('claim_confirmation_email', { p_order_id: orderId, p_force: force })
    .single()
  if (error) throw new Error(`Kunde inte reservera mejlutskick för order ${orderId}: ${error.message}`)
  return Boolean(data)
}
