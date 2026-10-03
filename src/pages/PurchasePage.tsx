import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { callFunction, ApiError } from '../lib/functionsApi'
import type { EventOrganizerRelation, EventRow, TicketTypeRow } from '../lib/types'
import { Layout } from '../components/Layout'
import { APP_NAME } from '../lib/constants'

interface CreateOrderResponse {
  checkout_url: string
}

// Serviceavgift-konfiguration (Tilläggsordern 2026-08-07): köpsidan är
// publik/oautentiserad och kan inte läsa Supabase secrets direkt - hämtas
// via public-fee-config så att avgiften kan visas INNAN köparen skickas
// till Stripe (DoD-punkt 1). Ingen egen rad visas i percent-läget - då
// ligger avgiften kvar inbakad i biljettpriset, precis som idag.
interface FeeConfig {
  mode: 'percent' | 'flat_per_ticket'
  flat_ore: number
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

  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [discountCode, setDiscountCode] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [feeConfig, setFeeConfig] = useState<FeeConfig | null>(null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    async function load() {
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        // terms_url (A6) - bara det nya fältet läggs till här, inget annat
        // från organizers exponeras (se ordertexten avsnitt 4).
        .select('*, organizers(name, terms_url)')
        .eq('slug', slug)
        .maybeSingle()
      if (cancelled) return
      if (eventError) {
        setLoadError(eventError.message)
        return
      }
      if (!eventData) {
        setNotFound(true)
        return
      }
      setEvent(eventData as EventWithOrganizer)

      const { data: ticketTypeData, error: ticketTypeError } = await supabase
        .from('ticket_types')
        .select('*')
        .eq('event_id', (eventData as EventRow).id)
        .order('sort_order', { ascending: true })
      if (cancelled) return
      if (ticketTypeError) {
        setLoadError(ticketTypeError.message)
        return
      }
      setTicketTypes((ticketTypeData ?? []) as TicketTypeRow[])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    let cancelled = false
    callFunction<FeeConfig>('public-fee-config')
      .then((cfg) => {
        if (!cancelled) setFeeConfig(cfg)
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

  const organizer = event
    ? Array.isArray(event.organizers)
      ? event.organizers[0]
      : event.organizers
    : null
  // Köpvillkor (A6) - bara satt för arrangörer som kräver godkännande.
  const termsUrl = organizer?.terms_url ?? null

  const remaining = event ? event.capacity - event.sold_count : 0
  const soldOut = event ? event.capacity > 0 && remaining <= 0 : false
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
      // Visa API:ets faktiska feltext (ordern 2026-10-01, A7) - ett 409-
      // svar kan betyda slutsålt ELLER t.ex. att arrangören saknar ett
      // klart betalningskonto, och de ska inte visas som samma fel. Den
      // generella fallbacken används bara när svaret saknar läsbar text.
      setFormError(err instanceof ApiError ? err.message : 'Något gick fel. Försök igen om en stund.')
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
      <p className="text-[var(--text-muted)] mb-1">
        {/* starts_at är null bara för ett ännu opublicerat dublicerat
            event (Tilläggsordern 2026-08-05) - RLS gör att den här sidan
            i praktiken aldrig når hit för ett sådant event, men typen
            tillåter null så vi faller tillbaka defensivt. */}
        {event.starts_at
          ? new Date(event.starts_at).toLocaleString('sv-SE', {
              dateStyle: 'long',
              timeStyle: 'short',
            })
          : ''}
        {event.venue ? ` · ${event.venue}` : ''}
        {organizer?.name ? ` · Arrangör: ${organizer.name}` : ''}
      </p>
      <p className="text-[var(--text-muted)] mb-8">
        {soldOut ? 'Slutsålt' : `${remaining} platser kvar av ${event.capacity}`}
      </p>

      {soldOut ? (
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
