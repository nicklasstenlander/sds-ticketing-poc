import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { TERMS_BY_SLUG } from '../content/terms'
import { renderMarkdown } from '../lib/simpleMarkdown'

// /villkor/:slug (ordern "Köpvillkor som egen sida i Rideau" 2026-10-07).
// Ren frontend-sida - hämtar INGET från Supabase (ordertextens punkt 1:
// "ska fungera även om databasen är nere"), bara statiskt innehåll från
// src/content/terms/. Ingen inloggning krävs.
export function TermsPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const content = slug ? TERMS_BY_SLUG[slug] : undefined

  // <meta name="robots" content="noindex"> i utkastläge (punkt 2) - appen
  // är en ren klient-SPA utan server-rendering, så det finns ingen
  // <head>-mall att sätta taggen i statiskt. Ett litet bibliotek
  // (react-helmet e.dyl.) hade löst samma sak, men ordertexten ber
  // uttryckligen att undvika tunga beroenden - en enkel DOM-manipulation
  // i en effekt räcker för det här enda fallet.
  useEffect(() => {
    if (!content?.DRAFT) return
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => {
      document.head.removeChild(meta)
    }
  }, [content?.DRAFT])

  if (!content) {
    return (
      <Layout>
        <p className="text-[var(--text-muted)] mb-4">Sidan finns inte.</p>
        <Link to="/evenemang" className="link-accent">
          Till startsidan
        </Link>
      </Layout>
    )
  }

  return (
    <Layout hideChromeInPrint>
      <div className="print:hidden mb-6">
        {/* history.length<=1 är en heuristik (ingen garanterat korrekt
            signal om "kom hit direkt" i webbläsare) - räcker för en
            diskret tillbaka-länk som annars faller tillbaka till
            startsidan, exakt vad ordertexten ber om. */}
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/evenemang'))}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] underline underline-offset-2"
        >
          ← Tillbaka
        </button>
      </div>

      {content.DRAFT && (
        <div className="print:hidden mb-6 rounded-[var(--radius-sm)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>UTKAST</strong> – inte juridiskt granskat. Visas inte för kunder.
        </div>
      )}

      <div className="max-w-prose print:text-black">{renderMarkdown(content.BODY)}</div>

      <div className="mt-10 pt-6 border-t border-[var(--border)] text-xs text-[var(--text-muted)] print:text-black">
        <p>Senast uppdaterad: {content.LAST_UPDATED}</p>
        <p>Version {content.VERSION}</p>
      </div>
    </Layout>
  )
}
