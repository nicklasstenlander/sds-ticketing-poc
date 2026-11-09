// Intäkt per event för admin-listorna (Översikt). Ren funktion utan
// Supabase, så att den kan testas fristående (scripts/check-revenue.ts).
//
// Samma underlag som bokföringsexporten (export-sales): betalda ordrar,
// EN rad per order_item, priset och momsen som SNAPSHOTADES vid köpet
// (unit_price_ore/vat_rate) - aldrig biljettypens nuvarande pris.
// Ordrar arkiverade som 'test' räknas inte (samma regel som
// _shared/archiveExport.ts). Avbokade/återbetalda ordrar har status
// 'cancelled' och kommer därför aldrig med i underlaget.
//
// Netto = brutto baklänges utan moms (brutto × 100 / (100 + sats)),
// samma princip som exporten - aldrig påslag ovanpå netto.

export interface RevenueItem {
  event_id: string
  qty: number
  unit_price_ore: number
  vat_rate: number
  archived_reason: string | null
}

export interface EventRevenue {
  revenue_ore: number
  revenue_net_ore: number
}

export function revenueByEvent(items: RevenueItem[]): Map<string, EventRevenue> {
  const byEvent = new Map<string, { gross: number; net: number }>()
  for (const item of items) {
    if (item.archived_reason === 'test') continue
    const gross = item.unit_price_ore * item.qty
    const net = (gross * 100) / (100 + item.vat_rate)
    const entry = byEvent.get(item.event_id) ?? { gross: 0, net: 0 }
    entry.gross += gross
    entry.net += net
    byEvent.set(item.event_id, entry)
  }
  const result = new Map<string, EventRevenue>()
  for (const [eventId, { gross, net }] of byEvent) {
    result.set(eventId, { revenue_ore: gross, revenue_net_ore: Math.round(net) })
  }
  return result
}
