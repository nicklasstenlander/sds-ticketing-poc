// public-fee-config
//
// Tokenfri, publik endpoint (Tilläggsordern 2026-08-07, avsnitt 3):
// köpsidan (PurchasePage.tsx) är en publik, oautentiserad sida och kan
// inte läsa Supabase secrets direkt - den behöver ett sätt att veta
// PLATFORM_FEE_MODE/PLATFORM_FEE_FLAT_ORE INNAN köparen skickas vidare
// till Stripe, så att "Serviceavgift (N st) X,XX kr" kan visas i
// prissammanställningen före betalning (DoD-punkt 1).
//
// Läcker ingen känslig data - avgiften syns ändå för köparen både här och
// i Stripe Checkout, samma resonemang som public-events (se dess
// filkommentar). PLATFORM_FEE_RATE (percent-läget) exponeras INTE här -
// perceptionsmässigt onödigt (percent-läget visar ingen egen rad, bakas
// in i biljettpriset som idag) och sparar en anledning att läsa en secret
// i onödan.
//
// GET public-fee-config (inga query-params, inga headers)
// -> { mode: 'percent' | 'flat_per_ticket', flat_ore: number }
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { readPlatformFeeMode, readPlatformFeeFlatOre } from '../_shared/platformFee.ts'

Deno.serve((req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const mode = readPlatformFeeMode()
  const flatOre = mode === 'flat_per_ticket' ? readPlatformFeeFlatOre() : 0

  return jsonResponse({ mode, flat_ore: flatOre }, 200)
})
