import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { callFunction, ApiError } from '../lib/functionsApi'
import type { EventRow } from '../lib/types'
import { Layout } from '../components/Layout'

interface CreateOrderResponse {
  order_id: string
  tickets: { id: string; ticket_code: string }[]
}

export function PurchasePage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()

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
      navigate(`/kop/${event.slug}/klar`, {
        state: {
          orderId: result.order_id,
          tickets: result.tickets,
          eventTitle: event.title,
          email,
        },
      })
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
        <p className="text-slate-600">Eventet hittades inte, eller är inte publicerat.</p>
      </Layout>
    )
  }

  if (!event) {
    return (
      <Layout>
        <p className="text-slate-500">Laddar…</p>
      </Layout>
    )
  }

  const remaining = event.capacity - event.sold_count
  const soldOut = remaining <= 0

  return (
    <Layout>
      <h1 className="text-2xl font-bold mb-1">{event.title}</h1>
      <p className="text-slate-500 mb-1">
        {new Date(event.starts_at).toLocaleString('sv-SE', {
          dateStyle: 'long',
          timeStyle: 'short',
        })}
        {event.venue ? ` · ${event.venue}` : ''}
      </p>
      <p className="text-slate-500 mb-6">
        {soldOut ? 'Slutsålt' : `${remaining} platser kvar av ${event.capacity}`}
      </p>

      {soldOut ? (
        <div className="border border-slate-200 rounded-lg p-6 bg-white text-center">
          <p className="font-semibold mb-2">Tyvärr, det här eventet är slutsålt.</p>
          <p className="text-slate-500 text-sm">Håll utkik efter fler tillfällen.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="border border-slate-200 rounded-lg p-6 bg-white space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="name">
              Namn
            </label>
            <input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="email">
              E-post
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="qty">
              Antal biljetter
            </label>
            <select
              id="qty"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              {Array.from({ length: Math.min(6, remaining) }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {formError && <p className="text-red-600 text-sm">{formError}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-slate-900 text-white rounded-md py-2 font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Bokar…' : 'Boka (ingen betalning i PoC)'}
          </button>
        </form>
      )}
    </Layout>
  )
}
