import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { AdminNav } from '../components/AdminNav'
import { callFunction } from '../lib/functionsApi'
import { supabase } from '../lib/supabaseClient'
import { getActiveOrganizerId, setActiveOrganizerId } from '../lib/organizerContext'
import type { AdminEventRow } from '../lib/types'
import { CreateEventWizard } from './admin/CreateEventWizard'
import { DiscountCodesSection } from './admin/DiscountCodesSection'
import { LoginForm } from './admin/AdminLoginForm'
import { monogram } from '../lib/monogram'
import { ExportSection } from './admin/ExportSection'
import { PlatformRevenueExportSection } from './admin/PlatformRevenueExportSection'
import {
  stockholmWallClockToUtcIso,
  utcIsoToStockholmWallClock,
  utcIsoToStockholmDatetimeLocal,
  stockholmDatetimeLocalToUtcIso,
  formatStockholmDateTime,
  formatStockholmDateTimeLocale,
} from '../lib/stockholmTime'
import { computeSalesState } from '../lib/salesState'
import { confirmDialog } from '../lib/confirmDialog'

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

// steg 1b (2026-10-03): den gamla toDatetimeLocalValue() här visade
// datetime-local-fältet i webbläsarens EGEN tidszon, inte Stockholm - en
// admin som råkade ha en annan systemtidszon skulle se fel klockslag, och
// ett OFÖRÄNDRAT värde skulle kunna flyttas vid nästa sparning (eftersom
// skickandet nedan också tolkades fel, se handleSubmitForm). Ersatt med
// utcIsoToStockholmDatetimeLocal/stockholmDatetimeLocalToUtcIso
// (stockholmTime.ts), samma mönster som sales_open_at redan använder.

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
      <Layout
        dark
        hero={
          <>
            <h1 className="page-title">Admin</h1>
            <p className="page-lede">Logga in för att hantera dina föreställningar.</p>
          </>
        }
      >
        <LoginForm onSuccess={() => setAuthed(true)} />
      </Layout>
    )
  }

  return (
    <AdminDashboard onLogout={() => setAuthed(false)} />
  )
}

