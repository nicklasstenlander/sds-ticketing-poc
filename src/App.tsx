import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LandingPage } from './pages/LandingPage'
import { EventsPage } from './pages/EventsPage'
import { PurchasePage } from './pages/PurchasePage'
import { ConfirmationPage } from './pages/ConfirmationPage'
import { AdminPage } from './pages/AdminPage'
import { AdminEventPage } from './pages/AdminEventPage'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { AdminWelcomePage } from './pages/AdminWelcomePage'

// HashRouter (URL:er som /#/admin), inte BrowserRouter: GitHub Pages har
// ingen serverkonfiguration som kan skicka godtyckliga sökvägar till
// index.html, så en direktnavigering till /admin eller en länk från ett
// biljettmail skulle annars ge ett 404 från GitHub istället för appen.
// Fulare URL:er, men kräver ingen serverkonfiguration - se README.md
// avsnitt 7.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/evenemang" element={<EventsPage />} />
        <Route path="/kop/:slug" element={<PurchasePage />} />
        <Route path="/kop/:slug/klar" element={<ConfirmationPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/event/:id" element={<AdminEventPage />} />
        <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
        <Route path="/admin/valkommen" element={<AdminWelcomePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
