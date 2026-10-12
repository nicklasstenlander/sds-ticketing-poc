// Delad avbokningslogik (ordern "Avbokning, återbetalning, omsändning
// och köparmeddelanden" 2026-10-12, STEG 2 tillägg A) - används av
// admin-cancel-order OCH (STEG 3) charge.refunded-hanteringen i
// stripe-webhook, så de två vägarna aldrig glider isär.
//
// Den FAKTISKA atomiciteten (statusbyte + void-biljetter +
// kapacitetsfrigörning i EN transaktion, skyddad mot dubbel
// frigörning via ett villkorat statusbyte) ligger i databasfunktionen
// cancel_paid_order (se migrationen 20261012020000_cancel_order_
// function.sql) - den här filen är bara ett tunt, typat TypeScript-
// omslag runt det RPC-anropet, så anroparna slipper känna till RPC-
// namnet eller den råa kolumnnamngivningen.
import type { createAdminClient } from './supabaseAdmin.ts'

export interface CancelOrderResult {
  /** false = ordern hade redan status != 'paid' när anropet gjordes
   * (t.ex. redan cancelled, eller fortfarande pending/expired) - inget
   * gjordes, INGET fel kastat. Anroparen avgör om det ska tolkas som
   * "redan avbokad" (idempotent framgång) eller ett användarfel,
   * beroende på vad anroparen redan vet om ordern innan anropet. */
  cancelled: boolean
  eventId: string | null
  totalOre: number | null
  voidedTicketCount: number
}

export async function cancelPaidOrder(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
): Promise<CancelOrderResult> {
  const { data, error } = await supabase.rpc('cancel_paid_order', { p_order_id: orderId }).maybeSingle()
  if (error) throw new Error(`Kunde inte avboka ordern: ${error.message}`)
  if (!data) {
    return { cancelled: false, eventId: null, totalOre: null, voidedTicketCount: 0 }
  }
  const row = data as unknown as { event_id: string; total_ore: number | null; voided_ticket_count: number }
  return {
    cancelled: true,
    eventId: row.event_id,
    totalOre: row.total_ore,
    voidedTicketCount: row.voided_ticket_count,
  }
}
