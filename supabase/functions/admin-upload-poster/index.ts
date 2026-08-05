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
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { bearerTokenFrom, verifyAdminToken } from '../_shared/adminToken.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

interface UploadPosterBody {
  event_id?: string
  orientation?: 'landscape' | 'portrait'
  file_base64?: string
  content_type?: string
}

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB, avkodad storlek

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

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const adminPin = Deno.env.get('ADMIN_PIN')
  if (!adminPin) {
    return jsonResponse({ error: 'ADMIN_PIN är inte konfigurerad på servern.' }, 500)
  }

  const token = bearerTokenFrom(req)
  if (!(await verifyAdminToken(adminPin, token))) {
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
    .select('id, status')
    .eq('id', eventId)
    .maybeSingle()
  if (eventError) return jsonResponse({ error: `Databasfel: ${eventError.message}` }, 500)
  if (!event) return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
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

  // Förutsägbar sökväg med upsert: en ny uppladdning av samma orientering
  // skriver över den gamla filen istället för att skapa en dubblett.
  const path = `${eventId}/${orientation}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from('posters')
    .upload(path, bytes, { contentType, upsert: true })

  if (uploadError) {
    return jsonResponse({ error: `Kunde inte ladda upp affischen: ${uploadError.message}` }, 500)
  }

  const { data: publicUrlData } = supabase.storage.from('posters').getPublicUrl(path)
  // Cache-busting query-param så att en omuppladdning (samma path, upsert)
  // faktiskt visar den nya bilden direkt istället för en cachead gammal
  // version - webbläsare/CDN:er cachar annars aggressivt på en oförändrad
  // URL.
  const publicUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`

  const column = orientation === 'landscape' ? 'poster_landscape_url' : 'poster_portrait_url'
  const { error: updateError } = await supabase
    .from('events')
    .update({ [column]: publicUrl })
    .eq('id', eventId)

  if (updateError) {
    return jsonResponse({ error: `Kunde inte spara affisch-URL: ${updateError.message}` }, 500)
  }

  return jsonResponse({ url: publicUrl, orientation })
})
