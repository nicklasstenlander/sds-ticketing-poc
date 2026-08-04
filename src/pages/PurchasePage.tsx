import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { callFunction, ApiError } from '../lib/functionsApi'
import type { EventRow } from '../lib/types'
import { Layout } from '../components/Layout'

interface CreateOrderResponse {
  checkout_url: string
}

export function PurchasePage() {
  const { slug } = useParams<{ slug: string }>()

  const [event, setEvent] = useState<EventRow | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [qty, setQty] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('slug', slug)
        .maybeSingle()
      if (cancelled) return
      if (error) setLoadError(error.message)
      else if (!data) setNotFound(true)
      else setEvent(data as EventRow)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [slug])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!event) return
    setSubmitting(true)
    setFormError(null)
    try {
      const result = await callFunction<CreateOrderResponse>('create-order', {
        method: 'POST',
        body: { slug: event.slug, name, email, qty },
      })
      // Fullständig sidomdirigering (inte en klientroutning) - Stripe
      // Checkout är en hostad sida, ingen komponent i denna app.
      window.location.href = result.checkout_url
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFormError('Tyvärr, eventet är slutsålt.')
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

  if (!event) {
    return (
      <Layout>
        <p className="text-[var(--text-muted)]">Laddar…</p>
      </Layout>
    )
  }

  const remaining = event.capacity - event.sold_count
  const soldOut = remaining <= 0

  return (
    <Layout>
      <div className="eyebrow mb-3">SODSS Biljett</div>
      <h1 className="text-2xl font-bold mb-2 text-[var(--text)]">{event.title}</h1>
      <p className="text-[var(--text-muted)] mb-1">
        {new Date(event.starts_at).toLocaleString('sv-SE', {
          dateStyle: 'long',
          timeStyle: 'short',
        })}
        {event.venue ? ` · ${event.venue}` : ''}
      </p>
      <p className="text-[var(--text-muted)] mb-2">
        {soldOut ? 'Slutsålt' : `${remaining} platser kvar av ${event.capacity}`}
      </p>
      <p className="font-medium mb-8 text-[var(--text)]">
        {(event.price_ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr
        <span className="text-[var(--text-muted)] font-normal"> (varav moms {event.vat_rate}%)</span>
      </p>

      {soldOut ? (
        <div className="card text-center">
          <p className="font-semibold mb-2 text-[var(--text)]">Tyvärr, det här eventet är slutsålt.</p>
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

          <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
            <span className="text-sm text-[var(--text-muted)]">Totalt</span>
            <span className="text-xl font-extrabold text-[var(--text)]">
              {((event.price_ore * qty) / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr
            </span>
          </div>

          {formError && <p className="text-red-600 text-sm">{formError}</p>}

          <button type="submit" disabled={submitting} className="btn-primary w-full py-2">
            {submitting ? 'Skickar dig till Stripe…' : 'Gå till betalning'}
          </button>
        </form>
      )}
    </Layout>
  )
}
