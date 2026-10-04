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
import {
  stockholmWallClockToUtcIso,
  utcIsoToStockholmWallClock,
  utcIsoToStockholmDatetimeLocal,
  stockholmDatetimeLocalToUtcIso,
} from '../src/lib/stockholmTime.ts'
import { computeSalesState as computeSalesStateFrontend, computeCountdown, computeClockSkewMs } from '../src/lib/salesState.ts'
import { computeSalesState as computeSalesStateBackend } from '../supabase/functions/_shared/salesState.ts'
import { parseAdminDateTimeInput } from '../supabase/functions/_shared/stockholmTime.ts'
import { formatStockholmDateTime } from '../src/lib/stockholmTime.ts'
import { formatStockholmDateTimeSv } from '../supabase/functions/_shared/salesState.ts'

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

// === datetime-local (AdminPage.tsx, steg 1b) ===
// Samma round-trip-princip som ovan men för det kombinerade
// <input type="datetime-local">-formatet - kontrollerar specifikt att ett
// OFÖRÄNDRAT värde inte flyttas vid sparning (ordertextens 1b, andra
// punkten).
for (const [iso, expectedLocal] of [
  ['2026-05-10T17:58:00.000Z', '2026-05-10T19:58'], // sommartid, +2
  ['2026-01-10T17:58:00.000Z', '2026-01-10T18:58'], // vintertid, +1
] as const) {
  const local = utcIsoToStockholmDatetimeLocal(iso)
  assertEqual(local, expectedLocal, `utcIsoToStockholmDatetimeLocal(${iso})`)
  const back = stockholmDatetimeLocalToUtcIso(local)
  assertEqual(back, iso, `Round-trip datetime-local ${local}`)
}

console.log()

// === parseAdminDateTimeInput (backend, steg 1b) ===
// "Servern tolkar en sträng utan tidszon som Europe/Stockholm. Strängar
// med Z eller offset gäller som de är."
assertEqual(
  parseAdminDateTimeInput('2026-05-10T17:58:00Z'),
  '2026-05-10T17:58:00.000Z',
  'Z-sträng används som den är',
)
assertEqual(
  parseAdminDateTimeInput('2026-05-10T19:58:00+02:00'),
  '2026-05-10T17:58:00.000Z',
  'Sträng med explicit offset används som den är',
)
assertEqual(
  parseAdminDateTimeInput('2026-05-10T19:58'),
  stockholmWallClockToUtcIso('2026-05-10', '19:58'),
  'Naiv sträng (sommartid) tolkas som Europe/Stockholm',
)
assertEqual(
  parseAdminDateTimeInput('2026-01-10T19:58'),
  stockholmWallClockToUtcIso('2026-01-10', '19:58'),
  'Naiv sträng (vintertid) tolkas som Europe/Stockholm',
)
assertEqual(parseAdminDateTimeInput('inte ett datum'), null, 'Ogiltig indata ger null')
// Runt vårskiftet, samma datum som hittades ovan - naiv tolkning ska
// stämma exakt med stockholmWallClockToUtcIso på var sida om skiftet.
assertEqual(
  parseAdminDateTimeInput(`${dayBeforeSpring}T10:00`),
  stockholmWallClockToUtcIso(dayBeforeSpring, '10:00'),
  `parseAdminDateTimeInput runt vårskiftet (${dayBeforeSpring})`,
)
assertEqual(
  parseAdminDateTimeInput(`${dayAfterSpring}T10:00`),
  stockholmWallClockToUtcIso(dayAfterSpring, '10:00'),
  `parseAdminDateTimeInput runt vårskiftet (${dayAfterSpring})`,
)

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

console.log()

// === Skevhetskorrigering (uppföljning 2026-10-04) ===
// Upptäckt medan detta skrevs: den ursprungliga computeCountdown räknade
// om skevheten vid VARJE anrop med en NY Date.now(), vilket algebraiskt
// alltid gav tillbaka server_time oavsett hur mycket tid som gått -
// nedräkningen skulle aldrig röra sig. Fixat genom att skevheten beräknas
// EN gång (computeClockSkewMs, vid API-svaret) och sparas som ett tal.

