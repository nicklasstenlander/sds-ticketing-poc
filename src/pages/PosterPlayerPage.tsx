import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { parsePosterQuery } from '../lib/posterUrl'
import { formatStockholmDateTimeLocale } from '../lib/stockholmTime'
import type { EventRow } from '../lib/types'

type PosterEvent = Pick<
  EventRow,
  'id' | 'title' | 'venue' | 'starts_at' | 'poster_portrait_url' | 'poster_landscape_url'
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
        .select('id,title,venue,starts_at,poster_portrait_url,poster_landscape_url')
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
    const out: { id: string; src: string; title: string; venue: string | null; when: string }[] = []
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

  return (
    <div className="signage" role="img" aria-label="Affischer">
      {slides.map((slide, i) => (
        <div key={slide.id} className={`signage-slide ${i === active ? 'is-active' : ''}`} aria-hidden={i !== active}>
          <img src={slide.src} alt={slide.title} />
          {config.showInfo && (
            <div className="signage-info">
              <strong>{slide.title}</strong>
              <span>{[slide.when, slide.venue].filter(Boolean).join(' · ')}</span>
            </div>
          )}
        </div>
      ))}
      {events !== null && slides.length === 0 && <p className="signage-empty">Inga affischer att visa just nu.</p>}
    </div>
  )
}
