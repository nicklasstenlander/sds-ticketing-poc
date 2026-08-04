import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { EventRow } from '../lib/types'
import { Layout } from '../components/Layout'

export function HomePage() {
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('starts_at', { ascending: true })
      if (cancelled) return
      if (error) setError(error.message)
      else setEvents(data as EventRow[])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Layout>
      <div className="eyebrow mb-3">SODSS Biljett</div>
      <h1 className="text-2xl font-bold mb-2 text-[var(--text)]">Kommande evenemang</h1>
      <p className="text-[var(--text-muted)] mb-8">
        Proof of concept för biljettflödet: skapa event i admin, köp biljett här, scanna i
        appen.
      </p>

      {error && <p className="text-red-600">Kunde inte hämta events: {error}</p>}
      {events === null && !error && <p className="text-[var(--text-muted)]">Laddar…</p>}
      {events !== null && events.length === 0 && (
        <p className="text-[var(--text-muted)]">Inga publicerade events ännu. Skapa ett i admin.</p>
      )}

      <ul className="space-y-4">
        {events?.map((event) => {
          const soldOut = event.sold_count >= event.capacity
          const pct = event.capacity > 0 ? Math.min(100, Math.round((event.sold_count / event.capacity) * 100)) : 0
          return (
            <li key={event.id} className="card">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[var(--text)]">{event.title}</div>
                  <div className="text-sm text-[var(--text-muted)] mb-3">
                    {new Date(event.starts_at).toLocaleString('sv-SE', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {event.venue ? ` · ${event.venue}` : ''}
                  </div>
                  <div className="progress-track max-w-[220px] mb-2">
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-sm text-[var(--text-muted)]">
                    {event.sold_count} / {event.capacity} sålda
                  </div>
                </div>
                {soldOut ? (
                  <span className="text-sm text-[var(--text-muted)] shrink-0">Slutsålt</span>
                ) : (
                  <Link to={`/kop/${event.slug}`} className="btn-primary text-sm shrink-0">
                    Köp biljett
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Layout>
  )
}