// Servern säger T. Klienten är 10 minuter FÖRE servern (klientens klocka
// går för fort) - utan korrigering skulle ett släpp 5 min efter T (dvs 5
// min i FRAMTIDEN enligt servern) se ut att redan ha passerat för
// klienten, 5 minuter för tidigt.
{
  const serverTimeIso = '2026-06-01T12:00:00.000Z'
  const clientNowAtFetchMs = new Date('2026-06-01T12:10:00.000Z').getTime() // +10 min
  const skewMs = computeClockSkewMs(serverTimeIso, clientNowAtFetchMs)
  assertEqual(skewMs, -10 * 60_000, 'computeClockSkewMs - klienten 10 min FÖRE servern ger -10 min skevhet')

  const salesOpenAt = '2026-06-01T12:05:00.000Z' // 5 min efter T (servertid)
  const clientNow = new Date(clientNowAtFetchMs) // samma ögonblick, ingen ytterligare tid gått
  const countdown = computeCountdown(salesOpenAt, skewMs, clientNow)
  assertEqual(
    countdown.reached,
    false,
    'Klient 10 min före server - korrigerat: INTE nått (sann tid är T, släpp är T+5min)',
  )
  assertEqual(countdown.minutes, 5, 'Klient 10 min före server - korrigerat: exakt 5 min kvar')

  // Utan korrigering (samma scenario, bara med klockSkewMs=0) hade detta
  // FELAKTIGT visat "nått" - exakt bakgrunden till ordern.
  const uncorrected = computeCountdown(salesOpenAt, 0, clientNow)
  assertEqual(
    uncorrected.reached,
    true,
    '(kontrast) utan korrigering hade samma scenario FELAKTIGT visat nått - visar varför fixen behövs',
  )
}

// Klienten är 10 minuter EFTER servern (klientens klocka går för
// långsamt) - mindre farligt (visar bara för mycket tid kvar, öppnar
// aldrig för tidigt), men ska ändå korrigeras rätt.
{
  const serverTimeIso = '2026-06-01T12:00:00.000Z'
  const clientNowAtFetchMs = new Date('2026-06-01T11:50:00.000Z').getTime() // -10 min
  const skewMs = computeClockSkewMs(serverTimeIso, clientNowAtFetchMs)
  assertEqual(skewMs, 10 * 60_000, 'computeClockSkewMs - klienten 10 min EFTER servern ger +10 min skevhet')

  const salesOpenAt = '2026-06-01T12:05:00.000Z'
  const clientNow = new Date(clientNowAtFetchMs)
  const countdown = computeCountdown(salesOpenAt, skewMs, clientNow)
  assertEqual(countdown.reached, false, 'Klient 10 min efter server - korrigerat: INTE nått')
  assertEqual(countdown.minutes, 5, 'Klient 10 min efter server - korrigerat: exakt 5 min kvar, inte 15')
}

// Släpptiden passerar medan fliken är dold: webbläsare bromsar/pausar
// timers i bakgrundsflikar, så INGA sekundtick behöver ha skett alls
// mellan "5 min kvar" och "2 timmar efter släppet" - fixen (visibility-
// change: setNow(new Date()) + omhämtning) förlitar sig på att
// computeCountdown/computeSalesState är RENA funktioner av en given `now`,
// inte beroende av att ha "räknat ner" genom varje mellanliggande sekund.
// Det här verifierar att det stämmer - ett enda hopp ger rätt svar direkt.
{
  const salesOpenAt = '2026-06-01T12:00:00.000Z'
  const beforeHidden = computeCountdown(salesOpenAt, 0, new Date('2026-06-01T11:55:00.000Z'))
  assertEqual(beforeHidden.reached, false, 'Före flik gömd: 5 min kvar, inte nått')

  // Direkt hopp - ingen tickning alls genom mellantiden (simulerar en
  // flik som legat dold i över två timmar, långt förbi släppet).
  const afterHiddenPastRelease = computeCountdown(salesOpenAt, 0, new Date('2026-06-01T14:30:00.000Z'))
  assertEqual(
    afterHiddenPastRelease.reached,
    true,
    'Efter flik dold förbi släppet: nått direkt, utan mellanliggande tick',
  )

  const salesStateAfterHidden = computeSalesStateFrontend({
    salesOpenAt,
    soldCount: 0,
    capacity: 100,
    now: new Date('2026-06-01T14:30:00.000Z'),
  })
  assertEqual(salesStateAfterHidden, 'open', 'sales_state efter dold flik förbi släppet: open direkt')
}

// Steg 2 (widget/embed), detaljen om datumformat: mockarna skriver
// "14 okt kl. 10:00" - UTAN punkt efter månadsförkortningen. Intl:s
// 'sv-SE'-korta månader har en punkt ("okt.") som standard - en
// regression här skulle tysta trasa chip-texten i både köpsidan/admin
// (frontend) och SALES_NOT_OPEN-felmeddelandet/embed-widgeten (backend).
assertEqual(
  formatStockholmDateTime('2026-10-14T08:00:00.000Z'),
  '14 okt kl. 10:00',
  'formatStockholmDateTime: inget punkt efter månaden (frontend)',
)
assertEqual(
  formatStockholmDateTimeSv('2026-10-14T08:00:00.000Z'),
  '14 okt kl. 10:00',
  'formatStockholmDateTimeSv: inget punkt efter månaden (backend)',
)
// Maj har ingen punkt även i Intl:s original ("14 maj") - kontrollerar
// att strippningen inte råkar äta en bokstav på månader utan punkt.
assertEqual(
  formatStockholmDateTime('2026-05-14T08:00:00.000Z'),
  '14 maj kl. 10:00',
  'formatStockholmDateTime: månader utan punkt (t.ex. maj) oförändrade',
)

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
