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
  /** Släppet har redan passerat enligt klientens (skevhetskorrigerade)
   * klocka - bara en signal för att trigga omhämtning, INTE något UI ska
   * lita på för att visa köpformuläret (servern bestämmer, se
   * ordertextens 1.5/2.3). */
  reached: boolean
}

/**
 * Beräknar klockskillnaden (millisekunder) mellan klienten och servern, ur
 * ETT API-svars `server_time` plus klientens egen `Date.now()` TAGEN I
 * SAMMA ÖGONBLICK som svaret kom tillbaka. Positivt värde = servern ligger
 * före klienten, negativt = klienten ligger före servern.
 *
 * VIKTIGT: detta ska beräknas EN gång när svaret kommer in, och sparas
 * (t.ex. i React-state) - INTE räknas om vid varje tick. Att räkna om det
 * med en NY `Date.now()` vid varje anrop (det ursprungliga felet här -
 * se steg 1b-uppföljningen 2026-10-04) gör uträkningen till en
 * algebraisk identitet som alltid ger tillbaka server_time oavsett hur
 * mycket tid som faktiskt gått: clientNow - (clientNow - serverTime) =
 * serverTime, en konstant - nedräkningen skulle då aldrig röra sig.
 * Nätverkets tur-och-returtid (svaret kommer inte fram momentant) ger ett
 * litet, oundvikligt fel på någon bråkdel av en sekund till någon sekund -
 * försumbart för en nedräkning med sekundupplösning, och utan betydelse
 * för köpspärren (create-order är alltid den faktiska källan till sanning,
 * detta är bara UI-polering).
 */
export function computeClockSkewMs(serverTime: string, clientNowAtFetch: number = Date.now()): number {
  return new Date(serverTime).getTime() - clientNowAtFetch
}

/** Beräknar nedräkningen mot `salesOpenAt`, justerad för klockskillnaden
 * (`clockSkewMs`, från computeClockSkewMs - EN gång per hämtning, inte per
 * tick). `clientNow` är den löpande, tickande klockan (uppdateras varje
 * sekund) - skillnaden adderas till den så att nedräkningen faktiskt
 * rör sig i realtid, korrigerad för skevheten. */
export function computeCountdown(salesOpenAt: string, clockSkewMs: number, clientNow: Date = new Date()): Countdown {
  const effectiveNowMs = clientNow.getTime() + clockSkewMs
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
