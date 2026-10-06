import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Självhostade typsnitt (ordern "Före försäljning" 2026-10-05, 1.1) -
// INTE Google Fonts längre (src/index.css importerade tidigare
// fonts.googleapis.com på alla sidor, vilket skickade besökarens
// IP-adress till Google vid varje sidladdning). Bara de vikter som
// faktiskt används i koden: Manrope 400/500/600/700/800 (samtliga
// Tailwind font-*-klasser som förekommer), JetBrains Mono bara 400
// (.eyebrow/.mono i index.css sätter aldrig en tyngre vikt - Tailwinds
// EGEN font-mono-verktygsklass, använd på tre ställen, pekar för övrigt
// inte ens på --font-mono utan på Tailwinds inbyggda default-monospace-
// stack, orört här). Varje vikt-fil innehåller redan en "latin"-
// unicode-range (U+0000-00FF) som täcker å/ä/ö - ingen separat
// latin-ext-import behövs för det.
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import '@fontsource/jetbrains-mono/400.css'
import './index.css'
import { App } from './App'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root-elementet saknas i index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
