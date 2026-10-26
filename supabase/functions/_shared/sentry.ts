// Felövervakning för Supabase Edge Functions (Deno).
//
// Importeras och await:as INNAN Deno.serve() i varje funktions index.ts.
// Saknas SENTRY_DSN, eller om SDK:t inte kan starta, kör funktionen vidare
// utan Sentry - en trasig felrapport får inte stoppa köp eller webhook.
//
// Supabase kör inte Denos --preload-importkrok, så init sker här.
// denoServeIntegration (SDK:ts officiella Deno.serve-krok) fångar fel och
// spann. Den exporterar inte wrapDenoRequestHandler, så vi lägger ett
// flush-lager under den kroken: vid ett kastat fel väntar vi in flush,
// annars schemaläggs flush via EdgeRuntime.waitUntil så isolatet inte
// fryser innan händelsen hunnit iväg. Request-kroppar (köparnamn, e-post,
// Stripe-payload) skickas inte.

import {
  scrubBreadcrumb,
  scrubSentryEvent,
  scrubSentrySpan,
  sentryDataCollection,
} from './sentryPrivacy.ts'

const DSN = Deno.env.get('SENTRY_DSN')
const ENVIRONMENT = Deno.env.get('SENTRY_ENVIRONMENT') || 'production'
const RELEASE = Deno.env.get('SENTRY_RELEASE') || undefined

type SentryModule = typeof import('npm:@sentry/deno@11.9.0')

let sentry: SentryModule | null = null
let startup: Promise<void> | null = null

function scheduleFlush(): void {
  if (!sentry) return
  const pending = sentry.flush(2000).then(
    () => undefined,
    () => undefined,
  )
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime
  if (typeof runtime?.waitUntil === 'function') {
    try {
      runtime.waitUntil(pending)
    } catch {
      // waitUntil finns bara i Supabase. Lokalt räcker det att servern lever.
    }
  }
}

// Installeras FÖRE Sentry.init. denoServeIntegration ersätter sedan Deno.serve
// och anropar den här proxyn med sin redan wrappade handler, så flush sker
// efter att SDK:t både avslutat spannet och köat felet.
function installFlushPatch(sdk: SentryModule): void {
  const realServe = Deno.serve
  const flushProxy = new Proxy(realServe, {
    apply(target, thisArg, args: unknown[]) {
      const wrap = (handler: (request: Request, info: Deno.ServeHandlerInfo) => Response | Promise<Response>) =>
        async (request: Request, info: Deno.ServeHandlerInfo) => {
          try {
            return await handler(request, info)
          } catch (error) {
            try {
              await sdk.flush(2000)
            } catch {
              // rapporteringen får inte dölja det ursprungliga felet
            }
            throw error
          } finally {
            scheduleFlush()
          }
        }

      const next = [...args]
      if (typeof next[0] === 'function') {
        next[0] = wrap(next[0] as (request: Request, info: Deno.ServeHandlerInfo) => Response | Promise<Response>)
      } else if (next.length >= 2 && typeof next[1] === 'function') {
        next[1] = wrap(next[1] as (request: Request, info: Deno.ServeHandlerInfo) => Response | Promise<Response>)
      } else if (
        next[0] &&
        typeof next[0] === 'object' &&
        'handler' in next[0] &&
        typeof (next[0] as { handler?: unknown }).handler === 'function'
      ) {
        const options = { ...(next[0] as Record<string, unknown>) }
        options.handler = wrap(options.handler as (request: Request, info: Deno.ServeHandlerInfo) => Response | Promise<Response>)
        next[0] = options
      }
      return Reflect.apply(target, thisArg, next)
    },
  })

  const descriptor = Object.getOwnPropertyDescriptor(Deno, 'serve')
  Object.defineProperty(Deno, 'serve', {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? true,
    writable: true,
    value: flushProxy,
  })
}

async function start(): Promise<void> {
  if (!DSN) return
  try {
    const sdk = await import('npm:@sentry/deno@11.9.0')
    installFlushPatch(sdk)
    sdk.init({
      dsn: DSN,
      environment: ENVIRONMENT,
      release: RELEASE,
      serverName: 'sds-ticketing-poc',
      // SDK 11 ersatte sendDefaultPii med dataCollection. Båda sätts:
      // false är en no-op om fältet ignoreras, dataCollection är det som gäller.
      sendDefaultPii: false,
      sampleRate: 1,
      tracesSampleRate: ENVIRONMENT === 'development' ? 1 : 0.2,
      dataCollection: sentryDataCollection,
      tracePropagationTargets: [/^\//, /^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\//],
      enableOpenTelemetrySetup: false,
      enableRuntimeChannelInjection: false,
      integrations: (integrations) =>
        integrations.map((integration) =>
          integration.name === 'DenoServe'
            ? sdk.denoServeIntegration({
                maxRequestBodySize: 'none',
                ignoreRequestBody: () => true,
                sessions: false,
              })
            : integration,
        ),
      initialScope: {
        tags: { runtime: 'deno', service: 'sds-ticketing-poc' },
      },
      beforeSend(event) {
        return scrubSentryEvent(event)
      },
      beforeSendSpan(span) {
        return scrubSentrySpan(span)
      },
      beforeBreadcrumb(breadcrumb) {
        return scrubBreadcrumb(breadcrumb)
      },
    })
    sentry = sdk
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    console.error('Sentry init misslyckades. Edge function körs utan felövervakning.', message.replace(DSN, '[Filtered]'))
    sentry = null
  }
}

/** Anropas en gång per isolate, innan Deno.serve. */
export function instrumentEdgeFunctions(): Promise<void> {
  if (!startup) startup = start()
  return startup
}

/** Fångade fel (t.ex. Stripe-webhookens 500) som inte når Deno.serve som kast. */
export async function captureEdgeException(error: unknown): Promise<void> {
  if (!sentry) return
  try {
    sentry.captureException(error)
    await sentry.flush(2000)
  } catch {
    // rapporteringen får inte fälla den riktiga responsen
  }
}
