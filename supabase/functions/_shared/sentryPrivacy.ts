// Gemensam PII-skrubbning för webbläsaren (@sentry/react) och
// Supabase Edge Functions (@sentry/deno). Ingen runtime-specifik import,
// så samma fil kan köras i Vite, Node-tester och Deno.
//
// SDK 11 samlar som standard användarinfo, cookies, HTTP-kroppar och
// query-parametrar (det som tidigare styrdes av sendDefaultPii). Den
// inbyggda denylisten täcker bara nycklar som auth/token/password/key.
// Köparnamn, e-post, telefon och betalningsfält måste därför filtreras
// här, och request-kroppar tas bort helt.

export const FILTERED = '[Filtered]'

/** Nycklar som SDK:ts dataCollection-denylist matchar partiellt (skiftlägesokänsligt). */
export const SENTRY_KEY_DENY = [
  'email',
  'e-mail',
  'phone',
  'mobile',
  'tel',
  'name',
  'buyer',
  'holder',
  'address',
  'postal',
  'zip',
  'token',
  'secret',
  'password',
  'passwd',
  'pwd',
  'cookie',
  'authorization',
  'apikey',
  'api_key',
  'api-key',
  'cvv',
  'cvc',
  'iban',
  'card',
  'payment',
  'personnummer',
  'ssn',
  'otp',
  'pin',
  'signature',
  'session',
  'bearer',
  'stripe',
  'order_id',
  'ticket',
  'qr',
] as const

export const sentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { deny: [...SENTRY_KEY_DENY] },
  httpBodies: [] as Array<'incomingRequest' | 'outgoingRequest' | 'incomingResponse' | 'outgoingResponse'>,
  urlQueryParams: { deny: [...SENTRY_KEY_DENY] },
  databaseQueryData: false,
  stackFrameVariables: false,
  queues: false,
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  graphQL: { document: false, variables: false },
}

const PARTIAL_OBJECT_KEYS = [
  'email',
  'e-mail',
  'phone',
  'mobile',
  'token',
  'secret',
  'password',
  'passwd',
  'cvv',
  'cvc',
  'iban',
  'personnummer',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'api-key',
  'payment',
  'otp',
  'buyer',
  'holder',
  'ticket_code',
  'client_secret',
  'bearer',
  'credit',
  'ssn',
  'stripe-signature',
  'stripe_signature',
  'request_body',
  'requestbody',
  'response_body',
  'responsebody',
]

const EXACT_OBJECT_KEYS = new Set([
  'tel',
  'pwd',
  'pin',
  'card',
  'order_id',
  'qr_url',
  'ip',
  'ip_address',
  'client_ip',
  'remote_addr',
])

const NAME_PARENTS = new Set([
  'user',
  'data',
  'body',
  'extra',
  'request',
  'form',
  'fields',
  'customer',
  'buyer',
  'metadata',
  'query',
  'query_string',
  'params',
  'input',
  'headers',
])

const NAME_KEYS = new Set(['name', 'username', 'user_name', 'firstname', 'lastname', 'fullname', 'first_name', 'last_name', 'full_name', 'address'])

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE_RE = /\+\d{8,15}\b|\b07\d{8}\b/g
const SECRET_RES = [
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+\b/g,
  /\bwhsec_[A-Za-z0-9]+\b/g,
  /\bre_[A-Za-z0-9]{8,}\b/g,
  /\bsb_secret_[A-Za-z0-9_-]+\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
]

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/-/g, '_')
}

function isSensitiveQueryKey(key: string): boolean {
  const normalized = normalizeKey(key)
  if (EXACT_OBJECT_KEYS.has(normalized) || NAME_KEYS.has(normalized)) return true
  return SENTRY_KEY_DENY.some((part) => normalized.includes(normalizeKey(part)))
}

