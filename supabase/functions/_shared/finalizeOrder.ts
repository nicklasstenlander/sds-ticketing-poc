// Delat TS-omslag för finalize_paid_order (ordern "Webhooken:
// misslyckade händelser måste kunna försökas igen" 2026-10-12, STEG B
// punkt 1; utvidgad av ordern "Webhooken är för långsam" 2026-10-13)
// - samma mönster som _shared/cancelOrder.ts. Enda anroparen är
// handleCheckoutCompleted (stripe-webhook).
import type { createAdminClient } from './supabaseAdmin.ts'

export interface FinalizedTicket {
  id: string
  ticket_code: string
  holder_name: string | null
  ticket_type_id: string
}

export interface FinalizedOrderInfo {
  buyerName: string
  buyerEmail: string
  totalOre: number | null
  confirmationEmailSentAt: string | null
}

export interface FinalizedOrderItem {
  ticketTypeId: string
  qty: number
  unitPriceOre: number
  vatRate: number
  typeName: string | null
}

export interface FinalizedEventInfo {
  title: string
  venue: string | null
  startsAt: string
}

export interface FinalizedOrganizerInfo {
  legalName: string | null
  orgNumber: string | null
  termsUrl: string | null
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
  /** Allt mejlet behöver, hämtat i SAMMA transaktion/anrop som
   * slutförandet (ordern "Webhooken är för långsam" 2026-10-13, punkt
   * 1) - sparar fyra separata DB-anrop. Null/tom bara för utfall som
   * aldrig skickar mejl ('not_found'/'expired'/'cancelled'/...). */
  orderInfo: FinalizedOrderInfo | null
  orderItems: FinalizedOrderItem[]
  eventInfo: FinalizedEventInfo | null
  organizerInfo: FinalizedOrganizerInfo | null
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
    order_info: { buyer_name: string; buyer_email: string; total_ore: number | null; confirmation_email_sent_at: string | null } | null
    order_items:
      | { ticket_type_id: string; qty: number; unit_price_ore: number; vat_rate: number; type_name: string | null }[]
      | null
    event_info: { title: string; venue: string | null; starts_at: string } | null
    organizer_info: { legal_name: string | null; org_number: string | null; terms_url: string | null } | null
  }

  return {
    outcome: row.outcome,
    eventId: row.event_id,
    paidAt: row.paid_at,
    tickets: row.tickets ?? [],
    orderInfo: row.order_info
      ? {
          buyerName: row.order_info.buyer_name,
          buyerEmail: row.order_info.buyer_email,
          totalOre: row.order_info.total_ore,
          confirmationEmailSentAt: row.order_info.confirmation_email_sent_at,
        }
      : null,
    orderItems: (row.order_items ?? []).map((item) => ({
      ticketTypeId: item.ticket_type_id,
      qty: item.qty,
      unitPriceOre: item.unit_price_ore,
      vatRate: item.vat_rate,
      typeName: item.type_name,
    })),
    eventInfo: row.event_info
      ? { title: row.event_info.title, venue: row.event_info.venue, startsAt: row.event_info.starts_at }
      : null,
    organizerInfo: row.organizer_info
      ? {
          legalName: row.organizer_info.legal_name,
          orgNumber: row.organizer_info.org_number,
          termsUrl: row.organizer_info.terms_url,
        }
      : null,
  }
}

// Ren avgörandelogik (testbar utan databas, se
// scripts/check-webhook-svarstid.ts) - mappar finalize_paid_orders
// utfallskod till vad Deno.serve-dispatchen ska göra: webhook_events-
// raden markeras 'done' eller 'needs_attention' EFTER att
// handleCheckoutCompleted returnerat (se stripe-webhook/index.ts) -
// INTE inuti finalize_paid_order (rättat 2026-10-13, se migrationens
// kommentar om racet det annars orsakade).
export type FinalizeHandlerOutcome = 'done' | 'needs_attention' | 'not_found'

export function mapFinalizeOutcome(outcome: string): FinalizeHandlerOutcome {
  if (outcome === 'not_found') return 'not_found'
  if (outcome === 'finalized' || outcome === 'already_paid') return 'done'
  return 'needs_attention' // 'expired', 'cancelled', eller nåt annat oväntat
}
