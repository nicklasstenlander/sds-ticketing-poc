// Skydd mot att gratisbiljetter fyller en föreställning (ordern
// "Skydd mot att gratisbiljetter fyller en föreställning" 2026-10-07).
//
// Gratisbiljetter (barn 0-3 år, 0 kr) räknas mot salongens kapacitet men
// kräver ingen betalning - en order med enbart gratisbiljetter skulle
// annars kunna fylla en föreställning med bara en e-postadress, utan
// att Stripe någonsin behöver bekräfta en betalning.
//
// Ren funktion, ingen DB/Stripe-åtkomst - anropas av create-order FÖRE
// kapacitetsreservationen och FÖRE alla Stripe-anrop (se ordertextens
// avsnitt 2, "Kontrollen körs...").
//
// "En gratisbiljett" = en biljettyp vars ORDINARIE ticket_types.price_ore
// är 0 - INTE det (eventuellt rabatterade) pris som faktiskt debiteras.
// Rabattkoder ändrar alltså aldrig en biljetts klassificering: en betald
// typ med en 100%-kod räknas fortfarande som betald. Anropande kod
// (create-order) MÅSTE därför skicka in priset FÖRE rabatt
// (CartLine.unitPriceOre, satt direkt från ticket_types.price_ore, inte
// unitPriceAfterOre) - se filkommentaren i create-order/index.ts.
export const MAX_FREE_PER_PAID = 2

export interface FreeTicketLine {
  /** Biljettypens ORDINARIE pris (ticket_types.price_ore) - inte det
   * rabatterade priset. */
  priceOre: number
  qty: number
}

export type FreeTicketCheckResult =
  | { ok: true }
  | { ok: false; code: 'FREE_NEEDS_PAID' | 'FREE_LIMIT'; error: string }

export function checkFreeTicketLimit(lines: FreeTicketLine[]): FreeTicketCheckResult {
  const freeQty = lines.filter((l) => l.priceOre === 0).reduce((sum, l) => sum + l.qty, 0)

  // Inga gratisbiljetter i kundvagnen alls - event utan gratistyp (eller
  // en kundvagn som bara innehåller betalda typer) påverkas inte alls.
  if (freeQty === 0) return { ok: true }

  const paidQty = lines.filter((l) => l.priceOre > 0).reduce((sum, l) => sum + l.qty, 0)

  if (paidQty === 0) {
    return {
      ok: false,
      code: 'FREE_NEEDS_PAID',
      error: 'Gratisbiljetter bokas tillsammans med minst en betald biljett.',
    }
  }

  if (freeQty > MAX_FREE_PER_PAID * paidQty) {
    return {
      ok: false,
      code: 'FREE_LIMIT',
      error: 'Du kan boka högst två gratisbiljetter per betald biljett.',
    }
  }

  return { ok: true }
}