function shouldFullyRedact(key: string, parentKey: string | null): boolean {
  const normalized = normalizeKey(key)
  if (EXACT_OBJECT_KEYS.has(normalized)) return true
  if (PARTIAL_OBJECT_KEYS.some((part) => normalized.includes(normalizeKey(part)))) return true
  if (normalized === 'ip' || normalized.endsWith('_ip') || normalized.includes('ip_address') || normalized.includes('client_address')) {
    return true
  }
  if (NAME_KEYS.has(normalized) && parentKey !== null && NAME_PARENTS.has(normalizeKey(parentKey))) return true
  if (parentKey !== null && normalizeKey(parentKey) === 'headers' && isSensitiveQueryKey(key)) return true
  return false
}

export function scrubFreeText(value: string): string {
  let next = value
  for (const pattern of SECRET_RES) {
    pattern.lastIndex = 0
    next = next.replace(pattern, FILTERED)
  }
  EMAIL_RE.lastIndex = 0
  next = next.replace(EMAIL_RE, FILTERED)
  PHONE_RE.lastIndex = 0
  next = next.replace(PHONE_RE, FILTERED)
  return next
}

function scrubQueryString(qs: string): string {
  if (!qs) return qs
  const hadQuestion = qs.startsWith('?')
  const raw = hadQuestion ? qs.slice(1) : qs
  if (!raw.includes('=')) return hadQuestion ? `?${scrubFreeText(raw)}` : scrubFreeText(raw)
  const parts = raw.split('&').map((part) => {
    if (!part) return part
    const eq = part.indexOf('=')
    const rawName = eq === -1 ? part : part.slice(0, eq)
    const rawValue = eq === -1 ? '' : part.slice(eq + 1)
    let name = rawName
    let value = rawValue
    try {
      name = decodeURIComponent(rawName.replace(/\+/g, ' '))
      value = decodeURIComponent(rawValue.replace(/\+/g, ' '))
    } catch {
      name = rawName
      value = rawValue
    }
    if (isSensitiveQueryKey(name)) return `${rawName}=${encodeURIComponent(FILTERED)}`
    const scrubbed = scrubFreeText(value)
    if (scrubbed === value) return part
    return `${rawName}=${encodeURIComponent(scrubbed)}`
  })
  const joined = parts.join('&')
  return hadQuestion ? `?${joined}` : joined
}

function scrubUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const kept = new URLSearchParams()
    for (const [key, value] of parsed.searchParams.entries()) {
      if (isSensitiveQueryKey(key) || scrubFreeText(value) !== value) {
        kept.set(key, FILTERED)
      } else {
        kept.append(key, value)
      }
    }
    parsed.search = kept.toString() ? `?${kept.toString()}` : ''
    if (parsed.hash) {
      const hashBody = parsed.hash.slice(1)
      const q = hashBody.indexOf('?')
      if (q === -1) parsed.hash = `#${scrubFreeText(hashBody)}`
      else parsed.hash = `#${scrubFreeText(hashBody.slice(0, q))}?${scrubQueryString(hashBody.slice(q + 1)).replace(/^\?/, '')}`
    }
    // mailto: och e-post i path/userinfo syns inte som query-parametrar.
    return scrubFreeText(parsed.toString())
  } catch {
    return scrubFreeText(scrubQueryString(url))
  }
}

