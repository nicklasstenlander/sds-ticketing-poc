import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { callFunction, getAdminToken } from '../lib/functionsApi'
import type { EventRow, TicketRow } from '../lib/types'

interface AdminEventTicketsResponse {
  event: EventRow
  tickets: TicketRow[]
}

const STATUS_LABEL: Record<TicketRow['status'], string> = {
  valid: 'Giltig (ej incheckad)',
  checked_in: 'Incheckad',
  void: 'Annullerad',
}

const STATUS_STYLE: Record<TicketRow['status'], string> = {
  valid: 'bg-slate-100 text-slate-700',
  checked_in: 'bg-green-100 text-green-700',
  void: 'bg-red-100 text-red-700',
}

export function AdminEventPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<AdminEventTicketsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!getAdminToken()) {
      navigate('/admin')
      return
    }
    if (!id) return
    let cancelled = false
    async function load() {
      try {
        const res = await callFunction<AdminEventTicketsResponse>(
          `admin-event-tickets?event_id=${id}`,
          { auth: true },
        )
        if (!cancelled) setData(res)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Kunde inte hämta data.')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, navigate])

  return (
    <Layout>
      <Link to="/admin" className="text-sm text-slate-500 hover:text-slate-800">
        &larr; Tillbaka till admin
      </Link>

      {error && <p className="text-red-600 mt-4">{error}</p>}
      {!data && !error && <p className="text-slate-500 mt-4">Laddar…</p>}

      {data && (
        <div className="mt-4">
          <h1 className="text-2xl font-bold">{data.event.title}</h1>
          <p className="text-slate-500 mb-6">
            {new Date(data.event.starts_at).toLocaleString('sv-SE', {
              dateStyle: 'long',
              timeStyle: 'short',
            })}
            {data.event.venue ? ` · ${data.event.venue}` : ''} · {data.event.sold_count} /{' '}
            {data.event.capacity} sålda
          </p>

          <h2 className="font-semibold mb-3">Biljetter ({data.tickets.length})</h2>
          {data.tickets.length === 0 ? (
            <p className="text-slate-500">Inga biljetter sålda ännu.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="px-4 py-2">Kod</th>
                    <th className="px-4 py-2">Innehavare</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Incheckad</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tickets.map((ticket) => (
                    <tr key={ticket.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 font-mono">{ticket.ticket_code}</td>
                      <td className="px-4 py-2">{ticket.holder_name ?? '-'}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[ticket.status]}`}
                        >
                          {STATUS_LABEL[ticket.status]}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {ticket.checked_in_at
                          ? new Date(ticket.checked_in_at).toLocaleString('sv-SE', {
                              dateStyle: 'short',
                              timeStyle: 'medium',
                            })
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Layout>
  )
}
