import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { callFunction } from '../lib/functionsApi'
import { supabase } from '../lib/supabaseClient'
import { getActiveOrganizerId, setActiveOrganizerId } from '../lib/organizerContext'
import { APP_NAME } from '../lib/constants'
import { formatStockholmDateTime } from '../lib/stockholmTime'
import type { AdminEventRow } from '../lib/types'

interface OrganizerSummary {
  id: string
  name: string
  slug: string
}

interface ListOrganizersResponse {
  organizers: OrganizerSummary[]
}

interface AdminEventsResponse {
  events: AdminEventRow[]
  organizer_slug: string
}

type Layout8 = 'horizontal' | 'portrait' | 'landscape' | 'button' | 'showtimes' | 'grid' | 'agenda' | 'banner'

const SINGLE_EVENT_LAYOUTS: Layout8[] = ['horizontal', 'portrait', 'landscape', 'button']

const LAYOUTS: { value: Layout8; label: string }[] = [
  { value: 'horizontal', label: 'Horisontell' },
  { value: 'portrait', label: 'Stående' },
  { value: 'landscape', label: 'Liggande' },
  { value: 'button', label: 'Bara en knapp' },
  { value: 'showtimes', label: 'Speltider' },
  { value: 'grid', label: 'Rutnät' },
  { value: 'agenda', label: 'Agenda' },
  { value: 'banner', label: 'Banner' },
]

// "Beskrivning" tas MEDVETET inte med här (ordern 2.4/2.5) - fältet finns
// inte i schemat, och ska inte läggas till bara för att mockuppen nämner
// det i sin etikettlista.
const SHOW_OPTIONS: { value: string; label: string }[] = [
  { value: 'poster', label: 'Affisch' },
  { value: 'date', label: 'Datum och tid' },
  { value: 'place', label: 'Plats' },
  { value: 'price', label: 'Pris från' },
  { value: 'organizer', label: 'Arrangör' },
  { value: 'countdown', label: 'Nedräkning före biljettsläpp' },
]

const ACCENTS: { value: string; label: string; color: string }[] = [
  { value: 'midnatt', label: 'Midnatt', color: '#243B53' },
  { value: 'skymning', label: 'Skymning', color: '#5A3E9B' },
  { value: 'rampljus', label: 'Rampljus', color: '#F6B93B' },
]

