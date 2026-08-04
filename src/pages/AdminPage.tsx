import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { callFunction, clearAdminToken, getAdminToken, setAdminToken } from '../lib/functionsApi'
import type { EventRow } from '../lib/types'

interface AdminAuthResponse {
  token: string
  expires_at: string
}

interface AdminEventsResponse {
  events: EventRow[]
}

interface CreateEventResponse {
  event: EventRow
}

export function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    setAuthed(Boolean(getAdminToken()))
    setCheckingAuth(false)
  }, [])

  if (checkingAuth) return null

  if (!authed) {
    return (
      <Layout>
        <PinGate onSuccess={() => setAuthed(true)} />
      </Layout>
    )
  }

  return (
    <Layout>
      <AdminDashboard onLogout={() => setAuthed(false)} />
    </Layout>
  )
}

function PinGate({ onSuccess }: { onSuccess: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await callFunction<AdminAuthResponse>('admin-auth', {
        method: 'POST',
        body: { pin },
      })
      setAdminToken(res.token)
      onSuccess()
    } catch {
      setError('Fel PIN-kod.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-sm mx-auto border border-slate-200 rounded-lg p-6 bg-white">
      <h1 className="text-xl font-bold mb-4">Admin - logga in</h1>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="password"
          inputMode="numeric"
          placeholder="PIN-kod"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          autoFocus
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-slate-900 text-white rounded-md py-2 font-medium hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? 'Kontrollerar…' : 'Logga in'}
        </button>
      </form>
    </div>
  )
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [venue, setVenue] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [capacity, setCapacity] = useState(50)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function loadEvents() {
    try {
      const res = await callFunction<AdminEventsResponse>('admin-events', { auth: true })
      setEvents(res.events)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte hämta events.')
    }
  }

  useEffect(() => {
    loadEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      await callFunction<CreateEventResponse>('admin-create-event', {
        auth: true,
        method: 'POST',
        body: { title, venue, starts_at: startsAt, capacity, status: 'published' },
      })
      setTitle('')
      setVenue('')
      setStartsAt('')
      setCapacity(50)
      await loadEvents()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Kunde inte skapa event.')
    } finally {
      setCreating(false)
    }
  }

  function handleLogout() {
    clearAdminToken()
    onLogout()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Admin</h1>
        <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-800">
          Logga ut
        </button>
      </div>

      <section className="border border-slate-200 rounded-lg p-6 bg-white mb-8">
        <h2 className="font-semibold mb-4">Skapa nytt event</h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Titel</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Plats</label>
            <input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Datum &amp; tid</label>
              <input
                type="datetime-local"
                required
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Platsantal</label>
              <input
                type="number"
                min={1}
                required
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
          </div>
          {createError && <p className="text-red-600 text-sm">{createError}</p>}
          <button
            type="submit"
            disabled={creating}
            className="bg-slate-900 text-white rounded-md px-4 py-2 font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {creating ? 'Skapar…' : 'Skapa event'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-semibold mb-4">Befintliga events</h2>
        {error && <p className="text-red-600">{error}</p>}
        {events === null && !error && <p className="text-slate-500">Laddar…</p>}
        {events !== null && events.length === 0 && (
          <p className="text-slate-500">Inga events skapade ännu.</p>
        )}
        <ul className="space-y-2">
          {events?.map((event) => (
            <li key={event.id}>
              <Link
                to={`/admin/event/${event.id}`}
                className="block border border-slate-200 rounded-lg p-4 bg-white hover:border-slate-400"
              >
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
                  </div>
                  <div className="text-right">
                    <div className="text-sm">
                      {event.sold_count} / {event.capacity} sålda
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        event.status === 'published'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {event.status === 'published' ? 'Publicerat' : 'Utkast'}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
