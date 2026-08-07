import { useEffect, useState } from 'react'
import { callFunction } from '../../lib/functionsApi'

interface ApplicationBase {
  id: string
  organizer_name: string
  contact_email: string
  message: string | null
  created_at: string
}

interface PendingApplication extends ApplicationBase {}

interface ReviewedApplication extends ApplicationBase {
  status: 'approved' | 'rejected'
  reviewed_at: string | null
}

interface ListApplicationsResponse {
  pending: PendingApplication[]
  reviewed: ReviewedApplication[]
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })
}

// "Väntande ansökningar" + hopfällbar "Tidigare ansökningar" (Tilläggs-
// ordern 2026-08-06/07, "Ansökningsformulär för nya arrangörer"). Renderas
// i samma gren av AdminOrganizersPage som redan visar <OrganizersSection />
// - platform-admin utan valt workspace - direkt ovanför den, eftersom
// "Godkänn" på en ansökan resulterar i precis den typen av rad som
// OrganizersSection redan listar (organizer-skapandet delas via
// _shared/createOrganizer.ts, se den filens kommentar).
export function ApplicationsSection() {
  const [pending, setPending] = useState<PendingApplication[] | null>(null)
  const [reviewed, setReviewed] = useState<ReviewedApplication[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const [actingId, setActingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  async function load() {
    try {
      const res = await callFunction<ListApplicationsResponse>('admin-list-applications', { auth: true })
      setPending(res.pending)
      setReviewed(res.reviewed)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Kunde inte hämta ansökningar.')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleApprove(application: PendingApplication) {
    if (!window.confirm(`Godkänn ansökan från ${application.organizer_name}? En inbjudan skickas direkt till ${application.contact_email}.`)) {
      return
    }
    setActingId(application.id)
    setActionError(null)
    setConfirmation(null)
    try {
      await callFunction('admin-approve-application', {
        auth: true,
        method: 'POST',
        body: { application_id: application.id },
      })
      setConfirmation(`${application.organizer_name} godkänd - inbjudan skickad till ${application.contact_email}.`)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Kunde inte godkänna ansökan.')
      await load()
    } finally {
      setActingId(null)
    }
  }

  async function handleReject(application: PendingApplication) {
    if (!window.confirm(`Avslå ansökan från ${application.organizer_name}? Inget mail skickas till den sökande.`)) {
      return
    }
    setActingId(application.id)
    setActionError(null)
    setConfirmation(null)
    try {
      await callFunction('admin-reject-application', {
        auth: true,
        method: 'POST',
        body: { application_id: application.id },
      })
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Kunde inte avslå ansökan.')
    } finally {
      setActingId(null)
    }
  }

  if (loadError) return <p className="text-red-600 text-sm mb-4">{loadError}</p>
  if (pending === null) return <p className="text-[var(--text-muted)] text-sm mb-4">Laddar ansökningar…</p>

  return (
    <div className="space-y-4 mb-6">
      {confirmation && <p className="text-green-700 text-sm">{confirmation}</p>}
      {actionError && <p className="text-red-600 text-sm">{actionError}</p>}

      {pending.length > 0 && (
        <section className="card">
          <h2 className="font-semibold mb-4 text-[var(--text)]">Väntande ansökningar</h2>
          <ul className="space-y-4">
            {pending.map((application) => (
              <li key={application.id} className="pb-4 border-b border-[var(--border)] last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[var(--text)] font-medium">{application.organizer_name}</div>
                    <div className="text-[var(--text-muted)] text-xs">
                      {application.contact_email} · {formatDate(application.created_at)}
                    </div>
                    {application.message && (
                      <p className="text-sm text-[var(--text)] mt-2 whitespace-pre-wrap">{application.message}</p>
                    )}
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleApprove(application)}
                      disabled={actingId === application.id}
                      className="btn-primary text-sm"
                    >
                      {actingId === application.id ? 'Arbetar…' : 'Godkänn'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(application)}
                      disabled={actingId === application.id}
                      className="text-red-600 hover:text-red-800 underline text-sm disabled:opacity-40"
                    >
                      Avslå
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reviewed !== null && reviewed.length > 0 && (
        <section className="card">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-sm link-accent"
          >
            {showHistory ? 'Dölj tidigare ansökningar' : `Tidigare ansökningar (${reviewed.length}) →`}
          </button>
          {showHistory && (
            <ul className="space-y-2 mt-4">
              {reviewed.map((application) => (
                <li key={application.id} className="flex items-center justify-between text-sm py-1 gap-3">
                  <div className="min-w-0">
                    <div className="text-[var(--text)] font-medium">{application.organizer_name}</div>
                    <div className="text-[var(--text-muted)] text-xs truncate">
                      {application.contact_email}
                      {application.reviewed_at ? ` · ${formatDate(application.reviewed_at)}` : ''}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${
                      application.status === 'approved'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {application.status === 'approved' ? 'Godkänd' : 'Avslagen'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
