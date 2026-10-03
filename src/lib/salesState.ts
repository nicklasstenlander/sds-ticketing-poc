// Ordern "Schemalagt biljettsläpp" (2026-10-03), 1.1. Samma prioritering
// som den backend-sidiga varianten i supabase/functions/_shared/
// salesState.ts - koden kan INTE delas rakt av (Deno-funktionerna och
// Vite-bundlen byggs separat, inget monorepo-delat lib finns i projektet),
// så håll de två implementationerna i synk för hand om logiken ändras.
export type SalesState = 'upcoming' | 'sold_out' | 'open'

export function computeSalesState(params: {
  salesOpenAt: string | null
  soldCount: number
  capacity: number
  now?: Date
}): SalesState {
  const now = params.now ?? new Date()
  if (params.salesOpenAt && new Date(params.salesOpenAt) > now) return 'upcoming'
  if (params.capacity > 0 && params.soldCount >= params.capacity) return 'sold_out'
  return 'open'
}

export interface Countdown {
  days: number
  hours: number
  minutes: number
  seconds: number
  /** Under en timme kvar - visa tim/min/sek istället för dag/tim/min
   * (ordern 1.5). */
  underAnHour: boolean
  /** Släppet har redan passerat enligt klientens klocka - bara en signal
   * för att trigga omhämtning, INTE något UI ska lita på för att visa
   * köpformuläret (servern bestämmer, se ordertextens 1.5/2.3). */
  reached: boolean
}

/** Beräknar nedräkningen mot `salesOpenAt`, justerad för klockskillnaden
 * mellan klienten och servern (`serverTime`, från API-svaret) - klientens
 * egen klocka används bara för att ANIMERA nedräkningen mellan
 * hämtningar, aldrig för att avgöra om köp faktiskt är öppet. */
export function computeCountdown(salesOpenAt: string, serverTime: string, clientNow: Date = new Date()): Countdown {
  const serverFetchedAt = new Date(serverTime).getTime()
  const clockSkewMs = clientNow.getTime() - serverFetchedAt
  const effectiveNowMs = clientNow.getTime() - clockSkewMs
  const remainingMs = Math.max(0, new Date(salesOpenAt).getTime() - effectiveNowMs)

  const totalSeconds = Math.floor(remainingMs / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return {
    days,
    hours,
    minutes,
    seconds,
    underAnHour: remainingMs < 3_600_000,
    reached: remainingMs <= 0,
  }
}
