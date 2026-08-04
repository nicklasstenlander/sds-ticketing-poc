import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { callFunction } from '../lib/functionsApi'

interface OrderStatusResponse {
  status: 'pending' | 'paid' | 'expired' | 'cancelled'
  ticket_count: number | null
}

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 30000

// Bekräftelsesidan pollar order-status (aldrig en direkt Supabase-query mot
// orders - se motivering i supabase/functions/order-status/index.ts) tills
// webhooken hunnit markera ordern som betald. Stripe-webhooken kör oftast
// klart innan kunden är tillbaka från Checkout, men inte alltid - därför
// polling istället för att bara anta att betalningen redan är klar.
export function ConfirmationPage() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const orderId = searchParams.get('order')
  const wasCancelled = searchParams.get('cancelled') === '1'

  const [status, setStatus] = useState<OrderStatusResponse['status'] | 'timeout' | null>(null)
  const [ticketCount, setTicketCount] = useState<number | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const startedAtRef = useRef<number>(Date.now())

  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    startedAtRef.current = Date.now()

    async function poll() {
      try {
        const res = await callFunction<OrderStatusResponse>(`order-status?order_id=${orderId}`)
        if (cancelled) return
        setPollError(null)
        setTicketCount(res.ticket_count)
        if (res.status === 'paid' || res.status === 'expired' || res.status === 'cancelled') {
          setStatus(res.status)
          return // sluta polla, ett slutgiltigt tillstånd är nått
        }
        setStatus('pending')
        if (Date.now() - startedAtRef.current >= POLL_TIMEOUT_MS) {
          setStatus('timeout')
          return
        }
        setTimeout(poll, POLL_INTERVAL_MS)
      } catch (err) {
        if (cancelled) return
        setPollError(err instanceof Error ? err.message : 'Kunde inte hämta orderstatus.')
        if (Date.now() - startedAtRef.current >= POLL_TIMEOUT_MS) {
          setStatus('timeout')
          return
        }
        setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    poll()
    return () => {
      cancelled = true
    }
  }, [orderId])

  if (!orderId) {
    return (
      <Layout>
        <p className="text-[var(--text-muted)] mb-4">
          Vi hittar ingen orderinformation att visa (sidan öppnades förmodligen direkt, utan att
          gå via köpflödet).
        </p>
        {slug && (
          <Link to={`/kop/${slug}`} className="link-accent">
            Tillbaka till köpsidan
          </Link>
        )}
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="card mb-6">
        <div className="text-sm text-[var(--text-muted)] mb-2">Ordernummer</div>
        <div className="font-mono text-sm break-all text-[var(--text)]">{orderId}</div>
      </div>

      {wasCancelled && status !== 'paid' && (
        <p className="text-amber-800 bg-amber-50 rounded-[var(--radius-sm)] p-4 mb-6 text-sm">
          Betalningen avbröts. Din plats släpps automatiskt inom kort - du kan försöka igen direkt.
        </p>
      )}

      {(status === null || status === 'pending') && (
        <div className="card text-center">
          <p className="font-semibold mb-2 text-[var(--text)]">Ett ögonblick bara.</p>
          <p className="text-[var(--text-muted)] text-sm">
            Vi bekräftar din betalning - det brukar bara ta några sekunder. Lämna gärna sidan
            öppen.
          </p>
          {pollError && <p className="text-red-600 text-sm mt-3">{pollError}</p>}
        </div>
      )}

      {status === 'paid' && (
        <div className="card text-center border-t-4 border-[var(--accent)]">
          <p className="font-semibold mb-2 text-[var(--text)]">Vi ses på föreställningen.</p>
          <p className="text-[var(--text-muted)] text-sm">
            {ticketCount === 1 ? '1 biljett' : `${ticketCount ?? ''} biljetter`} väntar i din
            inkorg - vi har skickat ett mail med QR-koder till dig. Dyker det inte upp direkt,
            kolla skräpposten.
          </p>
        </div>
      )}

      {status === 'expired' && (
        <div className="card text-center">
          <p className="font-semibold mb-2 text-[var(--text)]">Tiden hann rinna ut</p>
          <p className="text-[var(--text-muted)] text-sm mb-4">
            Din plats är inte längre reserverad, och du har inte debiterats. Försök gärna igen.
          </p>
          {slug && (
            <Link to={`/kop/${slug}`} className="link-accent">
              Tillbaka till köpsidan
            </Link>
          )}
        </div>
      )}

      {status === 'cancelled' && (
        <div className="card text-center">
          <p className="font-semibold mb-2 text-[var(--text)]">Bokningen avbröts</p>
          {slug && (
            <Link to={`/kop/${slug}`} className="link-accent">
              Tillbaka till köpsidan
            </Link>
          )}
        </div>
      )}

      {status === 'timeout' && (
        <div className="card text-center">
          <p className="font-semibold mb-2 text-[var(--text)]">Det tar lite längre tid än vanligt</p>
          <p className="text-[var(--text-muted)] text-sm mb-4">
            Din betalning kan fortfarande gå igenom - ladda om sidan om en liten stund för att se
            var det landade. Ordernumret ovan gäller om du behöver höra av dig till oss.
          </p>
        </div>
      )}

      <Link to="/" className="link-accent inline-block mt-8">
        Till startsidan
      </Link>
    </Layout>
  )
}
