// admin-create-event
//
// Skapar ett nytt event. Kräver en giltig Supabase Auth-JWT (se
// _shared/organizerAuth.ts) - PIN-baserad admin-sessionstoken är
// borttagen (Tilläggsordern 2026-08-05, multi-tenant). Eventet knyts
// ALLTID till den inloggade användarens EGEN arrangör (organizer_id
// härleds från JWT:n via organizer_members) - ett organizer_id som
// eventuellt skickas i body ignoreras helt, det litar vi aldrig på från
// klienten.
//
// Pris/moms skapas INTE här längre - de hör till biljettyper
// (ticket_types), inte eventet, se admin-ticket-types. capacity finns
// dock kvar HÄR (rättelseordern 2026-08-05, delad kapacitetspool) -
// biljettyperna delar en gemensam pott platser på eventet, ingen egen
// kapacitet per typ. Ett nytt event skapas alltid som "draft" oavsett vad
// som skickas i status, tills minst en biljettyp finns (se
// admin-update-event, publiceringsspärren i avsnitt 5 av Tilläggsordern)
// - ett event utan biljettyper går inte att publicera.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { resolveOrganizer } from '../_shared/organizerAuth.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'

interface CreateEventBody {
  title?: string
  venue?: string
  starts_at?: string
  slug?: string
  capacity?: number
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/é/g, 'e')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
}

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

  let body: CreateEventBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const title = (body.title ?? '').trim()
  const venue = (body.venue ?? '').trim()
  const startsAt = (body.starts_at ?? '').trim()
  const capacity = body.capacity === undefined ? 0 : Number(body.capacity)

  if (!title) return jsonResponse({ error: 'Titel krävs.' }, 400)
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) {
    return jsonResponse({ error: 'Ogiltigt datum/tid.' }, 400)
  }
  if (!Number.isInteger(capacity) || capacity < 0) {
    return jsonResponse({ error: 'Platsantal måste vara ett heltal >= 0.' }, 400)
  }

  const baseSlug = body.slug?.trim() ? slugify(body.slug) : slugify(title)
  if (!baseSlug) return jsonResponse({ error: 'Kunde inte generera slug från titeln.' }, 400)

  const supabase = createAdminClient()

  // Säkerställ unik slug - prova baseSlug, sedan baseSlug-2, baseSlug-3, ...
  // Slugen är unik globalt (över alla arrangörer), inte bara inom en
  // arrangör, eftersom den utgör den publika köp-URL:en.
  let slug = baseSlug
  for (let attempt = 2; attempt <= 20; attempt++) {
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (!existing) break
    slug = `${baseSlug}-${attempt}`
  }

  // Skapas alltid som "draft" - publicering sker via admin-update-event,
  // som spärrar publicering tills minst en biljettyp finns. organizer_id
  // sätts till den inloggade användarens egen arrangör - aldrig från body.
  const { data, error } = await supabase
    .from('events')
    .insert({
      slug,
      title,
      venue: venue || null,
      starts_at: new Date(startsAt).toISOString(),
      status: 'draft',
      capacity,
      organizer_id: auth.organizerId,
    })
    .select()
    .single()

  if (error) {
    return jsonResponse({ error: `Kunde inte skapa event: ${error.message}` }, 500)
  }

  const formattedEvent = {
    ...data,
    starts_at: toIso8601Seconds(data.starts_at),
    created_at: toIso8601Seconds(data.created_at),
  }

  return jsonResponse({ event: formattedEvent }, 201)
})
