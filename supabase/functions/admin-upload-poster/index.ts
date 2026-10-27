// admin-upload-poster
//
// Laddar upp en liggande eller stående affisch för ett event till den
// publika "posters"-bucketen och sparar den publika URL:en på
// events.poster_landscape_url/poster_portrait_url. Admin-skyddad, samma
// sessionstoken-mönster som övriga admin-funktioner. Ingen publik
// skrivrätt till bucketen (se migrationen) - all uppladdning går via
// service role här.
//
// POST admin-upload-poster
// { event_id, orientation: "landscape" | "portrait", file_base64, content_type }
//
// Ingen dimensionskontroll här (kostsamt att avkoda en bild bara för att
// mäta den i en Edge Function) - klienten validerar mått innan anropet
// (se AdminEventPage.tsx, checkImageDimensions). Fel mått som ändå smiter
// igenom ger bara en snedvriden bild i UI, inget säkerhets- eller
// dataintegritetsproblem - acceptabel risk för en PoC.
//
// Egress-ordern 2026-10-26: klienten komprimerar till WebP (JPEG i Safari)
// innan anropet, se src/lib/posterCompression.ts. Varje uppladdning får
// ett NYTT filnamn ({orientation}-{tidsstämpel}.{ext}) istället för upsert
// på samma sökväg + ?v=-cache-bust, så att filen kan cachas i ett år
// (immutable) - en ny affisch är alltid en ny URL. Den tidigare filen tas
// bort efteråt (best effort) så att bucketen inte växer.
import { instrumentEdgeFunctions } from '../_shared/sentry.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

interface UploadPosterBody {
  event_id?: string
  orientation?: 'landscape' | 'portrait'
  file_base64?: string
  content_type?: string
}

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB, avkodad storlek

// Ett år. Säkert eftersom filnamnet byts vid varje ny uppladdning.
const POSTER_CACHE_CONTROL = '31536000'

/** Objektets sökväg i posters-bucketen ur en publik URL, eller null om
 * URL:en inte pekar dit. */
function posterObjectPath(publicUrl: string | null): string | null {
  if (!publicUrl) return null
  const marker = '/storage/v1/object/public/posters/'
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(publicUrl.slice(idx + marker.length).split('?')[0])
}

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Avkodar en base64-sträng (med eller utan "data:...;base64," prefix)
 * till råa bytes. */
function decodeBase64(input: string): Uint8Array {
  const commaIdx = input.indexOf(',')
  const raw = input.startsWith('data:') && commaIdx !== -1 ? input.slice(commaIdx + 1) : input
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

await instrumentEdgeFunctions()

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const auth = await resolveOrganizer(req)
  if (!auth) {
    return jsonResponse({ error: 'Ej behörig. Logga in i admin igen.' }, 401)
  }

  let body: UploadPosterBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const eventId = (body.event_id ?? '').trim()
  const orientation = body.orientation
  const contentType = (body.content_type ?? '').trim()
  const fileBase64 = body.file_base64 ?? ''

  if (!eventId) return jsonResponse({ error: 'event_id krävs.' }, 400)
  if (orientation !== 'landscape' && orientation !== 'portrait') {
    return jsonResponse({ error: 'orientation måste vara "landscape" eller "portrait".' }, 400)
  }
  const ext = ALLOWED_CONTENT_TYPES[contentType]
  if (!ext) {
    return jsonResponse(
      { error: 'content_type måste vara image/jpeg, image/png eller image/webp.' },
      400,
    )
  }
  if (!fileBase64) return jsonResponse({ error: 'file_base64 krävs.' }, 400)

  const supabase = createAdminClient()

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, status, organizer_id, poster_landscape_url, poster_portrait_url')
    .eq('id', eventId)
    .maybeSingle()
  if (eventError) return jsonResponse({ error: `Databasfel: ${eventError.message}` }, 500)
  if (!event || event.organizer_id !== auth.organizerId) {
    return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
  }
  if (event.status === 'cancelled') {
    return jsonResponse({ error: 'Eventet är inställt och kan inte redigeras.' }, 409)
  }

  let bytes: Uint8Array
  try {
    bytes = decodeBase64(fileBase64)
  } catch {
    return jsonResponse({ error: 'Kunde inte avkoda file_base64.' }, 400)
  }

  if (bytes.byteLength > MAX_BYTES) {
    return jsonResponse({ error: 'Filen är för stor (max 5 MB).' }, 400)
  }
  if (bytes.byteLength === 0) {
    return jsonResponse({ error: 'Filen är tom.' }, 400)
  }

  const path = `${eventId}/${orientation}-${Date.now()}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from('posters')
    .upload(path, bytes, { contentType, upsert: false, cacheControl: POSTER_CACHE_CONTROL })

  if (uploadError) {
    return jsonResponse({ error: `Kunde inte ladda upp affischen: ${uploadError.message}` }, 500)
  }

  const { data: publicUrlData } = supabase.storage.from('posters').getPublicUrl(path)
  const publicUrl = publicUrlData.publicUrl

  const column = orientation === 'landscape' ? 'poster_landscape_url' : 'poster_portrait_url'
  const previousPath = posterObjectPath(event[column])
  const { error: updateError } = await supabase
    .from('events')
    .update({ [column]: publicUrl })
    .eq('id', eventId)

  if (updateError) {
    return jsonResponse({ error: `Kunde inte spara affisch-URL: ${updateError.message}` }, 500)
  }

  // Bara filer i eventets egen mapp - aldrig något en annan rad kan peka på.
  if (previousPath && previousPath !== path && previousPath.startsWith(`${eventId}/`)) {
    const { error: removeError } = await supabase.storage.from('posters').remove([previousPath])
    if (removeError) console.error(`Kunde inte ta bort gammal affisch ${previousPath}: ${removeError.message}`)
  }

  return jsonResponse({ url: publicUrl, orientation })
})
