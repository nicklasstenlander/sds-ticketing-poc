import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { callFunction } from '../../lib/functionsApi'
import type { AdminEventRow, DiscountCodeRow, DiscountType } from '../../lib/types'

interface DiscountCodesResponse {
  discount_codes: DiscountCodeRow[]
}

function eventTitleOf(code: DiscountCodeRow): string {
  const rel = code.events
  if (!rel) return 'Alla event'
  if (Array.isArray(rel)) return rel[0]?.title ?? 'Alla event'
  return rel.title ?? 'Alla event'
}

// Admin-sektion för rabattkoder (Tilläggsordern avsnitt 6). Ligger som en
// egen sektion i admin-dashboarden, bredvid export - koder är inte
// knutna till en enskild eventsida eftersom en kod kan gälla "alla event".
export function DiscountCodesSection({ events }: { events: AdminEventRow[] }) {
  const [codes, setCodes] = useState<DiscountCodeRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [code, setCode] = useState('')
  const [discountType, setDiscountType] = useState<DiscountType>('percent')
  const [value, setValue] = useState(10)
  const [eventId, setEventId] = useState<string>('') // '' = alla event
  const [maxUses, setMaxUses] = useState<string>('')
  const [validUntil, setValidUntil] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function loadCodes() {
    try {
      const res = await callFunction<DiscountCodesResponse>('admin-discount-codes', { auth: true })
      setCodes(res.discount_codes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte hämta rabattkoder.')
    }
  }

  useEffect(() => {
    loadCodes()
  }, [])

  function resetForm() {
    setCode('')
    setDiscountType('percent')
    setValue(10)
    setEventId('')
    setMaxUses('')
    setValidUntil('')
    setFormError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      // Kronor -> öre för beloppsrabatt. Procent skickas som heltal rakt av.
      const submittedValue = discountType === 'amount' ? Math.round(value * 100) : Math.round(value)
      await callFunction('admin-discount-codes', {
        auth: true,
        method: 'POST',
        body: {
          action: 'create',
          code,
          discount_type: discountType,
          value: submittedValue,
          event_id: eventId || null,
          max_uses: maxUses ? Number(maxUses) : null,
          valid_until: validUntil ? new Date(validUntil).toISOString() : null,
        },
      })
      resetForm()
      setShowForm(false)
      await loadCodes()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Kunde inte skapa rabattkoden.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggleActive(discountCode: DiscountCodeRow) {
    try {
      await callFunction('admin-discount-codes', {
        auth: true,
        method: 'POST',
        body: { action: 'update', discount_code_id: discountCode.id, active: !discountCode.active },
      })
      await loadCodes()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte uppdatera rabattkoden.')
    }
  }

  return (
    <section className="card">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-[var(--text)]">Rabattkoder</h2>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="text-sm link-accent"
        >
          {showForm ? 'Avbryt' : 'Ny kod +'}
        </button>
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-4 mb-6 border-b border-[var(--border)] pb-6">
          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Kod</label>
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="t.ex. SOMMAR25"
              className="field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Typ</label>
            <div className="flex gap-6 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={discountType === 'percent'}
                  onChange={() => setDiscountType('percent')}
                />
                Procent
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={discountType === 'amount'}
                  onChange={() => setDiscountType('amount')}
                />
                Kronor
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">
              Värde {discountType === 'percent' ? '(%)' : '(kr)'}
            </label>
            <input
              type="number"
              min={discountType === 'percent' ? 1 : 0}
              max={discountType === 'percent' ? 100 : undefined}
              step={discountType === 'percent' ? 1 : 0.01}
              required
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              className="field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Gäller</label>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="field">
              <option value="">Alla event</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]">Max antal (valfritt)</label>
              <input
                type="number"
                min={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="Obegränsat"
                className="field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]">Giltig till (valfritt)</label>
              <input
                type="datetime-local"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="field"
              />
            </div>
          </div>

          {formError && <p className="text-red-600 text-sm">{formError}</p>}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Skapar…' : 'Skapa rabattkod'}
          </button>
        </form>
      )}

      {codes === null && !error && <p className="text-[var(--text-muted)] text-sm">Laddar…</p>}
      {codes !== null && codes.length === 0 && (
        <p className="text-[var(--text-muted)] text-sm">Inga rabattkoder skapade ännu.</p>
      )}

      {codes !== null && codes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="py-2 pr-3">Kod</th>
                <th className="py-2 pr-3">Rabatt</th>
                <th className="py-2 pr-3">Gäller</th>
                <th className="py-2 pr-3">Använd</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-2 pr-3 font-mono">{c.code}</td>
                  <td className="py-2 pr-3">
                    {c.discount_type === 'percent' ? `${c.value}%` : `${(c.value / 100).toFixed(2)} kr`}
                  </td>
                  <td className="py-2 pr-3">{eventTitleOf(c)}</td>
                  <td className="py-2 pr-3">
                    {c.used_count}
                    {c.max_uses !== null ? ` / ${c.max_uses}` : ''}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        c.active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {c.active ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(c)}
                      className="text-slate-600 hover:text-slate-900 underline"
                    >
                      {c.active ? 'Inaktivera' : 'Aktivera'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
