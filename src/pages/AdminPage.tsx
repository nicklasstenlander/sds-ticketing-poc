import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import {
  callFunction,
  clearAdminToken,
  downloadAdminFile,
  getAdminToken,
  setAdminToken,
} from '../lib/functionsApi'
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
  const [priceKr, setPriceKr] = useState(0)
  const [vatRate, setVatRate] = useState(6)
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
        body: {
          title,
          venue,
          starts_at: startsAt,
          capacity,
          status: 'published',
          // Kronor -> öre. Math.round undviker flyttalsavrundningsfel
          // (t.ex. 149.99 * 100 kan annars bli 14998.999...).
          price_ore: Math.round(priceKr * 100),
          vat_rate: vatRate,
        },
      })
      setTitle('')
      setVenue('')
      setStartsAt('')
      setCapacity(50)
      setPriceKr(0)
      setVatRate(6)
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Pris (kr)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                required
                value={priceKr}
                onChange={(e) => setPriceKr(Number(e.target.value))}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Momssats</label>
              <select
                value={vatRate}
                onChange={(e) => setVatRate(Number(e.target.value))}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value={6}>6 % (standard, scenframträdande)</option>
                <option value={12}>12 %</option>
                <option value={25}>25 %</option>
                <option value={0}>0 %</option>
              </select>
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

      <ExportSection events={events ?? []} />

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
                      {' · '}
                      {(event.price_ore / 100).toLocaleString('sv-SE', {
                        minimumFractionDigits: 2,
                      })}{' '}
                      kr ({event.vat_rate}% moms)
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

type ExportScope = 'day' | 'range' | 'event'

// Exportknappar för bokföring (CSV och SIE4). Läggs som en egen sektion i
// admin-dashboarden - se supabase/functions/export-sales/index.ts för hur
// filerna byggs (alltid från ordrarnas egen pris/moms-ögonblicksbild, inte
// eventets nuvarande värden).
function ExportSection({ events }: { events: EventRow[] }) {
  const today = new Date().toISOString().slice(0, 10)

  const [scope, setScope] = useState<ExportScope>('day')
  const [date, setDate] = useState(today)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [eventId, setEventId] = useState(events[0]?.id ?? '')
  const [downloading, setDownloading] = useState<'csv' | 'sie' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  function buildQuery(format: 'csv' | 'sie'): string | null {
    const params = new URLSearchParams({ format, scope })
    if (scope === 'day') {
      if (!date) return null
      params.set('date', date)
    } else if (scope === 'range') {
      if (!from || !to) return null
      params.set('from', from)
      params.set('to', to)
    } else {
      if (!eventId) return null
      params.set('event_id', eventId)
    }
    return `export-sales?${params.toString()}`
  }

  async function handleDownload(format: 'csv' | 'sie') {
    const query = buildQuery(format)
    if (!query) {
      setExportError('Fyll i datum/period/event innan export.')
      return
    }
    setDownloading(format)
    setExportError(null)
    try {
      await downloadAdminFile(query, `forsaljning.${format === 'csv' ? 'csv' : 'se'}`)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export misslyckades.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <section className="border border-slate-200 rounded-lg p-6 bg-white mt-8">
      <h2 className="font-semibold mb-1">Exportera försäljning</h2>
      <p className="text-sm text-slate-500 mb-4">
        CSV för kalkylark, SIE4 för bokföring (Fortnox m.fl.). Läser endast betalda ordrar och
        använder alltid priset/momsen som gällde vid köptillfället, inte eventets nuvarande
        värden.{' '}
        <strong>Granska den första SIE-filen med en redovisningskonsult innan skarp import.</strong>
      </p>

      <div className="flex flex-wrap gap-4 mb-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={scope === 'day'}
            onChange={() => setScope('day')}
          />
          Dagens datum
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={scope === 'range'}
            onChange={() => setScope('range')}
          />
          Period
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={scope === 'event'}
            onChange={() => setScope('event')}
          />
          Helt evenemang
        </label>
      </div>

      {scope === 'day' && (
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Datum</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
      )}

      {scope === 'range' && (
        <div className="flex gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium mb-1">Från</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Till</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </div>
        </div>
      )}

      {scope === 'event' && (
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Event</label>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            {events.length === 0 && <option value="">Inga events</option>}
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {exportError && <p className="text-red-600 text-sm mb-3">{exportError}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => handleDownload('csv')}
          disabled={downloading !== null}
          className="bg-slate-900 text-white rounded-md px-4 py-2 font-medium hover:bg-slate-700 disabled:opacity-50"
        >
          {downloading === 'csv' ? 'Laddar ner…' : 'Ladda ner CSV'}
        </button>
        <button
          type="button"
          onClick={() => handleDownload('sie')}
          disabled={downloading !== null}
          className="bg-white text-slate-900 border border-slate-300 rounded-md px-4 py-2 font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          {downloading === 'sie' ? 'Laddar ner…' : 'Ladda ner SIE'}
        </button>
      </div>
    </section>
  )
}
