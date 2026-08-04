import { Link } from 'react-router-dom'
import { APP_NAME } from '../lib/constants'

// / (roten av den publika sajten) - en statisk hero-sida, ingen egen logik
// förutom länken vidare. Bygger inte på den delade <Layout>-komponenten
// eftersom heron är helbild/mörk (--accent som bakgrund) medan Layout är
// byggd för den ljusa, smalare innehållsbredden som resten av sajten
// använder - se Tilläggsordern "ScenPass-designmockupen", avsnitt 2.
export function LandingPage() {
  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{ backgroundColor: 'var(--accent)' }}
    >
      {/* Dekorativa former - lågdetalj cirklar/trianglar, ren dekoration. */}
      <div
        aria-hidden="true"
        className="absolute rounded-full"
        style={{ width: 260, height: 260, top: -60, right: -60, background: '#F5A623', opacity: 0.18 }}
      />
      <div
        aria-hidden="true"
        className="absolute rounded-full"
        style={{ width: 140, height: 140, bottom: '18%', left: '-40px', background: '#FBD34D', opacity: 0.15 }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: -40,
          right: '12%',
          width: 0,
          height: 0,
          borderLeft: '90px solid transparent',
          borderRight: '90px solid transparent',
          borderBottom: '150px solid #F5A623',
          opacity: 0.12,
          transform: 'rotate(8deg)',
        }}
      />

      <header className="relative z-10 mx-auto w-full max-w-4xl px-4 py-4 flex items-center justify-between">
        <span className="font-bold" style={{ color: 'var(--accent-text)' }}>
          {APP_NAME}
        </span>
        <Link to="/admin" className="text-sm underline" style={{ color: 'rgba(255,255,255,0.75)' }}>
          Admin
        </Link>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 py-24">
        <div className="eyebrow mb-4" style={{ color: 'rgba(255,255,255,0.7)' }}>
          {APP_NAME}
        </div>
        <h1
          className="font-extrabold mb-4"
          style={{ color: 'var(--accent-text)', fontSize: 'clamp(32px, 6vw, 52px)', letterSpacing: '-0.01em', maxWidth: 640 }}
        >
          Biljetter till scenen, klara på under en minut.
        </h1>
        <p className="mb-10 max-w-md" style={{ color: 'rgba(255,255,255,0.75)', fontSize: 16 }}>
          Hitta en föreställning, köp biljett och få den direkt i mailen - inga konton, inget krångel.
        </p>
        <Link
          to="/evenemang"
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] font-bold"
          style={{
            backgroundColor: 'var(--accent-text)',
            color: 'var(--accent)',
            padding: '15px 28px',
            fontSize: 16,
          }}
        >
          Hitta biljetter <span aria-hidden="true">→</span>
        </Link>
      </main>

      <footer
        className="relative z-10 text-center text-xs py-4"
        style={{ color: 'rgba(255,255,255,0.5)' }}
      >
        Proof of concept - inte kopplat till produktionsmiljön.
      </footer>
    </div>
  )
}
