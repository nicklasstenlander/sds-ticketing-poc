#!/usr/bin/env node
// Tester för validateTermsFileContent i check-terms.mjs (ordern
// "Köpvillkor som egen sida i Rideau" 2026-10-07, punkt 4): (a) DRAFT=true
// med platshållare -> ok, (b) DRAFT=false med "[" kvar -> misslyckas,
// (c) DRAFT=false och ren text -> ok.
//
// Kör: node scripts/check-terms.test.mjs
import { validateTermsFileContent } from './check-terms.mjs'

let failures = 0
function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}

function fixture({ draft, body }) {
  return `export const DRAFT = ${draft}\nexport const VERSION = 1\nexport const LAST_UPDATED = '[datum]'\nexport const TITLE = 't'\nexport const BODY = \`${body}\`\n`
}

// (a) DRAFT=true med platshållare kvar -> ok (utkast, platshållare tillåtna)
assertEqual(
  validateTermsFileContent(fixture({ draft: true, body: '# Rubrik\n\n[placeholder] och **[granska]**' }), 'a.ts'),
  [],
  '(a) DRAFT=true med [platshållare] och [granska] kvar -> godkänd',
)

// (b) DRAFT=false med "[" kvar -> misslyckas
const bFailures = validateTermsFileContent(fixture({ draft: false, body: 'Adress: [gatuadress]' }), 'b.ts')
assertEqual(bFailures.length > 0, true, '(b) DRAFT=false med "[" kvar i texten -> misslyckas')

// (b2) samma, men med "[granska]" specifikt (inte bara en lös hakparentes)
const b2Failures = validateTermsFileContent(fixture({ draft: false, body: 'En rad. **[granska]**' }), 'b2.ts')
assertEqual(b2Failures.length > 0, true, '(b2) DRAFT=false med "[granska]" kvar -> misslyckas')

// (b3) samma, men med ordet UTKAST kvar i själva texten (inte bara banner-UI:t)
const b3Failures = validateTermsFileContent(fixture({ draft: false, body: 'Det här är ett UTKAST fortfarande.' }), 'b3.ts')
assertEqual(b3Failures.length > 0, true, '(b3) DRAFT=false med ordet "UTKAST" kvar i texten -> misslyckas')

// (c) DRAFT=false och ren text (inga hakparenteser/UTKAST/[granska]) -> ok
assertEqual(
  validateTermsFileContent(
    fixture({ draft: false, body: '# Rubrik\n\nHelt vanlig, färdiggranskad text utan platshållare.' }),
    'c.ts',
  ),
  [],
  '(c) DRAFT=false och ren, granskad text -> godkänd',
)

// Extra: en fil utan DRAFT-export ger ett tydligt fel istället för att krascha
assertEqual(
  validateTermsFileContent('export const BODY = `text`', 'trasig.ts').length > 0,
  true,
  'Fil utan "export const DRAFT" ger ett tydligt problem, inte en krasch',
)

// Extra: en fil utan BODY-export ger ett tydligt fel istället för att krascha
assertEqual(
  validateTermsFileContent('export const DRAFT = false', 'trasig2.ts').length > 0,
  true,
  'Fil utan "export const BODY" ger ett tydligt problem, inte en krasch',
)

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) process.exit(1)
