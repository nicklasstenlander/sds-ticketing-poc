// Ren beslutsfunktion för scan-ticket (ordern "Före försäljning"
// 2026-10-05, 1.2 - inställt event ska avvisa skanningen). Egen fil,
// skild från index.ts, så den går att importera från
// scripts/check-scan-ticket.ts UTAN att samtidigt köra index.ts:s
// Deno.serve(...) som sidoeffekt av importen.
//
// DB-sidoeffekterna (uppdatera ticket-raden, logga ticket_scans) ligger
// kvar i index.ts, som fortfarande behöver riktig Supabase-åtkomst.
// Inställt event vinner ALLTID, oavsett biljettens egen status.
export type ScanResultValue = 'ok' | 'duplicate' | 'invalid'

export interface ScanOutcome {
  result: ScanResultValue
  message: string | null
}

export function determineScanOutcome(params: {
  ticketStatus: 'valid' | 'checked_in' | 'void'
  eventStatus: string | null
}): ScanOutcome {
  if (params.eventStatus === 'cancelled') {
    return { result: 'invalid', message: 'Föreställningen är inställd' }
  }
  if (params.ticketStatus === 'valid') return { result: 'ok', message: null }
  if (params.ticketStatus === 'checked_in') return { result: 'duplicate', message: null }
  return { result: 'invalid', message: null } // status === 'void'
}
