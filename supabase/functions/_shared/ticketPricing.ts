// Delad prissammanfattning för de publika listningarna (public-embed,
// public-events) - ordern "Förberedelse för CORE-appen" 2026-10-10, B.
//
// RÄTTELSE (samma order): from_price_ore räknade tidigare lägsta pris
// över ALLA biljettyper, inklusive gratistyper (price_ore=0) - ett event
// som blandade en gratis barntyp med betalda vuxentyper visade därför
// "Från 0 kr" på den publika listan, trots att den billigaste BETALDA
// biljetten kostade betydligt mer (skarpt bevis: test-slapp visade
// from_price_ore=0 trots Ordinarie 295 kr/Billig 3 kr, bara för att
// Barn-typen är 0 kr). from_price_ore är nu uttryckligen lägsta pris
// BLAND BETALDA typer (price_ore > 0) - null om inga betalda typer finns.
export interface TicketTypeForPricing {
  price_ore: number
  name: string
}

export interface PricingSummary {
  /** Lägsta pris bland BETALDA typer (price_ore > 0). null om eventet
   * saknar betalda typer helt (antingen inga typer alls, eller bara
   * gratistyper). */
  from_price_ore: number | null
  /** Namnen på typer med price_ore=0, i den ordning de kom in. Tom lista
   * om inga gratistyper finns. */
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
