import { formatStockholmDateTimeLocale } from './stockholmTime'

// "5 dec" / "5–6 dec" / "30 nov–2 dec" (eller hela månadsnamn med 'long').
// Datumet är det första en besökare söker - en föreställning som går flera
// dagar ska visa hela spannet, inte bara första speltiden.
export function formatDateRange(isos: string[], monthStyle: 'short' | 'long' = 'short'): string {
  if (isos.length === 0) return ''
  const sorted = [...isos].sort()
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const day = (iso: string) => formatStockholmDateTimeLocale(iso, { day: 'numeric' })
  const month = (iso: string) => formatStockholmDateTimeLocale(iso, { month: monthStyle }).replace('.', '')
  if (day(first) === day(last) && month(first) === month(last)) return `${day(first)} ${month(first)}`
  if (month(first) === month(last)) return `${day(first)}–${day(last)} ${month(last)}`
  return `${day(first)} ${month(first)}–${day(last)} ${month(last)}`
}
