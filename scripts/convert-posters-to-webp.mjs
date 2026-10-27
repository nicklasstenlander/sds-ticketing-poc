// ENGÅNGSSKRIPT - körs manuellt, ALDRIG i CI (egress-ordern 2026-10-26).
//
// Konverterar de befintliga affischerna i posters-bucketen till WebP med
// samma maxmått/kvalitet som uppladdningen (src/lib/posterCompression.ts),
// laddar upp dem under ett NYTT filnamn med ett års cache-control och
// pekar om events.poster_landscape_url/poster_portrait_url. Alla event
// (även utkast och arkiverade), inte bara de publicerade.
//
// Torrkörning som standard - visar vad som skulle göras och storlekarna
// före/efter, men skriver ingenting:
//   npm i --no-save sharp@0.34
//   SUPABASE_URL=https://oyqgxnmwojjjpoubdlfa.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/convert-posters-to-webp.mjs
//
// Skarpt:      ... node scripts/convert-posters-to-webp.mjs --apply
// Skarpt och ta bort originalen i samma svep:
//              ... node scripts/convert-posters-to-webp.mjs --apply --delete-old
// (En senare körning hoppar över affischer som redan är WebP, så original
// som lämnats kvar efter --apply tas bort i Dashboard -> Storage -> posters.)
//
// Idempotent: affischer som redan är .webp hoppas över, och raden
// uppdateras bara om URL:en fortfarande är den gamla (ingen krock med en
// samtidig uppladdning i admin). Utan --delete-old ligger originalfilerna
// kvar, så en återställning är bara att sätta tillbaka den gamla URL:en.
import { createClient } from '@supabase/supabase-js'

// Samma värden som src/lib/posterCompression.ts.
const MAX_SIZE = { landscape: { w: 1600, h: 900 }, portrait: { w: 800, h: 1422 } }
const WEBP_QUALITY = 80
const CACHE_CONTROL = '31536000'
const MARKER = '/storage/v1/object/public/posters/'

const apply = process.argv.includes('--apply')
const deleteOld = process.argv.includes('--delete-old')
if (deleteOld && !apply) {
  console.error('--delete-old kräver --apply.')
  process.exit(1)
}

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Sätt SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

let sharp
try {
  sharp = (await import('sharp')).default
} catch {
  console.error('sharp saknas - kör först: npm i --no-save sharp@0.34')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

function objectPath(publicUrl) {
  const idx = publicUrl.indexOf(MARKER)
  if (idx === -1) return null
  return decodeURIComponent(publicUrl.slice(idx + MARKER.length).split('?')[0])
}

const kb = (n) => `${(n / 1024).toFixed(0)} kB`

const { data: events, error } = await supabase
  .from('events')
  .select('id, title, poster_landscape_url, poster_portrait_url')
  .or('poster_landscape_url.not.is.null,poster_portrait_url.not.is.null')
if (error) throw new Error(`Kunde inte läsa events: ${error.message}`)

console.log(`${apply ? 'SKARP KÖRNING' : 'TORRKÖRNING (lägg till --apply för att skriva)'} - ${events.length} event med affisch\n`)

let count = 0
let before = 0
let after = 0
const failures = []

for (const event of events) {
  for (const orientation of ['landscape', 'portrait']) {
    const column = orientation === 'landscape' ? 'poster_landscape_url' : 'poster_portrait_url'
    const oldUrl = event[column]
    if (!oldUrl) continue
    const oldPath = objectPath(oldUrl)
    const label = `${event.title} (${orientation})`
    if (!oldPath || !oldPath.startsWith(`${event.id}/`)) {
      console.log(`HOPPAR ÖVER ${label}: URL:en pekar inte på eventets mapp i posters-bucketen`)
      continue
    }
    if (oldPath.endsWith('.webp')) {
      console.log(`REDAN WEBP  ${label}`)
      continue
    }

    try {
      const { data: blob, error: dlError } = await supabase.storage.from('posters').download(oldPath)
      if (dlError) throw new Error(`nedladdning: ${dlError.message}`)
      const input = Buffer.from(await blob.arrayBuffer())
      const max = MAX_SIZE[orientation]
      const output = await sharp(input)
        .resize({ width: max.w, height: max.h, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true })

      count++
      before += input.length
      after += output.data.length
      console.log(
        `${apply ? 'KONVERTERAR' : 'SKULLE KONV.'} ${label}: ${oldPath} ${kb(input.length)} -> ` +
          `${output.info.width}x${output.info.height} webp ${kb(output.data.length)}`,
      )
      if (!apply) continue

      const newPath = `${event.id}/${orientation}-${Date.now()}.webp`
      const { error: upError } = await supabase.storage
        .from('posters')
        .upload(newPath, output.data, { contentType: 'image/webp', cacheControl: CACHE_CONTROL, upsert: false })
      if (upError) throw new Error(`uppladdning: ${upError.message}`)
      const newUrl = supabase.storage.from('posters').getPublicUrl(newPath).data.publicUrl

      const { data: updated, error: updError } = await supabase
        .from('events')
        .update({ [column]: newUrl })
        .eq('id', event.id)
        .eq(column, oldUrl)
        .select('id')
      if (updError) throw new Error(`uppdatering: ${updError.message}`)
      if (!updated?.length) {
        await supabase.storage.from('posters').remove([newPath])
        throw new Error('affischen byttes under körningen - lämnad orörd')
      }

      if (deleteOld) {
        const { error: rmError } = await supabase.storage.from('posters').remove([oldPath])
        if (rmError) console.log(`  VARNING: kunde inte ta bort ${oldPath}: ${rmError.message}`)
      }
    } catch (err) {
      failures.push(label)
      console.log(`FEL ${label}: ${err instanceof Error ? err.message : err}`)
    }
  }
}

console.log(
  `\n${count} affischer: ${kb(before)} -> ${kb(after)}` +
    (count ? ` (snitt ${kb(before / count)} -> ${kb(after / count)})` : ''),
)
if (failures.length) {
  console.log(`${failures.length} misslyckades: ${failures.join(', ')}`)
  process.exit(1)
}
