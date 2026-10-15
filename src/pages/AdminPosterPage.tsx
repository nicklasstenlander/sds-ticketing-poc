import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { AdminNav } from '../components/AdminNav'
import { callFunction } from '../lib/functionsApi'
import { supabase } from '../lib/supabaseClient'
import { setActiveOrganizerId } from '../lib/organizerContext'
import { formatStockholmDateTimeLocale } from '../lib/stockholmTime'
import {
  DEFAULT_POSTER_CONFIG,
  POSTER_SECONDS_OPTIONS,
  posterPlayerUrl,
  type PosterConfig,
  type PosterOrientation,
} from '../lib/posterUrl'
import type { AdminEventRow } from '../lib/types'

interface Show {
  key: string
  title: string
  venue: string | null
  eventIds: string[]
  firstStart: string | null
  portrait: string | null
  landscape: string | null
}

// Samma föreställning på flera speltider = en rad (en affisch).
function groupShows(events: AdminEventRow[]): Show[] {
  const groups = new Map<string, Show>()
  for (const e of events) {
    const key = `${e.title}|${e.venue ?? ''}`
    const g = groups.get(key)
    if (g) {
      g.eventIds.push(e.id)
      g.portrait ??= e.poster_portrait_url
      g.landscape ??= e.poster_landscape_url
    } else {
      groups.set(key, {
        key,
        title: e.title,
        venue: e.venue,
        eventIds: [e.id],
        firstStart: e.starts_at,
        portrait: e.poster_portrait_url,
        landscape: e.poster_landscape_url,
      })
    }
  }
  return [...groups.values()]
}

