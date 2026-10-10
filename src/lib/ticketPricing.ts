// Frontend-kopia av supabase/functions/_shared/ticketPricing.ts (ordern
// "Förberedelse för CORE-appen" 2026-10-10, B - samma duplicerings-
// mönster som salesState.ts/freeTicketLimit.ts: Deno-funktionerna och
// Vite-bundlen byggs separat, kan inte dela filen rakt av).
//
// RÄTTELSE: from_price_ore/minPrice räknade tidigare lägsta pris över
// ALLA biljettyper, inklusive gratistyper (price_ore=0) - ett event med
// en gratis barntyp visade "Från 0 kr" även när riktiga betalda
// biljetter kostade betydligt mer. Räknar nu bara BETALDA typer
// (price_ore > 0) - null om inga betalda typer finns.
export interface TicketTypeForPricing {
  price_ore: number
  name: string
}

export interface PricingSummary {
  from_price_ore: number | null
  free_ticket_names: string[]
}

export function computePricingSummary(ticketTypes: TicketTypeForPricing[]): PricingSummary {
  let fromPriceOre: number | null = null
  const freeTicketNames: string[] = []

  for (const tt of ticketTypes) {
    if (tt.price_ore === 0) {
      freeTicketNames.push(tt.name)
      continue
    }
    if (fromPriceOre === null || tt.price_ore < fromPriceOre) {
      fromPriceOre = tt.price_ore
    }
  }

  return { from_price_ore: fromPriceOre, free_ticket_names: freeTicketNames }
}
