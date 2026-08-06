import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { callFunction } from '../lib/functionsApi'
import { supabase } from '../lib/supabaseClient'
import { getActiveOrganizerId, setActiveOrganizerId } from '../lib/organizerContext'
import { APP_NAME } from '../lib/constants'
import { OrganizersSection } from './admin/OrganizersSection'
import { OrganizerMembersSection } from './admin/OrganizerMembersSection'

interface OrganizerSummary {
  id: string
  name: string
  slug: string
}

interface ListOrganizersResponse {
  organizers: OrganizerSummary[]
}

// /admin/organizers - "Arrangörer"-fliken (Tilläggsordern 2026-08-06,
// "Flera användare per arrangör"). Egen flik i huvudnavigeringen, på
// samma nivå som Dashboard - synlig för ALLA inloggade admins, men
// innehållet skiljer sig beroende på vem som tittar:
//
// - Vanlig arrangörs-admin: alltid <OrganizerMembersSection /> (sin egen
//   arrangörs namn/medlemmar/bjud in).
// - Platform-admin UTAN ett workspace valt (ingen X-Organizer-Id):
//   <OrganizersSection /> - arrangörslistan + "Lägg till arrangör",
//   samma innehåll som tidigare låg i en egen sektion på /admin, nu
//   flyttat hit istället för att finnas på två ställen i UI:t.
// - Platform-admin MED ett workspace valt via växlaren: samma
//   <OrganizerMembersSection /> som en vanlig arrangörs-admin ser, för
//   den valda arrangören (härlett server-side från X-Organizer-Id,
//   precis som övriga platform-admin-anrop).
export function AdminOrganizersPage() {
  const navigate = useNavigate()
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [authed, setAuthed] = useState(false)

  const [organizers, setOrganizers] = useState<OrganizerSummary[] | null>(null)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const [orgCheckReady, setOrgCheckReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(Boolean(data.session))
      setCheckingAuth(false)
    })
  }, [])

  // Samma platform-admin-detektion + senast valt workspace som AdminPage
  // - dubblerad här snarare än delad via en gemensam hook, i linje med
  // resten av kodbasens stil (se t.ex. slugify() som är kopierad på
  // liknande sätt mellan backend-funktioner).
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
          <Link to="/admin/stripe-installning" className="text-sm link-accent">
            Stripe
          </Link>
          <button onClick={handleLogout} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
            Logga ut
          </button>
        </div>
      </div>
      <h1 className="text-2xl font-bold text-[var(--text)] mb-6">Arrangörer</h1>

      {!orgCheckReady && <p className="text-[var(--text-muted)] text-sm">Laddar…</p>}
      {orgCheckReady && (isPlatformAdmin && !activeOrgId ? <OrganizersSection /> : <OrganizerMembersSection />)}
    </Layout>
  )
}
