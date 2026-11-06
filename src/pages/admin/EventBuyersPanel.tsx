import { useEffect, useMemo, useState } from 'react'
import { SidePanel } from '../../components/SidePanel'
import { callFunction } from '../../lib/functionsApi'
import { formatKr } from '../../lib/formatPrice'
import { formatStockholmDateTimeLocale } from '../../lib/stockholmTime'
import { downloadCsv, fileSafe, printTable, splitBuyerName } from '../../lib/buyerExport'
import type { AdminEventRow, AdminOrderRow } from '../../lib/types'

interface EventTicketsResponse {
  orders: AdminOrderRow[]
}

interface Buyer {
  id: string
  first: string
  last: string
  email: string
  qty: number
  total_ore: number | null
  created_at: string
}

function kr(ore: number | null): string {
  return ore !== null ? formatKr(ore) : ''
}

// Klick på ett föreställningskort på Dashboard: lista över alla som köpt
// biljett till just den föreställningen. Hämtas från admin-event-tickets
// (samma läsande endpoint som eventdetaljsidan) när panelen öppnas.
// Bara betalda, icke-arkiverade ordrar räknas som köpare.
export function EventBuyersPanel({ event, onClose }: { event: AdminEventRow | null; onClose: () => void }) {
  const [orders, setOrders] = useState<AdminOrderRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [printBlocked, setPrintBlocked] = useState(false)
  const eventId = event?.id ?? null

  useEffect(() => {
    if (!eventId) return
    let cancelled = false
    setOrders(null)
    setError(null)
    setSearch('')
    setPrintBlocked(false)
    callFunction<EventTicketsResponse>(`admin-event-tickets?event_id=${encodeURIComponent(eventId)}`, { auth: true })
      .then((res) => {
        if (!cancelled) setOrders(res.orders)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Kunde inte hämta köpare.')
      })
    return () => {
      cancelled = true
    }
  }, [eventId])

  const buyers: Buyer[] = useMemo(
    () =>
      (orders ?? [])
        .filter((o) => o.status === 'paid' && !o.archived_at)
        .map((o) => {
          const { first, last } = splitBuyerName(o.buyer_name)
          return { id: o.id, first, last, email: o.buyer_email, qty: o.ticket_qty, total_ore: o.total_ore, created_at: o.created_at }
        })
        .sort((a, b) => a.last.localeCompare(b.last, 'sv') || a.first.localeCompare(b.first, 'sv')),
    [orders],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return buyers
    return buyers.filter((b) => `${b.first} ${b.last} ${b.email}`.toLowerCase().includes(q))
  }, [buyers, search])

  const ticketTotal = buyers.reduce((sum, b) => sum + b.qty, 0)
  const amountTotal = buyers.reduce((sum, b) => sum + (b.total_ore ?? 0), 0)
  const when = event?.starts_at
    ? formatStockholmDateTimeLocale(event.starts_at, { dateStyle: 'long', timeStyle: 'short' })
    : 'Inget datum satt'

  const header = ['Förnamn', 'Efternamn', 'E-post', 'Antal biljetter', 'Belopp (kr)']
  const rows = () => buyers.map((b) => [b.first, b.last, b.email, b.qty, kr(b.total_ore)])

  function handleCsv() {
    if (!event) return
    const csvRows = buyers.map((b) => [
      b.first,
      b.last,
      b.email,
      b.qty,
      kr(b.total_ore),
      formatStockholmDateTimeLocale(b.created_at, { dateStyle: 'short', timeStyle: 'short' }),
      b.id,
    ])
    downloadCsv(`kopare-${fileSafe(event.title)}.csv`, [...header, 'Köpt', 'Ordernummer'], csvRows)
  }

  function handlePrint() {
    if (!event) return
    const ok = printTable({
      title: event.title,
      subtitle: `${when}${event.venue ? ` · ${event.venue}` : ''} · ${buyers.length} köp · ${ticketTotal} biljetter`,
      header,
      rows: rows(),
      numericColumns: [3, 4],
    })
    setPrintBlocked(!ok)
  }

  return (
    <SidePanel
      open={Boolean(event)}
      title={event?.title ?? ''}
      subtitle={
        <>
          {when}
          {orders && (
            <>
              {' '}
              · {buyers.length} köp · {ticketTotal} biljetter · {formatKr(amountTotal)} kr
            </>
          )}
        </>
      }
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {printBlocked && (
            <p className="text-xs text-[var(--danger)]">Webbläsaren blockerade utskriftsfönstret – tillåt popup-fönster och försök igen.</p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1 !px-3 text-sm" onClick={handlePrint} disabled={buyers.length === 0}>
              Skriv ut / PDF
            </button>
            <button type="button" className="btn-primary flex-1 !px-3 text-sm" onClick={handleCsv} disabled={buyers.length === 0}>
              Exportera CSV
            </button>
          </div>
        </div>
      }
    >
      <div className="p-4 border-b border-[var(--border)]">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sök namn eller e-post…"
          className="field w-full text-sm"
        />
      </div>
      {error && <p className="p-5 text-sm text-[var(--danger)]">{error}</p>}
      {orders === null && !error && <p className="p-5 text-sm text-[var(--text-muted)]">Laddar…</p>}
      {orders !== null && visible.length === 0 && (
        <p className="p-5 text-sm text-[var(--text-muted)]">
          {buyers.length === 0 ? 'Inga sålda biljetter till den här föreställningen ännu.' : 'Ingen köpare matchar sökningen.'}
        </p>
      )}
      <ul>
        {visible.map((b) => {
          const initials = ((b.first[0] ?? '') + (b.last[0] ?? '')).toUpperCase() || '?'
          return (
            <li key={b.id} className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border)] last:border-0">
              <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--accent-text)] flex items-center justify-center text-xs font-bold shrink-0">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--text)] truncate">
                  {b.first} {b.last}
                </p>
                <p className="text-xs text-[var(--text-muted)] truncate">{b.email}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold tabular-nums">
                  {b.qty} {b.qty === 1 ? 'biljett' : 'biljetter'}
                </p>
                <p className="text-xs text-[var(--text-muted)] tabular-nums">{b.total_ore !== null ? `${formatKr(b.total_ore)} kr` : '–'}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </SidePanel>
  )
}
