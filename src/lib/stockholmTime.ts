// Ordern "Schemalagt biljettsläpp" (2026-10-03), 1.4: datum/tid-väljaren
// för sales_open_at ska alltid tolkas som Europe/Stockholm, oavsett vilken
// tidszon webbläsaren själv står i (till skillnad från det ÄLDRE
// starts_at-fältet i AdminPage.tsx, som skickar en naiv
// datetime-local-sträng rakt av - den tolkas av `new Date()` på SERVERN,
// dvs i Edge Function-runtimens egen tidszon, inte Stockholm. Se
// rapporten för steg 1: detta är en redan existerande, orörd avvikelse,
// inte något den här ordern bad om att fixa).
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

/** "14 okt kl. 10:00", alltid i Europe/Stockholm oavsett besökarens egen
 * tidszon - för chip/badge-texter ("Biljetterna släpps ..."). */
export function formatStockholmDateTime(iso: string): string {
  const datePart = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))
  const timePart = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
  return `${datePart} kl. ${timePart}`
}
