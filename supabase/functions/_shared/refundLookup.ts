// Hjälpfunktioner för charge.refunded-hanteringen i stripe-webhook
// (ordern "Avbokning, återbetalning, omsändning och köparmeddelanden"
// 2026-10-12, STEG 3). De tre rena funktionerna nedan har inget
// DB-/Stripe-beroende och testas direkt i scripts/check-charge-refunded.ts.
// findOrderIdForRefund gör själva I/O:n och återanvänds bara av
// stripe-webhook/index.ts.

import type Stripe from 'npm:stripe@17'
import type { createAdminClient } from './supabaseAdmin.ts'

// STEG 3 punkt 3: en charge är "fullt återbetald" när hela det
// ursprungliga beloppet är återbetalt. >= istället för === som skydd
// mot ett eventuellt (i praktiken orealistiskt) överåterbetalt belopp.
export function isFullRefund(charge: { amount: number; amount_refunded: number }): boolean {
  return charge.amount_refunded >= charge.amount
}

// STEG 3 punkt 2: SDS är 'direct' (plattformsdestinationen, inget
// event.account) men Testscenen/Accepteas är 'connect' (event.account
// satt). Samma mönster som create-order redan använder för
// stripe.checkout.sessions.create.
export function connectedAccountOption(connectedAccountId: string | null): { stripeAccount: string } | undefined {
  return connectedAccountId ? { stripeAccount: connectedAccountId } : undefined
}

// Samma fält, i samma ordning, som handleCheckoutCompleted/
// handleCheckoutExpired redan litar på för att hitta tillbaka till vår
// egen order från en Stripe Checkout Session.
export function extractOrderIdFromSession(session: {
  client_reference_id?: string | null
  metadata?: Record<string, string> | null
}): string | null {
  return session.client_reference_id ?? session.metadata?.order_id ?? null
}

// Slår upp vilken order en återbetald charge hör till.
//
// Primärt: orders.stripe_payment_intent_id (satt av handleCheckoutCompleted
// sedan STEG 3). Reserv: äldre ordrar som betalades innan kolumnen fanns
// saknar den för alltid (ingen backfill) - då slås Checkout-sessionen upp
// via Stripe istället, scopead till connectedAccountId när det är satt.
//
// Rättat (ordern "Webhooken: misslyckade händelser måste kunna försökas
// igen" 2026-10-12, STEG B punkt 4): ett RIKTIGT fel i något av de två
// uppslagsstegen (databasfel, Stripe-API nere) kastas nu vidare istället
// för att tystas och tolkas som "ordern finns inte" - bara "inget av
// stegen hittade något" ger null (en legitim "inget att göra"-utgång).
export async function findOrderIdForRefund(
  supabase: ReturnType<typeof createAdminClient>,
  stripe: Stripe,
  paymentIntentId: string,
  connectedAccountId: string | null,
): Promise<string | null> {
  const { data: byColumn, error } = await supabase
    .from('orders')
    .select('id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()

  if (error) {
    throw new Error(`Kunde inte slå upp order via stripe_payment_intent_id: ${error.message}`)
  }
  if (byColumn) return byColumn.id

  const sessions = await stripe.checkout.sessions.list(
    { payment_intent: paymentIntentId, limit: 1 },
    connectedAccountOption(connectedAccountId),
  )
  const session = sessions.data[0]
  if (!session) return null
  return extractOrderIdFromSession(session)
}
