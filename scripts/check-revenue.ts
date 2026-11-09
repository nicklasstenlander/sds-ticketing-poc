// Intäkt per event i Översikt (2026-11). Fristående kontroll av den rena
// funktionen i supabase/functions/admin-events/revenue.ts - samma mönster
// som övriga scripts/check-*.ts (ingen testuppsättning i repot).
//
// Kör: deno run scripts/check-revenue.ts
//  (eller: node scripts/check-revenue.ts på Node 22.18+, som kör .ts direkt)
import { revenueByEvent } from '../supabase/functions/admin-events/revenue.ts'

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : ` - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`}`)
  if (!ok) failures++
}

const r = revenueByEvent([
  // Två rader på samma event: 2 × 200 kr + 1 × 120 kr, 6 % moms.
  { event_id: 'a', qty: 2, unit_price_ore: 20000, vat_rate: 6, archived_reason: null },
  { event_id: 'a', qty: 1, unit_price_ore: 12000, vat_rate: 6, archived_reason: null },
  // Gratisbiljett: påverkar inte beloppet.
  { event_id: 'a', qty: 1, unit_price_ore: 0, vat_rate: 6, archived_reason: null },
  // Dold (riktig betalning) räknas, testdata räknas inte.
  { event_id: 'b', qty: 1, unit_price_ore: 10600, vat_rate: 6, archived_reason: 'hidden' },
  { event_id: 'b', qty: 3, unit_price_ore: 10600, vat_rate: 6, archived_reason: 'test' },
  // Annan momssats (25 %).
  { event_id: 'c', qty: 1, unit_price_ore: 12500, vat_rate: 25, archived_reason: null },
])

assertEqual(r.get('a'), { revenue_ore: 52000, revenue_net_ore: 49057 }, 'brutto summeras, netto baklänges ur 6 % moms')
assertEqual(r.get('b'), { revenue_ore: 10600, revenue_net_ore: 10000 }, "'hidden' räknas, 'test' utesluts")
assertEqual(r.get('c'), { revenue_ore: 12500, revenue_net_ore: 10000 }, '25 % moms')
assertEqual(r.get('saknas'), undefined, 'event utan betalda ordrar finns inte i kartan (anroparen visar 0)')
assertEqual(revenueByEvent([]).size, 0, 'tom lista')

if (failures > 0) {
  console.error(`\n${failures} kontroll(er) misslyckades.`)
  // deno och node har olika exit-API:er.
  ;(globalThis as { Deno?: { exit(code: number): void } }).Deno?.exit(1)
  ;(globalThis as { process?: { exit(code: number): void } }).process?.exit(1)
} else {
  console.log('\nAlla kontroller godkända.')
}
