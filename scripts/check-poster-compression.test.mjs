#!/usr/bin/env node
// Tester för affischkomprimeringen (egress-ordern 2026-10-26): maxmåtten i
// src/lib/posterCompression.ts, att engångsskriptet och embed.js använder
// samma mått, och att public/embed.js fortfarande saknar beroenden.
//
// Kör: node scripts/check-poster-compression.test.mjs
// (importerar en .ts-fil direkt - kräver Node 22.18+ med typborttagning)
import { readFileSync } from 'node:fs'
import { POSTER_MAX_SIZE, POSTER_WEBP_QUALITY, posterTargetSize } from '../src/lib/posterCompression.ts'

let failures = 0
function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

assertEqual(posterTargetSize(1920, 1080, 'landscape'), { w: 1600, h: 900 }, 'Liggande 1920x1080 skalas ner till 1600x900')
assertEqual(posterTargetSize(1080, 1920, 'portrait'), { w: 800, h: 1422 }, 'Stående 1080x1920 skalas ner till 800x1422')
assertEqual(posterTargetSize(1200, 675, 'landscape'), { w: 1200, h: 675 }, 'Mindre bild skalas aldrig upp')
assertEqual(posterTargetSize(1920, 1200, 'landscape'), { w: 1440, h: 900 }, 'Högre än 16:9 begränsas av maxhöjden')
assertEqual(POSTER_WEBP_QUALITY, 0.8, 'WebP-kvalitet 80')

const script = read('scripts/convert-posters-to-webp.mjs')
assertEqual(
  script.includes(`landscape: { w: ${POSTER_MAX_SIZE.landscape.w}, h: ${POSTER_MAX_SIZE.landscape.h} }`) &&
    script.includes(`portrait: { w: ${POSTER_MAX_SIZE.portrait.w}, h: ${POSTER_MAX_SIZE.portrait.h} }`) &&
    script.includes(`WEBP_QUALITY = ${POSTER_WEBP_QUALITY * 100}`),
  true,
  'Engångsskriptet använder samma maxmått och kvalitet som uppladdningen',
)

const embed = read('public/embed.js')
assertEqual(
  embed.includes(`landscape: { width: ${POSTER_MAX_SIZE.landscape.w}, height: ${POSTER_MAX_SIZE.landscape.h} }`) &&
    embed.includes(`portrait: { width: ${POSTER_MAX_SIZE.portrait.w}, height: ${POSTER_MAX_SIZE.portrait.h} }`),
  true,
  'embed.js anger samma width/height som uppladdningsmåtten',
)
assertEqual(/^\s*import\s|require\(|import\(/m.test(embed), false, 'public/embed.js har inga import/require (inga beroenden)')

const upload = read('supabase/functions/admin-upload-poster/index.ts')
assertEqual(upload.includes('upsert: true'), false, 'admin-upload-poster skriver aldrig över en befintlig fil (nytt filnamn per uppladdning)')
assertEqual(upload.includes("POSTER_CACHE_CONTROL = '31536000'"), true, 'admin-upload-poster sätter ett års cache-control')

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) process.exit(1)
