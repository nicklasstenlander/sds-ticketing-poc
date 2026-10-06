// Ren beslutsfunktion för scan-ticket (ordern "Före försäljning"
// 2026-10-05, 1.2 - inställt event; ordern "Skannern ska veta vilken
// föreställning den släpper in till" 2026-10-06, A1 - fel föreställning).
// Egen fil, skild från index.ts, så den går att importera från
// scripts/check-scan-ticket.ts UTAN att samtidigt köra index.ts:s
// Deno.serve(...) som sidoeffekt av importen.
//
// DB-sidoeffekterna (uppdatera ticket-raden, logga ticket_scans) ligger
// kvar i index.ts, som fortfarande behöver riktig Supabase-åtkomst.
//
// Kontrollordning (ordern A1, bindande): 1) inställt event, 2) fel
// föreställning (bara om requestedEventId skickats OCH skiljer sig från
// biljettens eget event - en gammal appversion som aldrig skickar fältet
// ger requestedEventId=null och hoppar alltså över detta steg helt,
// exakt dagens beteende), 3) biljettens egen status. Steg 2 körs INNAN
// steg 3 med flit - en redan incheckad biljett som skannas mot FEL event
// ska svara "fel föreställning", aldrig "duplicate" (det skulle avslöja
// att biljetten redan är använd, se ordertextens A1).
import { formatStockholmDateTimeSv } from '../_shared/salesState.ts'

export type ScanResultValue = 'ok' | 'duplicate' | 'invalid'

export interface ScanOutcome {
  result: ScanResultValue
  message: string | null
}

export function determineScanOutcome(params: {
  ticketStatus: 'valid' | 'checked_in' | 'void'
  eventStatus: string | null
  /** Eventet biljetten faktiskt tillhör. */
  ticketEventId: string
  /** Eventet skanningen begärs för - null om fältet inte skickades alls
   * (gammal appversion, exakt dagens beteende). */
  requestedEventId: string | null
  ticketEventTitle: string | null
  ticketEventStartsAt: string | null
}): ScanOutcome {
  if (params.eventStatus === 'cancelled') {
    return { result: 'invalid', message: 'Föreställningen är inställd' }
  }

  if (params.requestedEventId && params.requestedEventId !== params.ticketEventId) {
    const title = params.ticketEventTitle ?? 'en annan föreställning'
    const when = params.ticketEventStartsAt ? formatStockholmDateTimeSv(params.ticketEventStartsAt) : null
    return {
      result: 'invalid',
      message: when ? `Biljetten gäller ${title}, ${when}` : `Biljetten gäller ${title}`,
    }
  }

  if (params.ticketStatus === 'valid') return { result: 'ok', message: null }
  if (params.ticketStatus === 'checked_in') return { result: 'duplicate', message: null }
  return { result: 'invalid', message: null } // status === 'void'
}
