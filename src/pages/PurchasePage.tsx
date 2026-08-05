import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { callFunction, ApiError } from '../lib/functionsApi'
import type { EventRow, TicketTypeRow } from '../lib/types'
import { Layout } from '../components/Layout'
import { APP_NAME } from '../lib/constants'

interface CreateOrderResponse {
  checkout_url: string
}

export function PurchasePage() {
  const { slug } = useParams<{ slug: string }>()

  const [event, setEvent] = useState<EventRow | null>(null)
  const [ticketTypes, setTicketTypes] = useState<TicketTypeRow[] | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [selectedTicketTypeId, setSelectedTicketTypeId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [qty, setQty] = useState(1)
  const [discountCode, setDiscountCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    async function load() {
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('*')
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
      setEvent(eventData as EventRow)

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
      const types = (ticketTypeData ?? []) as TicketTypeRow[]
      setTicketTypes(types)
      if (types.length === 1) setSelectedTicketTypeId(types[0].id)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [slug])

  const selectedTicketType = ticketTypes?.find((t) => t.id === selectedTicketTypeId) ?? null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!event || !selectedTicketType) return
    setSubmitting(true)
    setFormError(null)
    try {
      const result = await callFunction<CreateOrderResponse>('create-order', {
        method: 'POST',
        body: {
          slug: event.slug,
          ticket_type_id: selectedTicketType.id,
          name,
          email,
          qty,
          discount_code: discountCode.trim() || undefined,
        },
      })
      // Fullständig sidomdirigering (inte en klientroutning) - Stripe
      // Checkout är en hostad sida, ingen komponent i denna app.
      window.location.href = result.checkout_url
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFormError('Tyvärr, den biljettypen är slutsåld.')
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

  const remaining = selectedTicketType ? selectedTicketType.capacity - selectedTicketType.sold_count : 0
  const soldOut = selectedTicketType ? remaining <= 0 : false

  return (
    <Layout>
      <div className="eyebrow mb-3">{APP_NAME}</div>
      <h1 className="text-2xl font-bold mb-2 text-[var(--text)]">{event.title}</h1>
      <p className="text-[var(--text-muted)] mb-8">
        {new Date(event.starts_at).toLocaleString('sv-SE', {
          dateStyle: 'long',
          timeStyle: 'short',
        })}
        {event.venue ? ` · ${event.venue}` : ''}
      </p>

      {ticketTypes.length > 1 && (
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2 text-[var(--text)]">Välj biljettyp</label>
          <div className="space-y-2">
            {ticketTypes.map((t) => {
              const left = t.capacity - t.sold_count
              const isSoldOut = left <= 0
              const selected = t.id === selectedTicketTypeId
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={isSoldOut}
                  onClick={() => {
                    setSelectedTicketTypeId(t.id)
                    setQty(1)
                  }}
                  className={`card w-full text-left flex items-center justify-between gap-4 ${
                    selected ? 'border-l-4 border-l-[#dd5c86]' : ''
                  } ${isSoldOut ? 'opacity-50' : ''}`}
                >
                  <div>
                    <div className="font-semibold text-[var(--text)]">{t.name}</div>
                    <div className="text-sm text-[var(--text-muted)]">
                      {isSoldOut ? 'Slutsålt' : `${left} kvar`}
                    </div>
                  </div>
                  <div className="font-medium text-[var(--text)]">
                    {(t.price_ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {ticketTypes.length === 1 && selectedTicketType && (
        <p className="font-medium mb-8 text-[var(--text)]">
          {(selectedTicketType.price_ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr
          <span className="text-[var(--text-muted)] font-normal"> (varav moms {selectedTicketType.vat_rate}%)</span>
          {' · '}
          {soldOut ? 'Slutsålt' : `${remaining} platser kvar av ${selectedTicketType.capacity}`}
        </p>
      )}

      {!selectedTicketType ? (
        <div className="card text-center">
          <p className="text-[var(--text-muted)]">Välj en biljettyp ovan för att fortsätta.</p>
        </div>
      ) : soldOut ? (
        <div className="card text-center">
          <p className="font-semibold mb-2 text-[var(--text)]">Tyvärr, den biljettypen är slutsåld.</p>
          <p className="text-[var(--text-muted)] text-sm">Håll utkik efter fler tillfällen.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card space-y-4">
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
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Antal biljetter</label>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
                className="stepper-btn"
                aria-label="Färre biljetter"
              >
                –
              </button>
              <div className="text-lg font-bold min-w-[24px] text-center text-[var(--text)]">{qty}</div>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(6, remaining, q + 1))}
                disabled={qty >= Math.min(6, remaining)}
                className="stepper-btn"
                aria-label="Fler biljetter"
              >
                +
              </button>
            </div>
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
              Totalt {discountCode.trim() && '(innan ev. rabatt)'}
            </span>
            <span className="text-xl font-extrabold text-[var(--text)]">
              {((selectedTicketType.price_ore * qty) / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr
            </span>
          </div>

          {formError && <p className="text-red-600 text-sm">{formError}</p>}

          <button type="submit" disabled={submitting} className="btn-primary w-full py-2">
            {submitting ? 'Skickar dig till Stripe…' : 'Fortsätt till betalning'}
          </button>
        </form>
      )}
    </Layout>
  )
}
