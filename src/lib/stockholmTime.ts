// Ordern "Schemalagt biljettsläpp" (2026-10-03), 1.4, och steg 1b
// (samma datum): all hantering av datum/tid - både sales_open_at OCH
// starts_at - ska tolkas/visas som Europe/Stockholm, oavsett vilken
// tidszon webbläsaren eller servern själv står i. steg 1b fixade den
// äldre starts_at-avvikelsen som flaggades i steg 1-rapporten (AdminPage.tsx
// skickade tidigare en naiv datetime-local-sträng rakt av, tolkad av
// `new Date()` på SERVERN - dvs i Edge Function-runtimens egen tidszon).
//
// Tekniken: Sverige har bara två möjliga UTC-offset, +1 (CET) eller +2
// (CEST). Vi provar båda kandidaterna och väljer den vars Stockholm-
// representation faktiskt matchar den efterfrågade lokala tiden. Det
// fungerar korrekt även precis vid ett sommartidsskifte. Vid en "hoppad"
// vårtid (t.ex. 02:30 en natt som går direkt från 02:00 till 03:00) finns
// ingen giltig kandidat - vi faller då tillbaka på sommartid (CEST), det
// minst förvånande valet för en tid som inte existerar.

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

/**
 * Konverterar ett datum ("ÅÅÅÅ-MM-DD", från <input type="date">) och en
 * tid ("TT:MM", från <input type="time">), ANGIVNA i Europe/Stockholm,
 * till en UTC ISO-sträng. Returnerar null vid ogiltig indata.
 */
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
  // Hoppad tid (vårtid) - ingen kandidat matchade exakt.
  return new Date(candidates[1]).toISOString()
}

/** Bryter upp en UTC ISO-sträng i Stockholm-lokala date/time-värden,
 * redo att sätta direkt i <input type="date">/<input type="time">. Används
 * för att förifylla släpptidsfälten när ett event redigeras. */
export function utcIsoToStockholmWallClock(iso: string): { date: string; time: string } {
  const p = stockholmPartsAt(new Date(iso).getTime())
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  }
}

/** Konverterar en UTC ISO-sträng till det format <input type="datetime-local">
 * förväntar sig ("ÅÅÅÅ-MM-DDTTT:MM"), i Europe/Stockholm - inte webbläsarens
 * egna tidszon (steg 1b, fixar den äldre starts_at-avvikelsen). Används för
 * att förifylla redigeringsformulärets datum/tid-fält. */
export function utcIsoToStockholmDatetimeLocal(iso: string): string {
  const { date, time } = utcIsoToStockholmWallClock(iso)
  return `${date}T${time}`
}

/** Omvänd riktning: ett <input type="datetime-local">-värde ("ÅÅÅÅ-MM-
 * DDTTT:MM"), ANGIVET i Europe/Stockholm, till en UTC ISO-sträng. Returnerar
 * null vid ogiltig indata. */
export function stockholmDatetimeLocalToUtcIso(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value)
  if (!match) return null
  return stockholmWallClockToUtcIso(match[1], match[2])
}

/** "14 okt kl. 10:00", alltid i Europe/Stockholm oavsett besökarens egen
 * tidszon - för chip/badge-texter ("Biljetterna släpps ..."). Intl:s
 * 'sv-SE'-korta månadsförkortningar har en punkt ("okt.") som mockarna
 * inte har - strippas här. */
export function formatStockholmDateTime(iso: string): string {
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

/** Ersätter `new Date(iso).toLocaleString('sv-SE', options)` på alla
 * ställen som visar starts_at (steg 1b) - UTAN explicit timeZone hade
 * dessa visat admin-användarens/besökarens EGEN systemtidszon istället
 * för Stockholm (samma klass av bugg som toDatetimeLocalValue hade, fast
 * för visning i löptext snarare än ett formulärfält). */
export function formatStockholmDateTimeLocale(
  iso: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Date(iso).toLocaleString('sv-SE', { ...options, timeZone: 'Europe/Stockholm' })
}
