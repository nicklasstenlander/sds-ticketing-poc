import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { callFunction } from '../lib/functionsApi'

// Väntelista på köpsidan (2026-11): visas bara när speltiden är slutsåld och
// arrangören har slagit på väntelistan. Arrangören erbjuder platser själv;
// den som står i kö får ett mejl med köplänk om det blir platser.
export function WaitlistForm({ eventSlug }: { eventSlug: string }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [qty, setQty] = useState(1)
  const [website, setWebsite] = useState('') // honeypot, ska vara tomt
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'joined' | 'already_joined' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await callFunction<{ result: 'joined' | 'already_joined' }>('public-join-waitlist', {
        method: 'POST',
        body: { event_slug: eventSlug, name: name.trim(), email: email.trim(), qty, website },
      })
      setDone(res.result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel. Försök igen.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="card" role="status">
        <p className="font-semibold mb-2 text-[var(--text)]">
          {done === 'joined' ? 'Du står på väntelistan.' : 'Du står redan på väntelistan.'}
        </p>
        <p className="text-[var(--text-muted)] text-sm">
          Blir det platser lediga mejlar vi dig en länk för att köpa. Platserna går till den som köper först.
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <p className="font-semibold mb-1 text-[var(--text)]">Slutsålt – ställ dig på väntelistan</p>
      <p className="text-[var(--text-muted)] text-sm mb-5">
        Blir det platser lediga mejlar vi dig en länk för att köpa. Först till kvarn gäller.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate={false}>
        <label className="block">
          <span className="block text-sm font-semibold mb-2 text-[var(--text)]">Namn</span>
          <input
            required
            autoComplete="name"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold mb-2 text-[var(--text)]">E-post</span>
          <input
            required
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold mb-2 text-[var(--text)]">Antal biljetter</span>
          <select value={qty} onChange={(e) => setQty(Number(e.target.value))} className="field max-w-[8rem]">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {/* Honeypot: dolt för människor, fylls bara i av robotar. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor={`${id}-website`}>Lämna tomt</label>
          <input
            id={`${id}-website`}
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          Vi använder bara dina uppgifter för att meddela dig om platser till den här föreställningen.
        </p>
        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Skickar…' : 'Ställ mig på väntelistan'}
        </button>
      </form>
    </div>
  )
}
