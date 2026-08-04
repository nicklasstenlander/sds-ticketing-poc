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
      <h1 className="text-2xl font-bold mb-1">Kommande evenemang</h1>
      <p className="text-slate-500 mb-6">
        Proof of concept för biljettflödet: skapa event i admin, köp biljett här, scanna i
        appen.
      </p>

      {error && <p className="text-red-600">Kunde inte hämta events: {error}</p>}
      {events === null && !error && <p className="text-slate-500">Laddar…</p>}
      {events !== null && events.length === 0 && (
        <p className="text-slate-500">Inga publicerade events ännu. Skapa ett i admin.</p>
      )}

      <ul className="space-y-3">
        {events?.map((event) => {
          const soldOut = event.sold_count >= event.capacity
          return (
            <li key={event.id} className="border border-slate-200 rounded-lg p-4 bg-white">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{event.title}</div>
                  <div className="text-sm text-slate-500">
                    {new Date(event.starts_at).toLocaleString('sv-SE', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {event.venue ? ` · ${event.venue}` : ''}
                  </div>
                  <div className="text-sm text-slate-500">
                    {event.sold_count} / {event.capacity} sålda
                  </div>
                </div>
                <Link
                  to={`/kop/${event.slug}`}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${
                    soldOut
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed pointer-events-none'
                      : 'bg-slate-900 text-white hover:bg-slate-700'
                  }`}
                >
                  {soldOut ? 'Slutsålt' : 'Köp biljett'}
                </Link>
              </div>
            </li>
          )
        })}
      </ul>
    </Layout>
  )
}
