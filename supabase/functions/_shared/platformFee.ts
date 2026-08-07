// Delad plattformsavgifts-logik - Tilläggsordern 2026-08-07 ("Fast avgift
// per biljett + korrekt momshantering på plattformsavgiften, bägge
// modellerna").
//
// PLATFORM_FEE_MODE styr vilken modell som gäller, plattformsövergripande
// (aldrig per arrangör, aldrig blandat - se ordertextens avsnitt 7):
//   - 'percent' (default, oförändrad från tidigare): avgiften är en andel
//     av biljettsumman (PLATFORM_FEE_RATE, t.ex. "0.02" för 2%), ingen
//     egen rad hos köparen - bakas in i biljettpriset som idag.
//   - 'flat_per_ticket': avgiften är ett FAST belopp PER BILJETT
//     (PLATFORM_FEE_FLAT_ORE i öre), oberoende av biljettpris och
//     rabattkoder - visas som egen rad ("Serviceavgift") både på
//     köpsidan och i Stripe Checkout.
//
// Momssatsen (PLATFORM_FEE_VAT_RATE) är INTE konfigurerbar - alltid 25%,
// hårdkodad. Gäller identiskt för båda avgiftsmodellerna. Ingen secret för
// detta, ingen anledning att kunna sätta fel värde av misstag.
export const PLATFORM_FEE_VAT_RATE = 25

export type PlatformFeeMode = 'percent' | 'flat_per_ticket'

export function readPlatformFeeMode(): PlatformFeeMode {
  const raw = Deno.env.get('PLATFORM_FEE_MODE')
  return raw === 'flat_per_ticket' ? 'flat_per_ticket' : 'percent'
}

/** PLATFORM_FEE_FLAT_ORE - fast avgift per biljett i öre (flat_per_ticket-
 * läget). Ogiltig/saknad secret faller tillbaka på 0 hellre än att
 * krascha ordern, men loggas så det upptäcks. */
export function readPlatformFeeFlatOre(): number {
  const raw = Deno.env.get('PLATFORM_FEE_FLAT_ORE')
  const n = Number(raw)
  if (raw !== undefined && (!Number.isFinite(n) || n < 0)) {
    console.error('Ogiltig PLATFORM_FEE_FLAT_ORE:', raw, '- använder 0 istället.')
  }
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** PLATFORM_FEE_RATE - andel (t.ex. 0.02 för 2%) av biljettsumman
 * (percent-läget). Oförändrad logik från tidigare version. */
export function readPlatformFeeRate(): number {
  const raw = Deno.env.get('PLATFORM_FEE_RATE')
  const n = Number(raw)
  if (raw !== undefined && (!Number.isFinite(n) || n < 0)) {
    console.error('Ogiltig PLATFORM_FEE_RATE:', raw, '- använder 0 istället.')
  }
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export interface PlatformFeeResult {
  mode: PlatformFeeMode
  /** Beloppet som faktiskt tas ut via Stripes application_fee_amount,
   * inkl. moms. Oförändrad uträkning jämfört med tidigare version -
   * bara HUR den bokförs efteråt är nytt. */
  feeOre: number
  /** 25% baklängesberäknad ur feeOre: feeOre * 25/125. Ren
   * bokföringsuppdelning - ökar INTE det faktiska beloppet, samma
   * princip som redan används för biljettpriset. */
  feeVatOre: number
  feeNetOre: number
}

/** Beräknar plattformsavgiften för en kundvagn, enligt aktivt
 * PLATFORM_FEE_MODE. Gäller BÅDA modellerna (se ordertextens
 * regressionstest, punkt 6) - inte bara den nya flat-modellen. */
export function calculatePlatformFee(params: { totalQty: number; ticketSubtotalOre: number }): PlatformFeeResult {
  const mode = readPlatformFeeMode()
  const feeOre =
    mode === 'flat_per_ticket'
      ? params.totalQty * readPlatformFeeFlatOre()
      : Math.round(params.ticketSubtotalOre * readPlatformFeeRate())
  const feeVatOre = Math.round((feeOre * PLATFORM_FEE_VAT_RATE) / (100 + PLATFORM_FEE_VAT_RATE))
  const feeNetOre = feeOre - feeVatOre
  return { mode, feeOre, feeVatOre, feeNetOre }
}
