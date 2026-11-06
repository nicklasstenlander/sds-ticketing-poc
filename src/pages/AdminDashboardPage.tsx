import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { AdminNav } from '../components/AdminNav'
import { callFunction } from '../lib/functionsApi'
import { supabase } from '../lib/supabaseClient'
import type { AdminEventRow } from '../lib/types'
import { formatStockholmDateTimeLocale } from '../lib/stockholmTime'
import { RecentOrdersSection } from './admin/RecentOrdersSection'
import { EventBuyersPanel } from './admin/EventBuyersPanel'

interface AdminEventsResponse {
  events: AdminEventRow[]
}

// /admin/dashboard - enligt Tilläggsordern "ScenPass-designmockupen"
// avsnitt 5: bygger BARA det som går att räkna ut med redan hämtad
// admin-events-data (sålt/kapacitet per event, totalt sålda biljetter).
// Mockupens "sålt denna vecka", "beläggning i snitt" och "+18% sedan
// igår" kräver ny backend-aggregering (tidsfönster på orders.paid_at,
// respektive en historisk snapshot att jämföra mot) som inte är beställd
// i denna order - se README för var det flaggas.
//
// Tillägg: föreställningskorten är kompakta (två kolumner) och klickbara -
// öppnar köparlistan med utskrift/PDF och CSV (EventBuyersPanel). Under
// korten: "Senaste ordrar" (RecentOrdersSection, admin-recent-orders),
// som uppdateras live vid varje ny försäljning.
export function AdminDashboardPage() {
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [events, setEvents] = useState<AdminEventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(Boolean(data.session))
      setCheckingAuth(false)
    })
  }, [])

  const [buyersFor, setBuyersFor] = useState<AdminEventRow | null>(null)

  const loadEvents = useCallback(() => {
    callFunction<AdminEventsResponse>('admin-events', { auth: true })
      .then((res) => setEvents(res.events))
      .catch((err) => setError(err instanceof Error ? err.message : 'Kunde inte hämta events.'))
  }, [])

  useEffect(() => {
    if (!authed) return
    loadEvents()
  }, [authed, loadEvents])

  if (checkingAuth) return null
  if (!authed) return <Navigate to="/admin" replace />

  // Bara publicerade speltider på översikten (designöversynen 2026-11) -
  // utkast har inga köpare än och visades förut som tomma 0%-kort. De
  // räknas i stället och länkas till Föreställningar.
  const publishedEvents = (events ?? []).filter((e) => e.status === 'published')
  const draftCount = (events ?? []).filter((e) => e.status === 'draft' && !e.archived_at).length
  const totalSold = publishedEvents.reduce((sum, e) => sum + e.sold_count, 0)
  // Samma tre nyckeltal-kort som Events-sidan (AdminPage.tsx), räknade ur
  // samma admin-events-data - ingen ny backend-aggregering.
  const now = Date.now()
  const upcomingCount = publishedEvents.filter(
    (e) => e.starts_at && new Date(e.starts_at).getTime() > now,
  ).length
  const withCapacity = publishedEvents.filter((e) => e.capacity > 0)
  const avgOccupancy =
    withCapacity.length === 0
      ? '–'
      : `${Math.round((withCapacity.reduce((sum, e) => sum + e.sold_count / e.capacity, 0) / withCapacity.length) * 100)}%`
  const showKpis = events !== null && publishedEvents.length > 0

  return (
    <Layout
      wide
      bandOverhang={showKpis}
      band={
        <>
          <AdminNav />
          <h1 className="page-title mb-2">Översikt</h1>
          <p className={`page-lede ${showKpis ? '' : 'mb-8'}`}>Överblick över dina föreställningar.</p>
          {showKpis && (
            <div className="admin-kpis">
              <div className="stat-card">
                <div className="stat-label">Sålda biljetter totalt</div>
                <div className="stat-value">{totalSold}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Kommande föreställningar</div>
                <div className="stat-value">{upcomingCount}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Snittbeläggning</div>
                <div className="stat-value">{avgOccupancy}</div>
              </div>
            </div>
          )}
        </>
      }
    >

      {error && <p className="text-[var(--danger)] mb-6">{error}</p>}

      {events === null && !error && <p className="text-[var(--text-muted)]">Laddar…</p>}
      {events !== null && publishedEvents.length === 0 && (
        <p className="text-[var(--text-muted)] mb-8">Inga publicerade föreställningar ännu.</p>
      )}

      {/* Kompakta föreställningskort, två kolumner. Klick öppnar köparlistan
          (med utskrift/PDF och CSV-export), se EventBuyersPanel. */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${draftCount > 0 ? 'mb-4' : 'mb-10'}`}>
        {publishedEvents.map((event) => {
          const pct = event.capacity > 0 ? Math.round((event.sold_count / event.capacity) * 100) : 0
          return (
            <button
              key={event.id}
              type="button"
              onClick={() => setBuyersFor(event)}
              className="card dash-event-card text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              style={{ padding: '12px 16px' }}
              title="Visa alla som köpt biljett"
            >
              <div className="flex justify-between items-baseline gap-3 mb-2">
                <div className="font-extrabold text-sm text-[var(--text)] line-clamp-1">{event.title}</div>
                <div className="font-extrabold text-sm tabular-nums shrink-0" style={{ color: 'var(--accent)' }}>
                  {pct}%
                </div>
              </div>
              <div className="progress-track mb-1.5" style={{ height: 6 }}>
                <div className="progress-fill" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <div className="text-[var(--text-muted)] text-xs flex justify-between gap-2">
                <span className="truncate">
                  {event.sold_count} / {event.capacity} sålda
                  {event.starts_at
                    ? // steg 1b: explicit Europe/Stockholm, inte webbläsarens egen
                      // tidszon (se stockholmTime.ts).
                      ` · ${formatStockholmDateTimeLocale(event.starts_at, { dateStyle: 'medium', timeStyle: 'short' })}`
                    : ''}
                </span>
                <span className="dash-event-cta shrink-0 font-semibold text-[var(--accent)]">
                  Köpare <span aria-hidden="true">→</span>
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {draftCount > 0 && (
        <p className="text-sm text-[var(--text-muted)] mb-10">
          {draftCount === 1 ? '1 utkast' : `${draftCount} utkast`} visas inte här ·{' '}
          <Link to="/admin" className="link-accent">
            Visa i Föreställningar →
          </Link>
        </p>
      )}

      {/* Ny försäljning (realtidsping) räknar även om korten ovan. */}
      <RecentOrdersSection onNewSale={loadEvents} />

      <EventBuyersPanel event={buyersFor} onClose={() => setBuyersFor(null)} />
    </Layout>
  )
}
