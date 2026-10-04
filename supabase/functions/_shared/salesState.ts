// Ordern "Schemalagt biljettsläpp" (2026-10-03), 1.1. Försäljningsstatus
// för ett event, i denna prioritetsordning:
//   1. 'upcoming' om sales_open_at är satt och ligger i framtiden
//   2. 'sold_out' om platserna är slut (delad pool, sold_count >= capacity)
//   3. 'open' annars
//
// Används av create-order (köpspärren), public-events och public-embed
// (steg 2) - en enda implementation delad mellan alla tre, eftersom de
// MÅSTE komma fram till exakt samma svar för samma event. Har en
// frontend-motsvarighet i src/lib/salesState.ts (kan inte delas rakt av,
// Deno-funktionerna och Vite-bundlen byggs separat) - håll de två i synk
// för hand om logiken ändras.
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

/** "14 okt kl. 10:00", alltid Europe/Stockholm oavsett serverns egen
 * tidszon (Deno Deploy kör UTC) - för SALES_NOT_OPEN-felmeddelandet i
 * create-order (ordern 1.3) och public-embeds chip-text (steg 2). Intl:s
 * 'sv-SE'-korta månadsförkortningar har en punkt ("okt.") som mockarna
 * inte har - strippas här. Samma fix finns i frontendens
 * formatStockholmDateTime (src/lib/stockholmTime.ts). */
export function formatStockholmDateTimeSv(iso: string): string {
  const datePart = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    day: 'numeric',
    month: 'short',
  })
    .format(new Date(iso))
    .replace(/\.$/, '')
  const timePart = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
  return `${datePart} kl. ${timePart}`
}