function scrubUrlOrName(value: string): string {
  const queryAt = value.indexOf('?')
  if (queryAt !== -1 && !/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return scrubFreeText(value.slice(0, queryAt))
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return scrubUrl(value)
  return scrubFreeText(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scrubUnknown(value: unknown, key: string | null, parentKey: string | null, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    if (key && shouldFullyRedact(key, parentKey)) return FILTERED
    if (key === 'query_string' || key === 'query' || (key !== null && (key.endsWith('.query') || key.endsWith('_query')))) {
      return scrubQueryString(value)
    }
    if (key === 'url' || key === 'http.url' || key === 'http.target' || (key !== null && key.endsWith('.url')) || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
      return scrubUrlOrName(value)
    }
    if (key === 'name' && value.includes('?')) return scrubUrlOrName(value)
    return scrubFreeText(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value
  if (Array.isArray(value)) {
    if (seen.has(value)) return value
    seen.add(value)
    if (key === 'headers') {
      return value.map((item) => {
        if (Array.isArray(item) && typeof item[0] === 'string') {
          const headerValue = item[1]
          const redacted = shouldFullyRedact(item[0], 'headers')
            ? FILTERED
            : typeof headerValue === 'string'
              ? scrubFreeText(headerValue)
              : scrubUnknown(headerValue, null, 'headers', seen)
          return [item[0], redacted]
        }
        return scrubUnknown(item, null, 'headers', seen)
      })
    }
    for (let i = 0; i < value.length; i++) value[i] = scrubUnknown(value[i], null, key, seen)
    return value
  }
  if (!isPlainObject(value)) return value
  if (seen.has(value)) return value
  seen.add(value)
  if (key === 'request') {
    delete value.data
    delete value.body
    delete value.cookies
  }
  if (key === 'user') {
    delete value.email
    delete value.ip_address
    delete value.username
    delete value.name
    delete value.geo
  }
  for (const childKey of Object.keys(value)) {
    if (key === 'request' && (childKey === 'data' || childKey === 'body' || childKey === 'cookies')) {
      delete value[childKey]
      continue
    }
    value[childKey] = scrubUnknown(value[childKey], childKey, key, seen)
  }
  return value
}

function tagEdgeFunction(event: Record<string, unknown>): void {
  const request = event.request
  if (!request || typeof request !== 'object') return
  const url = (request as { url?: unknown }).url
  if (typeof url !== 'string') return
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    const tags = (event.tags && typeof event.tags === 'object' ? event.tags : {}) as Record<string, unknown>
    const runtime = tags.runtime
    const fromGateway = parts[0] === 'functions' && parts[1] === 'v1' ? parts[2] : undefined
    const fromDenoPath = runtime === 'deno' ? parts[parts.length - 1] : undefined
    const name = fromGateway || fromDenoPath
    if (!name || tags.edge_function != null) return
    tags.edge_function = name
    event.tags = tags
  } catch {
    // ogiltig URL - inget funktionsnamn att sätta
  }
}

/**
 * Sentry gissar avsändarens IP på servern om user.ip_address saknas, och
 * sätter då även geo. Explicit null är opt-outen och måste sättas efter
 * att skrubbningen tagit bort en eventuell IP som SDK:t lagt dit.
 */
function blockInferredIp(event: Record<string, unknown>): void {
  // Ny kopia: SDK:ts user-objekt kan vara fruset, och tilldelning får inte
  // fälla beforeSend (då slängs hela felet).
  try {
    const user = isPlainObject(event.user) ? { ...event.user } : {}
    delete user.geo
    user.ip_address = null
    event.user = user
  } catch {
    // eventet i sig är fruset - hellre skicka utan den här opt-outen än att tappa felet
  }
}

/** Muterar ett Sentry-fel/transaktions-event och tar bort person- och betaldata. */
export function scrubSentryEvent<T>(event: T): T {
  if (!isPlainObject(event)) return event
  tagEdgeFunction(event)
  scrubUnknown(event, null, null, new WeakSet())
  blockInferredIp(event)
  return event
}

/** Muterar ett span-payload (namn + attribut) innan det skickas. */
export function scrubSentrySpan<T>(span: T): T {
  if (!isPlainObject(span)) return span
  const record = span as Record<string, unknown>
  if (typeof record.name === 'string') record.name = scrubUrlOrName(record.name)
  if (typeof record.description === 'string') record.description = scrubUrlOrName(record.description)
  if (record.attributes) scrubUnknown(record.attributes, 'attributes', null, new WeakSet())
  if (record.data) scrubUnknown(record.data, 'data', null, new WeakSet())
  return span
}

export function scrubBreadcrumb<T>(breadcrumb: T): T {
  if (!isPlainObject(breadcrumb)) return breadcrumb
  const data = breadcrumb.data
  if (isPlainObject(data)) {
    delete data.body
    delete data.request_body
    delete data.requestBody
    delete data.response
    delete data.response_body
    delete data.responseBody
  }
  scrubUnknown(breadcrumb, 'breadcrumb', null, new WeakSet())
  return breadcrumb
}
