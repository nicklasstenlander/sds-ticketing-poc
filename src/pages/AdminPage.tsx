import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { callFunction, downloadAdminFile } from '../lib/functionsApi'
import { supabase } from '../lib/supabaseClient'
import { getActiveOrganizerId, setActiveOrganizerId } from '../lib/organizerContext'
import type { AdminEventRow } from '../lib/types'
import { APP_NAME } from '../lib/constants'
import { CreateEventWizard } from './admin/CreateEventWizard'
import { DiscountCodesSection } from './admin/DiscountCodesSection'

interface AdminEventsResponse {
  events: AdminEventRow[]
}

interface DeleteEventResponse {
  result: 'deleted' | 'cancelled'
}

interface DuplicateEventResponse {
  event_id: string
  slug: string
}

interface OrganizerSummary {
  id: string
  name: string
  slug: string
}

interface ListOrganizersResponse {
  organizers: OrganizerSummary[]
}

// Konverterar en UTC ISO-tidsstämpel (t.ex. "2026-05-10T17:58:03Z") till
// det format <input type="datetime-local"> förväntar sig i sitt värde
// ("2026-05-10T17:58") - i webbläsarens LOKALA tidszon, inte UTC.
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(Boolean(data.session))
      setCheckingAuth(false)
    })
    // Håller authed i synk om sessionen ändras utanför denna komponent
    // (utloggning i en annan flik, en misslyckad token-refresh, m.m.) -
    // ingen egen sessionStorage-bokföring behövs längre, Supabase Auth-
    // klienten är källan till sanningen.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(Boolean(session))
    })
    return () => subscription.subscription.unsubscribe()
  }, [])

  if (checkingAuth) return null

  if (!authed) {
    return (
      <Layout>
        <LoginForm onSuccess={() => setAuthed(true)} />
      </Layout>
    )
  }

  return (
    <Layout wide>
      <AdminDashboard onLogout={() => setAuthed(false)} />
    </Layout>
  )
}

