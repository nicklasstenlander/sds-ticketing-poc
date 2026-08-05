import { useState } from 'react'
import type { FormEvent } from 'react'
import { callFunction } from '../../lib/functionsApi'
import type { EventRow } from '../../lib/types'

interface CreateEventResponse {
  event: EventRow
}

const VAT_OPTIONS = [
  { value: 6, label: '6 % (standard, scenframträdande)' },
  { value: 12, label: '12 %' },
  { value: 25, label: '25 %' },
  { value: 0, label: '0 %' },
]

interface DraftTicketType {
  key: number
  name: string
  priceKr: number
  vatRate: number
  capacity: number
}

let nextKey = 1
function newTicketType(overrides: Partial<DraftTicketType> = {}): DraftTicketType {
  return { key: nextKey++, name: '', priceKr: 295, vatRate: 6, capacity: 150, ...overrides }
}

// 3-stegs skapandeflöde för nya event, enligt ScenPass-designmockupen
// (avsnitt 4), uppdaterat för biljettyper (Tilläggsordern avsnitt 5).
// Steg 2 "Lägg till biljetter" bygger nu upp EN ELLER FLERA biljettyper
// (namn, pris, moms, kapacitet var för sig) istället för ett enda
// pris/kapacitetspar på eventet självt. Publicera-steget skapar eventet
// som draft, skapar varje biljettyp, och publicerar sist - misslyckas
// något steg efter att eventet redan skapats stannar det kvar som draft
// (syns i admin-listan, kan färdigställas/publiceras manuellt därifrån)
// istället för att tyst försvinna.
export function CreateEventWizard({
  onCreated,
  onClose,
}: {
  onCreated: () => void
  onClose: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [published, setPublished] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [venue, setVenue] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [ticketTypes, setTicketTypes] = useState<DraftTicketType[]>([newTicketType({ name: 'Ordinarie' })])

  const steps = [
    { num: 1, label: 'Skapa föreställning' },
    { num: 2, label: 'Lägg till biljetter' },
    { num: 3, label: 'Publicera' },
  ]

  function resetFields() {
    setTitle('')
    setVenue('')
    setDate('')
    setTime('')
    setTicketTypes([newTicketType({ name: 'Ordinarie' })])
    setError(null)
  }

  function startAnother() {
    resetFields()
    setStep(1)
    setPublished(false)
  }

  const step1Valid = title.trim().length > 0 && date.length > 0 && time.length > 0
  const step2Valid =
    ticketTypes.length > 0 &&
    ticketTypes.every((t) => t.name.trim().length > 0 && t.capacity >= 1 && t.priceKr >= 0)

  function goNext(e?: FormEvent) {
    e?.preventDefault()
    setStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : s))
  }
  function goBack() {
    setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))
  }

  function updateTicketType(key: number, patch: Partial<DraftTicketType>) {
    setTicketTypes((types) => types.map((t) => (t.key === key ? { ...t, ...patch } : t)))
  }
  function addTicketType() {
    setTicketTypes((types) => [...types, newTicketType({ name: '' })])
  }
  function removeTicketType(key: number) {
    setTicketTypes((types) => (types.length > 1 ? types.filter((t) => t.key !== key) : types))
  }

  async function handlePublish() {
    setSubmitting(true)
    setError(null)
    try {
      const startsAt = new Date(`${date}T${time}`).toISOString()
      const { event } = await callFunction<CreateEventResponse>('admin-create-event', {
        auth: true,
        method: 'POST',
        body: { title, venue, starts_at: startsAt },
      })

      for (const t of ticketTypes) {
        await callFunction('admin-ticket-types', {
          auth: true,
          method: 'POST',
          body: {
            action: 'create',
            event_id: event.id,
            name: t.name,
            price_ore: Math.round(t.priceKr * 100),
            vat_rate: t.vatRate,
            capacity: t.capacity,
          },
        })
      }

      await callFunction('admin-update-event', {
        auth: true,
        method: 'POST',
        body: { event_id: event.id, status: 'published' },
      })

      setPublished(true)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte publicera eventet.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-semibold text-[var(--text)]">Nytt event</h2>
        <button type="button" onClick={onClose} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
          Avbryt
        </button>
      </div>

      {/* Stegindikator - tre cirklar med nummer, ifylld = klar/aktiv. */}
      <div className="flex items-center gap-2 mb-8">
        {steps.map((s) => {
          const active = s.num === step
          const done = s.num < step
          return (
            <div key={s.num} className="flex items-center gap-2.5 flex-1">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{
                  backgroundColor: active || done ? 'var(--accent)' : 'var(--accent-soft)',
                  color: active || done ? 'var(--accent-text)' : 'var(--text-muted)',
                }}
              >
                {done ? '✓' : s.num}
              </div>
              <div
                className="text-xs font-semibold"
                style={{ color: active ? 'var(--text)' : 'var(--text-muted)' }}
              >
                {s.label}
              </div>
            </div>
          )
        })}
      </div>

      {step === 1 && (
        <form onSubmit={goNext} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Titel</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="t.ex. Sommargalan"
              className="field"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Plats</label>
            <input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="t.ex. Aulan"
              className="field"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]">Datum</label>
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="field" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]">Tid</label>
              <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className="field" />
            </div>
          </div>
          <button type="submit" disabled={!step1Valid} className="btn-primary w-full">
            Fortsätt
          </button>
        </form>
      )}

      {step === 2 && (
        <div className="space-y-6">
          {ticketTypes.map((t, i) => (
            <div key={t.key} className="border border-[var(--border)] rounded-[var(--radius-sm)] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--text)]">Biljettyp {i + 1}</span>
                {ticketTypes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTicketType(t.key)}
                    className="text-xs text-red-600 hover:text-red-800 underline"
                  >
                    Ta bort
                  </button>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-2 text-[var(--text)]">Namn</label>
                <input
                  required
                  value={t.name}
                  onChange={(e) => updateTicketType(t.key, { name: e.target.value })}
                  placeholder="t.ex. Ordinarie, Barn, Student"
                  className="field"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-[var(--text)]">Platsantal</label>
                  <input
                    type="number"
                    min={1}
                    value={t.capacity}
                    onChange={(e) => updateTicketType(t.key, { capacity: Number(e.target.value) })}
                    className="field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-[var(--text)]">Pris (kr)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={t.priceKr}
                    onChange={(e) => updateTicketType(t.key, { priceKr: Number(e.target.value) })}
                    className="field"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2 text-[var(--text)]">Momssats</label>
                <select
                  value={t.vatRate}
                  onChange={(e) => updateTicketType(t.key, { vatRate: Number(e.target.value) })}
                  className="field"
                >
                  {VAT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}

          <button type="button" onClick={addTicketType} className="text-sm link-accent">
            + Lägg till en biljettyp till
          </button>

          <div className="flex gap-3">
            <button type="button" onClick={goBack} className="btn-secondary flex-1">
              Tillbaka
            </button>
            <button type="button" onClick={() => goNext()} disabled={!step2Valid} className="btn-primary flex-[2]">
              Fortsätt
            </button>
          </div>
        </div>
      )}

      {step === 3 && !published && (
        <div className="space-y-4">
          <div className="flex flex-col">
            {[
              ['Titel', title],
              ['Plats', venue || '–'],
              ['Datum', `${date} ${time}`],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between py-2.5 text-sm border-b border-[var(--border)] last:border-b-0"
              >
                <span className="text-[var(--text-muted)]">{label}</span>
                <span className="font-semibold text-[var(--text)]">{value}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <div className="text-sm text-[var(--text-muted)] mb-1">Biljettyper</div>
            {ticketTypes.map((t) => (
              <div key={t.key} className="flex justify-between py-1.5 text-sm">
                <span className="text-[var(--text)]">
                  {t.name} ({t.capacity} platser)
                </span>
                <span className="font-semibold text-[var(--text)]">
                  {t.priceKr.toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr (moms {t.vatRate}%)
                </span>
              </div>
            ))}
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-3 mt-2">
            <button type="button" onClick={goBack} disabled={submitting} className="btn-secondary flex-1">
              Tillbaka
            </button>
            <button type="button" onClick={handlePublish} disabled={submitting} className="btn-primary flex-[2]">
              {submitting ? 'Publicerar…' : 'Publicera'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && published && (
        <div className="text-center py-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 text-2xl"
            style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
          >
            ✓
          </div>
          <h3 className="font-extrabold text-lg mb-2 text-[var(--text)]">Föreställningen är publicerad.</h3>
          <p className="text-[var(--text-muted)] text-sm mb-6">{title} syns nu på köpsidan.</p>
          <div className="flex gap-3 justify-center">
            <button type="button" onClick={startAnother} className="btn-secondary">
              Skapa en till
            </button>
            <button type="button" onClick={onClose} className="btn-primary">
              Klar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
