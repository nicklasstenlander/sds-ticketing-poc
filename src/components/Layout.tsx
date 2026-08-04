import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

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
      <header className="bg-[var(--surface)] shadow-[var(--shadow-card)]">
        <div className={`mx-auto ${widthClass} px-4 py-4 flex items-center justify-between`}>
          <Link to="/" className="font-bold text-[var(--text)]">
            SODSS Biljett (PoC)
          </Link>
          <Link to="/admin" className="text-sm link-accent">
            Admin
          </Link>
        </div>
      </header>
      <main className={`flex-1 mx-auto w-full ${widthClass} px-4 py-8`}>{children}</main>
      <footer className="text-center text-xs py-4 text-[var(--text-muted)] border-t border-[var(--border)]">
        Proof of concept - inte kopplat till produktionsmiljön.
      </footer>
    </div>
  )
}
