/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Publik Sentry-klientnyckel. Tom/saknad = ingen felrapportering. */
  readonly VITE_SENTRY_DSN?: string
  /** Release-tagg, sätts till commit-SHA i GitHub Actions. */
  readonly VITE_SENTRY_RELEASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
