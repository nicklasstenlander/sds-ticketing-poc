import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { callFunction } from '../lib/functionsApi'
import { supabase } from '../lib/supabaseClient'
import { getActiveOrganizerId, setActiveOrganizerId } from '../lib/organizerContext'
import { APP_NAME } from '../lib/constants'

interface OrganizerSummary {
  id: string
  name: string
  slug: string
}

interface ListOrganizersResponse {
  organizers: OrganizerSummary[]
}

interface StripeStatusResponse {
  stripe_account_id: string | null
  stripe_onboarding_complete: boolean
}

interface ConnectStripeResponse {
  url: string
}

// /admin/stripe-installning (Tilläggsordern 2026-08-06, "Stripe Connect -
// eget underkonto per arrangör"). Samma platform-admin-detektion + valt
// workspace-mönster som AdminOrganizersPage.tsx - dubblerad snarare än
// delad via en gemensam hook, i linje med resten av kodbasens stil.
//
// En platform-admin UTAN ett valt workspace har ingen EN arrangör att visa
// Stripe-status för (X-Organizer-Id skickas inte, resolveOrganizer()
// skulle returnera null) - vi visar därför en förklarande text och länkar
// till "Arrangörer"-fliken för att välja workspace, istället för att
// anropa admin-connect-stripe i onåbart läge.
export function AdminStripeSettingsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [authed, setAuthed] = useState(false)

  const [organizers, setOrganizers] = useState<OrganizerSummary[] | null>(null)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const [orgCheckReady, setOrgCheckReady] = useState(false)

  const [status, setStatus] = useState<StripeStatusResponse | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(Boolean(data.session))
      setCheckingAuth(false)
    })
  }, [])

  useEffect(() => {
    if (!authed) return
    callFunction<ListOrganizersResponse>('admin-list-organizers', { auth: true })
      .then((res) => {
        setIsPlatformAdmin(true)
        setOrganizers(res.organizers)
        const stored = getActiveOrganizerId()
        const valid = stored && res.organizers.some((o) => o.id === stored) ? stored : null
        setActiveOrgId(valid)
      })
      .catch(() => {
        setIsPlatformAdmin(false)
      })
      .finally(() => setOrgCheckReady(true))
  }, [authed])

  const hasSelectableOrganizer = !isPlatformAdmin || Boolean(activeOrgId)

  async function loadStatus() {
    setStatusError(null)
    try {
      const res = await callFunction<StripeStatusResponse>('admin-connect-stripe', { auth: true, method: 'GET' })
      setStatus(res)
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Kunde inte hämta Stripe-status.')
    }
  }

  useEffect(() => {
    if (!orgCheckReady || !hasSelectableOrganizer) return
    loadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgCheckReady, hasSelectableOrganizer])

  // Efter en avslutad (eller avbruten) Stripe-onboardingrunda skickar
  // Stripe tillbaka besökaren till return_url (?klar=1, se
  // admin-connect-stripe). account.updated-webhooken kan hinna släpa
  // efter en liten stund innan stripe_onboarding_complete faktiskt är
  // satt i databasen - vi hämtar bara om statusen en gång till här, en
  // manuell "Uppdatera"-knapp hade varit överdrivet för denna PoC.
  useEffect(() => {
    if (searchParams.get('klar') === '1' && orgCheckReady && hasSelectableOrganizer) {
      loadStatus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgCheckReady, hasSelectableOrganizer])

  async function handleConnect() {
    setConnecting(true)
    setConnectError(null)
    try {
      const res = await callFunction<ConnectStripeResponse>('admin-connect-stripe', {
        auth: true,
        method: 'POST',
      })
      window.location.href = res.url
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Kunde inte starta Stripe-anslutningen.')
      setConnecting(false)
    }
  }

  function handleSwitchOrganizer(id: string) {
    setActiveOrganizerId(id)
    setActiveOrgId(id)
    window.location.reload()
  }

  function handleLogout() {
    setActiveOrganizerId(null)
    supabase.auth.signOut().then(() => navigate('/admin'))
  }

  if (checkingAuth) return null
  if (!authed) return <Navigate to="/admin" replace />

  return (
    <Layout wide>
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
              <option value="">Alla arrangörer</option>
              {organizers.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )}
          <Link to="/admin" className="text-sm link-accent">
            Events
          </Link>
          <Link to="/admin/dashboard" className="text-sm link-accent">
            Dashboard
          </Link>
          <Link to="/admin/organizers" className="text-sm link-accent">
            Arrangörer
          </Link>
          <button onClick={handleLogout} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
            Logga ut
          </button>
        </div>
      </div>
      <h1 className="text-2xl font-bold text-[var(--text)] mb-6">Stripe-inställningar</h1>

      {!orgCheckReady && <p className="text-[var(--text-muted)] text-sm">Laddar…</p>}

      {orgCheckReady && !hasSelectableOrganizer && (
        <section className="card">
          <p className="text-[var(--text)] mb-3">
            Välj ett workspace för att se och hantera dess Stripe-anslutning.
          </p>
          <Link to="/admin/organizers" className="link-accent text-sm">
            Gå till Arrangörer →
          </Link>
        </section>
      )}

      {orgCheckReady && hasSelectableOrganizer && (
        <section className="card max-w-xl">
          {statusError && <p className="text-red-600 text-sm mb-3">{statusError}</p>}

          {status === null && !statusError && <p className="text-[var(--text-muted)] text-sm">Laddar status…</p>}

          {status !== null && status.stripe_onboarding_complete && (
            <div>
              <p className="text-green-700 font-medium mb-1">Anslutet ✓</p>
              <p className="text-[var(--text-muted)] text-sm">
                Kontot tar emot betalningar. Ingen ytterligare åtgärd behövs.
              </p>
            </div>
          )}

          {status !== null && !status.stripe_onboarding_complete && (
            <div>
              <p className="text-[var(--text)] mb-4">
                {status.stripe_account_id
                  ? 'Stripe-anslutningen är påbörjad men inte slutförd. Fortsätt onboardingen för att kunna publicera betalda event.'
                  : 'Anslut ett eget Stripe-konto för att kunna publicera betalda event. Pengar för era köp går direkt dit, vår avgift dras automatiskt.'}
              </p>
              <button type="button" onClick={handleConnect} disabled={connecting} className="btn-primary">
                {connecting ? 'Öppnar Stripe…' : 'Anslut Stripe-konto'}
              </button>
              {connectError && <p className="text-red-600 text-sm mt-3">{connectError}</p>}
            </div>
          )}
        </section>
      )}
    </Layout>
  )
}
