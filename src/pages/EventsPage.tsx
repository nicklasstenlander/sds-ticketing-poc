import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { EventOrganizerRelation, EventRow, TicketTypeRow } from '../lib/types'
import { Layout } from '../components/Layout'
import { computeSalesState } from '../lib/salesState'
import { formatStockholmDateTime, formatStockholmDateTimeLocale } from '../lib/stockholmTime'
import { formatKr } from '../lib/formatPrice'

interface EventWithTicketTypes extends EventRow {
  ticket_types: TicketTypeRow[]
  organizers: EventOrganizerRelation | EventOrganizerRelation[] | null
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

// Liggande affisch är förstahandsval (bred, 16:9); stående används bara om den
// liggande saknas. Aldrig beskuren.
function Poster({ shows, prefer = 'landscape' }: { shows: EventWithTicketTypes[]; prefer?: 'landscape' | 'portrait' }) {
  const first = shows[0]
  const landscape = shows.find((e) => e.poster_landscape_url)?.poster_landscape_url
  const portrait = shows.find((e) => e.poster_portrait_url)?.poster_portrait_url
  const useLandscape = prefer === 'landscape' ? Boolean(landscape) : !portrait && Boolean(landscape)
  const src = useLandscape ? landscape : (portrait ?? landscape)
  if (src) {
    return (
      <div className={`poster ${useLandscape ? 'poster-landscape' : 'poster-portrait'}`}>
        <img src={src} alt={`Affisch: ${first.title}`} loading="lazy" />
      </div>
    )
  }
  // Ingen affisch uppladdad: en typografisk affisch i varumärkets färger,
  // så rutnätet inte får ett tomt hål.
  return (
    <div className={`poster ${prefer === 'portrait' ? 'poster-portrait' : 'poster-landscape'} poster-fallback`} aria-hidden="true">
      <span>{first.title}</span>
    </div>
  )
}

function Showtime({ event }: { event: EventWithTicketTypes }) {
  const types = event.ticket_types ?? []
  const salesState = computeSalesState({
    salesOpenAt: event.sales_open_at,
    soldCount: event.sold_count,
    capacity: event.capacity,
  })
  const label = event.starts_at
    ? `${stockholm(event.starts_at, { weekday: 'short' }).replace('.', '')} ${stockholm(event.starts_at, { day: 'numeric', month: 'short' }).replace('.', '')} · ${stockholm(event.starts_at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`
    : 'Datum saknas'
  if (salesState === 'sold_out' || types.length === 0) {
    return (
      <li>
        <span className="time-chip time-chip-off">
          <span className="first-letter:uppercase">{label}</span>
          <small>{types.length === 0 ? 'Ej till salu ännu' : 'Slutsålt'}</small>
        </span>
      </li>
    )
  }
  if (salesState === 'upcoming') {
    return (
      <li>
        <span className="time-chip time-chip-off">
          <span className="first-letter:uppercase">{label}</span>
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
        <span className="first-letter:uppercase">{label}</span>
        {lowStock && <small>Få biljetter kvar</small>}
      </Link>
    </li>
  )
}

function Feature({ group }: { group: EventWithTicketTypes[] }) {
  const first = group[0]
  const organizer = Array.isArray(first.organizers) ? first.organizers[0] : first.organizers
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
      <div className="feature-head">
        <h2 className="feature-title">{first.title}</h2>
        <div className="feature-line">
          <span className="show-date">{dateRange(group)}</span>
          <span className="feature-meta">{[first.venue, organizer?.name].filter(Boolean).join(' · ')}</span>
          {price && <span className="show-price">{price}</span>}
        </div>
      </div>
      <div className="arch arch-wide">
        <Poster shows={group} />
      </div>
      <div className="feature-times">
        {allUpcoming && opens && (
          <div className="badge badge-spotlight">Biljetterna släpps {formatStockholmDateTime(opens)}</div>
        )}
        <ul className="time-chips">
          {group.map((event) => (
            <Showtime key={event.id} event={event} />
          ))}
        </ul>
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
        .select('*, ticket_types(*), organizers(name)')
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

  return (
    <Layout
      wide="xl"
      dark
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
              const organizer = Array.isArray(first.organizers) ? first.organizers[0] : first.organizers
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
                  <Poster shows={group} prefer="portrait" />
                  <div className="show-body">
                    <div className="show-date">{dateRange(group)}</div>
                    <h3 className="show-title">{first.title}</h3>
                    <p className="show-meta">
                      {[first.venue, organizer?.name].filter(Boolean).join(' · ')}
                      {price && <span className="show-price">{price}</span>}
                    </p>
                    {allUpcoming && opens && (
                      <div className="badge badge-spotlight">Biljetterna släpps {formatStockholmDateTime(opens)}</div>
                    )}
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
