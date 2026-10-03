// Ordern "Schemalagt biljettsläpp" (2026-10-03), 1.6: "Enhetstester (om
// testuppsättning finns, annars en liten fristående kontroll)". Projektet
// har ingen testuppsättning (inget vitest/jest i package.json) - istället
// en fristående, Deno-körbar kontroll (Deno finns redan installerat och
// kan köra TypeScript direkt, inget byggsteg behövs). Kör med:
//
//   deno run --allow-env scripts/check-step1.ts
//
// Importerar de RIKTIGA modulerna (inga kopior) - både frontend- och
// backend-varianten av computeSalesState testas, för att även fånga om de
// två skulle divergera från varandra.
import { stockholmWallClockToUtcIso, utcIsoToStockholmWallClock } from '../src/lib/stockholmTime.ts'
import { computeSalesState as computeSalesStateFrontend } from '../src/lib/salesState.ts'
import { computeSalesState as computeSalesStateBackend } from '../supabase/functions/_shared/salesState.ts'

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}

// === Hitta 2026 års sommartidsskiften programmatiskt (inte hårdkodat) ===
function stockholmOffsetHours(d: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Stockholm', timeZoneName: 'shortOffset' })
  const part = fmt.formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1'
  return Number(part.replace('GMT', '')) || 1
}

function findTransition(fromMonth: number, toMonth: number): Date {
  // Skannar dag för dag inom [fromMonth, toMonth) 2026 efter dagen då
  // offset ändras vid middagstid UTC (undviker tveksamhet kring exakt
  // skiftestimme).
  let prevOffset = stockholmOffsetHours(new Date(Date.UTC(2026, fromMonth, 1, 12)))
  for (let day = 2; day <= 31; day++) {
    const d = new Date(Date.UTC(2026, fromMonth, day, 12))
    if (d.getUTCMonth() !== fromMonth && d.getUTCMonth() !== toMonth) break
    const offset = stockholmOffsetHours(d)
    if (offset !== prevOffset) return d
    prevOffset = offset
  }
  throw new Error('Hittade inget sommartidsskifte i det angivna intervallet.')
}

const springForward = findTransition(2, 3) // mars -> april
const fallBack = findTransition(9, 10) // oktober -> november

console.log(`Vårens skifte 2026 hittat: ${springForward.toISOString().slice(0, 10)}`)
console.log(`Höstens skifte 2026 hittat: ${fallBack.toISOString().slice(0, 10)}\n`)

// === stockholmWallClockToUtcIso ===

// Vintertid (CET, UTC+1): 10:00 Stockholm = 09:00 UTC.
assertEqual(stockholmWallClockToUtcIso('2026-01-15', '10:00'), '2026-01-15T09:00:00.000Z', 'Vintertid (CET, +1)')

// Sommartid (CEST, UTC+2): 10:00 Stockholm = 08:00 UTC.
assertEqual(stockholmWallClockToUtcIso('2026-07-15', '10:00'), '2026-07-15T08:00:00.000Z', 'Sommartid (CEST, +2)')

// Dagen FÖRE vårens skifte: fortfarande CET (+1).
const dayBeforeSpring = new Date(springForward.getTime() - 86_400_000).toISOString().slice(0, 10)
assertEqual(
  stockholmWallClockToUtcIso(dayBeforeSpring, '10:00'),
  `${dayBeforeSpring}T09:00:00.000Z`,
  `Dagen före vårskiftet (${dayBeforeSpring}) - fortfarande +1`,
)

// Dagen EFTER vårens skifte: redan CEST (+2).
const dayAfterSpring = new Date(springForward.getTime() + 86_400_000).toISOString().slice(0, 10)
assertEqual(
  stockholmWallClockToUtcIso(dayAfterSpring, '10:00'),
  `${dayAfterSpring}T08:00:00.000Z`,
  `Dagen efter vårskiftet (${dayAfterSpring}) - redan +2`,
)

