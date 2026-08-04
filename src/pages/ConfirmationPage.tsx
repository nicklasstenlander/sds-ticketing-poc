import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { callFunction } from '../lib/functionsApi'
import { APP_NAME } from '../lib/constants'

interface OrderStatusTicket {
  ticket_code: string
  qr_url: string
}

interface OrderStatusResponse {
  status: 'pending' | 'paid' | 'expired' | 'cancelled'
  ticket_count: number | null
  tickets: OrderStatusTicket[] | null
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
  const [tickets, setTickets] = useState<OrderStatusTicket[] | null>(null)
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
        setTickets(res.tickets)
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
        <div className="text-center">
          <p className="font-semibold mb-6 text-[var(--text)]">Du är klar.</p>
          <p className="text-[var(--text-muted)] text-sm mb-6">
            Vi ses på föreställningen. Samma biljetter ligger också i mailet vi just skickade dig
            - dyker det inte upp direkt, kolla skräpposten.
          </p>

          {tickets === null && (
            <p className="text-[var(--text-muted)] text-sm">
              Hämtar {ticketCount === 1 ? 'din biljett' : `dina ${ticketCount ?? ''} biljetter`}…
            </p>
          )}

          <div className="flex flex-col gap-5 items-center">
            {tickets?.map((ticket, i) => (
              <div
                key={ticket.ticket_code}
                className="ticket-card ticket-reveal p-7 text-left mx-auto max-w-sm w-full"
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                <div className="eyebrow mb-1" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  {APP_NAME}
                </div>
                <div className="font-bold text-lg">
                  {tickets.length > 1 ? `Biljett ${i + 1} av ${tickets.length}` : '1 biljett'}
                </div>
                <div
                  className="border-t border-dashed mt-5 pt-5 flex flex-col items-center"
                  style={{ borderColor: 'rgba(255,255,255,0.25)' }}
                >
                  <img
                    src={ticket.qr_url}
                    alt={`QR-kod för biljett ${ticket.ticket_code}`}
                    width={160}
                    height={160}
                    className="rounded-xl bg-white p-3"
                  />
                  <div className="mono text-xs mt-4 tracking-widest" style={{ color: 'rgba(255,255,255,0.85)' }}>
                    {ticket.ticket_code}
                  </div>
                </div>
              </div>
            ))}
          </div>
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
