// Ren beslutsfunktion för scan-ticket (ordern "Före försäljning"
// 2026-10-05, 1.2 - inställt event; ordern "Skannern ska veta vilken
// föreställning den släpper in till" 2026-10-06, A1 - fel föreställning;
// ordern "Skannern ska visa vilken typ av biljett som skannas"
// 2026-10-07, A2 - showTicketType).
// Egen fil, skild från index.ts, så den går att importera från
// scripts/check-scan-ticket.ts UTAN att samtidigt köra index.ts:s
// Deno.serve(...) som sidoeffekt av importen.
//
// DB-sidoeffekterna (uppdatera ticket-raden, logga ticket_scans, slå upp
// biljettyp/köpsammansättning) ligger kvar i index.ts, som fortfarande
// behöver riktig Supabase-åtkomst.
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
  /** ordern A2: false för EXAKT de två avvisningar som redan sätter
   * `message` (inställt event, fel föreställning) - index.ts ska då inte
   * fylla i ticket_type/ticket_is_free/order_summary alls, även om
   * biljetten i sig hittades i databasen. Ett eget, explicit fält
   * istället för att låta index.ts anta "message !== null => dölj typen"
   * - den kopplingen råkar stämma idag men är inte tänkt att vara en
   * implicit kontrakt mellan de två filerna. */
  showTicketType: boolean
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
    return { result: 'invalid', message: 'Föreställningen är inställd', showTicketType: false }
  }

  if (params.requestedEventId && params.requestedEventId !== params.ticketEventId) {
    const title = params.ticketEventTitle ?? 'en annan föreställning'
    const when = params.ticketEventStartsAt ? formatStockholmDateTimeSv(params.ticketEventStartsAt) : null
    return {
      result: 'invalid',
      message: when ? `Biljetten gäller ${title}, ${when}` : `Biljetten gäller ${title}`,
      showTicketType: false,
    }
  }

  if (params.ticketStatus === 'valid') return { result: 'ok', message: null, showTicketType: true }
  if (params.ticketStatus === 'checked_in') return { result: 'duplicate', message: null, showTicketType: true }
  return { result: 'invalid', message: null, showTicketType: true } // status === 'void'
}

// === Biljettyp + köpsammansättning (ordern A2) ===
//
// Egen ren funktion, skild från DB-anropen i index.ts, av samma skäl som
// determineScanOutcome ovan: ska gå att testa i scripts/check-scan-ticket.ts
// utan en riktig Supabase-anslutning. index.ts hämtar raderna från
// order_items (en rad per biljettyp i KUNDVAGNEN, inte en rad per
// biljett), normaliserar PostgREST:s objekt-eller-array-form för den
// inbäddade ticket_types(name)-relationen, och skickar in resultatet här.

export interface OrderItemForScan {
  ticket_type_id: string
  qty: number
  /** order_items.list_price_ore (migrationen 20261007000100) - radens
   * pris FÖRE eventuell rabattkod, INTE order_items.unit_price_ore (som
   * är det rabatterade/debiterade priset) och INTE typens nuvarande pris.
   * Rabattkoder tillämpas per rad (create-order, applyDiscountToLines) -
   * unit_price_ore för en vuxenbiljett med en 100%-kod blir 0, precis som
   * en genuint gratis barnbiljett, så unit_price_ore kan INTE användas
   * för "är gratis"-frågan (se filkommentaren till ticket_is_free nedan).
   * `null` för ett köp gjort INNAN migrationen 20261007000100 (kolumnen
   * är rent additiv, ingen backfill av befintliga rader) - ger
   * ticket_is_free=null ("okänt"), aldrig felaktigt false. */
  listPriceOre: number | null
  /** null bara om biljettypen sedan dess raderats (se admin-ticket-types
   * delete-flödet - blockeras dock av paid-ordrar, så detta bör i
   * praktiken aldrig inträffa för en rad som hör till en betald order). */
  typeName: string | null
}

export interface TicketTypeInfo {
  ticket_type: string | null
  ticket_is_free: boolean | null
  order_summary: { name: string; qty: number }[] | null
}

const ORDER_SUMMARY_MAX_ROWS = 6

/** Inga personuppgifter i returvärdet - bara biljettypens namn, pris-
 * flaggan, och kundvagnens rader (namn+antal). Inget här kommer från
 * tickets.holder_name eller orders.buyer_name/buyer_email. */
export function buildTicketTypeInfo(params: {
  /** determineScanOutcome().showTicketType - false (inställt event, fel
   * föreställning) ger {null, null, null} rakt av, utan att ens titta på
   * orderItems. */
  showTicketType: boolean
  /** tickets.ticket_type_id för DEN HÄR biljetten - null om biljetten
   * (bör inte förekomma längre, se migrationen 20261007000000) saknar typ. */
  ownTicketTypeId: string | null
  /** Samtliga order_items-rader för biljettens order_id - oberoende av
   * ownTicketTypeId, eftersom köpets sammansättning kan innehålla andra
   * typer än just den biljett som skannades. */
  orderItems: OrderItemForScan[]
}): TicketTypeInfo {
  if (!params.showTicketType) {
    return { ticket_type: null, ticket_is_free: null, order_summary: null }
  }

  const ownItem = params.ownTicketTypeId
    ? (params.orderItems.find((item) => item.ticket_type_id === params.ownTicketTypeId) ?? null)
    : null

  return {
    ticket_type: ownItem?.typeName ?? null,
    // "Saknas typen: null" (ordertexten) - ingen matchande order_items-rad
    // hittad (eller ingen ticket_type_id alls på biljetten) ger null, inte
    // false. Avgörs av listPriceOre (priset FÖRE rabattkod), inte
    // unit_price_ore - se filkommentaren på OrderItemForScan.listPriceOre.
    // listPriceOre===null (köp gjort före migrationen 20261007000100, ingen
    // backfill) ger OCKSÅ null ("okänt") - `null === 0` vore `false` i
    // JS och skulle felaktigt visa en gammal biljett som "inte gratis".
    ticket_is_free: ownItem && ownItem.listPriceOre !== null ? ownItem.listPriceOre === 0 : null,
    order_summary:
      params.orderItems.length > 0
        ? params.orderItems
            .map((item) => ({ name: item.typeName ?? 'Okänd biljettyp', qty: item.qty }))
            .slice(0, ORDER_SUMMARY_MAX_ROWS)
        : null,
  }
}
