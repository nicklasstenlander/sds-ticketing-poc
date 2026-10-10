import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { EventOrganizerRelation, EventRow, TicketTypeRow } from '../lib/types'
import { Layout } from '../components/Layout'
import { APP_NAME } from '../lib/constants'
import { computeSalesState } from '../lib/salesState'
import { formatStockholmDateTime, formatStockholmDateTimeLocale } from '../lib/stockholmTime'
import { formatKr } from '../lib/formatPrice'

interface EventWithTicketTypes extends EventRow {
  ticket_types: TicketTypeRow[]
  organizers: EventOrganizerRelation | EventOrganizerRelation[] | null
}

// /evenemang - listar alla publicerade event. RLS begränsar redan anon-
// SELECT på events till status='published' (se migrationen från
// 2026-01-01), så ingen extra statusfiltrering behövs i frågan här.
// ticket_types hämtas i samma anrop via PostgREST-embedding (samma RLS-
// mönster: anon ser bara typer kopplade till ett publicerat event).
// capacity/sold_count ligger direkt på eventet (delad kapacitetspool,
// se rättelseordern 2026-08-05) - ingen summering över ticket_types
// behövs för det, bara för prisspannet.
export function EventsPage() {
  const [events, setEvents] = useState<EventWithTicketTypes[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('events')
        .select('*, ticket_types(*), organizers(name)')
        .order('starts_at', { ascending: true })
      if (cancelled) return
      if (error) setError(error.message)
      else setEvents(data as unknown as EventWithTicketTypes[])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Layout>
      <div className="eyebrow mb-3">{APP_NAME}</div>
      <h1 className="text-2xl font-bold mb-2 text-[var(--text)]">Kommande föreställningar</h1>
      <p className="text-[var(--text-muted)] mb-8">
        Välj en föreställning och köp biljett på under en minut.
      </p>

      {error && <p className="text-red-600">Kunde inte hämta events: {error}</p>}
      {events === null && !error && <p className="text-[var(--text-muted)]">Laddar…</p>}
      {events !== null && events.length === 0 && (
        <p className="text-[var(--text-muted)]">Inga publicerade events ännu. Skapa ett i admin.</p>
      )}

      <ul className="space-y-4">
        {events?.map((event) => {
          const types = event.ticket_types ?? []
          const salesState = computeSalesState({
            salesOpenAt: event.sales_open_at,
            soldCount: event.sold_count,
            capacity: event.capacity,
          })
          const soldOut = salesState === 'sold_out'
          const upcoming = salesState === 'upcoming'
          // Exakt antal/andel sålda visas INTE längre för besökare (önskemål
          // 2026-10-04, samma princip som köpsidan) - bara "Få biljetter
          // kvar" under 10% kvar. "Slutsålt" hanteras redan separat nedan
          // (höger badge), oberoende av detta.
          const lowStock = !soldOut && event.capacity > 0 && (event.capacity - event.sold_count) / event.capacity < 0.1
          // Prisintervall (Nicklas 2026-10-10, efter att ha testat "Från X
          // kr" + en separat "Barn 0-3 år: gratis"-rad: "Detta kan vi ta
          // bort och istället ha 0-200kr") - ETT tal om alla typer har
          // samma pris, annars MIN-MAX över ALLA typer (gratis räknas med
          // i spannet, inte en egen rad längre). Gäller bara /evenemang -
          // API-kontraktet (from_price_ore/free_ticket_names i public-
          // embed/public-events, docs/PUBLIC_EMBED_API.md) är oförändrat,
          // CORE-appen och widgeten läser fortfarande de fälten som de är.
          const prices = types.map((t) => t.price_ore)
          const minPriceOre = prices.length > 0 ? Math.min(...prices) : null
          const maxPriceOre = prices.length > 0 ? Math.max(...prices) : null
          const singlePrice = new Set(prices).size <= 1
          const organizer = Array.isArray(event.organizers) ? event.organizers[0] : event.organizers
          // Affisch (ordern "Små ändringar i frontend" 2026-10-10, punkt
          // 1): portrait är FÖRSTAVALET för kortlistans miniatyr (fast
          // 2:3, object-fit:contain - aldrig beskuren/sträckt). Saknas
          // portrait men landscape finns: landscape visas som en hero
          // ÖVERST på kortet istället (inte klämd in i miniatyrplatsen -
          // en liggande bild skulle beskäras hårt i en stående 2:3-ruta).
          // Saknas båda: samma diagonalrandiga platshållare som förut,
          // bara i miniatyrens nya 2:3-proportion istället för kvadratisk.
          const hasPortrait = Boolean(event.poster_portrait_url)
          const hasLandscape = Boolean(event.poster_landscape_url)
          const showLandscapeHero = !hasPortrait && hasLandscape

          return (
            <li key={event.id} className="card">
              {/* Två flex-items i YTTRE raden: posterGruppen (bild+text
                  ihop) och prisblocket - INTE tre separata (bild, text,
                  pris). Med tre separata items klämde flex-1 (basis:0%)
                  textkolumnen i smal vy (se historik nedan), och att byta
                  till flex-auto löste klämningen men fick posterbilden att
                  hamna på en EGEN rad ovanför texten när priset wrappade -
                  korrekt bredd, men onödigt höga kort (Nicklas rapporterade
                  det 2026-10-10 efter den fixen gått i drift). Genom att
                  gruppera bild+text i en EGEN inre flex-rad blir de EN
                  enhet i den yttre radens wrap-bedömning - de stannar ihop
                  på första raden, bara prisblocket wrappar ner när det
                  inte får plats, precis som innan höjd-regressionen. */}
              {/* Landscape-hero (punkt 1) - bara när portrait saknas men
                  landscape finns. Full kortbredd, ovanför resten av
                  kortet (inte i miniatyrplatsen - skulle beskäras hårt
                  i en stående 2:3-ruta). Samma aspect-video/object-cover
                  som köpsidans hero (PurchasePage.tsx). */}
              {showLandscapeHero && (
                <img
                  src={event.poster_landscape_url!}
                  alt=""
                  className="w-full aspect-video object-cover rounded-xl mb-4 border border-[var(--border)]"
                />
              )}
              <div className="flex items-center gap-5 flex-wrap">
                <div className="flex items-center gap-5 min-w-0 flex-auto">
                  {/* Affisch-miniatyr (punkt 1): portrait i fast 2:3,
                      object-fit:contain (ALDRIG beskuren/sträckt - en
                      bakgrundsfärg bakom bilden fyller ev. mellanrum om
                      den riktiga bildens proportion avviker lite från
                      2:3). 96px smal vy, 128px bred (sm: och uppåt).
                      Ingen miniatyr alls när landscape-heron ovan redan
                      visas (showLandscapeHero) - annars samma
                      diagonalrandiga platshållare som förut, nu i 2:3
                      istället för kvadratisk, så kort helt utan affisch
                      inte ser trasiga/ofärdiga ut. */}
                  {hasPortrait ? (
                    <div className="w-24 sm:w-32 aspect-[2/3] shrink-0 rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--accent-soft)]">
                      <img src={event.poster_portrait_url!} alt="" className="w-full h-full object-contain" />
                    </div>
                  ) : !showLandscapeHero ? (
                    <div
                      className="w-24 sm:w-32 aspect-[2/3] shrink-0 rounded-xl border border-[var(--border)]"
                      style={{
                        background:
                          'repeating-linear-gradient(45deg, var(--accent-soft), var(--accent-soft) 8px, var(--surface) 8px, var(--surface) 16px)',
                      }}
                      aria-hidden="true"
                    />
                  ) : null}
                  {/* flex-auto (inte flex-1): flex-1 sätter flex-basis:0%,
                      vilket gör att den här kolumnen INTE räknas med alls
                      när flex-wrap avgör om GRUPPEN (bild+text) får plats
                      bredvid prisblocket - kolumnen klämdes ner till
                      enstaka pixlar i smal vy (upptäckt vid 360px, ordern
                      2026-10-10 - fanns redan innan den ordern, aldrig
                      testat vid just 360px tidigare). flex-auto (flex:1 1
                      auto) låter kolumnens egna innehåll räknas med i den
                      bedömningen - samma "stapla innan krymp"-princip som
                      embed.js (ordern 2026-10-06). */}
                  <div className="min-w-0 flex-auto">
                    <div className="font-semibold text-[var(--text)]">{event.title}</div>
                    <div className="text-sm text-[var(--text-muted)] mb-3">
                      {/* starts_at är null bara för ett ännu opublicerat
                          dublicerat event (Tilläggsordern 2026-08-05) - RLS
                          (status = 'published') gör att den här listan i
                          praktiken aldrig innehåller ett sådant event, men
                          typen tillåter null så vi faller tillbaka defensivt. */}
                      {event.starts_at
                        ? // steg 1b: explicit Europe/Stockholm (se stockholmTime.ts).
                          formatStockholmDateTimeLocale(event.starts_at, { dateStyle: 'medium', timeStyle: 'short' })
                        : ''}
                      {event.venue ? ` · ${event.venue}` : ''}
                      {organizer?.name ? ` · Arrangör: ${organizer.name}` : ''}
                    </div>
                    {lowStock && <div className="text-sm text-[var(--text-muted)]">Få biljetter kvar</div>}
                  </div>
                </div>
                {/* Pris, gratisrad och knapp/chip på SAMMA rad (Nicklas
                    2026-10-10: "för att inte få den lika hög") - en flex-
                    rad istället för tre staplade block, så kortet bara blir
                    högre när raden faktiskt inte får plats (flex-wrap
                    bryter då av DELAR av raden, inte allt på förhand). Höger-
                    justerad som grupp (justify-end) även när den bryter till
                    fler rader. ml-auto: när HELA den här raden inte får
                    plats bredvid bild+text-gruppen (yttre flex-wrap ovan)
                    hamnar den på en egen rad, höger-justerad - samma
                    "stapla innan krympning"-princip som används i embed.js
                    (ordern 2026-10-06). */}
                <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 shrink-0 ml-auto max-w-full">
                  <span className="font-semibold text-[var(--text)]">
                    {types.length === 0 || minPriceOre === null || maxPriceOre === null
                      ? '–'
                      : singlePrice
                        ? minPriceOre === 0
                          ? 'Gratis'
                          : `${formatKr(minPriceOre)} kr`
                        : `${formatKr(minPriceOre)}–${formatKr(maxPriceOre)} kr`}
                  </span>
                  {upcoming && event.sales_open_at ? (
                    <span className="text-sm px-2 py-1 rounded-full bg-[var(--spotlight)] text-[var(--spotlight-ink)] inline-block">
                      Släpps {formatStockholmDateTime(event.sales_open_at)}
                    </span>
                  ) : types.length === 0 || soldOut ? (
                    <span className="text-sm text-[var(--text-muted)]">
                      {types.length === 0 ? 'Ej till salu ännu' : 'Slutsålt'}
                    </span>
                  ) : (
                    <Link to={`/kop/${event.slug}`} className="btn-primary text-sm">
                      Köp biljett
                    </Link>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Layout>
  )
}
