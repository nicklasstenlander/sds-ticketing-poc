import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { APP_NAME } from '../lib/constants'
import { TERMS_BY_SLUG } from '../content/terms'
import { shouldShowTermsLink } from '../lib/termsLink'

interface LayoutProps {
  children: ReactNode
  // Adminsidan har en tvåkolumnslayout (eventlista + formulär/export) som
  // blir trång i den vanliga 672px-breda publika containern. `wide`
  // breddar bara containern - själva tvåkolumnsstrukturen i AdminPage.tsx
  // rörs inte.
  wide?: boolean
  // Köpvillkor-länk i footern (ordern "Köpvillkor som egen sida i Rideau"
  // 2026-10-07, punkt 3) - bara satt av de publika sidorna som ska visa
  // den (köpsida, bekräftelsesida), inte adminsidorna. Värdet är
  // arrangörens slug, t.ex. "sds" -> /villkor/sds. Länken visas bara när
  // den slugens innehåll faktiskt är klart (DRAFT=false, uppföljning
  // 2026-10-08) - se shouldShowTermsLink.
  termsSlug?: string
  // Döljer header/footer vid utskrift (ordern "Köpvillkor som egen sida"
  // 2026-10-07, punkt 1: "@media print: ingen header/knappar"). Opt-in,
  // bara TermsPage sätter den - ändrar inget för övriga sidors utskrift.
  hideChromeInPrint?: boolean
}

export function Layout({ children, wide = false, termsSlug, hideChromeInPrint = false }: LayoutProps) {
  const widthClass = wide ? 'max-w-4xl' : 'max-w-2xl'
  const printHiddenClass = hideChromeInPrint ? 'print:hidden' : ''
  const showTermsLink = shouldShowTermsLink(termsSlug, TERMS_BY_SLUG)
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] print:bg-white">
      {/* Mörk topbar med negativ logotyp (grafisk profil förslag 1,
          2026-10: "Logotyp på mörk bakgrund" - vit text + Rampljus-gnistor/
          svep). Admin-länken flyttad till sidfoten (ordern 2026-10-04) -
          diskret för en vanlig besökare, inte en framträdande huvudmeny-
          punkt. */}
      <header className={`bg-[var(--accent)] shadow-[var(--shadow-card)] ${printHiddenClass}`}>
        <div className={`mx-auto ${widthClass} px-4 py-4 flex items-center justify-between`}>
          <Link to="/" aria-label={APP_NAME}>
            {/* import.meta.env.BASE_URL, inte en hårdkodad "/" - Vite
                skriver bara om länkar i index.html för "base" (se
                vite.config.ts), inte src-strängar i JSX. */}
            <img
              src={`${import.meta.env.BASE_URL}rideau-logo-inverse.svg`}
              alt={APP_NAME}
              className="h-8 w-auto"
            />
          </Link>
        </div>
      </header>
      <main className={`flex-1 mx-auto w-full ${widthClass} px-4 py-8`}>{children}</main>
      <footer
        className={`mx-auto w-full ${widthClass} px-4 py-6 flex items-center justify-center gap-4 ${printHiddenClass}`}
      >
        {showTermsLink && (
          <Link
            to={`/villkor/${termsSlug}`}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] underline underline-offset-2"
          >
            Köpvillkor
          </Link>
        )}
        <Link
          to="/admin"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] underline underline-offset-2"
        >
          Admin
        </Link>
      </footer>
    </div>
  )
}