// Affischminiatyr i eventlistan: liggande (16:9) först, annars stående, annars
// monogram - så varje rad har en bild och listan känns som föreställningarna.
function EventThumb({ event }: { event: AdminEventRow }) {
  const src = event.poster_landscape_url ?? event.poster_portrait_url
  const portraitOnly = !event.poster_landscape_url && Boolean(event.poster_portrait_url)
  if (!src) {
    return (
      <span className="admin-thumb admin-thumb-empty" aria-hidden="true">
        {monogram(event.title)}
      </span>
    )
  }
  return (
    <span className={`admin-thumb ${portraitOnly ? 'admin-thumb-portrait' : ''}`}>
      <img src={src} alt="" loading="lazy" />
    </span>
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
  const [description, setDescription] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [capacity, setCapacity] = useState(150)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Schemalagt biljettsläpp (ordern 2026-10-03) - samma fält/mönster som
  // CreateEventWizard.tsx, men för redigeringsformuläret.
  const [releaseMode, setReleaseMode] = useState<'direct' | 'scheduled'>('direct')
  const [salesOpenDate, setSalesOpenDate] = useState('')
  const [salesOpenTime, setSalesOpenTime] = useState('')

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
  // Arkiv (ordern "Arkiv för ordrar och event" 2026-10-12, DEL 2 punkt
  // 1) - "Visa arkiverade" döljer/visar arkiverade event i listan.
  // archivingEventId: raden som just nu visar reason-väljaren (test/
  // dold) - bara en i taget, stängs av en lyckad/avbruten åtgärd.
  const [showArchived, setShowArchived] = useState(false)
  const [archivingEventId, setArchivingEventId] = useState<string | null>(null)
  const [archiveActionId, setArchiveActionId] = useState<string | null>(null)

  const editingEvent = events?.find((e) => e.id === editingEventId) ?? null
  const capacityTooLow = editingEvent !== null && capacity < editingEvent.sold_count

  const formSectionRef = useRef<HTMLDivElement>(null)

  // Returnerar den hämtade listan (inte bara void) sa att anropare som
  // behover hitta en specifik rad direkt efter en omladdning (t.ex.
  // handleDuplicate nedan) slipper racea mot Reacts asynkrona setState -
  // events-variabeln i komponentens closure speglar INTE nödvändigtvis
  // det nya state:et forran nasta rendering.
  async function loadEvents(includeArchived = showArchived): Promise<AdminEventRow[]> {
    try {
      const query = includeArchived ? 'admin-events?include_archived=1' : 'admin-events'
      const res = await callFunction<AdminEventsResponse>(query, { auth: true })
      setEvents(res.events)
      return res.events
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte hämta events.')
      return []
    }
  }

  function handleToggleShowArchived() {
    const next = !showArchived
    setShowArchived(next)
    loadEvents(next)
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
    setDescription('')
    setStartsAt('')
    setCapacity(150)
    setReleaseMode('direct')
    setSalesOpenDate('')
    setSalesOpenTime('')
    setCreateError(null)
  }

  function startEdit(event: AdminEventRow) {
    setCreatingNew(false)
    setEditingEventId(event.id)
    setTitle(event.title)
    setVenue(event.venue ?? '')
    setDescription(event.description ?? '')
    // Ett dublicerat event har medvetet inget datum satt än - lämna
    // fältet tomt istället för att krascha eller gissa (new Date(null)
    // skulle tyst tolkas som 1970-01-01, ett förvirrande fel-värde).
    setStartsAt(event.starts_at ? utcIsoToStockholmDatetimeLocal(event.starts_at) : '')
    setCapacity(event.capacity)
    if (event.sales_open_at) {
      const wallClock = utcIsoToStockholmWallClock(event.sales_open_at)
      setReleaseMode('scheduled')
      setSalesOpenDate(wallClock.date)
      setSalesOpenTime(wallClock.time)
    } else {
      setReleaseMode('direct')
      setSalesOpenDate('')
      setSalesOpenTime('')
    }
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

    // steg 1b (2026-10-03): konvertera datetime-local-värdet (Stockholmstid,
    // se utcIsoToStockholmDatetimeLocal ovan i startEdit()) till en riktig
    // UTC ISO-sträng HÄR, på klienten - innan den skickas. Att skicka
    // startsAt rakt av (som tidigare) lät servern tolka en tidszonslös
    // sträng i sin egen körtidszon (UTC), vilket kunde flytta klockslaget
    // både vid en avsiktlig ändring OCH vid en osparad, oförändrad tid.
    const startsAtUtc = stockholmDatetimeLocalToUtcIso(startsAt)
    if (!startsAtUtc) {
      setCreateError('Ogiltigt datum/tid.')
      return
    }

    const salesOpenAt = releaseMode === 'scheduled' ? stockholmWallClockToUtcIso(salesOpenDate, salesOpenTime) : null

    // Bekräftelse (ordern 2026-10-03, 1.4) - bara när det faktiskt är en
    // NY/ändrad framtida släpptid på ett event som redan sålt biljetter.
    // Att bara spara om en oförändrad släpptid (t.ex. redan passerad)
    // ska inte trigga en varning i onödan.
    const isNewSalesOpenAt = salesOpenAt !== null && salesOpenAt !== editingEvent?.sales_open_at
    if (isNewSalesOpenAt && (editingEvent?.sold_count ?? 0) > 0 && salesOpenAt) {
      const confirmed = await confirmDialog(
        `Försäljningen stängs tillfälligt fram till ${formatStockholmDateTime(salesOpenAt)}. Redan sålda biljetter påverkas inte.`,
      )
      if (!confirmed) return
    }

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
          description,
          starts_at: startsAtUtc,
          capacity,
          sales_open_at: salesOpenAt,
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

  // "Radera" är bara möjligt för ett utkast utan några ordrar alls (se
  // admin-delete-event/index.ts, ordern 2026-10-12 DEL 2 punkt 3) - ett
  // publicerat event eller ett med ordrar ska arkiveras istället.
  // Server-sidan är den egentliga spärren, det här styr bara om knappen
  // ens visas.
  function canHardDelete(event: AdminEventRow): boolean {
    return event.status === 'draft' && event.order_count === 0 && !event.archived_at
  }

  async function handleDelete(event: AdminEventRow) {
    if (!await confirmDialog('Radera eventet permanent? Det går inte att ångra.', { danger: true, confirmLabel: 'Radera' })) return

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

  // Arkivering (ordern "Arkiv för ordrar och event" 2026-10-12, DEL 2
  // punkt 1) - event-fokuserat: arkiverar eventet OCH kaskaderar till
  // alla dess ordrar (admin-archive-event). reason väljs av admin innan
  // bekräftelse - "test" (ingen riktig betalning, utesluts ur
  // bokföringsexporten) eller "hidden" (riktig betalning, bara dold).
  async function handleArchiveEvent(event: AdminEventRow, reason: 'test' | 'hidden') {
    const reasonLabel = reason === 'test' ? 'testdata (utesluts ur bokföringsexporten)' : 'dold (ligger kvar i bokföringsexporten)'
    const orderNote = event.order_count > 0 ? ` Eventets ${event.order_count} order${event.order_count === 1 ? '' : 'ar'} arkiveras samtidigt.` : ''
    if (!await confirmDialog(`Arkivera "${event.title}" som ${reasonLabel}?${orderNote} Går att återställa senare.`)) {
      return
    }
    setArchiveActionId(event.id)
    setArchivingEventId(null)
    setRowError(null)
    try {
      await callFunction('admin-archive-event', {
        auth: true,
        method: 'POST',
        body: { event_id: event.id, action: 'archive', reason },
      })
      if (editingEventId === event.id) resetForm()
      await loadEvents()
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Kunde inte arkivera eventet.')
    } finally {
      setArchiveActionId(null)
    }
  }

  async function handleRestoreEvent(event: AdminEventRow) {
    setArchiveActionId(event.id)
    setRowError(null)
    try {
      await callFunction('admin-archive-event', {
        auth: true,
        method: 'POST',
        body: { event_id: event.id, action: 'restore' },
      })
      await loadEvents()
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Kunde inte återställa eventet.')
    } finally {
      setArchiveActionId(null)
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
    <Layout
      wide
      bandOverhang={Boolean(events && events.length > 0)}
      band={
        <>
      <AdminNav
        actions={
          <>
          {isPlatformAdmin && organizers && organizers.length > 0 && (
            <select
              value={activeOrgId ?? ''}
              onChange={(e) => handleSwitchOrganizer(e.target.value)}
              className="field field-sm"
              aria-label="Välj workspace"
            >
              {organizers.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )}
          <button onClick={handleLogout} className="admin-logout">
            Logga ut
          </button>
          </>
        }
      />
      <h1 className="page-title">Events</h1>
      {events && events.length > 0 && (
        <div className="admin-kpis">
          <div className="stat-card">
            <div className="stat-label">Publicerade events</div>
            <div className="stat-value">
              {events.filter((e) => e.status === 'published').length}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Sålda biljetter totalt</div>
            <div className="stat-value">
              {events.reduce((sum, e) => sum + e.sold_count, 0)}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Snittbeläggning</div>
            <div className="stat-value">
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
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <section className="order-1">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-extrabold text-[var(--text)]">Befintliga events</h2>
            <label className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
              <input type="checkbox" checked={showArchived} onChange={handleToggleShowArchived} />
              Visa arkiverade och inställda
            </label>
          </div>
          {error && <p className="text-[var(--danger)]">{error}</p>}
          {rowError && (
            <p className="text-[var(--danger)] mb-2">
              {rowError}
              {rowError.includes('Stripe') && (
                <>
                  {' '}
                  <Link to="/admin/stripe-installning" className="underline">
                    Gå till Stripe-inställningar →
                  </Link>
                </>
              )}
            </p>
          )}
          {events === null && !error && <p className="text-[var(--text-muted)]">Laddar…</p>}
          {events !== null && events.length === 0 && (
            <p className="text-[var(--text-muted)]">Inga events skapade ännu.</p>
          )}
          <ul className="space-y-3">
            {events
              // Inställda event (raderade med sålda biljetter) hör till arkivet:
              // döljs tillsammans med arkiverade tills "Visa arkiverade" kryssas i.
              ?.filter((event) => showArchived || event.status !== 'cancelled')
              .map((event) => {
              const cancelled = event.status === 'cancelled'
              const isEditing = event.id === editingEventId
              const summary = event.ticket_types_summary
              // Schemalagt biljettsläpp (ordern 2026-10-03) - markering i
              // listan, samma stil som status-chipen.
              const isUpcoming =
                computeSalesState({
                  salesOpenAt: event.sales_open_at,
                  soldCount: event.sold_count,
                  capacity: event.capacity,
                }) === 'upcoming'
              return (
                <li
                  key={event.id}
                  className={`card p-4 transition-colors ${
                    isEditing
                      ? 'is-editing'
                      : cancelled
                        ? 'opacity-70'
                        : ''
                  }`}
                >
                  <div className="admin-event-head">
                    <Link to={`/admin/event/${event.id}`} className="admin-event-link">
                      <EventThumb event={event} />
                      <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[var(--text)]">{event.title}</div>
                      <div className="text-sm text-[var(--text-muted)]">
                        {event.starts_at
                          ? // steg 1b: explicit Europe/Stockholm (se stockholmTime.ts).
                            formatStockholmDateTimeLocale(event.starts_at, { dateStyle: 'medium', timeStyle: 'short' })
                          : 'Inget datum satt'}
                        {event.venue ? ` · ${event.venue}` : ''}
                        {' · '}
                        {summary.ticket_type_count === 0
                          ? 'inga biljettyper'
                          : `${summary.ticket_type_count} biljettyp${summary.ticket_type_count > 1 ? 'er' : ''}`}
                      </div>
                      <div className="admin-event-status">
                        <span className="text-sm text-[var(--text)]">
                          {event.sold_count} / {event.capacity} sålda
                        </span>
                        <span
                          className={`badge ${
                            cancelled
                              ? 'badge-neutral'
                              : event.status === 'published'
                                ? 'badge-success'
                                : 'badge-warning'
                          }`}
                        >
                          {cancelled ? 'Inställt' : event.status === 'published' ? 'Publicerat' : 'Utkast'}
                        </span>
                        {event.archived_at && (
                          <span className="badge badge-dark">
                            Arkiverad ({event.archived_reason === 'test' ? 'testdata' : 'dold'})
                          </span>
                        )}
                        {isUpcoming && event.sales_open_at && (
                          <span className="badge badge-spotlight">
                            Släpps {formatStockholmDateTime(event.sales_open_at)}
                          </span>
                        )}
                      </div>
                      </div>
                    </Link>
                  </div>

                  {event.archived_at ? (
                    <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-[var(--border)] text-sm">
                      <span className="text-[var(--text-muted)]">
                        Arkiverad {formatStockholmDateTime(event.archived_at)}
                        {event.order_count > 0 ? ` · ${event.order_count} order${event.order_count === 1 ? '' : 'ar'} med` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRestoreEvent(event)}
                        disabled={archiveActionId === event.id}
                        className="admin-action-btn disabled:opacity-50"
                      >
                        {archiveActionId === event.id ? 'Återställer…' : 'Återställ'}
                      </button>
                    </div>
                  ) : (
                    !cancelled &&
                    (archivingEventId === event.id ? (
                      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-[var(--border)] text-sm">
                        <span className="text-[var(--text)]">Arkivera som:</span>
                        <button
                          type="button"
                          onClick={() => handleArchiveEvent(event, 'test')}
                          className="admin-action-btn"
                        >
                          Testdata (uteslut ur export)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleArchiveEvent(event, 'hidden')}
                          className="admin-action-btn"
                        >
                          Dölj (riktig betalning, kvar i export)
                        </button>
                        <button type="button" onClick={() => setArchivingEventId(null)} className="admin-action-btn">
                          Avbryt
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[var(--border)] text-sm">
                        <button type="button" onClick={() => startEdit(event)} className="admin-action-btn">
                          Redigera uppgifter
                        </button>
                        <Link to={`/admin/event/${event.id}`} className="admin-action-btn">
                          Biljettyper, ordrar &amp; affischer
                        </Link>
                        <button type="button" onClick={() => handleTogglePublish(event)} className="admin-action-btn">
                          {event.status === 'published' ? 'Sätt som utkast' : 'Publicera'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicate(event)}
                          disabled={duplicatingId === event.id}
                          className="admin-action-btn disabled:opacity-50"
                        >
                          {duplicatingId === event.id ? 'Duplicerar…' : 'Duplicera'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setArchivingEventId(event.id)}
                          disabled={archiveActionId === event.id}
                          className="admin-action-btn disabled:opacity-50"
                        >
                          {archiveActionId === event.id ? 'Arkiverar…' : 'Arkivera'}
                        </button>
                        {canHardDelete(event) && (
                          <button
                            type="button"
                            onClick={() => handleDelete(event)}
                            disabled={deletingId === event.id}
                            className="admin-action-btn admin-action-btn-danger disabled:opacity-50"
                          >
                            {deletingId === event.id ? 'Raderar…' : 'Radera'}
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <div className="order-2 lg:sticky lg:top-4 space-y-6" ref={formSectionRef}>
          {editingEventId ? (
            <section className="card is-editing">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-extrabold text-[var(--text)]">
                  Redigerar: {editingEvent?.title ?? ''}
                </h2>
                <button type="button" onClick={resetForm} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
                  Avbryt redigering
                </button>
              </div>
              <form onSubmit={handleSubmitForm} className="space-y-4">
                <div>
                  <label className="block">
                    <span className="block text-sm font-medium mb-2 text-[var(--text)]">Titel</span>
                    <input required value={title} onChange={(e) => setTitle(e.target.value)} className="field" />
                  </label>
                </div>
                <div>
                  <label className="block">
                    <span className="block text-sm font-medium mb-2 text-[var(--text)]">Plats</span>
                    <input value={venue} onChange={(e) => setVenue(e.target.value)} className="field" />
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-[var(--text)]">Showinformation</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={6}
                    className="field"
                    placeholder="Text som visas på biljettsidan, t.ex. om föreställningen, speltid, åldersrekommendation."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block">
                      <span className="block text-sm font-medium mb-2 text-[var(--text)]">Datum &amp; tid</span>
                      <input
                      type="datetime-local"
                      required
                      value={startsAt}
                      onChange={(e) => setStartsAt(e.target.value)}
                      className="field"
                    />
                    </label>
                  </div>
                  <div>
                    <label className="block">
                      <span className="block text-sm font-medium mb-2 text-[var(--text)]">
                      Platsantal
                      {editingEvent && (
                        <span className="font-normal text-[var(--text-muted)]"> ({editingEvent.sold_count} sålda)</span>
                      )}
                    </span>
                      <input
                      type="number"
                      min={0}
                      required
                      value={capacity}
                      onChange={(e) => setCapacity(Number(e.target.value))}
                      className={`field ${capacityTooLow ? 'border-[var(--danger)]' : ''}`}
                    />
                    </label>
                    {capacityTooLow && (
                      <p className="text-[var(--danger)] text-xs mt-1">
                        Kan inte vara lägre än antal sålda biljetter ({editingEvent?.sold_count}).
                      </p>
                    )}
                  </div>
                </div>

                {/* Schemalagt biljettsläpp (ordern 2026-10-03). */}
                <div>
                  <div className="block text-sm font-medium mb-2 text-[var(--text)]" id="grp-release">Släpp biljetter</div>
                  <div className="flex gap-4 mb-3">
                    <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                      <input
                        type="radio"
                        name="edit-release-mode"
                        checked={releaseMode === 'direct'}
                        onChange={() => setReleaseMode('direct')}
                      />
                      Direkt när eventet publiceras
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                      <input
                        type="radio"
                        name="edit-release-mode"
                        checked={releaseMode === 'scheduled'}
                        onChange={() => setReleaseMode('scheduled')}
                      />
                      Vid ett senare tillfälle
                    </label>
                  </div>
                  {releaseMode === 'scheduled' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block">
                          <span className="block text-xs font-medium mb-1 text-[var(--text-muted)]">Datum</span>
                          <input
                          type="date"
                          required
                          value={salesOpenDate}
                          onChange={(e) => setSalesOpenDate(e.target.value)}
                          className="field"
                        />
                        </label>
                      </div>
                      <div>
                        <label className="block">
                          <span className="block text-xs font-medium mb-1 text-[var(--text-muted)]">Tid</span>
                          <input
                          type="time"
                          required
                          value={salesOpenTime}
                          onChange={(e) => setSalesOpenTime(e.target.value)}
                          className="field"
                        />
                        </label>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-[var(--text-muted)] mt-2">
                    Eventet syns på sajten och i inbäddningar före släppet, men går inte att köpa. Redan
                    sålda biljetter påverkas inte.
                  </p>
                </div>

                <p className="text-sm text-[var(--text-muted)]">
                  Pris, moms och platsantal hanteras per biljettyp på eventets egen sida.{' '}
                  <Link to={`/admin/event/${editingEventId}`} className="link-accent">
                    Hantera biljettyper →
                  </Link>
                </p>

                {createError && <p className="text-[var(--danger)] text-sm">{createError}</p>}
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

          {/* Plattformsintäkt (Tilläggsordern 2026-08-07) - Childproof ABs
              EGNA siffror (plattformsavgiften), inte en arrangörs egen
              försäljning. Visas bara för platform-admins - en vanlig
              arrangörs-admin ser den aldrig, och API:t (platform-export-
              revenue) nekar 403 om den ändå anropas direkt. */}
          {isPlatformAdmin && <PlatformRevenueExportSection />}
        </div>
      </div>
    </Layout>
  )
}