// Dagen FÖRE höstens skifte: fortfarande CEST (+2).
const dayBeforeFall = new Date(fallBack.getTime() - 86_400_000).toISOString().slice(0, 10)
assertEqual(
  stockholmWallClockToUtcIso(dayBeforeFall, '10:00'),
  `${dayBeforeFall}T08:00:00.000Z`,
  `Dagen före höstskiftet (${dayBeforeFall}) - fortfarande +2`,
)

// Dagen EFTER höstens skifte: redan CET (+1).
const dayAfterFall = new Date(fallBack.getTime() + 86_400_000).toISOString().slice(0, 10)
assertEqual(
  stockholmWallClockToUtcIso(dayAfterFall, '10:00'),
  `${dayAfterFall}T09:00:00.000Z`,
  `Dagen efter höstskiftet (${dayAfterFall}) - redan +1`,
)

// Round-trip: UTC -> Stockholm wall-clock -> UTC ska ge tillbaka samma sak,
// för ett urval datum inklusive runt skiftena.
for (const [date, time] of [
  ['2026-01-15', '10:00'],
  ['2026-07-15', '14:30'],
  [dayBeforeSpring, '23:45'],
  [dayAfterSpring, '00:15'],
  [dayBeforeFall, '23:45'],
  [dayAfterFall, '00:15'],
]) {
  const iso = stockholmWallClockToUtcIso(date, time)
  if (!iso) {
    console.log(`FAIL round-trip ${date} ${time} - stockholmWallClockToUtcIso returnerade null`)
    failures++
    continue
  }
  const back = utcIsoToStockholmWallClock(iso)
  assertEqual(back, { date, time }, `Round-trip ${date} ${time}`)
}

console.log()

// === computeSalesState (båda varianterna - frontend och backend) ===
for (const [label, computeSalesState] of [
  ['frontend', computeSalesStateFrontend],
  ['backend', computeSalesStateBackend],
] as const) {
  const now = new Date('2026-06-01T12:00:00Z')

  assertEqual(
    computeSalesState({ salesOpenAt: '2026-06-02T00:00:00Z', soldCount: 0, capacity: 100, now }),
    'upcoming',
    `[${label}] upcoming - sales_open_at i framtiden`,
  )
  assertEqual(
    computeSalesState({ salesOpenAt: null, soldCount: 100, capacity: 100, now }),
    'sold_out',
    `[${label}] sold_out - inget släpp, platserna slut`,
  )
  assertEqual(
    computeSalesState({ salesOpenAt: null, soldCount: 3, capacity: 100, now }),
    'open',
    `[${label}] open - inget släpp, platser kvar`,
  )
  // Gränsfall: exakt vid släpptiden - "ligger i framtiden" är då falskt
  // (likhet räknas inte som framtid), så upcoming ska INTE gälla längre.
  assertEqual(
    computeSalesState({ salesOpenAt: now.toISOString(), soldCount: 0, capacity: 100, now }),
    'open',
    `[${label}] gränsfall - exakt vid släpptiden räknas som öppet, inte upcoming`,
  )
  // Gränsfall: släppt (förfluten tid) men samtidigt slutsålt - sold_out
  // vinner (prioritetsordningen upcoming > sold_out > open).
  assertEqual(
    computeSalesState({ salesOpenAt: '2026-01-01T00:00:00Z', soldCount: 100, capacity: 100, now }),
    'sold_out',
    `[${label}] gränsfall - redan släppt OCH slutsålt`,
  )
  // Gränsfall: upcoming vinner över sold_out om båda är sanna samtidigt
  // (prioritetsordningen, ordertextens 1.1).
  assertEqual(
    computeSalesState({ salesOpenAt: '2026-06-02T00:00:00Z', soldCount: 100, capacity: 100, now }),
    'upcoming',
    `[${label}] gränsfall - upcoming vinner över sold_out`,
  )
}

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