// Riktig Supabase Auth-inloggning (e-post + lösenord) - ersätter den
// delade admin-PIN-koden (Tilläggsordern 2026-08-05, "Flera arrangörer:
// riktiga inloggningar och dataisolering"). Ingen arrangörsväljare här:
// vilken arrangör användaren tillhör härleds uteslutande server-side via
// organizer_members (se _shared/organizerAuth.ts), aldrig valt i UI:t.
function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError('Fel e-postadress eller lösenord.')
      setLoading(false)
      return
    }
    onSuccess()
    setLoading(false)
  }

  return (
    <div className="card max-w-sm mx-auto">
      <div className="eyebrow mb-3">{APP_NAME}</div>
      <h1 className="text-xl font-bold mb-4 text-[var(--text)]">Admin - logga in</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2 text-[var(--text)]">E-post</label>
          <input
            type="email"
            required
            autoComplete="username"
            placeholder="namn@arrangor.se"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2 text-[var(--text)]">Lösenord</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Lösenord"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
          />
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Loggar in…' : 'Logga in'}
        </button>
      </form>
    </div>
  )
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [events, setEvents] = useState<AdminEventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Uppföljning 2026-08-05 ("platform-admin"): admin-list-organizers
  // svarar 200 bara för en platform-admin (se organizerAuth.ts) - 403 för
  // vanliga arrangörsanvändare tolkas som "ingen växlare, fortsätt som
  // vanligt", inte som ett fel att visa. orgCheckReady styr att
  // loadEvents() (och därmed alla andra admin-anrop nedan, via den delade
  // X-Organizer-Id-headern i functionsApi.ts) väntar tills rätt workspace
  // är valt.
  const [organizers, setOrganizers] = useState<OrganizerSummary[] | null>(null)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const [orgCheckReady, setOrgCheckReady] = useState(false)

  const [title, setTitle] = useState('')
  const [venue, setVenue] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [capacity, setCapacity] = useState(150)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Ett event-id = redigerar det eventet - det direkta enstegsformuläret
  // för titel/plats/datum/kapacitet, förifyllt, se startEdit(). Kapacitet
  // är en delad pott som alla biljettyper tar från (rättelseordern
  // 2026-08-05) - pris/moms hanteras däremot per biljettyp på eventets
  // egen sida (/admin/event/:id, se AdminEventPage.tsx).
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const editingEvent = events?.find((e) => e.id === editingEventId) ?? null
  const capacityTooLow = editingEvent !== null && capacity < editingEvent.sold_count

  const formSectionRef = useRef<HTMLDivElement>(null)

  // Returnerar den hämtade listan (inte bara void) sa att anropare som
  // behover hitta en specifik rad direkt efter en omladdning (t.ex.
  // handleDuplicate nedan) slipper racea mot Reacts asynkrona setState -
  // events-variabeln i komponentens closure speglar INTE nödvändigtvis
  // det nya state:et forran nasta rendering.
  async function loadEvents(): Promise<AdminEventRow[]> {
    try {
      const res = await callFunction<AdminEventsResponse>('admin-events', { auth: true })
      setEvents(res.events)
      return res.events
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte hämta events.')
      return []
    }
  }

  // Körs en gång vid mount: avgör om den inloggade användaren är en
  // platform-admin, och om så, vilket workspace hen senast valde (eller
  // det första i listan om inget tidigare val finns kvar). loadEvents()
  // (nästa effekt) väntar på orgCheckReady så att X-Organizer-Id-headern
  // hunnit sättas innan några admin-anrop görs.
  useEffect(() => {
    callFunction<ListOrganizersResponse>('admin-list-organizers', { auth: true })
      .then((res) => {
        setIsPlatformAdmin(true)
        setOrganizers(res.organizers)
        const stored = getActiveOrganizerId()
        const valid = stored && res.organizers.some((o) => o.id === stored) ? stored : (res.organizers[0]?.id ?? null)
        setActiveOrganizerId(valid)
        setActiveOrgId(valid)
      })
      .catch(() => {
        // 403 (vanlig arrangörsanvändare) eller 401 - inte en
        // platform-admin. Nollställ ev. kvarglömt workspace-val från en
        // tidigare platform-admin-session på samma webbläsare.
        setIsPlatformAdmin(false)
        setActiveOrganizerId(null)
      })
      .finally(() => setOrgCheckReady(true))
  }, [])

  useEffect(() => {
    if (!orgCheckReady) return
    loadEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgCheckReady])

  function handleSwitchOrganizer(id: string) {
    setActiveOrganizerId(id)
    setActiveOrgId(id)
    // Enklast robusta sätt att få ALLA underkomponenter (rabattkoder,
    // export, m.fl. - som var och en gör sina egna callFunction-anrop) att
    // hämta om data för det nya workspacet, utan att behöva route:a
    // organizer_id genom varenda komponents props.
    window.location.reload()
  }

  function resetForm() {
    setEditingEventId(null)
    setTitle('')
    setVenue('')
    setStartsAt('')
    setCapacity(150)
    setCreateError(null)
  }

  function startEdit(event: AdminEventRow) {
    setCreatingNew(false)
    setEditingEventId(event.id)
    setTitle(event.title)
    setVenue(event.venue ?? '')
    // Ett dublicerat event har medvetet inget datum satt än - lämna
    // fältet tomt istället för att krascha eller gissa (new Date(null)
    // skulle tyst tolkas som 1970-01-01, ett förvirrande fel-värde).
    setStartsAt(event.starts_at ? toDatetimeLocalValue(event.starts_at) : '')
    setCapacity(event.capacity)
    setCreateError(null)
    scrollToFormOnNarrowScreen()
  }

  function startCreate() {
    setEditingEventId(null)
    setCreatingNew(true)
    scrollToFormOnNarrowScreen()
  }

  function scrollToFormOnNarrowScreen() {
    if (window.matchMedia('(max-width: 1023px)').matches) {
      formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  async function handleSubmitForm(e: FormEvent) {
    e.preventDefault()
    if (!editingEventId || capacityTooLow) return
    setCreating(true)
    setCreateError(null)
    try {
      await callFunction('admin-update-event', {
        auth: true,
        method: 'POST',
        body: {
          event_id: editingEventId,
          title,
          venue,
          starts_at: startsAt,
          capacity,
        },
      })
      resetForm()
      await loadEvents()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Kunde inte spara eventet.')
    } finally {
      setCreating(false)
    }
  }

  async function handleTogglePublish(event: AdminEventRow) {
    setRowError(null)
    const nextStatus = event.status === 'published' ? 'draft' : 'published'
    try {
      await callFunction('admin-update-event', {
        auth: true,
        method: 'POST',
        body: { event_id: event.id, status: nextStatus },
      })
      await loadEvents()
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Kunde inte ändra publiceringsstatus.')
    }
  }

  async function handleDelete(event: AdminEventRow) {
    const soldCount = event.sold_count
    const message =
      soldCount > 0
        ? `Eventet har ${soldCount} sålda biljetter och kan inte raderas — det markeras som inställt istället. Fortsätt?`
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

  // Duplicerar ett event (Tilläggsordern "Duplicera event" 2026-08-05).
  // Ingen bekräftelsedialog - till skillnad från radering är en
  // duplicering ofarlig att ångra, ta bara bort kopian igen om den inte
  // behövs. Efter lyckad duplicering laddas listan om och redigerings-
  // formuläret öppnas direkt för den nya kopian (samma formulär som
  // "Redigera" använder), så att datumet - obligatoriskt i det fältet,
  // se kravet nedan - kan sättas i samma svep. Länken "Hantera
  // biljettyper →" i formuläret leder vidare till affischuppladdning.
  async function handleDuplicate(event: AdminEventRow) {
    setDuplicatingId(event.id)
    setRowError(null)
    try {
      const res = await callFunction<DuplicateEventResponse>('admin-duplicate-event', {
        auth: true,
        method: 'POST',
        body: { event_id: event.id },
      })
      const refreshed = await loadEvents()
      const newEvent = refreshed.find((e) => e.id === res.event_id)
      if (newEvent) startEdit(newEvent)
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Kunde inte duplicera eventet.')
    } finally {
      setDuplicatingId(null)
    }
  }

  function handleLogout() {
    setActiveOrganizerId(null)
    supabase.auth.signOut().then(onLogout)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="eyebrow">{APP_NAME} Admin</div>
        <div className="flex items-center gap-4">
          {isPlatformAdmin && organizers && organizers.length > 0 && (
            <select
              value={activeOrgId ?? ''}
              onChange={(e) => handleSwitchOrganizer(e.target.value)}
              className="field text-sm"
              style={{ width: 'auto', padding: '6px 10px' }}
              aria-label="Välj workspace"
            >
              {organizers.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )}
          <Link to="/admin/dashboard" className="text-sm link-accent">
            Dashboard
          </Link>
          <button onClick={handleLogout} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
            Logga ut
          </button>
        </div>
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
                const avg = withCap.reduce((sum, e) => sum + e.sold_count / e.capacity, 0) / withCap.length
                return `${Math.round(avg * 100)}%`
              })()}
            </div>
          </div>
        </div>
      )}

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
              const summary = event.ticket_types_summary
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
                        {event.starts_at
                          ? new Date(event.starts_at).toLocaleString('sv-SE', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })
                          : 'Inget datum satt'}
                        {event.venue ? ` · ${event.venue}` : ''}
                        {' · '}
                        {summary.ticket_type_count === 0
                          ? 'inga biljettyper'
                          : `${summary.ticket_type_count} biljettyp${summary.ticket_type_count > 1 ? 'er' : ''}`}
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
                      <Link to={`/admin/event/${event.id}`} className="text-slate-600 hover:text-slate-900 underline">
                        Biljettyper
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleTogglePublish(event)}
                        className="text-slate-600 hover:text-slate-900 underline"
                      >
                        {event.status === 'published' ? 'Sätt som utkast' : 'Publicera'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicate(event)}
                        disabled={duplicatingId === event.id}
                        className="text-slate-600 hover:text-slate-900 underline disabled:opacity-50"
                      >
                        {duplicatingId === event.id ? 'Duplicerar…' : 'Duplicera'}
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

        <div className="order-2 lg:sticky lg:top-4 space-y-6" ref={formSectionRef}>
          {editingEventId ? (
            <section className="card border-l-4 border-l-[#dd5c86]">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-[var(--text)]">
                  Redigerar: {editingEvent?.title ?? ''}
                </h2>
                <button type="button" onClick={resetForm} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
                  Avbryt redigering
                </button>
              </div>
              <form onSubmit={handleSubmitForm} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-[var(--text)]">Titel</label>
                  <input required value={title} onChange={(e) => setTitle(e.target.value)} className="field" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-[var(--text)]">Plats</label>
                  <input value={venue} onChange={(e) => setVenue(e.target.value)} className="field" />
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
                      {editingEvent && (
                        <span className="font-normal text-[var(--text-muted)]"> ({editingEvent.sold_count} sålda)</span>
                      )}
                    </label>
                    <input
                      type="number"
                      min={0}
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
                <p className="text-sm text-[var(--text-muted)]">
                  Pris, moms och platsantal hanteras per biljettyp på eventets egen sida.{' '}
                  <Link to={`/admin/event/${editingEventId}`} className="link-accent">
                    Hantera biljettyper →
                  </Link>
                </p>

                {createError && <p className="text-red-600 text-sm">{createError}</p>}
                <button type="submit" disabled={creating || capacityTooLow} className="btn-primary">
                  {creating ? 'Sparar…' : 'Spara ändringar'}
                </button>
              </form>
            </section>
          ) : creatingNew ? (
            <CreateEventWizard
              onCreated={async () => {
                await loadEvents()
              }}
              onClose={() => setCreatingNew(false)}
            />
          ) : (
            <section className="card text-center py-10">
              <p className="text-[var(--text-muted)] text-sm mb-4">Redo att lägga till en ny föreställning?</p>
              <button type="button" onClick={startCreate} className="btn-primary">
                Skapa nytt event →
              </button>
            </section>
          )}

          <DiscountCodesSection events={events ?? []} />

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
// ticket_types nuvarande värden).
function ExportSection({ events }: { events: AdminEventRow[] }) {
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
        använder alltid priset/momsen som gällde vid köptillfället, inte biljettypens nuvarande
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
