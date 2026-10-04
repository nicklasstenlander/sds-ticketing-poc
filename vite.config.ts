import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relativ bas ('./'), inte ett hårdkodat repo-namn som '/sds-ticketing-
  // poc/' - samma bygge fungerar DÅ oförändrat både under
  // https://<användarnamn>.github.io/sds-ticketing-poc/ OCH i roten av en
  // egen domän (https://biljetter.sollentunadansochscenskola.se/), utan
  // att vite.config.ts behöver ändras när domänen byts. Se docs/domain.md.
  // OBS: om import.meta.env.BASE_URL någonsin används för att bygga en
  // ABSOLUT URL (inte bara ett <img src>/<script src>, som webbläsaren
  // själv löser upp relativt sidans egen adress) duger INTE en enkel
  // sammanslagning av origin+BASE_URL längre, eftersom BASE_URL nu bara
  // är den relativa strängen "./" - se AdminEmbedPage.tsx embedScriptUrl()
  // som istället använder new URL(..., window.location.href).
  base: './',
})
