import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../../lib/supabaseClient'

// Riktig Supabase Auth-inloggning (e-post + lösenord) - ersätter den
// delade admin-PIN-koden (Tilläggsordern 2026-08-05, "Flera arrangörer:
// riktiga inloggningar och dataisolering"). Ingen arrangörsväljare här:
// vilken arrangör användaren tillhör härleds uteslutande server-side via
// organizer_members (se _shared/organizerAuth.ts), aldrig valt i UI:t.
export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError('Fel e-postadress eller lösenord.')
      setLoading(false)
      return
    }
    onSuccess()
    setLoading(false)
  }

  return (
    <div className="card max-w-sm mx-auto mt-6 sm:mt-12 p-8">
      <h1 className="text-2xl font-extrabold mb-1 text-[var(--text)]">Logga in</h1>
      <p className="text-sm text-[var(--text-muted)] mb-6">Admin för arrangörer</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="block text-sm font-semibold mb-2 text-[var(--text)]">E-post</label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="username"
            placeholder="namn@arrangor.se"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="login-password" className="block text-sm font-semibold mb-2 text-[var(--text)]">Lösenord</label>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Lösenord"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
          />
        </div>
        {error && <p role="alert" className="text-[var(--danger)] text-sm font-medium">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Loggar in…' : 'Logga in'}
        </button>
      </form>
    </div>
  )
}
