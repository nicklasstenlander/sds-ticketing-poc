import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { APP_NAME } from '../lib/constants'

interface LayoutProps {
  children: ReactNode
  // Adminsidan har en tvåkolumnslayout (eventlista + formulär/export) som
  // blir trång i den vanliga 672px-breda publika containern. `wide`
  // breddar bara containern - själva tvåkolumnsstrukturen i AdminPage.tsx
  // rörs inte.
  wide?: boolean
}

export function Layout({ children, wide = false }: LayoutProps) {
  const widthClass = wide ? 'max-w-4xl' : 'max-w-2xl'
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      {/* Mörk topbar med negativ logotyp (grafisk profil förslag 1,
          2026-10: "Logotyp på mörk bakgrund" - vit text + Rampljus-gnistor/
          svep). --accent-text ger rätt kontrast för Admin-länken ovanpå
          Midnatt, till skillnad från .link-accent (Midnatt-på-Midnatt hade
          varit osynligt här). */}
      <header className="bg-[var(--accent)] shadow-[var(--shadow-card)]">
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
          <Link to="/admin" className="text-sm text-[var(--accent-text)] underline underline-offset-2">
            Admin
          </Link>
        </div>
      </header>
      <main className={`flex-1 mx-auto w-full ${widthClass} px-4 py-8`}>{children}</main>
    </div>
  )
}
