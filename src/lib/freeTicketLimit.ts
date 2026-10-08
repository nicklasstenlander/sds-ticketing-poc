// Skydd mot att gratisbiljetter fyller en föreställning (ordern
// "Skydd mot att gratisbiljetter fyller en föreställning" 2026-10-07).
//
// Frontend-kopia av supabase/functions/_shared/freeTicketLimit.ts (samma
// duplicerings-mönster som computeSalesState/src/lib/salesState.ts +
// supabase/functions/_shared/salesState.ts - scripts/check-free-ticket-
// limit.ts testar BÅDA kopiorna, för att fånga om de skulle divergera).
// Köpsidan använder detta BARA för att visa/inaktivera UI:t direkt -
// servern (create-order) är alltid den som faktiskt avgör, se
// filkommentaren i den riktiga kopian.
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
