import { Link, useLocation, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'

interface ConfirmationState {
  orderId: string
  tickets: { id: string; ticket_code: string }[]
  eventTitle: string
  email: string
}

export function ConfirmationPage() {
  const { slug } = useParams<{ slug: string }>()
  const location = useLocation()
  const state = location.state as ConfirmationState | null

  if (!state) {
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
      <h1 className="text-2xl font-bold mb-2">Tack för din bokning!</h1>
      <p className="text-slate-600 mb-1">
        Biljett(er) till <strong>{state.eventTitle}</strong> är bokade.
      </p>
      <p className="text-slate-600 mb-6">
        Ett mail med QR-koder har skickats till <strong>{state.email}</strong>. Kommer det inte
        fram direkt, kolla skräpposten - eller använd koderna i klartext nedan.
      </p>

      <div className="border border-slate-200 rounded-lg p-4 bg-white mb-6">
        <div className="text-sm text-slate-500 mb-2">Ordernummer</div>
        <div className="font-mono text-sm break-all">{state.orderId}</div>
      </div>

      <div className="border border-slate-200 rounded-lg p-4 bg-white">
        <div className="text-sm text-slate-500 mb-3">
          Biljettkoder (klartext-reserv om mailet med QR-bild inte visas)
        </div>
        <ul className="space-y-2">
          {state.tickets.map((ticket) => (
            <li key={ticket.id} className="font-mono text-lg tracking-widest">
              {ticket.ticket_code}
            </li>
          ))}
        </ul>
      </div>

      <Link to="/" className="inline-block mt-6 text-slate-900 underline">
        Till startsidan
      </Link>
    </Layout>
  )
}
