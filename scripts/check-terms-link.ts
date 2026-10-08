// Kontroll av shouldShowTermsLink i src/lib/termsLink.ts (ordern
// "Köpvillkor som egen sida i Rideau" 2026-10-07, uppföljning 2026-10-08:
// "dölj footerlänken 'Köpvillkor' ... så länge DRAFT = true"). Ren
// funktion, ingen React-rendering behövs för att testa den - samma
// mönster som scripts/check-scan-ticket.ts.
//
// Kör: deno run --allow-env scripts/check-terms-link.ts
import { shouldShowTermsLink } from '../src/lib/termsLink.ts'

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}

const DRAFT_REGISTRY = { sds: { DRAFT: true } }
const READY_REGISTRY = { sds: { DRAFT: false } }

assertEqual(
  shouldShowTermsLink('sds', DRAFT_REGISTRY),
  false,
  'DRAFT=true -> länken döljs (ordertextens egna ord: "Länken visas först när DRAFT = false")',
)
assertEqual(shouldShowTermsLink('sds', READY_REGISTRY), true, 'DRAFT=false -> länken visas')
assertEqual(shouldShowTermsLink(undefined, READY_REGISTRY), false, 'Ingen slug alls -> länken döljs')
assertEqual(
  shouldShowTermsLink('finns-inte', READY_REGISTRY),
  false,
  'Okänd slug (finns inte i registret) -> länken döljs, inte en länk till "Sidan finns inte"',
)
assertEqual(shouldShowTermsLink('', READY_REGISTRY), false, 'Tom sträng som slug -> länken döljs')

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
