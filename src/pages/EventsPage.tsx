import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { EventOrganizerRelation, EventRow, TicketTypeRow } from '../lib/types'
import { Layout } from '../components/Layout'
import { APP_NAME } from '../lib/constants'
import { computeSalesState } from '../lib/salesState'
import { computePricingSummary } from '../lib/ticketPricing'
import { formatStockholmDateTime, formatStockholmDateTimeLocale } from '../lib/stockholmTime'

interface EventWithTicketTypes extends EventRow {
  ticket_types: TicketTypeRow[]
  organizers: EventOrganizerRelation | EventOrganizerRelation[] | null
}

// /evenemang - listar alla publicerade event. RLS begränsar redan anon-
// SELECT på events till status='published' (se migrationen från
// 2026-01-01), så ingen extra statusfiltrering behövs i frågan här.
// ticket_types hämtas i samma anrop via PostgREST-embedding (samma RLS-
// mönster: anon ser bara typer kopplade till ett publicerat event).
// capacity/sold_count ligger direkt på eventet (delad kapacitetspool,
// se rättelseordern 2026-08-05) - ingen summering över ticket_types
// behövs för det, bara för prisspannet.
export function EventsPage() {
  const [events, setEvents] = useState<EventWithTicketTypes[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('events')
        .select('*, ticket_types(*), organizers(name)')
        .order('starts_at', { ascending: true })
      if (cancelled) return
      if (error) setError(error.message)
      else setEvents(data as unknown as EventWithTicketTypes[])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Layout>
      <div className="eyebrow mb-3">{APP_NAME}</div>
      <h1 className="text-2xl font-bold mb-2 text-[var(--text)]">Kommande föreställningar</h1>
      <p className="text-[var(--text-muted)] mb-8">
        Välj en föreställning och köp biljett på under en minut.
      </p>

      {error && <p className="text-red-600">Kunde inte hämta events: {error}</p>}
      {events === null && !error && <p className="text-[var(--text-muted)]">Laddar…</p>}
      {events !== null && events.length === 0 && (
        <p className="text-[var(--text-muted)]">Inga publicerade events ännu. Skapa ett i admin.</p>
      )}

      <ul className="space-y-4">
        {events?.map((event) => {
          const types = event.ticket_types ?? []
          const salesState = computeSalesState({
            salesOpenAt: event.sales_open_at,
            soldCount: event.sold_count,
            capacity: event.capacity,
          })
          const soldOut = salesState === 'sold_out'
          const upcoming = salesState === 'upcoming'
          // Exakt antal/andel sålda visas INTE längre för besökare (önskemål
          // 2026-10-04, samma princip som köpsidan) - bara "Få biljetter
          // kvar" under 10% kvar. "Slutsålt" hanteras redan separat nedan
          // (höger badge), oberoende av detta.
          const lowStock = !soldOut && event.capacity > 0 && (event.capacity - event.sold_count) / event.capacity < 0.1
          const prices = types.map((t) => t.price_ore)
          const hasMultiplePrices = new Set(prices).size > 1
          // Rättad (ordern "Förberedelse för CORE-appen" 2026-10-10, B) -
          // from_price_ore/minPrice räknar bara BETALDA typer. En gratis
          // barntyp gav tidigare "Från 0 kr" även när riktiga biljetter
          // kostade mer - fromPriceOre=null nu bara om ALLA typer är
          // gratis (freeTicketNames.length>0) eller inga typer finns alls.
          const pricing = computePricingSummary(types.map((t) => ({ price_ore: t.price_ore, name: t.name })))
          const fromPriceOre = pricing.from_price_ore
          const freeTicketNames = pricing.free_ticket_names
          const organizer = Array.isArray(event.organizers) ? event.organizers[0] : event.organizers

          return (
            <li key={event.id} className="card">
              <div className="flex items-center gap-5 flex-wrap">
                {/* Affisch (liggande) som kortbild om en är uppladdad
                    (Tilläggsordern 2026-08-05) - annars samma
                    diagonalrandiga platshållare som innan, så kort utan
                    affisch inte ser trasiga/ofärdiga ut. */}
                {event.poster_landscape_url ? (
                  <img
                    src={event.poster_landscape_url}
                    alt=""
                    className="w-[64px] h-[64px] rounded-xl shrink-0 border border-[var(--border)] object-cover"
                  />
                ) : (
                  <div
                    className="w-[64px] h-[64px] rounded-xl shrink-0 border border-[var(--border)]"
                    style={{
                      background:
                        'repeating-linear-gradient(45deg, var(--accent-soft), var(--accent-soft) 8px, var(--surface) 8px, var(--surface) 16px)',
                    }}
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[var(--text)]">{event.title}</div>
                  <div className="text-sm text-[var(--text-muted)] mb-3">
                    {/* starts_at är null bara för ett ännu opublicerat
                        dublicerat event (Tilläggsordern 2026-08-05) - RLS
                        (status = 'published') gör att den här listan i
                        praktiken aldrig innehåller ett sådant event, men
                        typen tillåter null så vi faller tillbaka defensivt. */}
                    {event.starts_at
                      ? // steg 1b: explicit Europe/Stockholm (se stockholmTime.ts).
                        formatStockholmDateTimeLocale(event.starts_at, { dateStyle: 'medium', timeStyle: 'short' })
                      : ''}
                    {event.venue ? ` · ${event.venue}` : ''}
                    {organizer?.name ? ` · Arrangör: ${organizer.name}` : ''}
                  </div>
                  {lowStock && <div className="text-sm text-[var(--text-muted)]">Få biljetter kvar</div>}
                </div>
                {/* ml-auto: när raden inte får plats (flex-wrap ovan)
                    hamnar det här blocket ensamt på en egen rad, höger-
                    justerat på den raden - samma "stapla innan krympning"-
                    princip som används i embed.js (ordern 2026-10-06). */}
                <div className="text-right shrink-0 ml-auto">
                  <div className="font-semibold text-[var(--text)] mb-2">
                    {types.length === 0
                      ? '–'
                      : fromPriceOre === null
                        ? 'Gratis'
                        : `${hasMultiplePrices ? 'Från ' : ''}${(fromPriceOre / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr`}
                  </div>
                  {/* Gratisrad (ordern 2026-10-10, B) - bara när det
                      BLANDAS med betalda typer (annars visar priset ovan
                      redan "Gratis" ensamt). */}
                  {fromPriceOre !== null && freeTicketNames.length > 0 && (
                    // max-w: utan en breddbegränsning kan den här raden bli
                    // bredare än chippet/priset och tvinga hela högerblocket
                    // (shrink-0) brett nog för att klämma titelkolumnen i
                    // smal vy (samma klass av bugg som ordern 2026-10-06
                    // åtgärdade - se filkommentaren längre upp i filen).
                    <div className="text-xs text-[var(--text-muted)] mb-2 max-w-[120px] ml-auto">
                      {freeTicketNames.map((name) => `${name}: gratis`).join(', ')}
                    </div>
                  )}
                  {upcoming && event.sales_open_at ? (
                    <span className="text-sm px-2 py-1 rounded-full bg-[var(--spotlight)] text-[var(--spotlight-ink)] inline-block">
                      Släpps {formatStockholmDateTime(event.sales_open_at)}
                    </span>
                  ) : types.length === 0 || soldOut ? (
                    <span className="text-sm text-[var(--text-muted)]">
                      {types.length === 0 ? 'Ej till salu ännu' : 'Slutsålt'}
                    </span>
                  ) : (
                    <Link to={`/kop/${event.slug}`} className="btn-primary text-sm">
                      Köp biljett
                    </Link>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Layout>
  )
}
