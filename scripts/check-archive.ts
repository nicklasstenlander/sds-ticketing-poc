// Kontroller för arkivfunktionen (ordern "Arkiv för ordrar och event"
// 2026-10-12). Deno-skript (inte node), samma mönster som
// check-scan-ticket.ts - importerar en riktig .ts-fil från
// supabase/functions/ direkt, utan TS-loader-trubbel.
//
// Två sorters kontroller:
//
// 1. Riktiga enhetstester av den rena exportfiltreringen
//    (splitArchivedTestItems, supabase/functions/_shared/archiveExport.ts)
//    - "export innehåller arkiverade" (orsak 'hidden'), "test" utesluts.
//
// 2. Statiska textkontroller av källkoden (samma princip som
//    check-terms.mjs) för saker som är svåra att enhetstesta utan en
//    riktig databas i den här sessionen:
//    - "sold_count oförändrat": admin-archive-event/admin-archive-orders
//      får ALDRIG nämna sold_count/capacity eller anropa RPC:erna som
//      ändrar dem, importera Stripe, eller innehålla .delete( -
//      "radera aldrig något".
//    - "publika API:er saknar arkiverat event": public-embed/public-
//      events/list-events måste alla filtrera .is('archived_at', null).
//    - create-order måste kontrollera archived_at innan en order skapas.
//    - RLS-migrationen filtrerar events/ticket_types på archived_at.
//
// Den faktiska CRUD-cykeln (arkivering döljer/återställning visar i en
// riktig adminlista) verifieras separat med en live-rundtur mot
// testdata EFTER deploy, se leveransrapporten - går inte att testa här
// utan en riktig databasanslutning.
//
// Kör: deno run --allow-read scripts/check-archive.ts

import { splitArchivedTestItems } from '../supabase/functions/_shared/archiveExport.ts'

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}
function assertTrue(actual: unknown, label: string) {
  assertEqual(Boolean(actual), true, label)
}

// === 1. splitArchivedTestItems - ren funktion ===

{
  const items = [
    { id: 'a', reason: null as string | null, amount: 100 },
    { id: 'b', reason: 'hidden' as string | null, amount: 200 },
    { id: 'c', reason: 'test' as string | null, amount: 300 },
  ]
  const result = splitArchivedTestItems(
    items,
    (i) => i.reason,
    (i) => i.amount,
    (i) => i.id,
  )
  assertEqual(result.included.map((i) => i.id), ['a', 'b'], 'Export: oarkiverad och "hidden" ingår, "test" utesluts')
  assertEqual(result.excludedCount, 1, 'Export: precis en post utesluten')
  assertEqual(result.excludedTotalOre, 300, 'Export: uteslutet belopp är bara den uteslutna postens')
}

{
  // export-sales-fallet: FLERA rader (order_items) kan höra till SAMMA
  // arkiverade order - excludedCount ska räkna ordrar (unika grupper),
  // inte rader.
  const items = [
    { orderId: 'order-1', amount: 100 },
    { orderId: 'order-1', amount: 50 },
    { orderId: 'order-2', amount: 300 },
  ]
  const result = splitArchivedTestItems(
    items,
    () => 'test',
    (i) => i.amount,
    (i) => i.orderId,
  )
  assertEqual(result.included, [], 'Export: alla rader uteslutna när alla är test')
  assertEqual(result.excludedCount, 2, 'Export: excludedCount räknar UNIKA ordrar (2), inte rader (3)')
  assertEqual(result.excludedTotalOre, 450, 'Export: uteslutet belopp summerar alla radernas belopp, trots gruppering per order')
}

{
  const result = splitArchivedTestItems<{ id: string }>([], () => 'test', () => 0, (i) => i.id)
  assertEqual(result, { included: [], excludedCount: 0, excludedTotalOre: 0 }, 'Export: tom lista ger tomt resultat, kraschar inte')
}

// === 2. Statiska kontroller av källkoden ===

const root = new URL('..', import.meta.url)
function read(relPath: string): string {
  return Deno.readTextFileSync(new URL(relPath, root))
}

