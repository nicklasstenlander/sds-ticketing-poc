#!/usr/bin/env node
// Tester för validateVersionSync/extractContentVersion/
// extractServerVersionMap i check-terms-version-sync.mjs (ordern
// "Köpvillkor godkända, gå live" 2026-10-12, uppföljning): (a) VERSION
// matchar -> ok, (b) VERSION skiljer sig -> misslyckas, plus några
// randfall (saknad post i servermappen, trasiga filer).
//
// Kör: node scripts/check-terms-version-sync.test.mjs
import { validateVersionSync, extractContentVersion, extractServerVersionMap } from './check-terms-version-sync.mjs'

let failures = 0
function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}

function contentFixture(version) {
  return `export const DRAFT = false\nexport const VERSION = ${version}\nexport const LAST_UPDATED = '1 januari 2026'\nexport const TITLE = 't'\nexport const BODY = \`text\`\n`
}

function serverFixture(entries) {
  const body = Object.entries(entries)
    .map(([slug, v]) => `  ${slug}: ${v},`)
    .join('\n')
  return `export const TERMS_VERSION_BY_ORGANIZER_SLUG: Record<string, number> = {\n${body}\n}\n`
}

// (a) VERSION matchar -> ok
assertEqual(
  validateVersionSync({ sds: contentFixture(1) }, serverFixture({ sds: 1 })),
  [],
  '(a) VERSION matchar mellan innehållsfilen (1) och termsVersions.ts (1) -> godkänd',
)

// (b) VERSION skiljer sig -> misslyckas, med ett tydligt felmeddelande
// som nämner båda talen
{
  const problems = validateVersionSync({ sds: contentFixture(2) }, serverFixture({ sds: 1 }))
  assertEqual(problems.length, 1, '(b) VERSION 2 i innehållsfilen mot 1 i termsVersions.ts -> exakt ett problem')
  assertEqual(
    problems[0].includes('2') && problems[0].includes('1'),
    true,
    '(b) felmeddelandet nämner båda versionsnumren (2 och 1)',
  )
}

// (c) Slug saknas helt i termsVersions.ts -> INGET fel (inte registrerad
// server-sida än, se check-terms.mjs för DRAFT-styrning av publicering)
assertEqual(
  validateVersionSync({ 'ny-arrangor': contentFixture(1) }, serverFixture({ sds: 1 })),
  [],
  '(c) en slug som helt saknas i termsVersions.ts -> inget fel, inget att jämföra mot',
)

// (d) Flera arrangörer, en matchar och en skiljer sig -> bara den som
// skiljer sig flaggas
{
  const problems = validateVersionSync(
    { sds: contentFixture(1), testscenen: contentFixture(3) },
    serverFixture({ sds: 1, testscenen: 2 }),
  )
  assertEqual(problems.length, 1, '(d) två arrangörer, en matchar och en skiljer sig -> exakt ett problem')
  assertEqual(problems[0].startsWith('testscenen:'), true, '(d) problemet pekar ut rätt arrangör (testscenen)')
}

// (e) termsVersions.ts helt trasig (objektet hittas inte) -> ett tydligt
// problem istället för en krasch
assertEqual(
  validateVersionSync({ sds: contentFixture(1) }, 'export const NÅGOT_ANNAT = {}').length > 0,
  true,
  '(e) termsVersions.ts utan TERMS_VERSION_BY_ORGANIZER_SLUG ger ett tydligt problem, inte en krasch',
)

// (f) Innehållsfil utan VERSION-export -> ett tydligt problem istället
// för en krasch
assertEqual(
  validateVersionSync({ sds: 'export const DRAFT = false' }, serverFixture({ sds: 1 })).length > 0,
  true,
  '(f) innehållsfil utan "export const VERSION" ger ett tydligt problem, inte en krasch',
)

// Extraherarna direkt, utanför validateVersionSync
assertEqual(extractContentVersion(contentFixture(5)), 5, 'extractContentVersion läser rätt tal')
assertEqual(extractContentVersion('export const DRAFT = false'), null, 'extractContentVersion ger null utan VERSION-export')
assertEqual(extractServerVersionMap(serverFixture({ sds: 1, x: 7 })), { sds: 1, x: 7 }, 'extractServerVersionMap läser flera poster')
assertEqual(extractServerVersionMap('tomt'), null, 'extractServerVersionMap ger null utan TERMS_VERSION_BY_ORGANIZER_SLUG')

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) process.exit(1)
