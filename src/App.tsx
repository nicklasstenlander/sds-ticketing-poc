import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { EventsPage } from './pages/EventsPage'
import { PurchasePage } from './pages/PurchasePage'
import { ConfirmationPage } from './pages/ConfirmationPage'
import { AdminPage } from './pages/AdminPage'
import { AdminEventPage } from './pages/AdminEventPage'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { AdminWelcomePage } from './pages/AdminWelcomePage'
import { AdminOrganizersPage } from './pages/AdminOrganizersPage'
import { AdminStripeSettingsPage } from './pages/AdminStripeSettingsPage'

// HashRouter (URL:er som /#/admin), inte BrowserRouter: GitHub Pages har
// ingen serverkonfiguration som kan skicka godtyckliga sökvägar till
// index.html, så en direktnavigering till /admin eller en länk från ett
// biljettmail skulle annars ge ett 404 från GitHub istället för appen.
// Fulare URL:er, men kräver ingen serverkonfiguration - se README.md
// avsnitt 7.
//
// Ingen egen landningssida längre (Tilläggsordern 2026-08-07,
// "Omdöpning: ScenPass -> Rideau", avsnitt 3) - Squarespace har en egen
// sida som länkar direkt till /evenemang. "/" (och alla okända sökvägar)
// redirectar hit istället för att 404:a eller visa en borttagen sida.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/evenemang" replace />} />
        <Route path="/evenemang" element={<EventsPage />} />
        <Route path="/kop/:slug" element={<PurchasePage />} />
        <Route path="/kop/:slug/klar" element={<ConfirmationPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/event/:id" element={<AdminEventPage />} />
        <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
        <Route path="/admin/valkommen" element={<AdminWelcomePage />} />
        <Route path="/admin/organizers" element={<AdminOrganizersPage />} />
        <Route path="/admin/stripe-installning" element={<AdminStripeSettingsPage />} />
        <Route path="*" element={<Navigate to="/evenemang" replace />} />
      </Routes>
    </HashRouter>
  )
}
