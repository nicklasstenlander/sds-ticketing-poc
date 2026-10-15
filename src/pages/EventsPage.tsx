import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { EventOrganizerRelation, EventRow, TicketTypeRow } from '../lib/types'
import { Layout } from '../components/Layout'
import { computeCountdown, computeSalesState } from '../lib/salesState'
import { formatStockholmDateTime, formatStockholmDateTimeLocale } from '../lib/stockholmTime'
import { formatKr } from '../lib/formatPrice'
import { monogram } from '../lib/monogram'
import { posterVars } from '../lib/posterVars'

interface EventWithTicketTypes extends EventRow {
  ticket_types: TicketTypeRow[]
  organizers: EventOrganizerRelation | EventOrganizerRelation[] | null
}

function organizerOf(e: EventWithTicketTypes): EventOrganizerRelation | undefined {
  return Array.isArray(e.organizers) ? e.organizers[0] : (e.organizers ?? undefined)
}

// En föreställning (samma titel/plats) visas som EN affischruta med en
// knapp per speltid - varje speltid är fortfarande ett eget event med eget
// pris, eget säljläge och egen köplänk.
function groupShows(events: EventWithTicketTypes[]): EventWithTicketTypes[][] {
  const groups = new Map<string, EventWithTicketTypes[]>()
  for (const e of events) {
    const key = [e.title, e.venue ?? ''].join('|')
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  return [...groups.values()]
}

// Prisspann över ALLA biljettyper, gratis inkluderat (Nicklas 2026-10-10).
function priceLabel(shows: EventWithTicketTypes[]): string {
  const prices = shows.flatMap((e) => (e.ticket_types ?? []).map((t) => t.price_ore))
  if (prices.length === 0) return ''
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  if (min === max) return min === 0 ? 'Gratis' : `${formatKr(min)} kr`
  return `${formatKr(min)}–${formatKr(max)} kr`
}

const stockholm = (iso: string, o: Intl.DateTimeFormatOptions) => formatStockholmDateTimeLocale(iso, o)

// "5–6 dec" / "5 dec" / "30 nov–2 dec" - datumet är det första en besökare söker.
function dateRange(shows: EventWithTicketTypes[]): string {
  const dated = shows.filter((e) => e.starts_at).map((e) => e.starts_at as string)
  if (dated.length === 0) return ''
  const first = dated[0]
  const last = dated[dated.length - 1]
  const day = (iso: string) => stockholm(iso, { day: 'numeric' })
  const month = (iso: string) => stockholm(iso, { month: 'short' }).replace('.', '')
  if (day(first) === day(last) && month(first) === month(last)) return `${day(first)} ${month(first)}`
  if (month(first) === month(last)) return `${day(first)}–${day(last)} ${month(last)}`
  return `${day(first)} ${month(first)}–${day(last)} ${month(last)}`
}

function posterUrls(shows: EventWithTicketTypes[]) {
  return {
    landscape: shows.find((e) => e.poster_landscape_url)?.poster_landscape_url ?? null,
    portrait: shows.find((e) => e.poster_portrait_url)?.poster_portrait_url ?? null,
  }
}

// "Around the World" -> "AW". Används när ingen affisch finns, så ytan inte
// upprepar titeln som redan står bredvid.
// Affischen är ett slutet objekt: arrangören styr inte hur den ser ut, så den
// visas alltid HEL (aldrig beskuren) i en ram med fast format. En kraftigt
// suddad kopia fyller ytan bakom, och en hårfin kant skiljer den från sidan -
// då fungerar ljusa, mörka, mättade och felformaterade affischer lika bra.
// Hero: liggande på smal skärm, stående på bred (om båda finns). Ruta i
// "Fler föreställningar": stående först.
function Poster({ shows, variant }: { shows: EventWithTicketTypes[]; variant: 'hero' | 'tile' }) {
  const first = shows[0]
  const { landscape, portrait } = posterUrls(shows)
  // Hela klassnamn, inte ihopsatta av variant: Tailwind rensar annars bort
  // klasserna ur CSS:en eftersom den inte hittar dem som strängar i koden.
  const frameClass = variant === 'hero' ? 'poster-frame-hero' : 'poster-frame-tile'
  if (landscape || portrait) {
    const alt = `Affisch: ${first.title}`
    return (
      <div className={`poster poster-frame ${frameClass}`} style={posterVars(landscape, portrait)}>
        {variant === 'hero' ? (
          <picture>
            {landscape && portrait && <source media="(min-width: 900px)" srcSet={portrait} />}
            <img src={landscape ?? portrait ?? ''} alt={alt} />
          </picture>
        ) : (
          <img src={portrait ?? landscape ?? ''} alt={alt} loading="lazy" />
        )}
      </div>
    )
  }
  // Ingen affisch uppladdad: en yta i varumärkets färger med monogram, så
  // rutnätet inte får ett tomt hål.
  return (
    <div className={`poster poster-frame ${frameClass} poster-fallback`} aria-hidden="true">
      <span className="poster-monogram">{monogram(first.title)}</span>
    </div>
  )
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

// Försäljningsstart som en notis (inte en knappliknande pill) med nedräkning i
// hela dagar när det är minst två dagar kvar.
function SalesNotice({ opens }: { opens: string }) {
  const { days } = computeCountdown(opens, 0)
  return (
    <div className="sales-notice">
      <ClockIcon />
      <p>
        <strong>Biljetterna släpps {formatStockholmDateTime(opens)}</strong>
        {days >= 2 && <span className="sales-notice-count"> · om {days} dagar</span>}
      </p>
    </div>
  )
}

// Tre tydliga tillstånd: till salu (fylld), släpps snart (streckad kant +
// klocka), slutsålt (överstruken).
function Showtime({ event, timeOnly = false }: { event: EventWithTicketTypes; timeOnly?: boolean }) {
  const types = event.ticket_types ?? []
  const salesState = computeSalesState({
    salesOpenAt: event.sales_open_at,
    soldCount: event.sold_count,
    capacity: event.capacity,
  })
  const time = event.starts_at
    ? stockholm(event.starts_at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : null
  const label = event.starts_at
    ? timeOnly
      ? (time as string)
      : `${stockholm(event.starts_at, { weekday: 'short' }).replace('.', '')} ${stockholm(event.starts_at, { day: 'numeric', month: 'short' }).replace('.', '')} · ${time}`
    : 'Datum saknas'
  if (salesState === 'sold_out' || types.length === 0) {
    const soldOut = salesState === 'sold_out'
    return (
      <li>
        <span className={`time-chip time-chip-off ${soldOut ? 'time-chip-sold' : ''}`}>
          <span className="time-chip-label first-letter:uppercase">{label}</span>
          <small>{types.length === 0 ? 'Ej till salu ännu' : 'Slutsålt'}</small>
        </span>
      </li>
    )
  }
  if (salesState === 'upcoming') {
    return (
      <li>
        <span className="time-chip time-chip-off time-chip-soon">
          <ClockIcon />
          <span className="time-chip-label first-letter:uppercase">{label}</span>
          <span className="sr-only">, släpps snart</span>
        </span>
      </li>
    )
  }
  // Exakt antal sålda visas inte för besökare (önskemål 2026-10-04) - bara
  // "Få biljetter kvar" under 10% kvar.
  const lowStock = event.capacity > 0 && (event.capacity - event.sold_count) / event.capacity < 0.1
  return (
    <li>
      <Link to={`/kop/${event.slug}`} className="time-chip">
        <span className="time-chip-label first-letter:uppercase">{label}</span>
        {lowStock && <small>Få biljetter kvar</small>}
      </Link>
    </li>
  )
}

// Speltiderna grupperade per dag ("Lördag 5 december": 10:00, 13:00, 16:00).
function dayGroups(group: EventWithTicketTypes[]) {
  const byDay = new Map<string, { label: string; events: EventWithTicketTypes[] }>()
  for (const e of group) {
    const key = e.starts_at ? stockholm(e.starts_at, { year: 'numeric', month: '2-digit', day: '2-digit' }) : 'saknas'
    const label = e.starts_at ? stockholm(e.starts_at, { weekday: 'long', day: 'numeric', month: 'long' }) : 'Datum saknas'
    const entry = byDay.get(key) ?? { label, events: [] }
    entry.events.push(e)
    byDay.set(key, entry)
  }
  return [...byDay.entries()].map(([key, value]) => ({ key, ...value }))
}

function Feature({ group }: { group: EventWithTicketTypes[] }) {
  const first = group[0]
  const organizer = organizerOf(first)
  const allUpcoming = group.every(
    (e) => computeSalesState({ salesOpenAt: e.sales_open_at, soldCount: e.sold_count, capacity: e.capacity }) === 'upcoming',
  )
  const opens = group
    .map((e) => e.sales_open_at)
    .filter((x): x is string => Boolean(x))
    .sort()[0]
  const price = priceLabel(group)
  return (
    <div className="feature">
      <div className="arch arch-wide">
        <Poster shows={group} variant="hero" />
      </div>
      <div className="feature-info">
        <div className="min-w-0">
          <h2 className="feature-title">{first.title}</h2>
          <div className="feature-line">
            <span className="show-date">{dateRange(group)}</span>
            <span className="feature-meta">{[first.venue, organizer?.name].filter(Boolean).join(' · ')}</span>
            {price && <span className="show-price">{price}</span>}
          </div>
        </div>
        <div className="feature-times">
          {allUpcoming && opens && <SalesNotice opens={opens} />}
          {dayGroups(group).map((day) => (
            <div key={day.key} className="show-day-group">
              <p className="show-day first-letter:uppercase">{day.label}</p>
              <ul className="time-chips">
                {day.events.map((event) => (
                  <Showtime key={event.id} event={event} timeOnly />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function EventsPage() {
  const [events, setEvents] = useState<EventWithTicketTypes[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('events')
        .select('*, ticket_types(*), organizers(name, slug)')
        .order('starts_at', { ascending: true })
      if (cancelled) return
      if (error) setError(true)
      else setEvents(data as unknown as EventWithTicketTypes[])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const shows = groupShows(events ?? [])
  const [featured, ...rest] = shows
  // Köpvillkor-länk i footern bara när alla föreställningar tillhör SAMMA
  // arrangör (annars vore det oklart vems villkor länken gäller).
  const slugs = new Set((events ?? []).map((e) => organizerOf(e)?.slug).filter((s): s is string => Boolean(s)))
  const termsSlug = slugs.size === 1 ? [...slugs][0] : undefined

  return (
    <Layout
      wide="xl"
      dark
      termsSlug={termsSlug}
      backdrop={featured ? posterUrls(featured) : undefined}
      hero={
        <>
          <h1 className="sr-only">Kommande föreställningar</h1>
          {error && (
            <p role="alert" className="text-[var(--danger)] text-lg">
              Vi kunde inte hämta föreställningarna just nu. Försök igen om en stund.
            </p>
          )}
          {events === null && !error && <p className="text-[var(--text-muted)] text-lg">Hämtar föreställningar…</p>}
          {events !== null && events.length === 0 && (
            <p className="feature-title">Inga föreställningar just nu. Titta in igen snart.</p>
          )}
          {featured && <Feature group={featured} />}
        </>
      }
    >
      {rest.length > 0 && (
        <section aria-labelledby="more-shows">
          <h2 id="more-shows" className="more-title">
            Fler föreställningar
          </h2>
          <ul className="show-grid">
            {rest.map((group) => {
              const first = group[0]
              const organizer = organizerOf(first)
              const allUpcoming = group.every(
                (e) => computeSalesState({ salesOpenAt: e.sales_open_at, soldCount: e.sold_count, capacity: e.capacity }) === 'upcoming',
              )
              const opens = group
                .map((e) => e.sales_open_at)
                .filter((x): x is string => Boolean(x))
                .sort()[0]
              const price = priceLabel(group)
              return (
                <li key={first.id} className="show-tile">
                  <Poster shows={group} variant="tile" />
                  <div className="show-body">
                    <div className="show-date">{dateRange(group)}</div>
                    <h3 className="show-title">{first.title}</h3>
                    <p className="show-meta">
                      {[first.venue, organizer?.name].filter(Boolean).join(' · ')}
                      {price && <span className="show-price">{price}</span>}
                    </p>
                    {allUpcoming && opens && <SalesNotice opens={opens} />}
                    <ul className="time-chips">
                      {group.map((event) => (
                        <Showtime key={event.id} event={event} />
                      ))}
                    </ul>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </Layout>
  )
}
