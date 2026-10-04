// Steg 1b (ordern "Schemalagt biljettsläpp" 2026-10-03). Samma teknik som
// den frontend-sidiga varianten i src/lib/stockholmTime.ts (kan inte delas
// rakt av, Deno-funktionerna och Vite-bundlen byggs separat) - håll de två
// i synk för hand om logiken ändras.
//
// Försvar i djupet: klienten SKA alltid skicka en fullständig UTC ISO-
// sträng (med "Z") för starts_at/sales_open_at, redan konverterad via
// stockholmWallClockToUtcIso på klientsidan. Men om en sträng ändå kommer
// in UTAN tidszon (t.ex. ett framtida API-anrop som missar konverteringen,
// eller ett direkt curl-anrop) tolkas den som Europe/Stockholm, ALDRIG som
// serverns egen körtidszon (Deno Deploy kör UTC) - annars skulle samma typ
// av fel som steg 1b fixade i AdminPage.tsx kunna återuppstå på serversidan.
interface StockholmParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function stockholmPartsAt(utcMs: number): StockholmParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = fmt.formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
}

export function stockholmWallClockToUtcIso(dateStr: string, timeStr: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeStr)
  if (!dateMatch || !timeMatch) return null

  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])

  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute)
  const candidates = [1, 2].map((offsetHours) => naiveUtcMs - offsetHours * 3_600_000)

  for (const candidateMs of candidates) {
    const parts = stockholmPartsAt(candidateMs)
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      return new Date(candidateMs).toISOString()
    }
  }
  return new Date(candidates[1]).toISOString()
}

const HAS_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i

/**
 * Tolkar admin-inmatning (starts_at/sales_open_at) för create-order/
 * admin-create-event/admin-update-event: en sträng med "Z" eller ett
 * explicit offset används SOM DEN ÄR (klienten har redan gjort rätt).
 * En sträng UTAN tidszon ("ÅÅÅÅ-MM-DDTTT:MM[:SS]") tolkas som
 * Europe/Stockholm. Returnerar null vid ogiltig indata.
 */
export function parseAdminDateTimeInput(input: string): string | null {
  const trimmed = input.trim()
  if (HAS_TIMEZONE.test(trimmed)) {
    const d = new Date(trimmed)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(trimmed)
  if (!match) return null
  return stockholmWallClockToUtcIso(match[1], match[2])
}
