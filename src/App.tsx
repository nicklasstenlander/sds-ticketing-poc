import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { PurchasePage } from './pages/PurchasePage'
import { ConfirmationPage } from './pages/ConfirmationPage'
import { AdminPage } from './pages/AdminPage'
import { AdminEventPage } from './pages/AdminEventPage'

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
        <Route path="/" element={<HomePage />} />
        <Route path="/kop/:slug" element={<PurchasePage />} />
        <Route path="/kop/:slug/klar" element={<ConfirmationPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/event/:id" element={<AdminEventPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
