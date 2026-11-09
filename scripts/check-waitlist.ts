// Väntelista (2026-11). Fristående kontroll av erbjudandemejlet
// (supabase/functions/_shared/waitlistEmail.ts) - samma mönster som övriga
// scripts/check-*.ts.
//
// Kör: deno run scripts/check-waitlist.ts
//  (eller: node scripts/check-waitlist.ts på Node 22.18+)
//
// Databasdelen (unik adress per speltid, statusvärden) prövas i
// scripts/check-waitlist-db.mjs mot PGlite.
import { buildWaitlistOfferEmail } from '../supabase/functions/_shared/waitlistEmail.ts'

let failures = 0
function check(cond: boolean, label: string) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)
  if (!cond) failures++
}

const mail = buildWaitlistOfferEmail({
  name: 'Anna <script>',
  eventTitle: 'Around the World',
  eventVenue: 'Berga Teater',
  eventStartsAt: '2026-12-06T13:30:00Z',
  purchaseUrl: 'https://biljetter.example/#/kop/around-the-world-6',
  organizerName: 'Sollentuna Dans & Scenskola',
})
check(mail.subject === 'Det finns platser till Around the World', 'ämnesraden')
check(mail.html.includes('https://biljetter.example/#/kop/around-the-world-6'), 'köplänken finns i HTML')
check(mail.text.includes('https://biljetter.example/#/kop/around-the-world-6'), 'köplänken finns i textversionen')
check(mail.html.includes('först till kvarn'), 'säger att platsen inte är reserverad')
check(!mail.html.includes('<script>') && mail.html.includes('Anna &lt;script&gt;'), 'namnet escapas i HTML')
check(mail.html.includes('Sollentuna Dans &amp; Scenskola'), 'arrangören escapas och står som avsändare')
check(mail.text.includes('söndag 6 december') && mail.text.includes('14:30'), 'datum och tid i Stockholmstid (13:30 UTC = 14:30)')

const noDate = buildWaitlistOfferEmail({
  name: 'Bo', eventTitle: 'Color Me', eventVenue: null, eventStartsAt: null,
  purchaseUrl: 'https://x/#/kop/c', organizerName: null,
})
check(!noDate.text.includes('()') && noDate.text.includes('Hälsningar, Arrangören'), 'fungerar utan datum, plats och arrangörsnamn')

if (failures > 0) {
  console.error(`\n${failures} kontroll(er) misslyckades.`)
  ;(globalThis as { Deno?: { exit(code: number): void } }).Deno?.exit(1)
  ;(globalThis as { process?: { exit(code: number): void } }).process?.exit(1)
} else {
  console.log('\nAlla kontroller godkända.')
}