for (const file of ['supabase/functions/admin-archive-event/index.ts', 'supabase/functions/admin-archive-orders/index.ts']) {
  const content = read(file)
  // Kollar mot .rpc(/.update( med sold_count/capacity i NÅGON kod-rad
  // (inte kommentarer, som förklarande ANVÄNDER orden "sold_count"/
  // "capacity" i prosa om varför de INTE rörs) - en rad som börjar med
  // // räknas bort.
  const codeLines = content.split('\n').filter((line) => !line.trim().startsWith('//'))
  const codeOnly = codeLines.join('\n')
  assertTrue(
    !/\.rpc\(|reserve_shared_capacity|release_shared_capacity|sold_count\s*:|\.update\([^)]*capacity/.test(codeOnly),
    `${file}: ingen kodrad anropar en RPC eller skriver sold_count/capacity (arkivering ska inte röra platsantal)`,
  )
  assertTrue(
    !/from\s+['"].*stripe/i.test(content) && !content.includes('createStripeClient'),
    `${file}: importerar inte Stripe (arkivering ska inte röra betalningar)`,
  )
  assertTrue(!content.includes('.delete('), `${file}: innehåller aldrig .delete( - "radera aldrig något"`)
}

for (const file of [
  'supabase/functions/public-embed/index.ts',
  'supabase/functions/public-events/index.ts',
  'supabase/functions/list-events/index.ts',
]) {
  assertTrue(
    read(file).includes(".is('archived_at', null)"),
    `${file}: filtrerar bort arkiverade event (.is('archived_at', null))`,
  )
}

assertTrue(
  read('supabase/functions/create-order/index.ts').includes('event.archived_at'),
  'create-order: kontrollerar event.archived_at innan en order skapas (service role kringgår RLS)',
)

{
  const content = read('supabase/migrations/20261012010000_archive.sql')
  assertTrue(content.includes('archived_at is null'), 'RLS-migrationen filtrerar publika events/ticket_types-policyer på archived_at is null')
  // Policynamnet på events är EXAKT "Publika events ar lasbara for alla"
  // (utan å/ä - bekräftat mot pg_policies på det riktiga projektet,
  // 2026-10-12). Ett fel namn här gör att "drop policy" inte hittar
  // raden och hela migrationen misslyckas.
  assertTrue(
    content.includes('drop policy "Publika events ar lasbara for alla" on events') &&
      content.includes('create policy "Publika events ar lasbara for alla"'),
    'Migrationen drop/create:ar events-policyn med det EXAKTA, diakritikfria namnet',
  )
  assertTrue(!content.includes('Publika events är läsbara för alla'), 'Migrationen använder INTE det felaktiga namnet med å/ä')
  assertTrue(content.includes('begin;') && content.includes('commit;'), 'Migrationen är omsluten av begin/commit')
}

{
  const rollback = read('supabase/rollbacks/20261012010000_archive_rollback.sql')
  assertTrue(
    rollback.includes('drop policy "Publika events ar lasbara for alla" on events') &&
      rollback.includes('create policy "Publika events ar lasbara for alla"'),
    'Reservfilen återskapar events-policyn med samma exakta namn',
  )
  assertTrue(
    rollback.includes('drop policy "Publika biljettyper är läsbara för publicerade event" on ticket_types'),
    'Reservfilen återskapar ticket_types-policyn med samma namn',
  )
  // De ÅTERSKAPADE policyerna (efter drop) ska sakna archived_at helt -
  // exakt originalet, inte en kopia av den nya arkivmedvetna versionen.
  const afterFirstCreate = rollback.slice(rollback.indexOf('create policy'))
  assertTrue(!afterFirstCreate.includes('archived_at'), 'Reservfilens återskapade policyer nämner INTE archived_at (exakt originalet)')
  assertTrue(!rollback.includes('.delete(') && !rollback.includes('drop table') && !rollback.includes('drop column'), 'Reservfilen rör bara policyer, inget annat')
}

{
  // Uppföljning 2026-10-12: event-återställning fick INTE återställa en
  // order som arkiverats enskilt med annan orsak/tidpunkt. Nyckeln är
  // att restore-grenen matchar ordrarnas archived_at mot EVENTETS egna
  // (lästa FÖRE nollställning), inte en bar "archived_at is not null".
  const content = read('supabase/functions/admin-archive-event/index.ts')
  assertTrue(
    content.includes("const archivedAtBeforeRestore = event.archived_at"),
    'admin-archive-event: läser eventets archived_at i en egen variabel INNAN det nollställs',
  )
  assertTrue(
    content.includes(".eq('archived_at', archivedAtBeforeRestore)"),
    'admin-archive-event: återställningen av ordrar matchar EXAKT den tidsstämpeln - inte "alla arkiverade ordrar"',
  )
  assertTrue(
    !content.includes(".not('archived_at', 'is', null)"),
    'admin-archive-event: innehåller INTE den gamla "återställ alla arkiverade ordrar oavsett ursprung"-frågan',
  )
}

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
