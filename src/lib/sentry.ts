// Felövervakning för Rideau-frontend (Vite + React).
// Importeras först i main.tsx, innan övrig appkod.
//
// DSN är en publik klientnyckel (VITE_SENTRY_DSN), samma mönster som
// VITE_SUPABASE_URL. Saknas den stängs Sentry av - bygget och sidan
// fungerar ändå. SENTRY_AUTH_TOKEN hör hemma bara i CI (source maps),
// aldrig här: allt med VITE_-prefix bakas in i bundlen.

import * as Sentry from '@sentry/react'
import { reactRouterBrowserTracingIntegration } from '@sentry/react/react-router'
import {
  scrubBreadcrumb,
  scrubSentryEvent,
  scrubSentrySpan,
  sentryDataCollection,
} from '../../supabase/functions/_shared/sentryPrivacy.ts'

const dsn = import.meta.env.VITE_SENTRY_DSN
const release = import.meta.env.VITE_SENTRY_RELEASE || (import.meta.env.PROD ? undefined : 'dev')
const environment = import.meta.env.MODE

if (dsn) {
  // SDK 11 tog bort sendDefaultPii ur typerna och ersatte det med
  // dataCollection (standard är att skicka IP, cookies, kroppar och query).
  // Vi sätter båda: dataCollection är det som gäller, sendDefaultPii: false
  // ligger kvar om en äldre runtime fortfarande läser fältet.
  Sentry.init({
    dsn,
    environment,
    release,
    sendDefaultPii: false,
    sampleRate: 1,
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1,
    dataCollection: sentryDataCollection,
    integrations: [
      reactRouterBrowserTracingIntegration(),
    ],
    // Bara anrop till våra egna edge functions får sentry-trace/baggage.
    // Supabase REST/Auth och Stripe ska inte få de headrarna (CORS och
    // onödig spridning av trace-id).
    tracePropagationTargets: [/^\//, /^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\//],
    denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-web-extension:\/\//],
    initialScope: {
      tags: { runtime: 'browser', service: 'sds-ticketing-poc' },
    },
    beforeSend(event) {
      return scrubSentryEvent(event)
    },
    // traceLifecycle är 'stream' som standard. beforeSendTransaction ignoreras
    // då; span-skrubbningen sker i beforeSendSpan.
    beforeSendSpan(span) {
      return scrubSentrySpan(span)
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb)
    },
  } as Sentry.BrowserOptions)
}
