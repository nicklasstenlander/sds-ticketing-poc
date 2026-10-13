import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

const ITEMS = [
  { to: '/admin', label: 'Events', end: true },
  { to: '/admin/dashboard', label: 'Dashboard', end: false },
  { to: '/admin/organizers', label: 'Arrangörer', end: false },
  { to: '/admin/stripe-installning', label: 'Stripe', end: false },
  { to: '/admin/embed', label: 'Bädda in', end: false },
]

// Gemensam adminnavigering (ersätter fem egna länkrader per sida) -
// aktiv sida syns, och navigeringen scrollar horisontellt i smal vy
// istället för att radbryta. `actions` = workspace-väljare/Logga ut.
export function AdminNav({ actions }: { actions?: ReactNode }) {
  return (
    <div className="admin-nav">
      <nav aria-label="Admin" className="admin-nav-tabs">
        {ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="admin-nav-link">
            {item.label}
          </NavLink>
        ))}
      </nav>
      {actions && <div className="admin-nav-actions">{actions}</div>}
    </div>
  )
}
