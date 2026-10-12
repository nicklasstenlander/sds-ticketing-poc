// Kontroller för avbokning/omsändning (ordern "Avbokning, återbetalning,
// omsändning och köparmeddelanden" 2026-10-12, STEG 2). Deno-skript,
// samma mönster som check-scan-ticket.ts/check-archive.ts.
//
// Två sorters kontroller:
//
// 1. Riktiga enhetstester av rena funktioner: shouldReleaseAfterExpiry
//    Update (STEG 2 tillägg B - rättelsen av den befintliga dubbel-
//    frigöringsbuggen) och isSingleValidEmail (admin-resend-tickets
//    "to"-validering).
//
// 2. Statiska textkontroller av källkoden för saker som kräver en
//    riktig databas/Stripe-anslutning för att testas på riktigt i den
//    här sessionen: att cancel_paid_order-migrationen har rätt villkor
//    (status='paid', RETURNING), att admin-cancel-order/admin-resend-
//    tickets aldrig rör Stripe eller gör en rå .delete(), och att
//    handleCheckoutExpired faktiskt använder den rättade kontrollen.
//
// Kör: deno run --allow-read scripts/check-cancel-order.ts

import { shouldReleaseAfterExpiryUpdate } from '../supabase/functions/stripe-webhook/expiryGuard.ts'
import { isSingleValidEmail } from '../supabase/functions/admin-resend-tickets/emailValidation.ts'

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}
function assertTrue(actual: unknown, label: string) {
  assertEqual(Boolean(actual), true, label)
}

// === 1a. shouldReleaseAfterExpiryUpdate - den rättade dubbelfrigörings-
// buggen (STEG 1-rapporten -> STEG 2 tillägg B) ===

assertEqual(
  shouldReleaseAfterExpiryUpdate([{ id: 'order-1' }]),
  true,
  'En rad kom tillbaka från update:en -> VI vann statusbytet, frigör',
)
assertEqual(
  shouldReleaseAfterExpiryUpdate([]),
  false,
  'Simulerar racet: cron (release_expired_orders) hann flippa ordern till expired FÖRST -> 0 rader tillbaka -> frigör INTE igen',
)
assertEqual(shouldReleaseAfterExpiryUpdate(null), false, 'null (t.ex. om .select() av någon anledning gav null) -> frigör inte, kraschar inte')
assertEqual(
  shouldReleaseAfterExpiryUpdate([{ id: 'a' }, { id: 'b' }]),
  true,
  'Flera rader (bör inte hända för ett enskilt order_id, men ofarligt om det gjorde det) -> frigör',
)

// === 1b. isSingleValidEmail - admin-resend-tickets "to"-fältet ===

assertEqual(isSingleValidEmail('kund@exempel.se'), true, 'En giltig, enskild adress godkänns')
assertEqual(isSingleValidEmail('kund@exempel.se, annan@exempel.se'), false, 'Kommaseparerad lista avvisas')
assertEqual(isSingleValidEmail('kund@exempel.se; annan@exempel.se'), false, 'Semikolonseparerad lista avvisas')
assertEqual(isSingleValidEmail('inte-en-adress'), false, 'Saknar @ och domän - avvisas')
assertEqual(isSingleValidEmail(''), false, 'Tom sträng avvisas')
assertEqual(isSingleValidEmail('Namn <kund@exempel.se>'), false, '"Namn <adress>"-format avvisas - vill ha BARA adressen')
assertEqual(isSingleValidEmail('a@b.se'), true, 'Kort men giltig adress godkänns')

// === 2. Statiska kontroller av källkoden ===

const root = new URL('..', import.meta.url)
function read(relPath: string): string {
  return Deno.readTextFileSync(new URL(relPath, root))
}

