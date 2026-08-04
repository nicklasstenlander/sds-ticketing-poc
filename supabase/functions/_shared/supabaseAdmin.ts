import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Service role-klient - används ENDAST server-side i edge functions.
// SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY finns automatiskt tillgängliga
// som miljövariabler i alla Supabase Edge Functions, man behöver inte sätta
// dem själv via `supabase secrets set`.
export function createAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas i miljön för edge function.',
    )
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  })
}
