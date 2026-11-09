import { useEffect, useState } from 'react'
import { SidePanel } from '../../components/SidePanel'
import { callFunction } from '../../lib/functionsApi'
import { formatStockholmDateTimeLocale } from '../../lib/stockholmTime'
import type { AdminEventRow, AdminOrderRow, EventRow } from '../../lib/types'

interface MoveResponse {
  result: 'moved'
  email_sent: boolean
  ticket_count: number
}

// "Flytta order" (2026-11): hela ordern flyttas till en annan speltid av
// SAMMA föreställning (samma titel och plats). Gamla biljetter makuleras och
// köparen får nya biljetter i ett nytt mejl. Reglerna kontrolleras i
// databasfunktionen move_paid_order - listan här visar bara de speltider
// som kan komma i fråga, med lediga platser.
export function MoveOrderPanel({
  order,
  event,
  onClose,
  onMoved,
}: {
  order: AdminOrderRow | null
  event: EventRow
  onClose: () => void
  onMoved: (message: string) => Promise<void> | void
}) {
  const [targets, setTargets] = useState<AdminEventRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!order) return
    setTargetId(null)
    setError(null)
    setLoadError(null)
    setTargets(null)
    callFunction<{ events: AdminEventRow[] }>('admin-events', { auth: true })
      .then((res) =>
        setTargets(
          res.events.filter(
            (e) =>
              e.id !== event.id &&
              e.status === 'published' &&
              !e.archived_at &&
              e.title === event.title &&
              (e.venue ?? '') === (event.venue ?? ''),
          ),
        ),
      )
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Kunde inte hämta speltiderna.'))
  }, [order, event.id, event.title, event.venue])

  async function handleMove() {
    if (!order || !targetId) return
    const target = targets?.find((t) => t.id === targetId)
    setBusy(true)
    setError(null)
    try {
      const res = await callFunction<MoveResponse>('admin-move-order', {
        auth: true,
        method: 'POST',
        body: { order_id: order.id, target_event_id: targetId },
      })
      const when = target?.starts_at ? formatWhen(target.starts_at) : 'den nya speltiden'
      await onMoved(
        res.email_sent
          ? `Flyttad till ${when}. Nya biljetter är skickade till ${order.buyer_email}.`
          : `Flyttad till ${when}, men mejlet med de nya biljetterna kunde inte skickas. Använd "Skicka biljetter igen" på ordern.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte flytta ordern.')
    } finally {
      setBusy(false)
    }
  }

  const qty = order?.ticket_qty ?? 0

  return (
    <SidePanel
      open={order !== null}
      title="Flytta order"
      subtitle={order ? `${order.buyer_name} · ${qty} ${qty === 1 ? 'biljett' : 'biljetter'}` : undefined}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-primary" disabled={!targetId || busy} onClick={handleMove}>
            {busy ? 'Flyttar…' : 'Flytta och skicka nya biljetter'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Avbryt
          </button>
        </div>
      }
    >
      {/* SidePanel lägger ingen egen luft runt innehållet. */}
      <div className="p-5">
      <p className="text-sm text-[var(--text-muted)] mb-4">
        Hela ordern flyttas. De gamla biljetterna slutar gälla och köparen får nya biljetter med nya QR-koder
        i ett mejl. Priset och kvittot ändras inte.
      </p>

      <p className="text-sm font-semibold text-[var(--text)] mb-2">
        Från: <span className="font-normal">{event.starts_at ? formatWhen(event.starts_at) : 'Inget datum'}</span>
      </p>

      <fieldset>
        <legend className="text-sm font-semibold text-[var(--text)] mb-2">Till speltid</legend>
        {loadError && <p className="text-sm text-[var(--danger)]">{loadError}</p>}
        {targets === null && !loadError && <p className="text-sm text-[var(--text-muted)]">Hämtar speltider…</p>}
        {targets !== null && targets.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">Föreställningen har inga andra publicerade speltider.</p>
        )}
        <div className="grid gap-2">
          {targets?.map((t) => {
            const free = Math.max(0, t.capacity - t.sold_count)
            const fits = free >= qty
            return (
              <label key={t.id} className={`move-target ${fits ? '' : 'is-disabled'} ${targetId === t.id ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="move-target"
                  value={t.id}
                  disabled={!fits || busy}
                  checked={targetId === t.id}
                  onChange={() => setTargetId(t.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold first-letter:uppercase">
                    {t.starts_at ? formatWhen(t.starts_at) : 'Inget datum'}
                  </span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {fits ? `${free} lediga platser` : free === 0 ? 'Slutsålt' : `Bara ${free} lediga platser`}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-[var(--danger)] mt-4">
          {error}
        </p>
      )}
      </div>
    </SidePanel>
  )
}

function formatWhen(iso: string): string {
  return formatStockholmDateTimeLocale(iso, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}
