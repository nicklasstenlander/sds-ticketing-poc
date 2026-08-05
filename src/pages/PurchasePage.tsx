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

const MAX_TOTAL_QTY = 6

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
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    async function load() {
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('*, organizers(name)')
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

  const remaining = event ? event.capacity - event.sold_count : 0
  const soldOut = event ? event.capacity > 0 && remaining <= 0 : false
  const totalQty = Object.values(quantities).reduce((sum, q) => sum + q, 0)
  const totalOre = (ticketTypes ?? []).reduce(
    (sum, t) => sum + (quantities[t.id] ?? 0) * t.price_ore,
    0,
  )
  const maxSelectable = Math.min(MAX_TOTAL_QTY, remaining)

  function setQty(ticketTypeId: string, qty: number) {
    setQuantities((q) => ({ ...q, [ticketTypeId]: Math.max(0, qty) }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!event || totalQty < 1) return
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
        },
      })
      // Fullständig sidomdirigering (inte en klientroutning) - Stripe
      // Checkout är en hostad sida, ingen komponent i denna app.
      window.location.href = result.checkout_url
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFormError('Tyvärr, det räcker inte längre platser för den kombinationen.')
      } else {
        setFormError(err instanceof Error ? err.message : 'Något gick fel.')
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
        {(() => {
          const organizer = Array.isArray(event.organizers) ? event.organizers[0] : event.organizers
          return organizer?.name ? ` · Arrangör: ${organizer.name}` : ''
        })()}
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

            <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
              <span className="text-sm text-[var(--text-muted)]">
                Totalt ({totalQty} {totalQty === 1 ? 'biljett' : 'biljetter'})
                {discountCode.trim() && ' (innan ev. rabatt)'}
              </span>
              <span className="text-xl font-extrabold text-[var(--text)]">
                {(totalOre / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr
              </span>
            </div>

            {formError && <p className="text-red-600 text-sm">{formError}</p>}

            <button type="submit" disabled={submitting || totalQty < 1} className="btn-primary w-full py-2">
              {submitting
                ? 'Skickar dig till Stripe…'
                : totalQty < 1
                  ? 'Välj minst en biljett'
                  : 'Fortsätt till betalning'}
            </button>
          </div>
        </form>
      )}
    </Layout>
  )
}
