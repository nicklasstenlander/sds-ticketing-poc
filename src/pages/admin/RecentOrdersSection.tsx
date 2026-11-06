import { useCallback, useEffect, useRef, useState } from 'react'
import { callFunction } from '../../lib/functionsApi'
import { supabase } from '../../lib/supabaseClient'
import { formatKr } from '../../lib/formatPrice'
import { formatStockholmDateTimeLocale } from '../../lib/stockholmTime'
import type { RecentOrderRow, RecentOrdersResponse } from '../../lib/types'
import { OrderDetailPanel, OrderStatusBadge } from './OrderDetailPanel'

// Samma topic/event som _shared/orderBroadcast.ts (edge functions).
const orderChannelTopic = (organizerId: string) => `rideau-orders:${organizerId}`
const ORDER_PAID_EVENT = 'order_paid'

function eventTime(order: RecentOrderRow): string {
  return order.event.starts_at
    ? formatStockholmDateTimeLocale(order.event.starts_at, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Inget datum satt'
}

function orderPrice(order: RecentOrderRow): string {
  return order.total_ore !== null ? `${formatKr(order.total_ore)} kr` : '–'
}

interface RecentOrdersSectionProps {
  /** Anropas när en ny försäljning kommit in - så Dashboard kan räkna om korten. */
  onNewSale?: () => void
}

// "Senaste ordrar" på /admin/dashboard - motsvarigheten till Anmälningar
// i CORE. Bara läsning (admin-recent-orders). 25 ordrar per sida; en sida
// hämtas först när man klickar på den. Listan uppdateras av sig själv när
// stripe-webhooken signalerar en ny betald order (Realtime Broadcast, se
// _shared/orderBroadcast.ts), och kan alltid uppdateras manuellt.
export function RecentOrdersSection({ onNewSale }: RecentOrdersSectionProps) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<RecentOrdersResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<RecentOrderRow | null>(null)
  const [pendingNew, setPendingNew] = useState(0)
  const [live, setLive] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const pageRef = useRef(page)
  const requestSeq = useRef(0)
  const onNewSaleRef = useRef(onNewSale)
  onNewSaleRef.current = onNewSale

  const load = useCallback(async (targetPage: number) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await callFunction<RecentOrdersResponse>(`admin-recent-orders?page=${targetPage}`, { auth: true })
      if (seq !== requestSeq.current) return
      setData(res)
      setPage(res.page)
      pageRef.current = res.page
      setLastUpdated(new Date())
      if (res.page === 1) setPendingNew(0)
    } catch (err) {
      if (seq !== requestSeq.current) return
      setError(err instanceof Error ? err.message : 'Kunde inte hämta ordrar.')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(1)
  }, [load])

  // Realtidsprenumeration. Kanalen kräver arrangörens id, som kommer i
  // första svaret - prenumerera först när det finns (och byt kanal om
  // en platform-admin bytt workspace).
  const organizerId = data?.organizer_id ?? null
  useEffect(() => {
    if (!organizerId) return
    let debounce: ReturnType<typeof setTimeout> | null = null
    const channel = supabase
      .channel(orderChannelTopic(organizerId))
      .on('broadcast', { event: ORDER_PAID_EVENT }, () => {
        onNewSaleRef.current?.()
        if (pageRef.current === 1) {
          // Samla ihop flera pingar som kommer tätt (t.ex. omkörningar).
          if (debounce) clearTimeout(debounce)
          debounce = setTimeout(() => load(1), 800)
        } else {
          // Rör inte sidan man tittar på - visa en notis istället.
          setPendingNew((n) => n + 1)
        }
      })
      .subscribe((status) => setLive(status === 'SUBSCRIBED'))
    return () => {
      if (debounce) clearTimeout(debounce)
      setLive(false)
      supabase.removeChannel(channel)
    }
  }, [organizerId, load])

  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? 25
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const orders = data?.orders ?? []

  return (
    <section className="mb-10">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-xl font-extrabold text-[var(--text)]">Senaste ordrar</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5 flex items-center gap-1.5">
            <span
              className={`inline-block w-2 h-2 rounded-full ${live ? 'bg-[var(--success)]' : 'bg-[var(--border-strong)]'}`}
              aria-hidden="true"
            />
            {live ? 'Uppdateras automatiskt vid nya köp' : 'Ansluter till live-uppdatering…'}
            {lastUpdated && (
              <span>
                {' '}
                · senast hämtad{' '}
                {lastUpdated.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <button type="button" className="btn-secondary !min-h-[36px] !px-4 !py-1.5 text-sm" onClick={() => load(page)} disabled={loading}>
          <span className={loading ? 'inline-block animate-spin' : 'inline-block'} aria-hidden="true">
            ↻
          </span>
          {loading ? 'Hämtar…' : 'Uppdatera'}
        </button>
      </div>

      {pendingNew > 0 && (
        <button
          type="button"
          onClick={() => load(1)}
          className="w-full mb-3 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-4 py-2 text-sm font-semibold text-[var(--accent)] hover:underline"
        >
          {pendingNew === 1 ? '1 ny order' : `${pendingNew} nya ordrar`} har kommit in – visa senaste
        </button>
      )}

      {error && <p className="text-[var(--danger)] mb-3 text-sm">{error}</p>}

      {/* Köparen i EN kolumn (namn + e-post under) och föreställningen med
          tiden under - sparar två kolumner så tabellen ryms utan sidledsscroll
          på en vanlig skärm. Under 640px blir varje order ett eget kort. */}
      {data === null && loading && <p className="orders-empty">Laddar…</p>}
      {data !== null && orders.length === 0 && <p className="orders-empty">Inga sålda biljetter ännu.</p>}
      {orders.length > 0 && (
        <>
          <div className="orders-table-wrap hidden sm:block">
            <table className="orders-table">
              <thead>
                <tr>
                  <th scope="col">Köpare</th>
                  <th scope="col">Föreställning</th>
                  <th scope="col" className="text-right">
                    Antal
                  </th>
                  <th scope="col" className="text-right">
                    Pris
                  </th>
                </tr>
              </thead>
              <tbody className={loading ? 'opacity-60' : ''}>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <button type="button" onClick={() => setSelected(order)} className="orders-buyer">
                        {order.buyer_name || '—'}
                      </button>
                      <div className="orders-sub">{order.buyer_email}</div>
                    </td>
                    <td>
                      <div className="line-clamp-1">{order.event.title}</div>
                      <div className="orders-sub tabular-nums">
                        {eventTime(order)}
                        {order.status !== 'paid' && (
                          <span className="ml-2 align-middle">
                            <OrderStatusBadge status={order.status} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-right tabular-nums">{order.ticket_qty}</td>
                    <td className="text-right tabular-nums whitespace-nowrap">{orderPrice(order)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className={`orders-cards sm:hidden ${loading ? 'opacity-60' : ''}`}>
            {orders.map((order) => (
              <li key={order.id}>
                <button type="button" onClick={() => setSelected(order)} className="orders-card">
                  <span className="orders-card-top">
                    <span className="orders-buyer">{order.buyer_name || '—'}</span>
                    <span className="tabular-nums font-semibold">{orderPrice(order)}</span>
                  </span>
                  <span className="orders-sub line-clamp-1">{order.event.title}</span>
                  <span className="orders-sub tabular-nums">
                    {eventTime(order)} · {order.ticket_qty} {order.ticket_qty === 1 ? 'biljett' : 'biljetter'}
                  </span>
                  {order.status !== 'paid' && (
                    <span className="mt-1">
                      <OrderStatusBadge status={order.status} />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {total > pageSize && (
        <div className="flex items-center justify-between gap-3 mt-3 text-sm">
          <span className="text-[var(--text-muted)] tabular-nums">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} av {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary !min-h-[34px] !px-3 !py-1 text-sm"
              onClick={() => load(page - 1)}
              disabled={loading || page <= 1}
            >
              ← Nyare
            </button>
            <span className="tabular-nums text-[var(--text-muted)]">
              Sida {page} av {pageCount}
            </span>
            <button
              type="button"
              className="btn-secondary !min-h-[34px] !px-3 !py-1 text-sm"
              onClick={() => load(page + 1)}
              disabled={loading || page >= pageCount}
            >
              Äldre →
            </button>
          </div>
        </div>
      )}

      <OrderDetailPanel order={selected} onClose={() => setSelected(null)} />
    </section>
  )
}
