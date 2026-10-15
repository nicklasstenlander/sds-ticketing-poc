import { useState } from 'react'
import type { FormEvent } from 'react'
import { Layout } from '../components/Layout'
import { callFunction, ApiError } from '../lib/functionsApi'

// /kontakt. Uppgifterna är hämtade ur köpvillkoren (src/content/terms/sds.ts,
// punkt 1) så att sajten säger samma sak överallt - ändras de där, ändra här.
const EMAIL = 'info@sollentunadansochscenskola.se'

// Intresseanmälan för nya arrangörer. Skickas till public-apply-organizer, som
// lägger en rad i ansökningskön i admin (aldrig ett konto) och mejlar
// platform-admins. Skydd finns server-side: honeypot, max 3 per IP och timme.
function ApplyForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('') // honeypot - ska alltid vara tomt för en människa
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSending(true)
    setError(null)
    try {
      await callFunction('public-apply-organizer', {
        method: 'POST',
        body: { organizer_name: name, email, message, website },
      })
      setSentTo(email)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Vi kunde inte skicka just nu. Försök igen om en stund, eller mejla oss.',
      )
    } finally {
      setSending(false)
    }
  }

  if (sentTo) {
    return (
      <div role="status" className="apply-done">
        <strong>Tack, vi har tagit emot din förfrågan.</strong>
        <span>Vi hör av oss till {sentTo}.</span>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="apply-form">
      <label className="block">
        <span className="block text-sm font-semibold mb-2">Förening eller verksamhet</span>
        <input required maxLength={120} className="field" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block">
        <span className="block text-sm font-semibold mb-2">E-post</span>
        <input
          required
          type="email"
          maxLength={254}
          autoComplete="email"
          className="field"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="block text-sm font-semibold mb-2">Berätta kort om er (valfritt)</span>
        <textarea
          rows={4}
          maxLength={2000}
          className="field"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      {/* Honeypot: dolt för människor, ifyllt av bottar. */}
      <div className="apply-hp" aria-hidden="true">
        <label>
          Lämna det här fältet tomt
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-[var(--danger)] font-semibold">
          {error}
        </p>
      )}
      <button type="submit" disabled={sending} className="btn-primary">
        {sending ? 'Skickar…' : 'Skicka förfrågan'}
      </button>
    </form>
  )
}

export function ContactPage() {
  return (
    <Layout
      dark
      termsSlug="sds"
      hero={
        <>
          <h1 className="page-title">Kontakt</h1>
          <p className="page-lede">Frågor om din biljett eller ditt köp? Hör av dig.</p>
        </>
      }
    >
      <div className="prose-page">
        <p className="prose-lead">
          Skriv till oss på{' '}
          <a className="link-accent" href={`mailto:${EMAIL}`}>
            {EMAIL}
          </a>
          .
        </p>
        <p>
          Berätta gärna vilken föreställning det gäller och vilken e-postadress du köpte med, så hittar vi ditt köp
          snabbare. Har du inte fått något bekräftelsemejl inom några minuter: titta i skräpposten först.
        </p>
        <h2>Vem säljer biljetterna</h2>
        <p>
          Biljetterna säljs av Moon Movements AB, som driver Sollentuna Dans &amp; Scenskola. Med licens från Nicklas
          Stenlander Marquart.
        </p>
        <dl className="contact-facts">
          <div>
            <dt>Organisationsnummer</dt>
            <dd>559317-1936</dd>
          </div>
          <div>
            <dt>Adress</dt>
            <dd>Grekfararvägen 7</dd>
          </div>
          <div>
            <dt>E-post</dt>
            <dd>
              <a className="link-accent" href={`mailto:${EMAIL}`}>
                {EMAIL}
              </a>
            </dd>
          </div>
        </dl>
        <h2>Vill du sälja biljetter via Rideau?</h2>
        <p>Skriv några rader om din verksamhet, så återkommer vi.</p>
        <ApplyForm />
        <p className="text-sm text-[var(--text-muted)]">
          Föredrar du mejl? Skriv till{' '}
          <a
            className="link-accent"
            href={`mailto:${EMAIL}?subject=${encodeURIComponent('Intresse av att sälja biljetter via Rideau')}`}
          >
            {EMAIL}
          </a>
          .
        </p>
      </div>
    </Layout>
  )
}
