import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { callFunction, ApiError } from '../lib/functionsApi'
import type { EventOrganizerRelation, EventRow, TicketTypeRow } from '../lib/types'
import { Layout } from '../components/Layout'
import { APP_NAME } from '../lib/constants'
import { computeSalesState, computeCountdown, computeClockSkewMs } from '../lib/salesState'
import { formatStockholmDateTime, formatStockholmDateTimeLocale } from '../lib/stockholmTime'

interface CreateOrderResponse {
  checkout_url: string
}

// Serviceavgift-konfiguration (Tilläggsordern 2026-08-07): köpsidan är
// publik/oautentiserad och kan inte läsa Supabase secrets direkt - hämtas
// via public-fee-config så att avgiften kan visas INNAN köparen skickas
// till Stripe (DoD-punkt 1). Ingen egen rad visas i percent-läget - då
// ligger avgiften kvar inbakad i biljettpriset, precis som idag.
//
// server_time (ordern 2026-10-03, 1.5) - återanvänder detta anrop (som
// redan görs vid sidladdning ändå) för klockskillnaden countdown-
// nedräkningen mot sales_open_at behöver, se public-fee-config/index.ts.
interface FeeConfig {
  mode: 'percent' | 'flat_per_ticket'
  flat_ore: number
  server_time: string
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span>{String(value).padStart(2, '0')}</span>
      <span className="text-xs font-normal text-[var(--text-muted)]">{label}</span>
    </div>
  )
}

const MAX_TOTAL_QTY = 6

// Ordern 2026-10-03 (A6), avsnitt 1: texten ska gå att ändra lätt, och
// SKA granskas av revisor/jurist innan Live-försäljning - ändra bara
// denna konstant, den återanvänds ingenstans annars.
const TERMS_WITHDRAWAL_NOTE = 'Biljetter till evenemang på ett bestämt datum har ingen ångerrätt.'

// Kundvagn (Tilläggsordern 2026-08-05, "Flera biljettyper i samma köp"):
// alla biljettyper listas samtidigt med var sin +/- kvantitetsväljare
// (start 0), istället för att köparen först väljer EN typ. Det totala
// antalet över alla rader begränsas både av MAX_TOTAL_QTY och av
// eventets delade kapacitetspool (rättelseordern 2026-08-05) - remaining
// nedan är alltså en pott som delas mellan alla rader, inte en gräns per
// rad.
interface EventWithOrganizer extends EventRow {
  organizers: EventOrganizerRelation | EventOrganizerRelation[] | null
}

