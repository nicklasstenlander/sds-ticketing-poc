#!/usr/bin/env node
// Kontrollskript: VERSION i varje src/content/terms/<slug>.ts MÅSTE
// matcha motsvarande post i TERMS_VERSION_BY_ORGANIZER_SLUG i
// supabase/functions/_shared/termsVersions.ts (ordern "Köpvillkor
// godkända, gå live" 2026-10-12, uppföljning om orders.terms_version).
// Körs som del av `npm run build` (se package.json), precis som
// check-terms.mjs.
//
// De två filerna kan inte dela kod - en Supabase Edge Function (Deno)
// kan inte importera src/content/terms/ (separat deploy-mål, se
// filkommentaren i termsVersions.ts) - och måste därför hållas i synk
// för hand vid varje ny godkänd textversion. Utan den här kontrollen
// skulle en VERSION-bump i innehållsfilen kunna gå live (DRAFT=false,
// deployad frontend) utan att servern vet om det, vilket tyst skulle
// stämpla nya ordrars terms_version med FEL (gammalt) nummer - precis
// det versionsspåret finns för att förhindra.
//
// En organisation som INTE finns i termsVersions.ts alls flaggas INTE
// här (inget att jämföra mot än - se check-terms.mjs för DRAFT-styrning
// av om en text är publicerad). Bara ett verkligt NUMMER-GLAPP mellan de
// två källorna är ett fel.
//
// Kör: node scripts/check-terms-version-sync.mjs
// Egna tester: node scripts/check-terms-version-sync.test.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Extraherar VERSION-numret ur en innehållsfils källkod. null om ingen
 * giltig "export const VERSION = <tal>" hittas. */
export function extractContentVersion(content) {
  const m = content.match(/export const VERSION\s*=\s*(\d+)/)
  return m ? Number(m[1]) : null
}

/** Extraherar {slug: version}-kartan ur källkoden för termsVersions.ts.
 * Tål kommentarer och valfri radordning - letar bara efter
 * `<nyckel>: <tal>`-par inuti TERMS_VERSION_BY_ORGANIZER_SLUG-objektet.
 * null om objektet inte hittas alls. */
export function extractServerVersionMap(content) {
  const objMatch = content.match(/TERMS_VERSION_BY_ORGANIZER_SLUG[^{]*\{([\s\S]*?)\}/)
  if (!objMatch) return null
  const map = {}
  const entryPattern = /(\w+)\s*:\s*(\d+)/g
  let entry
  while ((entry = entryPattern.exec(objMatch[1])) !== null) {
    map[entry[1]] = Number(entry[2])
  }
  return map
}

/** Ren valideringsfunktion, oberoende av filsystemet - tar
 * {slug: innehållsfilens källkod}-par och serverfilens källkod som text,
 * returnerar en lista problem (tom lista = godkänd). Separerad från I/O
 * exakt så den går att testa direkt, se check-terms-version-sync.test.mjs. */
export function validateVersionSync(contentFilesBySlug, serverFileContent) {
  const problems = []
  const serverMap = extractServerVersionMap(serverFileContent)
  if (serverMap === null) {
    problems.push('hittar ingen TERMS_VERSION_BY_ORGANIZER_SLUG i termsVersions.ts')
    return problems
  }

  for (const [slug, content] of Object.entries(contentFilesBySlug)) {
    const contentVersion = extractContentVersion(content)
    if (contentVersion === null) {
      problems.push(`${slug}: hittar ingen "export const VERSION" i innehållsfilen`)
      continue
    }
    if (!(slug in serverMap)) continue // Inte registrerad server-sida än - inget att jämföra mot, inget fel här.
    if (serverMap[slug] !== contentVersion) {
      problems.push(
        `${slug}: VERSION i src/content/terms/${slug}.ts är ${contentVersion}, men termsVersions.ts säger ${serverMap[slug]} - uppdatera båda i samma leverans`,
      )
    }
  }
  return problems
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const termsDir = join(__dirname, '..', 'src', 'content', 'terms')
  const serverFilePath = join(__dirname, '..', 'supabase', 'functions', '_shared', 'termsVersions.ts')

  const files = readdirSync(termsDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  if (files.length === 0) {
    console.error('FAIL: hittade inga innehållsfiler i src/content/terms/')
    process.exit(1)
  }

  const contentFilesBySlug = {}
  for (const file of files) {
    contentFilesBySlug[file.replace(/\.ts$/, '')] = readFileSync(join(termsDir, file), 'utf8')
  }
  const serverFileContent = readFileSync(serverFilePath, 'utf8')

  const problems = validateVersionSync(contentFilesBySlug, serverFileContent)
  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL ${p}`)
    console.log(`\n${problems.length} problem hittades.`)
    process.exit(1)
  }
  console.log('OK   VERSION matchar mellan innehållsfilerna och termsVersions.ts.')
}

// Kör bara huvudlogiken när filen körs direkt, inte när test-filen
// importerar de exporterade funktionerna.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
