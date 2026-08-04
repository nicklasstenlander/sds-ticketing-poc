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
        <p className="text-slate-600 mb-4">
          Vi hittar ingen orderinformation att visa (sidan öppnades förmodligen direkt, utan att
          gå via köpflödet).
        </p>
        {slug && (
          <Link to={`/kop/${slug}`} className="text-slate-900 underline">
            Tillbaka till köpsidan
          </Link>
        )}
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="border border-slate-200 rounded-lg p-4 bg-white mb-6">
        <div className="text-sm text-slate-500 mb-2">Ordernummer</div>
        <div className="font-mono text-sm break-all">{orderId}</div>
      </div>

      {wasCancelled && status !== 'paid' && (
        <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-sm">
          Betalningen avbröts i Stripe. Platserna släpps automatiskt när reservationen går ut - du
          kan försöka igen direkt.
        </p>
      )}

      {(status === null || status === 'pending') && (
        <div className="border border-slate-200 rounded-lg p-6 bg-white text-center">
          <p className="font-semibold mb-2">Biljetterna är på väg…</p>
          <p className="text-slate-500 text-sm">
            Vi väntar på bekräftelse från Stripe. Det brukar ta några sekunder - lämna inte sidan.
          </p>
          {pollError && <p className="text-red-600 text-sm mt-3">{pollError}</p>}
        </div>
      )}

      {status === 'paid' && (
        <div className="border border-green-200 bg-green-50 rounded-lg p-6 text-center">
          <p className="font-semibold mb-2">Tack för din bokning!</p>
          <p className="text-slate-600 text-sm">
            {ticketCount === 1 ? '1 biljett' : `${ticketCount ?? ''} biljetter`} är bokade. Ett
            mail med QR-koder skickas till din e-postadress inom kort - kolla skräpposten om det
            inte dyker upp direkt.
          </p>
        </div>
      )}

      {status === 'expired' && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-6 text-center">
          <p className="font-semibold mb-2">Betalningen hann gå ut</p>
          <p className="text-slate-600 text-sm mb-4">
            Reservationen är inte längre giltig. Du har inte debiterats - försök gärna igen.
          </p>
          {slug && (
            <Link to={`/kop/${slug}`} className="text-slate-900 underline">
              Tillbaka till köpsidan
            </Link>
          )}
        </div>
      )}

      {status === 'cancelled' && (
        <div className="border border-slate-200 rounded-lg p-6 bg-white text-center">
          <p className="font-semibold mb-2">Bokningen avbröts</p>
          {slug && (
            <Link to={`/kop/${slug}`} className="text-slate-900 underline">
              Tillbaka till köpsidan
            </Link>
          )}
        </div>
      )}

      {status === 'timeout' && (
        <div className="border border-amber-200 bg-amber-50 rounded-lg p-6 text-center">
          <p className="font-semibold mb-2">Det tar längre tid än väntat</p>
          <p className="text-slate-600 text-sm mb-4">
            Betalningen kan fortfarande gå igenom - ladda om sidan om en liten stund för att se
            aktuell status. Ordernumret ovan gäller om du behöver kontakta oss.
          </p>
        </div>
      )}

      <Link to="/" className="inline-block mt-6 text-slate-900 underline">
        Till startsidan
      </Link>
    </Layout>
  )
}
