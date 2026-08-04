import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { callFunction, getAdminToken } from '../lib/functionsApi'
import type { EventRow } from '../lib/types'
import { APP_NAME } from '../lib/constants'

interface AdminEventsResponse {
  events: EventRow[]
}

// /admin/dashboard - enligt Tilläggsordern "ScenPass-designmockupen"
// avsnitt 5: bygger BARA det som går att räkna ut med redan hämtad
// admin-events-data (sålt/kapacitet per event, totalt sålda biljetter).
// Mockupens "sålt denna vecka", "beläggning i snitt" och "+18% sedan
// igår" kräver ny backend-aggregering (tidsfönster på orders.paid_at,
// respektive en historisk snapshot att jämföra mot) som inte är beställd
// i denna order - se README för var det flaggas.
export function AdminDashboardPage() {
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setAuthed(Boolean(getAdminToken()))
    setCheckingAuth(false)
  }, [])

  useEffect(() => {
    if (!authed) return
    callFunction<AdminEventsResponse>('admin-events', { auth: true })
      .then((res) => setEvents(res.events))
      .catch((err) => setError(err instanceof Error ? err.message : 'Kunde inte hämta events.'))
  }, [authed])

  if (checkingAuth) return null
  if (!authed) return <Navigate to="/admin" replace />

  const publishedEvents = (events ?? []).filter((e) => e.status !== 'cancelled')
  const totalSold = publishedEvents.reduce((sum, e) => sum + e.sold_count, 0)

  return (
    <Layout wide>
      <div className="flex items-center justify-between mb-1">
        <div className="eyebrow">{APP_NAME}</div>
        <Link to="/admin" className="text-sm link-accent">
          ← Till admin
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-2 text-[var(--text)]">Dashboard</h1>
      <p className="text-[var(--text-muted)] text-sm mb-8">Överblick över dina föreställningar.</p>

      {error && <p className="text-red-600 mb-6">{error}</p>}

      <div className="card p-6 mb-6 max-w-xs">
        <div className="text-[var(--text-muted)] text-sm mb-2">Sålda biljetter totalt</div>
        <div className="text-3xl font-extrabold text-[var(--text)]">{totalSold}</div>
      </div>

      {events === null && !error && <p className="text-[var(--text-muted)]">Laddar…</p>}
      {events !== null && publishedEvents.length === 0 && (
        <p className="text-[var(--text-muted)]">Inga event att visa ännu.</p>
      )}

      <div className="flex flex-col gap-4">
        {publishedEvents.map((event) => {
          const pct = event.capacity > 0 ? Math.round((event.sold_count / event.capacity) * 100) : 0
          return (
            <div key={event.id} className="card">
              <div className="flex justify-between items-baseline mb-4">
                <div className="font-bold text-[var(--text)]">{event.title}</div>
                <div className="font-bold text-sm" style={{ color: 'var(--accent)' }}>
                  {pct}%
                </div>
              </div>
              <div className="progress-track mb-3" style={{ height: 10 }}>
                <div className="progress-fill" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <div className="text-[var(--text-muted)] text-sm">
                {event.sold_count} / {event.capacity} sålda ·{' '}
                {new Date(event.starts_at).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            </div>
          )
        })}
      </div>
    </Layout>
  )
}