// Samma stabila, ohashade sökväg som den verkliga sidan serverar embed.js
// från (public/embed.js, kopierat rakt av till dist-roten av Vite) -
// ALDRIG en hårdkodad adress, så koden/förhandsvisningen automatiskt blir
// rätt oavsett om detta körs lokalt, på GitHub Pages eller en framtida
// egen domän (samma princip som embed.js självt använder för sina
// köplänkar).
function embedScriptUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}embed.js`
}

export function AdminEmbedPage() {
  const navigate = useNavigate()
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [authed, setAuthed] = useState(false)

  const [organizers, setOrganizers] = useState<OrganizerSummary[] | null>(null)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)

  const [events, setEvents] = useState<AdminEventRow[] | null>(null)
  const [organizerSlug, setOrganizerSlug] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([])
  const [useOrganizerMode, setUseOrganizerMode] = useState(false)
  const [layout, setLayout] = useState<Layout8>('grid')
  const [show, setShow] = useState<string[]>(['poster', 'date', 'place', 'price'])
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [accent, setAccent] = useState<string>('midnatt')
  const [title, setTitle] = useState('')
  const [copied, setCopied] = useState(false)

  const previewHostRef = useRef<HTMLDivElement>(null)
  const scriptLoadedRef = useRef(false)

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
        setActiveOrgId(stored && res.organizers.some((o) => o.id === stored) ? stored : null)
      })
      .catch(() => setIsPlatformAdmin(false))
  }, [authed])

  useEffect(() => {
    if (!authed) return
    callFunction<AdminEventsResponse>('admin-events', { auth: true })
      .then((res) => {
        const published = res.events.filter((e) => e.status === 'published')
        setEvents(published)
        setOrganizerSlug(res.organizer_slug)
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Kunde inte hämta events.'))
  }, [authed, activeOrgId])

  function handleSwitchOrganizer(id: string) {
    setActiveOrganizerId(id)
    setActiveOrgId(id)
    window.location.reload()
  }

  function handleLogout() {
    setActiveOrganizerId(null)
    supabase.auth.signOut().then(() => navigate('/admin'))
  }

  const isSingleEventLayout = SINGLE_EVENT_LAYOUTS.indexOf(layout) !== -1

  function handleLayoutChange(next: Layout8) {
    setLayout(next)
    if (SINGLE_EVENT_LAYOUTS.indexOf(next) !== -1 && selectedSlugs.length > 1) {
      setSelectedSlugs(selectedSlugs.slice(0, 1))
    }
  }

  function toggleEvent(slug: string) {
    if (isSingleEventLayout) {
      setSelectedSlugs([slug])
      return
    }
    setSelectedSlugs((prev) => (prev.indexOf(slug) !== -1 ? prev.filter((s) => s !== slug) : [...prev, slug]))
  }

  function toggleShow(value: string) {
    setShow((prev) => (prev.indexOf(value) !== -1 ? prev.filter((s) => s !== value) : [...prev, value]))
  }

  const codeAttributes = useMemo(() => {
    const attrs: string[] = [`data-layout="${layout}"`]
    if (useOrganizerMode && organizerSlug) {
      attrs.push(`data-organizer="${organizerSlug}"`)
    } else {
      attrs.push(`data-events="${selectedSlugs.join(',')}"`)
    }
    attrs.push(`data-show="${show.join(',')}"`)
    attrs.push(`data-theme="${theme}"`)
    if (accent !== 'midnatt') attrs.push(`data-accent="${accent}"`)
    if (layout === 'showtimes' && title.trim()) attrs.push(`data-title="${title.trim()}"`)
    return attrs
  }, [layout, useOrganizerMode, organizerSlug, selectedSlugs, show, theme, accent, title])

  const codeText = useMemo(() => {
    const indented = codeAttributes.map((a) => `  ${a}`).join('\n')
    return `<div class="rideau-widget"\n${indented}></div>\n<script async src="${embedScriptUrl()}"></script>`
  }, [codeAttributes])

  const hasSelection = useOrganizerMode ? Boolean(organizerSlug) : selectedSlugs.length > 0

  // Mountar om förhandsvisningen (samma embed.js som den riktiga
  // widgeten) varje gång attributen ändras - genom att lägga in ETT HELT
  // NYTT .rideau-widget-element (inte återanvända det gamla), fångar
  // embed.js:s MutationObserver upp det automatiskt och monterar det,
  // precis som på en riktig sida. Skriptet självt laddas bara EN gång.
  useEffect(() => {
    const host = previewHostRef.current
    if (!host || !hasSelection) return
    host.textContent = ''
    const widget = document.createElement('div')
    widget.className = 'rideau-widget'
    codeAttributes.forEach((attr) => {
      const match = /^(data-[a-z]+)="([^"]*)"$/.exec(attr)
      if (match) widget.setAttribute(match[1], match[2])
    })
    host.appendChild(widget)

    if (!scriptLoadedRef.current) {
      scriptLoadedRef.current = true
      const script = document.createElement('script')
      script.src = embedScriptUrl()
      script.async = true
      document.body.appendChild(script)
    }
  }, [codeAttributes, hasSelection])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(codeText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback (ordern 2.4: "Clipboard API med fallback") - markera
      // texten i kodrutan så användaren kan kopiera manuellt med Cmd/
      // Ctrl+C, för webbläsare/sammanhang utan Clipboard-API-behörighet.
      const range = document.createRange()
      const codeEl = document.getElementById('rideau-embed-code')
      if (codeEl) {
        range.selectNodeContents(codeEl)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
    }
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
          <Link to="/admin/stripe-installning" className="text-sm link-accent">
            Stripe
          </Link>
          <button onClick={handleLogout} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
            Logga ut
          </button>
        </div>
      </div>
      <h1 className="text-2xl font-bold text-[var(--text)] mb-1">Bädda in biljettwidget</h1>
      <p className="text-sm text-[var(--text-muted)] mb-6">
        Klistra in koden nedan i en Code Block på t.ex. Squarespace. Före släppet visas nedräkningen. Vid släpp byts
        den mot Köp biljetter, utan att du ändrar koden.
      </p>

      {loadError && <p className="text-sm text-red-600 mb-4">{loadError}</p>}
      {!events && !loadError && <p className="text-sm text-[var(--text-muted)]">Laddar…</p>}

      {events && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="flex flex-col gap-6">
            <section className="card">
              <h2 className="font-semibold mb-3">Evenemang</h2>
              {events.length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">Inga publicerade evenemang ännu.</p>
              )}
              <div className="flex flex-col gap-2">
                {events.map((ev) => (
                  <label key={ev.id} className="flex items-center gap-2 text-sm">
                    <input
                      type={isSingleEventLayout ? 'radio' : 'checkbox'}
                      name="rideau-embed-event"
                      checked={selectedSlugs.indexOf(ev.slug) !== -1}
                      disabled={useOrganizerMode}
                      onChange={() => toggleEvent(ev.slug)}
                    />
                    <span>
                      {ev.title}
                      {ev.starts_at && (
                        <span className="text-[var(--text-muted)]"> — {formatStockholmDateTime(ev.starts_at)}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm mt-3 pt-3 border-t border-[var(--border)]">
                <input type="checkbox" checked={useOrganizerMode} onChange={(e) => setUseOrganizerMode(e.target.checked)} />
                <span>Visa alla mina publicerade evenemang automatiskt</span>
              </label>
            </section>

            <section className="card">
              <h2 className="font-semibold mb-3">Layout</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {LAYOUTS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => handleLayoutChange(l.value)}
                    className={layout === l.value ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </section>

            {layout === 'showtimes' && (
              <section className="card">
                <h2 className="font-semibold mb-3">Rubrik (valfri)</h2>
                <input
                  type="text"
                  className="field"
                  placeholder={events[0]?.title ?? 'Rubrik'}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </section>
            )}

            <section className="card">
              <h2 className="font-semibold mb-3">Visa</h2>
              <div className="grid grid-cols-2 gap-2">
                {SHOW_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={show.indexOf(opt.value) !== -1} onChange={() => toggleShow(opt.value)} />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="card">
              <h2 className="font-semibold mb-3">Utseende</h2>
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setTheme('light')}
                  className={theme === 'light' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
                >
                  Ljus
                </button>
                <button
                  type="button"
                  onClick={() => setTheme('dark')}
                  className={theme === 'dark' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
                >
                  Mörk
                </button>
              </div>
              <div className="flex gap-2">
                {ACCENTS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => setAccent(a.value)}
                    className="flex items-center gap-2 text-sm px-3 py-2 rounded-[var(--radius-sm)] border"
                    style={{
                      borderColor: accent === a.value ? a.color : 'var(--border)',
                      borderWidth: accent === a.value ? 2 : 1,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{ width: 16, height: 16, borderRadius: 999, background: a.color, display: 'inline-block' }}
                    />
                    {a.label}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="flex flex-col gap-6">
            <section className="card">
              <h2 className="font-semibold mb-3">Förhandsvisning</h2>
              {!hasSelection && (
                <p className="text-sm text-[var(--text-muted)]">
                  Välj minst ett evenemang (eller kryssa i "Visa alla mina publicerade evenemang automatiskt").
                </p>
              )}
              <div ref={previewHostRef} />
            </section>

            <section className="card">
              <h2 className="font-semibold mb-3">Kod att klistra in</h2>
              <pre
                id="rideau-embed-code"
                className="mono text-xs p-4 rounded-[var(--radius-sm)] overflow-x-auto"
                style={{ background: '#16263A', color: '#E5ECF2' }}
              >
                {codeText}
              </pre>
              <button type="button" onClick={handleCopy} className="btn-primary mt-3" disabled={!hasSelection}>
                {copied ? 'Kopierad' : 'Kopiera kod'}
              </button>
            </section>
          </div>
        </div>
      )}
    </Layout>
  )
}
