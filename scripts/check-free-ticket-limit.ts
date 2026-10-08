// Ordern "Skydd mot att gratisbiljetter fyller en föreställning"
// 2026-10-07, avsnitt 4. Fristående Deno-kontroll (samma mönster som
// scripts/check-step1.ts - projektet har ingen vitest/jest-
// testuppsättning). Testar BÅDA kopiorna av checkFreeTicketLimit
// (frontend src/lib/ och backend supabase/functions/_shared/ - samma
// duplicerings-/dubbeltest-mönster som check-step1.ts redan använder för
// computeSalesState), för att fånga om de skulle divergera från varandra.
//
// Kör: deno run --allow-env scripts/check-free-ticket-limit.ts
//
// Punkt 8 ("Nekat anrop skapar ingen order och ändrar inte sold_count")
// testas INTE här - det kräver en riktig Supabase-anslutning som den här
// fristående kontrollen medvetet inte har (samma begränsning som övriga
// scripts/check-*.ts i repot). Verifierat istället genom kodgranskning:
// checkFreeTicketLimit anropas i create-order/index.ts med en direkt
// `return jsonResponse(..., 409)` FÖRE reserve_shared_capacity_multi-
// anropet och FÖRE order-/order_items-inserten - ett nekat anrop når
// alltså aldrig den koden alls.
import {
  checkFreeTicketLimit as checkFreeTicketLimitBackend,
  MAX_FREE_PER_PAID as MAX_FREE_PER_PAID_BACKEND,
  type FreeTicketLine,
} from '../supabase/functions/_shared/freeTicketLimit.ts'
import {
  checkFreeTicketLimit as checkFreeTicketLimitFrontend,
  MAX_FREE_PER_PAID as MAX_FREE_PER_PAID_FRONTEND,
} from '../src/lib/freeTicketLimit.ts'

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}

const PAID = (qty: number): FreeTicketLine => ({ priceOre: 15000, qty })
const FREE = (qty: number): FreeTicketLine => ({ priceOre: 0, qty })

for (const [label, checkFreeTicketLimit, MAX_FREE_PER_PAID] of [
  ['backend', checkFreeTicketLimitBackend, MAX_FREE_PER_PAID_BACKEND],
  ['frontend', checkFreeTicketLimitFrontend, MAX_FREE_PER_PAID_FRONTEND],
] as const) {
  assertEqual(MAX_FREE_PER_PAID, 2, `[${label}] MAX_FREE_PER_PAID = 2 (ordertextens konstant)`)

  // 1. Enbart gratis -> nekas (FREE_NEEDS_PAID)
  assertEqual(
    checkFreeTicketLimit([FREE(1)]),
    { ok: false, code: 'FREE_NEEDS_PAID', error: 'Gratisbiljetter bokas tillsammans med minst en betald biljett.' },
    `[${label}] 1. Enbart gratis (1 st) -> FREE_NEEDS_PAID`,
  )
  assertEqual(
    checkFreeTicketLimit([FREE(3)]).ok,
    false,
    `[${label}] 1b. Enbart gratis (flera st, en rad) -> fortfarande nekad`,
  )

  // 2. 1 betald + 1 gratis -> ok
  assertEqual(checkFreeTicketLimit([PAID(1), FREE(1)]), { ok: true }, `[${label}] 2. 1 betald + 1 gratis -> ok`)

  // 3. 1 betald + 2 gratis -> ok (exakt gränsen, MAX_FREE_PER_PAID=2)
  assertEqual(
    checkFreeTicketLimit([PAID(1), FREE(2)]),
    { ok: true },
    `[${label}] 3. 1 betald + 2 gratis -> ok (exakt på gränsen)`,
  )

  // 4. 1 betald + 3 gratis -> nekas (FREE_LIMIT)
  assertEqual(
    checkFreeTicketLimit([PAID(1), FREE(3)]),
    { ok: false, code: 'FREE_LIMIT', error: 'Du kan boka högst två gratisbiljetter per betald biljett.' },
    `[${label}] 4. 1 betald + 3 gratis -> FREE_LIMIT (en över gränsen)`,
  )

  // 5. 2 betalda + 4 gratis -> ok (exakt gränsen, skalar med antal betalda)
  assertEqual(
    checkFreeTicketLimit([PAID(2), FREE(4)]),
    { ok: true },
    `[${label}] 5. 2 betalda + 4 gratis -> ok (exakt på gränsen, skalar)`,
  )
  assertEqual(
    checkFreeTicketLimit([PAID(2), FREE(5)]).ok,
    false,
    `[${label}] 5b. 2 betalda + 5 gratis -> nekas (en över den skalade gränsen)`,
  )

  // 6. Event utan gratistyp -> oförändrat beteende (ingen gratisrad alls,
  // oavsett hur många betalda rader/typer kundvagnen har)
  assertEqual(
    checkFreeTicketLimit([PAID(1)]),
    { ok: true },
    `[${label}] 6. Bara betalda rader, ingen gratistyp -> ok, opåverkat`,
  )
  assertEqual(
    checkFreeTicketLimit([PAID(2), { priceOre: 20000, qty: 1 }]),
    { ok: true },
    `[${label}] 6b. Flera betalda typer, ingen gratis -> ok, opåverkat`,
  )

  // 7. Betald typ med 100% rabattkod + gratis -> ok. checkFreeTicketLimit
  // tar emot priceOre = biljettypens ORDINARIE pris (ticket_types.price_ore,
  // INTE det rabatterade/debiterade priset - se create-order/index.ts, som
  // alltid skickar lines[].unitPriceOre, satt FÖRE applyDiscountToLines
  // körs). En vuxenbiljett som blivit gratis via en kod har alltså
  // fortfarande priceOre=15000 här, och räknas korrekt som betald.
  assertEqual(
    checkFreeTicketLimit([PAID(1), FREE(1)]), // PAID representerar den ORDINARIE typen oavsett vad som faktiskt debiterades
    { ok: true },
    `[${label}] 7. Betald typ (ordinarie pris skickat, trots 100%-rabattkod i verkligheten) + 1 gratis -> ok`,
  )
}

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
