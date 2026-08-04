import { functionsBaseUrl } from './supabaseClient'

const ADMIN_TOKEN_KEY = 'sds-ticketing-poc.admin-token'

export function getAdminToken(): string | null {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY)
}

export function setAdminToken(token: string): void {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token)
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

interface CallOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  auth?: boolean // skicka med admin-token som Authorization-header
}

/** Anropar en Supabase Edge Function med anon-nyckeln som apikey-header. */
export async function callFunction<T>(name: string, opts: CallOptions = {}): Promise<T> {
  const url = `${functionsBaseUrl()}/${name}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  }

  if (opts.auth) {
    const token = getAdminToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(url, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // tomt svar
  }

  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `Anropet misslyckades (${res.status}).`
    throw new ApiError(message, res.status)
  }

  return data as T
}

/**
 * Hämtar en fil (t.ex. CSV/SIE-export) från en admin-skyddad edge function
 * och triggar en nedladdning i webbläsaren. Kan inte återanvända
 * callFunction() ovan eftersom svaret här inte är JSON - vi läser det som
 * en blob och behåller filnamnet från Content-Disposition-headern.
 */
export async function downloadAdminFile(nameAndQuery: string, fallbackFilename: string): Promise<void> {
  const url = `${functionsBaseUrl()}/${nameAndQuery}`
  const token = getAdminToken()
  const headers: Record<string, string> = {
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(url, { method: 'GET', headers })

  if (!res.ok) {
    let message = `Anropet misslyckades (${res.status}).`
    try {
      const data = await res.json()
      message = data?.error ?? message
    } catch {
      // svaret var inte JSON - behåll standardmeddelandet
    }
    throw new ApiError(message, res.status)
  }

  const disposition = res.headers.get('Content-Disposition') ?? ''
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/)
  const filename = filenameMatch ? filenameMatch[1] : fallbackFilename

  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}
