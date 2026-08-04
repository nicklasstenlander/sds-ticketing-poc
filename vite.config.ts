import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages utan egen domän serverar från
  // https://<användarnamn>.github.io/sds-ticketing-poc/, inte från roten.
  // Utan rätt "base" blir alla asset-länkar (JS/CSS) trasiga. Byt ut
  // repo-namnet nedan om det faktiska GitHub-repot heter något annat.
  base: '/sds-ticketing-poc/',
})