export function PurchasePage() {
  const { slug } = useParams<{ slug: string }>()

  const [event, setEvent] = useState<EventWithOrganizer | null>(null)
  const [ticketTypes, setTicketTypes] = useState<TicketTypeRow[] | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Schemalagt biljettsläpp (ordern 2026-10-03) - förhindrar att release-
  // pollningen (nedan) startar om flera gånger medan nedräkningen redan
  // visar "nådd" (t.ex. vid varje sekundtick).
  const releaseTriggeredRef = useRef(false)
  const [now, setNow] = useState(() => new Date())
  // Klockskillnad mot servern (uppföljning 2026-10-04) - beräknas EN gång
  // när public-fee-config svarar (se computeClockSkewMs), inte om vid
  // varje tick. 0 tills svaret kommit, vilket bara betyder "oskevad
  // klocka" - samma säkra default som tidigare.
  const [clockSkewMs, setClockSkewMs] = useState(0)
  // Speglar clockSkewMs - den asynkrona pollningsloopen nedan är en
  // long-lived closure (startad när countdown.reached blir true) och ska
  // läsa den SENASTE skevheten, inte en inaktuell variant inlåst i
  // closure:n från den stund loopen startade.
  const clockSkewMsRef = useRef(0)
  useEffect(() => {
    clockSkewMsRef.current = clockSkewMs
  }, [clockSkewMs])

  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [discountCode, setDiscountCode] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [feeConfig, setFeeConfig] = useState<FeeConfig | null>(null)

  // Extraherad (inte bara en inline-funktion i useEffect) - returnerar det
  // färska eventet direkt istället för att gå via React-state, så att
  // release-pollningen nedan kan inspektera svaret omedelbart utan att
  // racea mot Reacts asynkrona setState (ordern 2026-10-03, 1.5:
  // "sidan ska hämta status på nytt från servern och visa formuläret utan
  // omladdning"). cancelledRef skyddar mot setState efter unmount/slug-byte.
  async function fetchEventAndTickets(cancelledRef?: { current: boolean }): Promise<EventWithOrganizer | null> {
    const { data: eventData, error: eventError } = await supabase
      .from('events')
      // terms_url (A6) och sales_open_at (ordern 2026-10-03) - bara dessa
      // nya fält läggs till i select():en, inget annat från organizers
      // exponeras (se ordertexten avsnitt 4). sales_open_at kommer redan
      // med automatiskt via "*".
      .select('*, organizers(name, terms_url)')
      .eq('slug', slug)
      .maybeSingle()
    if (cancelledRef?.current) return null
    if (eventError) {
      setLoadError(eventError.message)
      return null
    }
    if (!eventData) {
      setNotFound(true)
      return null
    }
    const ev = eventData as EventWithOrganizer
    setEvent(ev)

    const { data: ticketTypeData, error: ticketTypeError } = await supabase
      .from('ticket_types')
      .select('*')
      .eq('event_id', ev.id)
      .order('sort_order', { ascending: true })
    if (cancelledRef?.current) return null
    if (ticketTypeError) {
      setLoadError(ticketTypeError.message)
      return null
    }
    setTicketTypes((ticketTypeData ?? []) as TicketTypeRow[])
    return ev
  }

  useEffect(() => {
    if (!slug) return
    releaseTriggeredRef.current = false
    const cancelledRef = { current: false }
    fetchEventAndTickets(cancelledRef)
    return () => {
      cancelledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  useEffect(() => {
    let cancelled = false
    callFunction<FeeConfig>('public-fee-config')
      .then((cfg) => {
        if (!cancelled) {
          setFeeConfig(cfg)
          // Skevheten beräknas HÄR, i samma ögonblick svaret kommer in -
          // inte senare vid varje tick (se computeClockSkewMs).
          setClockSkewMs(computeClockSkewMs(cfg.server_time))
        }
      })
      .catch(() => {
        // Fee config-hämtning är inte kritisk för sidans huvudfunktion -
        // vid fel visas bara ingen serviceavgiftsrad (avgiften tas ändå
        // ut korrekt av create-order/Stripe oavsett vad frontenden vet).
        if (!cancelled) setFeeConfig(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Schemalagt biljettsläpp (ordern 2026-10-03, 1.1/1.5). Prioritetsordning
  // (upcoming > sold_out > open) i src/lib/salesState.ts - samma logik som
  // servern (create-order/public-events), se den filens kommentar.
  //
  // Skevhetskorrigerad `now` (uppföljning 2026-10-04) - samma tidpunkt
  // används här OCH i countdown nedan, så de alltid är konsekventa med
  // varandra inom en och samma rendering.
  const effectiveNow = new Date(now.getTime() + clockSkewMs)
  const salesState = event
    ? computeSalesState({
        salesOpenAt: event.sales_open_at,
        soldCount: event.sold_count,
        capacity: event.capacity,
        now: effectiveNow,
      })
    : null
  const upcoming = salesState === 'upcoming'

  // Tickande klocka - bara medan nedräkningen faktiskt visas, för att inte
  // rendera om sidan i onödan när köpformuläret redan visas.
  useEffect(() => {
    if (!upcoming) return
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [upcoming])

  // Uppföljning 2026-10-04: resynka klockan OCH hämta status på nytt så
  // snart fliken blir synlig igen - en bakgrundslagd flik kan ha missat
  // flera sekundtick (webbläsare bromsar/pausar timers i dolda flikar),
  // så släppet kan ha passerat utan att nedräkningen hunnit märka det.
  // Körs bara medan upcoming faktiskt visas - annars inget att synka.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      setNow(new Date())
      if (upcoming) {
        fetchEventAndTickets()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming])

  const countdown = upcoming && event?.sales_open_at ? computeCountdown(event.sales_open_at, clockSkewMs, now) : null

  // Vid släppet: hämta status på nytt från servern och visa formuläret UTAN
  // omladdning (ordern 1.5). 0-3 sekunders slumpad fördröjning så att inte
  // alla besökare slår på samtidigt, därefter nytt försök var 5:e sekund
  // tills servern faktiskt säger "open" (max en minut - klockskillnaden
  // mellan klienter kan annars skapa en tunn ström av för tidiga försök).
  // Widgeten/sidan får ALDRIG gissa att det är öppet - bara ett färskt
  // serversvar byter bort nedräkningen.
  useEffect(() => {
    if (!countdown?.reached) return
    if (releaseTriggeredRef.current) return
    releaseTriggeredRef.current = true

    const cancelledRef = { current: false }
    async function pollUntilOpen() {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 3000))
      const deadline = Date.now() + 60_000
      while (!cancelledRef.current) {
        const fresh = await fetchEventAndTickets(cancelledRef)
        if (cancelledRef.current) return
        if (fresh) {
          // Skevhetskorrigerad även här (uppföljning 2026-10-04) - annars
          // kunde en konsekvent klientklockskillnad få denna kontroll att
          // (felaktigt) tro att släppet redan passerat, byta till
          // formuläret, och låta köparen trilla rakt in i samma
          // SALES_NOT_OPEN-avvisning igen vid nästa klick (se catch-
          // blocket i handleSubmit) - samma orsak aldrig korrigerad.
          const freshState = computeSalesState({
            salesOpenAt: fresh.sales_open_at,
            soldCount: fresh.sold_count,
            capacity: fresh.capacity,
            now: new Date(Date.now() + clockSkewMsRef.current),
          })
          if (freshState !== 'upcoming') return
        }
        if (Date.now() >= deadline) return
        await new Promise((resolve) => setTimeout(resolve, 5000))
      }
    }
    pollUntilOpen()
    return () => {
      cancelledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown?.reached])

  const organizer = event
    ? Array.isArray(event.organizers)
      ? event.organizers[0]
      : event.organizers
    : null
  // Köpvillkor (A6) - bara satt för arrangörer som kräver godkännande.
  const termsUrl = organizer?.terms_url ?? null

  const remaining = event ? event.capacity - event.sold_count : 0
  const soldOut = event ? event.capacity > 0 && remaining <= 0 : false
  // Exakt antal kvarvarande platser visas inte längre för köparen (önskemål
  // 2026-10-04) - bara ett löst "få kvar"-läge under 10%. remaining/
  // maxSelectable nedan styr fortfarande den FAKTISKA köpspärren oförändrat,
  // det är bara den visade TEXTEN som ändras.
  const lowStock = event ? !soldOut && event.capacity > 0 && remaining / event.capacity < 0.1 : false
  const totalQty = Object.values(quantities).reduce((sum, q) => sum + q, 0)
  const totalOre = (ticketTypes ?? []).reduce(
    (sum, t) => sum + (quantities[t.id] ?? 0) * t.price_ore,
    0,
  )
  const maxSelectable = Math.min(MAX_TOTAL_QTY, remaining)
  const platformFeeOre =
    feeConfig?.mode === 'flat_per_ticket' ? totalQty * feeConfig.flat_ore : 0
  const grandTotalOre = totalOre + platformFeeOre

  function setQty(ticketTypeId: string, qty: number) {
    setQuantities((q) => ({ ...q, [ticketTypeId]: Math.max(0, qty) }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!event || totalQty < 1) return
    if (termsUrl && !acceptedTerms) return
    setSubmitting(true)
    setFormError(null)
    try {
      const items = Object.entries(quantities)
        .filter(([, qty]) => qty > 0)
        .map(([ticket_type_id, qty]) => ({ ticket_type_id, qty }))

      const result = await callFunction<CreateOrderResponse>('create-order', {
        method: 'POST',
        body: {
          slug: event.slug,
          items,
          name,
          email,
          discount_code: discountCode.trim() || undefined,
          accepted_terms: acceptedTerms,
        },
      })
      // Fullständig sidomdirigering (inte en klientroutning) - Stripe
      // Checkout är en hostad sida, ingen komponent i denna app.
      window.location.href = result.checkout_url
    } catch (err) {
      // SALES_NOT_OPEN (ordern 2026-10-03, 1.3/1.5): klockskillnad mellan
      // köparens klocka och servern - servern säger fortfarande inte
      // öppet trots att nedräkningen nådde noll hos köparen. Hämta om
      // eventet så nedräkningen visas igen istället för ett skrämmande
      // felmeddelande - "ett fel" hade sett ut som att något gått
      // sönder, när det bara är några sekunders väntan kvar.
      const code = err instanceof ApiError ? (err.body as { code?: string } | null)?.code : undefined
      if (code === 'SALES_NOT_OPEN') {
        releaseTriggeredRef.current = false
        await fetchEventAndTickets()
      } else {
        // Visa API:ets faktiska feltext (ordern 2026-10-01, A7) - ett 409-
        // svar kan betyda slutsålt ELLER t.ex. att arrangören saknar ett
        // klart betalningskonto, och de ska inte visas som samma fel. Den
        // generella fallbacken används bara när svaret saknar läsbar text.
        setFormError(err instanceof ApiError ? err.message : 'Något gick fel. Försök igen om en stund.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <Layout>
        <p className="text-red-600">Kunde inte hämta eventet: {loadError}</p>
      </Layout>
    )
  }

  if (notFound) {
    return (
      <Layout>
        <p className="text-[var(--text-muted)]">Eventet hittades inte, eller är inte publicerat.</p>
      </Layout>
    )
  }

  if (!event || ticketTypes === null) {
    return (
      <Layout>
        <p className="text-[var(--text-muted)]">Laddar…</p>
      </Layout>
    )
  }

  if (ticketTypes.length === 0) {
    return (
      <Layout>
        <p className="text-[var(--text-muted)]">Det här eventet har inga biljetter till salu ännu.</p>
      </Layout>
    )
  }

  return (
    <Layout>
      {/* Hero-affisch (liggande) om en är uppladdad (Tilläggsordern
          2026-08-05) - annars samma utseende som innan, utan bild. */}
      {event.poster_landscape_url && (
        <img
          src={event.poster_landscape_url}
          alt=""
          className="w-full aspect-video object-cover rounded-[var(--radius-sm)] mb-6 border border-[var(--border)]"
        />
      )}
      <div className="eyebrow mb-3">{APP_NAME}</div>
      <h1 className="text-2xl font-bold mb-2 text-[var(--text)]">{event.title}</h1>
      <p className={`text-[var(--text-muted)] ${soldOut || lowStock ? 'mb-1' : 'mb-8'}`}>
        {/* starts_at är null bara för ett ännu opublicerat dublicerat
            event (Tilläggsordern 2026-08-05) - RLS gör att den här sidan
            i praktiken aldrig når hit för ett sådant event, men typen
            tillåter null så vi faller tillbaka defensivt. */}
        {event.starts_at
          ? // steg 1b: explicit Europe/Stockholm (se stockholmTime.ts).
            formatStockholmDateTimeLocale(event.starts_at, { dateStyle: 'long', timeStyle: 'short' })
          : ''}
        {event.venue ? ` · ${event.venue}` : ''}
        {organizer?.name ? ` · Arrangör: ${organizer.name}` : ''}
      </p>
      {/* Exakt antal platser visas INTE längre (önskemål 2026-10-04) - bara
          "Slutsålt" eller "Få biljetter kvar" under 10% kvar. Inget extra
          visas alls vid normal tillgång, samma princip som public-embed/
          public-events redan följer (aldrig sold_count/capacity i klartext). */}
      {(soldOut || lowStock) && (
        <p className="text-[var(--text-muted)] mb-8">{soldOut ? 'Slutsålt' : 'Få biljetter kvar'}</p>
      )}

      {upcoming && event.sales_open_at ? (
        <div className="card text-center">
          <span className="inline-block text-sm px-3 py-1 rounded-full bg-[var(--spotlight)] text-[var(--spotlight-ink)] mb-5">
            Biljetterna släpps {formatStockholmDateTime(event.sales_open_at)}
          </span>
          {/* aria-hidden - siffrorna uppdateras sekund för sekund och ska
              inte läsas upp av en skärmläsare varje tick (ordern 2.1,
              tillgänglighet). Chip-texten ovan är den statiska,
              skärmläsarvänliga motsvarigheten. */}
          {countdown && (
            <div
              className="flex items-center justify-center gap-5 text-3xl font-extrabold text-[var(--text)]"
              aria-hidden="true"
            >
              {countdown.underAnHour ? (
                <>
                  <CountdownUnit value={countdown.hours} label="tim" />
                  <CountdownUnit value={countdown.minutes} label="min" />
                  <CountdownUnit value={countdown.seconds} label="sek" />
                </>
              ) : (
                <>
                  <CountdownUnit value={countdown.days} label="dagar" />
                  <CountdownUnit value={countdown.hours} label="tim" />
                  <CountdownUnit value={countdown.minutes} label="min" />
                </>
              )}
            </div>
          )}
        </div>
      ) : soldOut ? (
        <div className="card text-center">
          <p className="font-semibold mb-2 text-[var(--text)]">Tyvärr, det här eventet är slutsålt.</p>
          <p className="text-[var(--text-muted)] text-sm">Håll utkik efter fler tillfällen.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-3">
            {ticketTypes.map((t) => {
              const qty = quantities[t.id] ?? 0
              return (
                <div key={t.id} className="card flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-[var(--text)]">{t.name}</div>
                    <div className="text-sm text-[var(--text-muted)]">
                      {(t.price_ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <button
                      type="button"
                      onClick={() => setQty(t.id, qty - 1)}
                      disabled={qty <= 0}
                      className="stepper-btn"
                      aria-label={`Färre ${t.name}`}
                    >
                      –
                    </button>
                    <div className="text-lg font-bold min-w-[24px] text-center text-[var(--text)]">{qty}</div>
                    <button
                      type="button"
                      onClick={() => setQty(t.id, qty + 1)}
                      disabled={totalQty >= maxSelectable}
                      className="stepper-btn"
                      aria-label={`Fler ${t.name}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="card space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]" htmlFor="name">
                Namn
              </label>
              <input
                id="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]" htmlFor="email">
                E-post
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]" htmlFor="discount">
                Rabattkod (valfritt)
              </label>
              <input
                id="discount"
                value={discountCode}
                onChange={(e) => setDiscountCode(e.target.value)}
                placeholder="t.ex. SOMMAR25"
                className="field"
              />
            </div>

            <div className="pt-3 border-t border-[var(--border)] space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--text-muted)]">
                  Biljetter ({totalQty} {totalQty === 1 ? 'st' : 'st'})
                  {discountCode.trim() && ' (innan ev. rabatt)'}
                </span>
                <span className="text-sm text-[var(--text)]">
                  {(totalOre / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr
                </span>
              </div>
              {/* Serviceavgift som egen synlig rad - ENDAST i
                  flat_per_ticket-läget (ordertextens avsnitt 3). Visas
                  aldrig i percent-läget, där avgiften redan ligger inbakad
                  i biljettpriset ovan. Rabattkoder påverkar aldrig detta
                  belopp. */}
              {feeConfig?.mode === 'flat_per_ticket' && totalQty > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-muted)]">Serviceavgift ({totalQty} st)</span>
                  <span className="text-sm text-[var(--text)]">
                    {(platformFeeOre / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm text-[var(--text-muted)]">
                  Totalt{discountCode.trim() && ' (innan ev. rabatt på biljettpriset)'}
                </span>
                <span className="text-xl font-extrabold text-[var(--text)]">
                  {(grandTotalOre / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr
                </span>
              </div>
            </div>

            {/* Köpvillkor (A6) - bara för arrangörer med satt terms_url.
                Obligatorisk kryssruta ovanför betalknappen, serverkontrollen
                i create-order är den som faktiskt gäller (se filkommentaren
                där) - detta är bara UI:t. */}
            {termsUrl && (
              <div className="pt-3 border-t border-[var(--border)]">
                <label htmlFor="accept-terms" className="flex items-start gap-2 text-sm text-[var(--text)]">
                  <input
                    id="accept-terms"
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border)] text-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  />
                  <span>
                    Jag har läst och godkänner{' '}
                    <a
                      href={termsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-accent"
                    >
                      köpvillkoren
                    </a>
                  </span>
                </label>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{TERMS_WITHDRAWAL_NOTE}</p>
              </div>
            )}

            {formError && <p className="text-red-600 text-sm">{formError}</p>}

            <button
              type="submit"
              disabled={submitting || totalQty < 1 || (Boolean(termsUrl) && !acceptedTerms)}
              className="btn-primary w-full py-2"
            >
              {submitting
                ? 'Skickar dig till Stripe…'
                : totalQty < 1
                  ? 'Välj minst en biljett'
                  : 'Fortsätt till betalning'}
            </button>
            {/* Förklaring NÄR knappen är inaktiv på grund av villkoren
                specifikt (inte bara en grå knapp utan anledning, ordertextens
                avsnitt 1) - visas bara när det faktiskt är orsaken. */}
            {termsUrl && !acceptedTerms && totalQty >= 1 && (
              <p className="text-xs text-[var(--text-muted)] text-center -mt-2">
                Godkänn villkoren för att fortsätta
              </p>
            )}
          </div>
        </form>
      )}
    </Layout>
  )
}
