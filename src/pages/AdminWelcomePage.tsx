import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { supabase } from '../lib/supabaseClient'
import { APP_NAME } from '../lib/constants'

// Välkomstsida för nyinbjudna arrangörer (Tilläggsordern 2026-08-06,
// "Självbetjänad onboarding av nya arrangörer"). Länken i
// platform-create-organizers inbjudningsmail pekar hit:
// `${FRONTEND_BASE_URL}/#/admin/valkommen`.
//
// VIKTIG DRIFTSFÄLLA - HashRouter + Supabase-inbjudningslänkar krockar:
// Supabase Auth bygger sin bekräftelseredirect genom att hänga på
// #access_token=...&refresh_token=...&type=invite&... EFTER redirectTo,
// vilket - eftersom redirectTo redan innehåller ett "#" (HashRouter-
// URL:er ser alltid ut som /#/admin/valkommen) - ger en URL med TVÅ
// "#"-tecken:
//   https://.../#/admin/valkommen#access_token=xxx&refresh_token=yyy&type=invite
// Webbläsaren själv känner bara igen den FÖRSTA "#" som fragmentstart,
// så window.location.hash blir HELA strängen
// "/admin/valkommen#access_token=xxx&...". Supabase-js:s egen
// auto-detection (detectSessionInUrl) parsar RAKT AV window.location.hash
// som en enda URLSearchParams-sträng från position 0 - med vår extra
// rutt-prefix framför blir nyckeln "/admin/valkommen#access_token" istället
// för "access_token", så den automatiska sessionsåterställningen MISSLYCKAS
// TYST. Lösningen här: lita inte på detectSessionInUrl alls. react-router
// (via `history`-paketet) parsar SJÄLV om window.location.hash internt och
// letar efter ytterligare "#"/"?" i strängen - useLocation().hash ger
// alltså korrekt "#access_token=xxx&refresh_token=yyy&type=invite" (utan
// rutt-prefixet), oberoende av supabase-js. Vi läser token:erna DÄRIFRÅN
// och anropar supabase.auth.setSession(...) manuellt istället.
type Stage = 'checking' | 'need-password' | 'invalid-link' | 'setting-password' | 'done' | 'session-error'

export function AdminWelcomePage() {
  const location = useLocation()
  const navigate = useNavigate()

  const [stage, setStage] = useState<Stage>('checking')
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    async function establishSession() {
      const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash
      const params = new URLSearchParams(hash)
      const accessToken = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      const type = params.get('type')

      if (!accessToken || !refreshToken || type !== 'invite') {
        setStage('invalid-link')
        return
      }

      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })

      if (error) {
        setSessionError(error.message)
        setStage('session-error')
        return
      }

      // Städa bort token:erna ur den synliga adressen - de har fyllt sitt
      // syfte (sessionen är nu etablerad i supabase-js), och ska inte bli
      // kvar synliga i webbläsarhistoriken eller kunna delas av misstag.
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/admin/valkommen`)

      setStage('need-password')
    }

    establishSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSetPassword(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (password.length < 8) {
      setFormError('Lösenordet måste vara minst 8 tecken.')
      return
    }
    if (password !== confirmPassword) {
      setFormError('Lösenorden matchar inte.')
      return
    }
    setStage('setting-password')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setFormError(error.message)
      setStage('need-password')
      return
    }
    setStage('done')
    navigate('/admin', { replace: true })
  }

  return (
    <Layout>
      <div className="card max-w-sm mx-auto">
        <div className="eyebrow mb-3">{APP_NAME}</div>
        <h1 className="text-xl font-bold mb-4 text-[var(--text)]">Välkommen</h1>

        {stage === 'checking' && <p className="text-[var(--text-muted)] text-sm">Verifierar inbjudan…</p>}

        {stage === 'invalid-link' && (
          <p className="text-red-600 text-sm">
            Ogiltig eller ofullständig inbjudningslänk. Be den som bjöd in dig att skicka en ny
            inbjudan.
          </p>
        )}

        {stage === 'session-error' && (
          <p className="text-red-600 text-sm">
            Länken har gått ut eller redan använts ({sessionError}). Be den som bjöd in dig att
            skicka en ny inbjudan.
          </p>
        )}

        {(stage === 'need-password' || stage === 'setting-password') && (
          <form onSubmit={handleSetPassword} className="space-y-4">
            <p className="text-sm text-[var(--text-muted)]">
              Sätt ett lösenord för att komma igång med ditt ScenPass-workspace.
            </p>
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]">Lösenord</label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]">Bekräfta lösenord</label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="field"
              />
            </div>
            {formError && <p className="text-red-600 text-sm">{formError}</p>}
            <button type="submit" disabled={stage === 'setting-password'} className="btn-primary w-full">
              {stage === 'setting-password' ? 'Sparar…' : 'Sätt lösenord och fortsätt'}
            </button>
          </form>
        )}

        {stage === 'done' && <p className="text-[var(--text-muted)] text-sm">Klart, skickar dig vidare…</p>}
      </div>
    </Layout>
  )
}
