import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { EventOrganizerRelation, EventRow, TicketTypeRow } from '../lib/types'
import { Layout } from '../components/Layout'
import { APP_NAME } from '../lib/constants'

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
          const soldOut = event.capacity > 0 && event.sold_count >= event.capacity
          const pct = event.capacity > 0 ? Math.min(100, Math.round((event.sold_count / event.capacity) * 100)) : 0
          const prices = types.map((t) => t.price_ore)
          const minPrice = prices.length > 0 ? Math.min(...prices) : null
          const hasMultiplePrices = new Set(prices).size > 1
          const organizer = Array.isArray(event.organizers) ? event.organizers[0] : event.organizers

          return (
            <li key={event.id} className="card">
              <div className="flex items-center gap-5">
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
                    {new Date(event.starts_at).toLocaleString('sv-SE', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {event.venue ? ` · ${event.venue}` : ''}
                    {organizer?.name ? ` · Arrangör: ${organizer.name}` : ''}
                  </div>
                  {event.capacity > 0 && (
                    <>
                      <div className="progress-track max-w-[220px] mb-2">
                        <div className="progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-sm text-[var(--text-muted)]">
                        {event.sold_count} / {event.capacity} sålda
                      </div>
                    </>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold text-[var(--text)] mb-2">
                    {minPrice === null
                      ? '–'
                      : `${hasMultiplePrices ? 'Från ' : ''}${(minPrice / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr`}
                  </div>
                  {types.length === 0 || soldOut ? (
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