// /admin/affischer - skapar en publik URL till affischspelaren (/skylt)
// för digital signage. Allt som väljs här kodas in i URL:en; inget sparas
// i databasen, så en URL fungerar för alltid och "alla kommande" uppdateras
// av sig själv.
export function AdminPosterPage() {
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [events, setEvents] = useState<AdminEventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<PosterConfig>(DEFAULT_POSTER_CONFIG)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(Boolean(data.session))
      setCheckingAuth(false)
    })
  }, [])

  useEffect(() => {
    if (!authed) return
    callFunction<{ events: AdminEventRow[] }>('admin-events', { auth: true })
      .then((res) => setEvents(res.events))
      .catch((err) => setError(err instanceof Error ? err.message : 'Vi kunde inte hämta eventen. Försök igen.'))
  }, [authed])

  const shows = useMemo(() => {
    const now = Date.now() - 12 * 60 * 60 * 1000
    return groupShows(
      (events ?? []).filter(
        (e) => e.status === 'published' && !e.archived_at && e.starts_at && new Date(e.starts_at).getTime() >= now,
      ),
    )
  }, [events])

  const useAll = config.eventIds === null
  const effectiveConfig: PosterConfig = useMemo(
    () => (useAll ? config : { ...config, eventIds: shows.filter((s) => picked.has(s.key)).flatMap((s) => s.eventIds) }),
    [config, useAll, shows, picked],
  )
  const emptySelection = !useAll && effectiveConfig.eventIds?.length === 0
  const url = posterPlayerUrl(effectiveConfig)

  function setOrientation(orientation: PosterOrientation) {
    setConfig((c) => ({ ...c, orientation }))
  }

  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      document.getElementById('poster-url')?.focus()
      ;(document.getElementById('poster-url') as HTMLInputElement | null)?.select()
    }
  }

  function handleLogout() {
    setActiveOrganizerId(null)
    supabase.auth.signOut().then(() => setAuthed(false))
  }

  if (checkingAuth) return null
  if (!authed) return <Navigate to="/admin" replace />

  const missing = (s: Show) => (config.orientation === 'portrait' ? !s.portrait : !s.landscape)

  return (
    <Layout wide>
      <AdminNav
        actions={
          <button onClick={handleLogout} className="admin-logout">
            Logga ut
          </button>
        }
      />
      <h1 className="page-title mb-2">Affisch-URL</h1>
      <p className="page-lede mb-8">
        Välj vilka affischer som ska visas och få en länk till digital signage. Länken bläddrar mellan affischerna
        och hämtar nya var 5:e minut.
      </p>

      {error && <p role="alert" className="text-[var(--danger)] mb-4">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <div className="space-y-6">
          <section className="card">
            <h2 className="text-lg font-extrabold mb-3">Format</h2>
            <div className="flex gap-3" role="radiogroup" aria-label="Skärmens orientering">
              {(
                [
                  ['landscape', 'Liggande'],
                  ['portrait', 'Stående'],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={`poster-option ${config.orientation === value ? 'is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="orientation"
                    className="sr-only"
                    checked={config.orientation === value}
                    onChange={() => setOrientation(value)}
                  />
                  <span className={`poster-option-shape ${value}`} aria-hidden="true" />
                  {label}
                </label>
              ))}
            </div>
          </section>

          <section className="card">
            <h2 className="text-lg font-extrabold mb-3">Vad ska visas?</h2>
            <label className="flex items-start gap-3 mb-2">
              <input
                type="radio"
                name="mode"
                className="mt-1"
                checked={useAll}
                onChange={() => setConfig((c) => ({ ...c, eventIds: null }))}
              />
              <span>
                <span className="font-semibold">Alla kommande föreställningar</span>
                <span className="block text-sm text-[var(--text-muted)]">
                  Nya föreställningar dyker upp av sig själva, avslutade försvinner.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 mb-4">
              <input
                type="radio"
                name="mode"
                className="mt-1"
                checked={!useAll}
                onChange={() => setConfig((c) => ({ ...c, eventIds: [] }))}
              />
              <span className="font-semibold">Välj själv</span>
            </label>

            {!useAll && (
              <ul className="space-y-2">
                {events === null && !error && <li className="text-[var(--text-muted)]">Hämtar föreställningar…</li>}
                {events !== null && shows.length === 0 && (
                  <li className="text-[var(--text-muted)]">Det finns inga kommande publicerade föreställningar.</li>
                )}
                {shows.map((s) => {
                  const thumb = (config.orientation === 'portrait' ? s.portrait : s.landscape) ?? s.portrait ?? s.landscape
                  return (
                    <li key={s.key}>
                      <label className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
                        <input type="checkbox" checked={picked.has(s.key)} onChange={() => toggle(s.key)} />
                        {thumb ? (
                          <img src={thumb} alt="" className="w-16 h-10 object-contain bg-white rounded" />
                        ) : (
                          <span className="w-16 h-10 rounded bg-[var(--accent-soft)]" aria-hidden="true" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold truncate">{s.title}</span>
                          <span className="block text-sm text-[var(--text-muted)]">
                            {s.firstStart
                              ? formatStockholmDateTimeLocale(s.firstStart, { day: 'numeric', month: 'short' })
                              : ''}
                            {s.eventIds.length > 1 ? ` · ${s.eventIds.length} speltider` : ''}
                            {missing(s) && (thumb ? ' · saknar vald orientering, visar den andra' : ' · saknar affisch')}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="card">
            <h2 className="text-lg font-extrabold mb-3">Visning</h2>
            <label className="block mb-4">
              <span className="block text-sm font-semibold mb-2">Visningstid per affisch</span>
              <select
                className="field field-sm"
                value={config.seconds}
                onChange={(e) => setConfig((c) => ({ ...c, seconds: Number(e.target.value) }))}
              >
                {POSTER_SECONDS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s} sekunder
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={config.showInfo}
                onChange={(e) => setConfig((c) => ({ ...c, showInfo: e.target.checked }))}
              />
              <span>Visa titel, datum och plats under affischen</span>
            </label>
          </section>
        </div>

        <div className="space-y-6 lg:sticky lg:top-4">
          <section className="card">
            <h2 className="text-lg font-extrabold mb-3">Din URL</h2>
            {emptySelection ? (
              <p className="text-[var(--text-muted)]">Välj minst en föreställning för att få en URL.</p>
            ) : (
              <>
                <input id="poster-url" readOnly value={url} className="field mb-3" onFocus={(e) => e.currentTarget.select()} />
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={copy} className="btn-primary">
                    {copied ? 'Kopierad' : 'Kopiera URL'}
                  </button>
                  <a href={url} target="_blank" rel="noreferrer" className="btn-secondary">
                    Öppna i ny flik
                  </a>
                </div>
                <p className="text-sm text-[var(--text-muted)] mt-3">
                  Klistra in URL:en som webbadress i din signage-spelare. Länken är publik och visar bara publicerade
                  föreställningar.
                </p>
              </>
            )}
          </section>

          {!emptySelection && (
            <section>
              <h2 className="text-lg font-extrabold mb-3">Förhandsvisning</h2>
              <div
                className={`poster-preview ${config.orientation}`}
                style={{ aspectRatio: config.orientation === 'portrait' ? '9 / 16' : '16 / 9' }}
              >
                <iframe key={url} src={url} title="Förhandsvisning av affischspelaren" />
              </div>
            </section>
          )}
        </div>
      </div>
    </Layout>
  )
}
