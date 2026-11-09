import { useCallback, useEffect, useState } from 'react'
import { callFunction } from '../../lib/functionsApi'
import { confirmDialog } from '../../lib/confirmDialog'

interface WaitlistEntry {
  id: string
  name: string
  email: string
  qty: number
  status: 'waiting' | 'offered'
  created_at: string
  offered_at: string | null
}

interface WaitlistResponse {
  entries: WaitlistEntry[]
  waitlist_enabled: boolean
  free_seats: number
}

// De första i kön vars önskade antal ryms i de lediga platserna (minst en,
// så knappen gör något även när inget är ledigt just nu).
function firstThatFit(waiting: WaitlistEntry[], freeSeats: number): WaitlistEntry[] {
  const picked: WaitlistEntry[] = []
  let seats = freeSeats
  for (const entry of waiting) {
    if (entry.qty > seats) break
    picked.push(entry)
    seats -= entry.qty
  }
  return picked.length > 0 ? picked : waiting.slice(0, 1)
}

// Väntelista per speltid (2026-11). Valfri: av som standard. Admin erbjuder
// platser själv - de valda får ett mejl med köplänk, och först till kvarn
// gäller (erbjudandet reserverar ingen plats).
export function WaitlistSection({ eventId }: { eventId: string }) {
  const [data, setData] = useState<WaitlistResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await callFunction<WaitlistResponse>(`admin-waitlist?event_id=${eventId}`, { auth: true })
      setData(res)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte hämta väntelistan.')
    }
  }, [eventId])

  useEffect(() => {
    load()
  }, [load])

  async function toggleEnabled(enabled: boolean) {
    setBusy(true)
    setMessage(null)
    try {
      await callFunction('admin-update-event', {
        auth: true,
        method: 'POST',
        body: { event_id: eventId, waitlist_enabled: enabled },
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte spara.')
    } finally {
      setBusy(false)
    }
  }

  async function offer() {
    if (!data) return
    const ids = [...selected]
    const wanted = data.entries.filter((e) => selected.has(e.id)).reduce((sum, e) => sum + e.qty, 0)
    const ok = await confirmDialog(
      `Skicka erbjudande till ${ids.length} ${ids.length === 1 ? 'person' : 'personer'} (vill ha ${wanted} ${
        wanted === 1 ? 'biljett' : 'biljetter'
      })? Just nu finns ${data.free_seats} lediga platser. Platserna reserveras inte – först till kvarn.`,
      { confirmLabel: 'Skicka erbjudande' },
    )
    if (!ok) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await callFunction<{ sent: number; failed: number }>('admin-waitlist', {
        auth: true,
        method: 'POST',
        body: { action: 'offer', event_id: eventId, entry_ids: ids },
      })
      setMessage(
        res.failed > 0
          ? `Skickat till ${res.sent}. ${res.failed} mejl kunde inte skickas – försök igen.`
          : `Erbjudande skickat till ${res.sent}.`,
      )
      setSelected(new Set())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte skicka.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(entry: WaitlistEntry) {
    if (!(await confirmDialog(`Ta bort ${entry.name} från väntelistan?`, { danger: true, confirmLabel: 'Ta bort' }))) return
    setBusy(true)
    try {
      await callFunction('admin-waitlist', {
        auth: true,
        method: 'POST',
        body: { action: 'remove', event_id: eventId, entry_id: entry.id },
      })
      selected.delete(entry.id)
      setSelected(new Set(selected))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte ta bort.')
    } finally {
      setBusy(false)
    }
  }

  const entries = data?.entries ?? []
  const waiting = entries.filter((e) => e.status === 'waiting')

  return (
    <section className="mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-extrabold">
          Väntelista{data && entries.length > 0 ? ` (${entries.length})` : ''}
        </h2>
        {data && (
          <label className="flex items-center gap-2 text-sm text-[var(--text)]">
            <input
              type="checkbox"
              checked={data.waitlist_enabled}
              disabled={busy}
              onChange={(e) => toggleEnabled(e.target.checked)}
            />
            Visa väntelista när speltiden är slutsåld
          </label>
        )}
      </div>

      {error && <p className="text-sm text-[var(--danger)] mb-2">{error}</p>}
      {message && (
        <p role="status" className="mb-3 rounded-[var(--radius-sm)] bg-[var(--success-soft)] px-4 py-2 text-sm text-[var(--success-ink)]">
          {message}
        </p>
      )}
      {data === null && !error && <p className="text-sm text-[var(--text-muted)]">Hämtar…</p>}

      {data && entries.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          {data.waitlist_enabled
            ? 'Ingen står i kö ännu. Köpare ser ett formulär när speltiden är slutsåld.'
            : 'Av. Slå på för att låta köpare ställa sig i kö när speltiden är slutsåld.'}
        </p>
      )}

      {data && entries.length > 0 && (
        <>
          <p className="text-sm text-[var(--text-muted)] mb-3">
            {data.free_seats > 0
              ? `${data.free_seats} ${data.free_seats === 1 ? 'plats är ledig' : 'platser är lediga'} just nu.`
              : 'Inga lediga platser just nu.'}{' '}
            Välj vilka som ska få ett erbjudande. De får ett mejl med köplänk, och först till kvarn gäller.
          </p>
          <div className="orders-table-wrap">
            <table className="orders-table">
              <thead>
                <tr>
                  <th scope="col" className="w-10">
                    <span className="sr-only">Välj</span>
                  </th>
                  <th scope="col">Namn</th>
                  <th scope="col" className="text-right">
                    Antal
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Åtgärd</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr key={entry.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Välj ${entry.name}`}
                        checked={selected.has(entry.id)}
                        disabled={busy}
                        onChange={(e) => {
                          const next = new Set(selected)
                          if (e.target.checked) next.add(entry.id)
                          else next.delete(entry.id)
                          setSelected(next)
                        }}
                      />
                    </td>
                    <td>
                      <span className="font-semibold">
                        {i + 1}. {entry.name}
                      </span>
                      <span className="orders-sub">{entry.email}</span>
                    </td>
                    <td className="text-right tabular-nums">{entry.qty}</td>
                    <td>
                      {entry.status === 'offered' ? (
                        <span className="badge badge-success">
                          Erbjuden{' '}
                          {entry.offered_at
                            ? new Date(entry.offered_at).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })
                            : ''}
                        </span>
                      ) : (
                        <span className="badge badge-neutral">I kö</span>
                      )}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="text-xs underline text-[var(--danger)]"
                        disabled={busy}
                        onClick={() => remove(entry)}
                      >
                        Ta bort
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" disabled={busy || selected.size === 0} onClick={offer}>
              {busy ? 'Skickar…' : `Erbjud plats (${selected.size})`}
            </button>
            {waiting.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => setSelected(new Set(firstThatFit(waiting, data.free_seats).map((e) => e.id)))}
              >
                Välj de första i kön
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
