import { createClient } from '@supabase/supabase-js'

// OBS: Endast URL och anon-nyckel får finnas här. Anon-nyckeln är avsedd att
// vara publik (skyddas av Row Level Security i databasen) - inga hemligheter
// (service role-nyckel, Resend-nyckel, scanner-token) får någonsin läggas i
// VITE_-variabler eftersom de bakas in i klientens JS-bundle.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    'VITE_SUPABASE_URL och VITE_SUPABASE_ANON_KEY måste sättas (se .env.example).',
  )
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')

/**
 * Bas-URL till Supabase Edge Functions, avledd från projekt-URL:en.
 *
 * Den enda dokumenterade, bekräftade formen är
 * `https://<project-ref>.supabase.co/functions/v1/<funktionsnamn>`
 * (se README.md, avsnittet "Bekräftad bas-URL-form"). Den tidigare
 * använda formen `https://<project-ref>.functions.supabase.co` finns INTE
 * i Supabase officiella dokumentation och ska inte användas - den gav
 * samma `/functions/v1`-form för lokal utveckling redan innan, så detta
 * gör bara produktions- och lokalfallet konsekventa med varandra.
 */
export function functionsBaseUrl(): string {
  const url = supabaseUrl ?? ''
  return `${url.replace(/\/$/, '')}/functions/v1`
}
