import { useEffect, useRef, useState } from 'react'
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

interface DeleteEventResponse {
  result: 'deleted' | 'cancelled'
}

// Konverterar en UTC ISO-tidsstämpel (t.ex. "2026-05-10T17:58:03Z") till
// det format <input type="datetime-local"> förväntar sig i sitt värde
// ("2026-05-10T17:58") - i webbläsarens LOKALA tidszon, inte UTC. Detta är
// den omvända operationen av vad handleSubmitForm redan gör vid skapande
// (new Date(startsAt).toISOString(), som tolkar datetime-local-strängen
// som lokal tid) - så att redigera och spara ett oförändrat datum inte
// tyst skiftar det några timmar.
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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
    <Layout wide>
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
    <div className="card max-w-sm mx-auto">
      <div className="eyebrow mb-3">SODSS Biljett</div>
      <h1 className="text-xl font-bold mb-4 text-[var(--text)]">Admin - logga in</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="password"
          inputMode="numeric"
          placeholder="PIN-kod"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="field"
          autoFocus
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full">
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

  // null = "skapa nytt event"-läge. Ett event-id = redigerar det eventet -
  // samma formulär, förifyllt, se startEdit().
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const editingEvent = events?.find((e) => e.id === editingEventId) ?? null
  const capacityTooLow = editingEvent !== null && capacity < editingEvent.sold_count

  // Formulärkortets referens - används för att scrolla dit på smala
  // skärmar när "Redigera" klickas i eventlistan (se startEdit). På breda
  // skärmar (>=1024px) syns formuläret redan i den högra kolumnen utan
  // att scrolla, så där räcker den visuella markeringen i listan/kortet.
  const formSectionRef = useRef<HTMLElement>(null)

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

  function resetForm() {
    setEditingEventId(null)
    setTitle('')
    setVenue('')
    setStartsAt('')
    setCapacity(50)
    setPriceKr(0)
    setVatRate(6)
    setCreateError(null)
  }

  function startEdit(event: EventRow) {
    setEditingEventId(event.id)
    setTitle(event.title)
    setVenue(event.venue ?? '')
    setStartsAt(toDatetimeLocalValue(event.starts_at))
    setCapacity(event.capacity)
    setPriceKr(event.price_ore / 100)
    setVatRate(event.vat_rate)
    setCreateError(null)

    // Bara scrolla på smala skärmar (< 1024px, samma brytpunkt som
    // grid-layouten nedan använder för att gå från en till två kolumner).
    // På bred skärm ligger formuläret redan synligt i högerkolumnen -
    // ett ovälkommet hopp skulle bara vara distraherande där.
    if (window.matchMedia('(max-width: 1023px)').matches) {
      formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  async function handleSubmitForm(e: FormEvent) {
    e.preventDefault()
    if (editingEventId && capacityTooLow) return // extra skydd, knappen är redan disabled
    setCreating(true)
    setCreateError(null)
    try {
      // Kronor -> öre. Math.round undviker flyttalsavrundningsfel
      // (t.ex. 149.99 * 100 kan annars bli 14998.999...).
      const priceOre = Math.round(priceKr * 100)
      if (editingEventId) {
        await callFunction('admin-update-event', {
          auth: true,
          method: 'POST',
          body: {
            event_id: editingEventId,
            title,
            venue,
            starts_at: startsAt,
            capacity,
            price_ore: priceOre,
            vat_rate: vatRate,
          },
        })
      } else {
        await callFunction<CreateEventResponse>('admin-create-event', {
          auth: true,
          method: 'POST',
          body: { title, venue, starts_at: startsAt, capacity, status: 'published', price_ore: priceOre, vat_rate: vatRate },
        })
      }
      resetForm()
      await loadEvents()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Kunde inte spara eventet.')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(event: EventRow) {
    const message =
      event.sold_count > 0
        ? `Eventet har ${event.sold_count} sålda biljetter och kan inte raderas — det markeras som inställt istället. Fortsätt?`
        : 'Radera eventet permanent?'
    if (!window.confirm(message)) return

    setDeletingId(event.id)
    setRowError(null)
    try {
      await callFunction<DeleteEventResponse>('admin-delete-event', {
        auth: true,
        method: 'POST',
        body: { event_id: event.id },
      })
      if (editingEventId === event.id) resetForm()
      await loadEvents()
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Kunde inte radera eventet.')
    } finally {
      setDeletingId(null)
    }
  }

  function handleLogout() {
    clearAdminToken()
    onLogout()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="eyebrow">SODSS Biljett Admin</div>
        <button onClick={handleLogout} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
          Logga ut
        </button>
      </div>
      <h1 className="text-2xl font-bold text-[var(--text)] mb-6">Admin</h1>

      {events && events.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="card p-4">
            <div className="text-xs text-[var(--text-muted)] mb-1">Publicerade events</div>
            <div className="text-2xl font-extrabold text-[var(--text)]">
              {events.filter((e) => e.status === 'published').length}
            </div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-[var(--text-muted)] mb-1">Sålda biljetter totalt</div>
            <div className="text-2xl font-extrabold text-[var(--text)]">
              {events.reduce((sum, e) => sum + e.sold_count, 0)}
            </div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-[var(--text-muted)] mb-1">Snittbeläggning</div>
            <div className="text-2xl font-extrabold text-[var(--text)]">
              {(() => {
                const withCap = events.filter((e) => e.capacity > 0)
                if (withCap.length === 0) return '–'
                const avg =
                  withCap.reduce((sum, e) => sum + e.sold_count / e.capacity, 0) / withCap.length
                return `${Math.round(avg * 100)}%`
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Två kolumner på bred skärm (>=1024px, Tailwinds "lg"): eventlistan
          till vänster, formulär + export staplat till höger. Under 1024px
          kollapsar griden till en enda kolumn - DOM-ordningen nedan
          (lista, sedan formulär+export) blir då automatiskt den staplade
          ordningen Eventlista -> Formulär -> Export utan någon extra
          omordnings-logik. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <section className="order-1">
          <h2 className="font-semibold mb-4 text-[var(--text)]">Befintliga events</h2>
          {error && <p className="text-red-600">{error}</p>}
          {rowError && <p className="text-red-600 mb-2">{rowError}</p>}
          {events === null && !error && <p className="text-[var(--text-muted)]">Laddar…</p>}
          {events !== null && events.length === 0 && (
            <p className="text-[var(--text-muted)]">Inga events skapade ännu.</p>
          )}
          <ul className="space-y-3">
            {events?.map((event) => {
              const cancelled = event.status === 'cancelled'
              const isEditing = event.id === editingEventId
              return (
                <li
                  key={event.id}
                  className={`card p-4 transition-colors ${
                    isEditing
                      ? 'border-l-4 border-l-[#dd5c86] bg-rose-50'
                      : cancelled
                        ? 'opacity-70'
                        : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <Link to={`/admin/event/${event.id}`} className="min-w-0 flex-1 hover:underline">
                      <div className="font-semibold text-[var(--text)]">{event.title}</div>
                      <div className="text-sm text-[var(--text-muted)]">
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
                    </Link>
                    <div className="text-right shrink-0">
                      <div className="text-sm text-[var(--text)]">
                        {event.sold_count} / {event.capacity} sålda
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          cancelled
                            ? 'bg-slate-200 text-slate-600'
                            : event.status === 'published'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {cancelled ? 'Inställt' : event.status === 'published' ? 'Publicerat' : 'Utkast'}
                      </span>
                    </div>
                  </div>

                  {!cancelled && (
                    <div className="flex gap-4 mt-4 pt-4 border-t border-[var(--border)] text-sm">
                      <button
                        type="button"
                        onClick={() => startEdit(event)}
                        className="text-slate-600 hover:text-slate-900 underline"
                      >
                        Redigera
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(event)}
                        disabled={deletingId === event.id}
                        className="text-red-600 hover:text-red-800 underline disabled:opacity-50"
                      >
                        {deletingId === event.id ? 'Raderar…' : 'Radera'}
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <div className="order-2 lg:sticky lg:top-4 space-y-6">
          <section
            ref={formSectionRef}
            className={`card ${editingEventId ? 'border-l-4 border-l-[#dd5c86]' : ''}`}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-[var(--text)]">
                {editingEventId ? `Redigerar: ${editingEvent?.title ?? ''}` : 'Skapa nytt event'}
              </h2>
              {editingEventId && (
                <button type="button" onClick={resetForm} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
                  Avbryt redigering
                </button>
              )}
            </div>
            <form onSubmit={handleSubmitForm} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Titel</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Plats</label>
            <input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              className="field"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]">Datum &amp; tid</label>
              <input
                type="datetime-local"
                required
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]">
                Platsantal
                {editingEvent && <span className="font-normal text-[var(--text-muted)]"> ({editingEvent.sold_count} sålda)</span>}
              </label>
              <input
                type="number"
                min={1}
                required
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                className={`field ${capacityTooLow ? 'border-red-400' : ''}`}
              />
              {capacityTooLow && (
                <p className="text-red-600 text-xs mt-1">
                  Kan inte vara lägre än antal sålda biljetter ({editingEvent?.sold_count}).
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]">Pris (kr)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                required
                value={priceKr}
                onChange={(e) => setPriceKr(Number(e.target.value))}
                className="field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]">Momssats</label>
              <select
                value={vatRate}
                onChange={(e) => setVatRate(Number(e.target.value))}
                className="field"
              >
                <option value={6}>6 % (standard, scenframträdande)</option>
                <option value={12}>12 %</option>
                <option value={25}>25 %</option>
                <option value={0}>0 %</option>
              </select>
            </div>
          </div>

              {createError && <p className="text-red-600 text-sm">{createError}</p>}
              <button type="submit" disabled={creating || capacityTooLow} className="btn-primary">
                {creating ? 'Sparar…' : editingEventId ? 'Spara ändringar' : 'Skapa event'}
              </button>
            </form>
          </section>

          <ExportSection events={events ?? []} />
        </div>
      </div>
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
    <section className="card">
      <h2 className="font-semibold mb-2 text-[var(--text)]">Exportera försäljning</h2>
      <p className="text-sm text-[var(--text-muted)] mb-4">
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
          <label className="block text-sm font-medium mb-2 text-[var(--text)]">Datum</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="field"
          />
        </div>
      )}

      {scope === 'range' && (
        <div className="flex gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Från</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Till</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="field"
            />
          </div>
        </div>
      )}

      {scope === 'event' && (
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2 text-[var(--text)]">Event</label>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="field"
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

      <div className="flex gap-4">
        <button type="button" onClick={() => handleDownload('csv')} disabled={downloading !== null} className="btn-primary">
          {downloading === 'csv' ? 'Laddar ner…' : 'Ladda ner CSV'}
        </button>
        <button type="button" onClick={() => handleDownload('sie')} disabled={downloading !== null} className="btn-secondary">
          {downloading === 'sie' ? 'Laddar ner…' : 'Ladda ner SIE'}
        </button>
      </div>
    </section>
  )
}
