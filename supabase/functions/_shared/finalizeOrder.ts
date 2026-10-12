// Delat TS-omslag för finalize_paid_order (ordern "Webhooken:
// misslyckade händelser måste kunna försökas igen" 2026-10-12, STEG B
// punkt 1) - samma mönster som _shared/cancelOrder.ts. Enda anroparen
// är handleCheckoutCompleted (stripe-webhook).
import type { createAdminClient } from './supabaseAdmin.ts'

export interface FinalizedTicket {
  id: string
  ticket_code: string
  holder_name: string | null
  ticket_type_id: string
}

export interface FinalizeOrderResult {
  /** 'finalized' | 'already_paid' | 'not_found' | 'expired' | 'cancelled'
   * | annat order.status-värde - se migrationen för den fullständiga
   * förklaringen av varje utfall. */
  outcome: string
  eventId: string | null
  /** orders.paid_at - den FAKTISKA betalningstidpunkten (satt av det
   * ursprungliga 'finalized'-anropet), inte tidpunkten för det här
   * anropet. Null för 'not_found'/'expired'/'cancelled' m.fl. Används
   * för kvittodatumet i mejlet, så en omkörning (outcome='already_paid')
   * visar samma datum som kunden redan sett - inte dagens datum. */
  paidAt: string | null
  tickets: FinalizedTicket[]
}

export async function finalizePaidOrder(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
  paymentIntentId: string | null,
  ticketCodes: string[],
): Promise<FinalizeOrderResult> {
  const { data, error } = await supabase
    .rpc('finalize_paid_order', {
      p_order_id: orderId,
      p_payment_intent_id: paymentIntentId,
      p_ticket_codes: ticketCodes,
    })
    .maybeSingle()

  if (error) throw new Error(`Kunde inte slutföra ordern: ${error.message}`)
  if (!data) throw new Error(`finalize_paid_order gav inget resultat för order ${orderId}`)

  const row = data as unknown as {
    outcome: string
    event_id: string | null
    paid_at: string | null
    tickets: FinalizedTicket[] | null
  }
  return {
    outcome: row.outcome,
    eventId: row.event_id,
    paidAt: row.paid_at,
    tickets: row.tickets ?? [],
  }
}

// Ren avgörandelogik (testbar utan databas, se
// scripts/check-webhook-retry.ts) - mappar finalize_paid_orders
// utfallskod till vad Deno.serve-dispatchen ska göra: webhook_events-
// raden markeras 'done' eller 'needs_attention', och HTTP-svaret blir
// alltid 200 i båda fallen (STEG B punkt 3 - en needs_attention-
// händelse ska INTE få Stripe att försöka igen, bara synas för en
// människa via en enkel fråga mot webhook_events).
export type FinalizeHandlerOutcome = 'done' | 'needs_attention' | 'not_found'

export function mapFinalizeOutcome(outcome: string): FinalizeHandlerOutcome {
  if (outcome === 'not_found') return 'not_found'
  if (outcome === 'finalized' || outcome === 'already_paid') return 'done'
  return 'needs_attention' // 'expired', 'cancelled', eller nåt annat oväntat
}
