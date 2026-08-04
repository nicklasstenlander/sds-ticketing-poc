import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-2xl px-4 py-3 flex items-center justify-between">
          <Link to="/" className="font-bold text-slate-800">
            SODSS Biljett (PoC)
          </Link>
          <Link to="/admin" className="text-sm text-slate-500 hover:text-slate-800">
            Admin
          </Link>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 py-8">{children}</main>
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Proof of concept - inte kopplat till produktionsmiljön.
      </footer>
    </div>
  )
}
