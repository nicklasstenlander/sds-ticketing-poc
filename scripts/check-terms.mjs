#!/usr/bin/env node
// Kontrollskript för köpvillkorstexter (ordern "Köpvillkor som egen sida
// i Rideau" 2026-10-07, punkt 2) - körs som del av `npm run build` (se
// package.json). Misslyckas (exit 1) om en innehållsfil under
// src/content/terms/ har DRAFT=false men BODY fortfarande innehåller
// hakparenteser, ordet "UTKAST" eller "[granska]" - ett sista skyddsnät
// mot att en ogranskad platshållartext råkar publiceras som "klar".
//
// Kör: node scripts/check-terms.mjs
// Egna tester för valideringslogiken: node scripts/check-terms.test.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const FORBIDDEN = [
  { pattern: /\[/, label: 'innehåller tecknet "["' },
  { pattern: /\]/, label: 'innehåller tecknet "]"' },
  { pattern: /UTKAST/, label: 'innehåller ordet "UTKAST"' },
  { pattern: /\[granska\]/, label: 'innehåller "[granska]"' },
]

/** Ren valideringsfunktion, oberoende av filsystemet - tar filinnehållet
 * som en sträng och returnerar en lista problem (tom lista = godkänd).
 * Separerad från I/O exakt så den går att testa direkt, se
 * check-terms.test.mjs. */
export function validateTermsFileContent(content, filename) {
  const problems = []

  const draftMatch = content.match(/export const DRAFT\s*=\s*(true|false)/)
  if (!draftMatch) {
    problems.push(`${filename}: hittar ingen "export const DRAFT = true|false"`)
    return problems
  }
  const isDraft = draftMatch[1] === 'true'

  const bodyMatch = content.match(/export const BODY\s*=\s*`([\s\S]*?)`/)
  if (!bodyMatch) {
    problems.push(`${filename}: hittar ingen "export const BODY = \`...\`"`)
    return problems
  }
  const body = bodyMatch[1]

  if (isDraft) return problems // utkast - platshållartext tillåten

  const hits = FORBIDDEN.filter((f) => f.pattern.test(body))
  if (hits.length > 0) {
    problems.push(`${filename}: DRAFT=false men texten ${hits.map((h) => h.label).join(', ')}`)
  }
  return problems
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const termsDir = join(__dirname, '..', 'src', 'content', 'terms')

  const files = readdirSync(termsDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  if (files.length === 0) {
    console.error('FAIL: hittade inga innehållsfiler i src/content/terms/')
    process.exit(1)
  }

  let failures = 0
  for (const file of files) {
    const content = readFileSync(join(termsDir, file), 'utf8')
    const problems = validateTermsFileContent(content, file)
    if (problems.length > 0) {
      for (const p of problems) console.error(`FAIL ${p}`)
      failures++
    } else {
      console.log(`OK   ${file}`)
    }
  }

  console.log(`\n${failures === 0 ? 'Alla villkorsfiler godkända.' : `${failures} villkorsfil(er) misslyckades.`}`)
  if (failures > 0) process.exit(1)
}

// Kör bara huvudlogiken när filen körs direkt (node scripts/check-terms.mjs),
// inte när check-terms.test.mjs importerar validateTermsFileContent.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
