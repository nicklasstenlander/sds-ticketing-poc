// admin-update-event
//
// Redigerar ett befintligt event. PATCH-liknande semantik: bara fält som
// faktiskt skickas i body uppdateras, resten lämnas orörda. Kräver giltig
// admin-sessionstoken, precis som admin-create-event.
//
// VIKTIGT - varje fält skrivs ut explicit i .update({...}) nedan, ALDRIG
// body rakt av. Det var bristen som fanns i ett tidigare utkast av
// admin-create-event (fält som tyst ignorerades av att bara delar av body
// mappades) - att bygga update-objektet fält-för-fält här gör att ett
// stavfel i ett fältnamn i body ger noll effekt (fältet finns inte i
// destructuringen) istället för att av misstag skriva över en kolumn med
// undefined/null.
//
// Kapacitet: eventets capacity kan aldrig sättas lägre än sold_count -
// annars skulle databasens egen check-constraint (events_sold_count_check,
// sold_count <= capacity) plötsligt brytas av en admin-redigering utan
// koppling till ett faktiskt köp. Kontrolleras här INNAN update-satsen,
// med ett tydligt felmeddelande - frontend varnar redan om detta innan
// submit (se Biljetter.tsx), men backend-spärren är den som faktiskt gäller.
//
// Pris/moms: fritt att redigera när som helst. orders.price_ore/vat_rate
// är en ögonblicksbild tagen vid köptillfället (se
// 20260101000300_stripe_vat_export.sql) - att ändra eventets pris/moms
// här påverkar ALDRIG redan skapade ordrar, bara framtida köp.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { bearerTokenFrom, verifyAdminToken } from '../_shared/adminToken.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { toIso8601Seconds } from '../_shared/time.ts'

interface UpdateEventBody {
  event_id?: string
  title?: string
  venue?: string
  starts_at?: string
  capacity?: number
  price_ore?: number
  vat_rate?: number
  status?: 'draft' | 'published'
}

const VALID_VAT_RATES = [0, 6, 12, 25]

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

  let body: UpdateEventBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400)
  }

  const eventId = (body.event_id ?? '').trim()
  if (!eventId) {
    return jsonResponse({ error: 'event_id krävs.' }, 400)
  }

  const supabase = createAdminClient()

  // Hämta nuvarande event FÖRST - dels för kapacitetskontrollen mot
  // sold_count, dels för att kunna svara 404 istället för ett förvirrande
  // "0 rader uppdaterade" om event_id inte finns.
  const { data: current, error: currentError } = await supabase
    .from('events')
    .select('id, sold_count, status')
    .eq('id', eventId)
    .maybeSingle()

  if (currentError) {
    return jsonResponse({ error: `Databasfel: ${currentError.message}` }, 500)
  }
  if (!current) {
    return jsonResponse({ error: 'Eventet hittades inte.' }, 404)
  }
  if (current.status === 'cancelled') {
    // Att återställa ett inställt event till published/draft är explicit
    // utanför omfattning för denna PoC (Tilläggsordern avsnitt 5) - inte
    // en teknisk begränsning, bara ett medvetet avstängt flöde tills det
    // efterfrågas.
    return jsonResponse(
      { error: 'Eventet är inställt och kan inte redigeras. Detta stöds inte i denna PoC.' },
      409,
    )
  }

  // Bygg update-objektet fält-för-fält. Varje fält valideras bara om det
  // faktiskt skickades (undefined = "rör inte den här kolumnen").
  const update: Record<string, unknown> = {}

  if (body.title !== undefined) {
    const title = body.title.trim()
    if (!title) return jsonResponse({ error: 'Titel kan inte vara tom.' }, 400)
    update.title = title
  }

  if (body.venue !== undefined) {
    update.venue = body.venue.trim() || null
  }

  if (body.starts_at !== undefined) {
    if (!body.starts_at || Number.isNaN(Date.parse(body.starts_at))) {
      return jsonResponse({ error: 'Ogiltigt datum/tid.' }, 400)
    }
    update.starts_at = new Date(body.starts_at).toISOString()
  }

  if (body.capacity !== undefined) {
    const capacity = Number(body.capacity)
    if (!Number.isInteger(capacity) || capacity < 1) {
      return jsonResponse({ error: 'Platsantal måste vara ett heltal >= 1.' }, 400)
    }
    if (capacity < current.sold_count) {
      return jsonResponse(
        {
          error: `Kapaciteten kan inte sättas lägre än antal sålda biljetter (${current.sold_count}).`,
        },
        400,
      )
    }
    update.capacity = capacity
  }

  if (body.price_ore !== undefined) {
    const priceOre = Number(body.price_ore)
    if (!Number.isInteger(priceOre) || priceOre < 0) {
      return jsonResponse({ error: 'Pris måste vara ett heltal (öre) >= 0.' }, 400)
    }
    update.price_ore = priceOre
  }

  if (body.vat_rate !== undefined) {
    const vatRate = Number(body.vat_rate)
    if (!VALID_VAT_RATES.includes(vatRate)) {
      return jsonResponse({ error: 'Momssats måste vara 0, 6, 12 eller 25 procent.' }, 400)
    }
    update.vat_rate = vatRate
  }

  if (body.status !== undefined) {
    if (body.status !== 'draft' && body.status !== 'published') {
      return jsonResponse(
        { error: 'status måste vara "draft" eller "published" (använd admin-delete-event för att ställa in ett event).' },
        400,
      )
    }
    update.status = body.status
  }

  if (Object.keys(update).length === 0) {
    return jsonResponse({ error: 'Inga fält att uppdatera skickades.' }, 400)
  }

  const { data, error } = await supabase
    .from('events')
    .update(update)
    .eq('id', eventId)
    .select()
    .single()

  if (error) {
    return jsonResponse({ error: `Kunde inte uppdatera event: ${error.message}` }, 500)
  }

  const formattedEvent = {
    ...data,
    starts_at: toIso8601Seconds(data.starts_at),
    created_at: toIso8601Seconds(data.created_at),
  }

  return jsonResponse({ event: formattedEvent })
})