{
  const migration = read('supabase/migrations/20261012020000_cancel_order_function.sql')
  assertTrue(migration.includes("where id = p_order_id") && migration.includes("and status = 'paid'"), 'Migrationen villkorar statusbytet på status=paid (atomärt, samma mönster som release_expired_orders)')
  assertTrue(migration.includes('returning orders.event_id, orders.total_ore'), 'Migrationen använder RETURNING för att bara agera på raden som FAKTISKT bytte status')
  assertTrue(migration.includes("set status = 'void'"), 'Migrationen sätter biljetterna till void i SAMMA funktion (samma transaktion)')
  assertTrue(migration.includes('release_shared_capacity_multi'), 'Migrationen återanvänder den befintliga frigöringsfunktionen, bygger ingen egen')
  assertTrue(migration.includes('begin;') && migration.includes('commit;'), 'Migrationen är omsluten av begin/commit')
  assertTrue(migration.includes('create or replace function'), 'create or replace - ingen drop')
  // Kollar bara KODRADER (inte -- kommentarer, som förklarande ANVÄNDER
  // orden "security definer" i prosa om varför den INTE sätts) - samma
  // princip som check-archive.ts.
  const migrationCodeOnly = migration
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  assertTrue(
    !/\bsecurity definer\b/i.test(migrationCodeOnly),
    'INGEN security definer i någon KODRAD - enda tänkta anroparen är service_role, som redan kringgår RLS utan att behöva köra som ägaren (granskat, inte bara kopierat från release_shared_capacity_multi)',
  )
  assertTrue(migration.includes('set search_path = public'), 'search_path fast satt ändå, som god hygien oavsett security-läge')
  assertTrue(
    migration.includes('revoke all on function cancel_paid_order(uuid) from public') &&
      migration.includes('revoke all on function cancel_paid_order(uuid) from anon') &&
      migration.includes('revoke all on function cancel_paid_order(uuid) from authenticated'),
    'EXECUTE revokeras explicit per roll (public, anon, authenticated) - INTE bara "from public", som visade sig vara verkningslöst för de tre befintliga funktionerna (anon/authenticated har egna direkta grants, bekräftat mot pg_proc.proacl)',
  )
  assertTrue(
    migration.includes('grant execute on function cancel_paid_order(uuid) to service_role'),
    'EXECUTE beviljas explicit till service_role - går inte att anropa direkt via PostgREST av en inloggad användare',
  )
}

for (const file of ['supabase/functions/admin-cancel-order/index.ts', 'supabase/functions/admin-resend-tickets/index.ts']) {
  const content = read(file)
  assertTrue(
    !/from\s+['"].*stripe/i.test(content) && !content.includes('createStripeClient'),
    `${file}: importerar inte Stripe (rör aldrig betalningar/återbetalningar)`,
  )
  assertTrue(!content.includes('.delete('), `${file}: innehåller aldrig .delete( - "radera aldrig något"`)
}

{
  const content = read('supabase/functions/admin-cancel-order/index.ts')
  assertTrue(content.includes('cancelPaidOrder(supabase, orderId)'), 'admin-cancel-order anropar den DELADE funktionen, lägger ingen egen avbokningslogik ovanpå')
  assertTrue(!content.includes("status: 'cancelled'") && !content.includes("status:'cancelled'"), 'admin-cancel-order sätter ALDRIG status själv - bara cancel_paid_order (via RPC) gör det')
}

{
  const content = read('supabase/functions/stripe-webhook/index.ts')
  assertTrue(
    content.includes(".update({ status: 'expired' })") && content.includes(".select('id')"),
    'handleCheckoutExpired kedjar .select() på update:en (rättelsen) - inte bara en bar .update() som aldrig avslöjar 0 träffade rader',
  )
  assertTrue(
    content.includes('shouldReleaseAfterExpiryUpdate(updatedRows)'),
    'handleCheckoutExpired använder den rättade, testade kontrollen innan den frigör kapacitet',
  )
  assertTrue(content.includes('Live mode'), 'Filkommentaren uppdaterad från det inaktuella "(Test mode)" (STEG 2 tillägg D)')
  assertTrue(!content.includes('(Test mode)'), 'Den gamla, inaktuella "(Test mode)"-texten är borta')
}

{
  const rollback = read('supabase/rollbacks/20261012020000_cancel_order_function_rollback.sql')
  assertTrue(rollback.includes('begin;') && rollback.includes('commit;'), 'Reservfilen är omsluten av begin/commit')
  assertTrue(rollback.includes('drop function if exists cancel_paid_order(uuid)'), 'Reservfilen droppar HELA funktionen (ny funktion, ingen tidigare version att återskapa)')
}

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
