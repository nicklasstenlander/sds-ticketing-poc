import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { TERMS_BY_SLUG } from '../content/terms'
import { markdownHeadings, renderMarkdown } from '../lib/simpleMarkdown'

// Villkorstextens egen rubrik ("# Köpvillkor …") och datumrad ("*Senast
// uppdaterad …*") visas i sidans rubrikyta i stället - de plockas bort ur
// brödtexten här, så själva texten i src/content/terms/ inte behöver
// ändras (den är juridiskt granskad).
function bodyWithoutTitle(body: string): string {
  return body
    .trim()
    .replace(/^# .*\n+/, '')
    .replace(/^\*Senast uppdaterad:[^*]*\*\n+/, '')
}

// /villkor/:slug (ordern "Köpvillkor som egen sida i Rideau" 2026-10-07).
// Ren frontend-sida - hämtar INGET från Supabase (ordertextens punkt 1:
// "ska fungera även om databasen är nere"), bara statiskt innehåll från
// src/content/terms/. Ingen inloggning krävs.
//
// Designöversynen 2026-11: samma mörka scen och rubrikyta som Om Rideau och
// Kontakt, innehållsförteckning (i sidled på bred skärm), och en ljus,
// svartvit utskrift.
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
      <Layout dark hero={<h1 className="page-title">Sidan finns inte</h1>}>
        <Link to="/evenemang" className="link-accent">
          Till alla föreställningar
        </Link>
      </Layout>
    )
  }

  const body = bodyWithoutTitle(content.BODY)
  const headings = markdownHeadings(body)
  const meta = `Senast uppdaterad ${content.LAST_UPDATED} · Version ${content.VERSION}`

  // HashRouter: en vanlig #ankarlänk skulle tolkas som en ny route, så
  // innehållsförteckningen scrollar och flyttar fokus själv.
  function jumpTo(id: string) {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    el.focus({ preventScroll: true })
  }

  return (
    <Layout
      dark
      wide
      hideChromeInPrint
      heroCompact
      hero={
        <>
          {/* history.length<=1 är en heuristik (ingen garanterat korrekt
              signal om "kom hit direkt" i webbläsare) - räcker för en
              diskret tillbaka-länk som annars faller tillbaka till
              startsidan, exakt vad ordertexten ber om. */}
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/evenemang'))}
            className="back-link"
          >
            <span aria-hidden="true">←</span> Tillbaka
          </button>
          <h1 className="page-title">{content.TITLE}</h1>
          <p className="page-lede">{meta}</p>
        </>
      }
    >
      {/* Rubrikytan döljs vid utskrift - titel och datum skrivs då här. */}
      <div className="terms-print-head">
        <h1>{content.TITLE}</h1>
        <p>{meta}</p>
      </div>

      {content.DRAFT && (
        <div className="print:hidden mb-6 rounded-[var(--radius-sm)] border border-[#ecd28c] bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning-ink)]">
          <strong>UTKAST</strong> – inte juridiskt granskat. Visas inte för kunder.
        </div>
      )}

      <div className="terms-layout">
        {headings.length > 2 && (
          <nav className="terms-toc" aria-label="Innehåll">
            <p className="terms-toc-title">Innehåll</p>
            <ol>
              {headings.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => jumpTo(h.id)}>
                    {h.text}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <article className="terms-body">
          {renderMarkdown(body)}
          <footer className="terms-foot">
            <p>{meta}</p>
            <button type="button" className="btn-secondary print:hidden" onClick={() => window.print()}>
              Skriv ut eller spara som PDF
            </button>
          </footer>
        </article>
      </div>
    </Layout>
  )
}
