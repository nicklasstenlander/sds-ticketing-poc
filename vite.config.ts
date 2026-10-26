import { glob, rm } from 'node:fs/promises'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Source maps genereras (hidden) så att CI kan ladda upp dem till Sentry
// när SENTRY_AUTH_TOKEN finns. De publiceras aldrig till GitHub Pages:
// pluginet raderar dem efter uppladdning, och closeBundle raderar
// eventuella rester om token saknas (uppladdningen hoppas då över).
function stripPublishedSourceMaps(): Plugin {
  return {
    name: 'strip-published-source-maps',
    apply: 'build',
    async closeBundle() {
      for await (const file of glob('dist/**/*.map')) {
        await rm(file, { force: true })
      }
    },
  }
}

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const sentryRelease = process.env.VITE_SENTRY_RELEASE

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    ...(sentryAuthToken
      ? sentryVitePlugin({
          org: 'nicklas-stenlander',
          project: 'sds-ticketing-poc',
          authToken: sentryAuthToken,
          // EU-region (de.sentry.io). Utan url pratar pluginet med sentry.io i US.
          url: 'https://de.sentry.io',
          telemetry: false,
          release: sentryRelease ? { name: sentryRelease } : undefined,
          sourcemaps: {
            filesToDeleteAfterUpload: ['./dist/**/*.map'],
          },
        })
      : []),
    stripPublishedSourceMaps(),
  ],
  build: {
    sourcemap: 'hidden',
  },
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
