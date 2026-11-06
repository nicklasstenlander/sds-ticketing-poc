import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

const ITEMS = [
  { to: '/admin', label: 'Föreställningar', end: true },
  { to: '/admin/dashboard', label: 'Översikt', end: false },
  { to: '/admin/organizers', label: 'Arrangörer', end: false },
  { to: '/admin/stripe-installning', label: 'Betalningar', end: false },
  { to: '/admin/embed', label: 'Bädda in', end: false },
  { to: '/admin/affischer', label: 'Affischer', end: false },
]

// Gemensam adminnavigering (ersätter fem egna länkrader per sida) -
// aktiv sida syns, och navigeringen scrollar horisontellt i smal vy
// istället för att radbryta. `actions` = workspace-väljare/Logga ut.
export function AdminNav({ actions }: { actions?: ReactNode }) {
  // En föreställnings egen sida (/admin/event/:id) hör till fliken
  // Föreställningar - annars är ingen flik markerad där.
  const { pathname } = useLocation()
  const onEventPage = pathname.startsWith('/admin/event/')
  return (
    <div className="admin-nav">
      <nav aria-label="Admin" className="admin-nav-tabs">
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `admin-nav-link ${isActive || (item.to === '/admin' && onEventPage) ? 'active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      {actions && <div className="admin-nav-actions">{actions}</div>}
    </div>
  )
}
