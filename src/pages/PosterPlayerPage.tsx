import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { appUrl, parsePosterQuery } from '../lib/posterUrl'
import { QrCode } from '../components/QrCode'
import { formatStockholmDateTime, formatStockholmDateTimeLocale } from '../lib/stockholmTime'
import { computeSalesState } from '../lib/salesState'
import type { EventRow } from '../lib/types'

type PosterEvent = Pick<
  EventRow,
  'id' | 'slug' | 'title' | 'venue' | 'starts_at' | 'sales_open_at' | 'sold_count' | 'capacity' | 'poster_portrait_url' | 'poster_landscape_url'
>

// Egen anonym klient, utan inloggningssession: skärmen ska se exakt det en
// signage-spelare (utan inloggning) ser, även i förhandsvisningen i admin.
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
)

const REFRESH_MS = 5 * 60 * 1000
// Ett event räknas som "kommande" till 12 timmar efter start, så
// en pågående föreställning inte plockas bort mitt under kvällen.
const GRACE_MS = 12 * 60 * 60 * 1000

// /skylt - spelaren för digital signage. Helskärm, svart bakgrund, ingen
// navigering. Bläddrar mellan affischerna (kors-toning) och hämtar listan
// på nytt var 5:e minut så nya/avpublicerade event uppdateras utan att
// någon rör skärmen. Konfigurationen kommer från URL:en (se posterUrl.ts).
export function PosterPlayerPage() {
  const [searchParams] = useSearchParams()
  const config = useMemo(() => parsePosterQuery(searchParams), [searchParams])
  const [events, setEvents] = useState<PosterEvent[] | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    document.title = 'Rideau - affischer'
    const prev = document.documentElement.style.background
    document.documentElement.style.background = '#000'
    return () => {
      document.documentElement.style.background = prev
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('events')
        .select('id,slug,title,venue,starts_at,sales_open_at,sold_count,capacity,poster_portrait_url,poster_landscape_url')
        .order('starts_at', { ascending: true })
      // Vid nätverksfel behålls senaste listan - skärmen ska aldrig bli tom för ett hickup.
      if (cancelled || error) return
      setEvents(data as PosterEvent[])
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const slides = useMemo(() => {
    if (!events) return []
    const cutoff = Date.now() - GRACE_MS
    const seen = new Set<string>()
    const out: { id: string; src: string; title: string; venue: string | null; when: string; link: string; releaseAt: string | null }[] = []
    const perShow = new Map<string, PosterEvent[]>()
    for (const e of events) perShow.set(`${e.title}|${e.venue ?? ''}`, [...(perShow.get(`${e.title}|${e.venue ?? ''}`) ?? []), e])
    for (const e of events) {
      if (!e.starts_at || new Date(e.starts_at).getTime() < cutoff) continue
      if (config.eventIds && !config.eventIds.includes(e.id)) continue
      const preferred = config.orientation === 'portrait' ? e.poster_portrait_url : e.poster_landscape_url
      const other = config.orientation === 'portrait' ? e.poster_landscape_url : e.poster_portrait_url
      const src = preferred ?? other
      if (!src) continue
      // Samma föreställning på flera speltider = samma affisch: visa den en gång.
      const key = `${e.title}|${e.venue ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: e.id,
        src,
        title: e.title,
        venue: e.venue,
        when: formatStockholmDateTimeLocale(e.starts_at, { day: 'numeric', month: 'long' }),
        // En speltid: direkt till köpsidan. Flera speltider: eventlistan, där alla tider syns.
        // Satt när HELA föreställningen ännu inte släppts (alla speltider väntar på släpp).
        releaseAt: (() => {
          const group = perShow.get(key) ?? [e]
          const upcoming = group.every(
            (g) => computeSalesState({ salesOpenAt: g.sales_open_at, soldCount: g.sold_count, capacity: g.capacity }) === 'upcoming',
          )
          return upcoming ? (group.map((g) => g.sales_open_at).filter((x): x is string => Boolean(x)).sort()[0] ?? null) : null
        })(),
        link: (perShow.get(key)?.length ?? 1) === 1 ? appUrl(`/kop/${e.slug}`) : appUrl('/evenemang'),
      })
    }
    return out
  }, [events, config])

  useEffect(() => {
    if (slides.length < 2) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), config.seconds * 1000)
    return () => clearInterval(timer)
  }, [slides.length, config.seconds])

  const active = slides.length > 0 ? index % slides.length : 0

  const logo = `${import.meta.env.BASE_URL}rideau-logo-inverse.svg`

  return (
    <div className={`signage ${config.showFrame ? 'is-framed' : ''}`} role="img" aria-label="Affischer">
      {slides.map((slide, i) => (
        <div
          key={slide.id}
          className={`signage-slide ${i === active ? 'is-active' : ''} ${config.showFrame ? `framed ${config.orientation}` : ''}`}
          aria-hidden={i !== active}
        >
          <div className="signage-poster">
            <img src={slide.src} alt={slide.title} />
          </div>
          {config.showFrame && (
            <aside className="signage-panel">
              <img className="signage-logo" src={logo} alt="Rideau" />
              <div className="signage-panel-mid">
                {config.showRelease && slide.releaseAt && (
                  <div className="signage-release">Biljetterna släpps {formatStockholmDateTime(slide.releaseAt)}</div>
                )}
                {config.showInfo && (
                  <div className="signage-info">
                    <strong>{slide.title}</strong>
                    <span>{[slide.when, slide.venue].filter(Boolean).join(' · ')}</span>
                  </div>
                )}
              </div>
              {config.showQr && (
                <div className="signage-qr">
                  <span>{slide.releaseAt ? 'Skanna för mer info' : 'Skanna och köp biljett'}</span>
                  <QrCode value={slide.link} label={`QR-kod: biljettinformation för ${slide.title}`} />
                </div>
              )}
            </aside>
          )}
        </div>
      ))}
      {events !== null && slides.length === 0 && <p className="signage-empty">Inga affischer att visa just nu.</p>}
    </div>
  )
}
