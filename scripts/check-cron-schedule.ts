// Kontroller för schemaläggningen av release_expired_orders() via
// pg_cron (ordern "Avbokning, återbetalning, omsändning och
// köparmeddelanden" 2026-10-12, uppföljning: alternativ a1 från
// schemaläggningsrapporten). Deno-skript, samma mönster som
// check-archive.ts/check-cancel-order.ts - statiska textkontroller,
// ingen riktig databas behövs.
//
// Kör: deno run --allow-read scripts/check-cron-schedule.ts

let failures = 0
function assertTrue(actual: unknown, label: string) {
  const ok = Boolean(actual)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade true`)
  if (!ok) failures++
}

const root = new URL('..', import.meta.url)
function read(relPath: string): string {
  return Deno.readTextFileSync(new URL(relPath, root))
}

// === Inga hemligheter i klartext (DEL 2 punkt 5 i ordern) ===
//
// a1 (direkt SQL mot release_expired_orders(), inget HTTP, ingen
// bearer-token) ska per konstruktion inte innehålla NÅGON hemlighet -
// om den här kontrollen någonsin slår till har någon av misstag lagt
// in en nyckel/token i filen, eller bytt arkitektur till HTTP-vägen
// utan att uppdatera det här skyddet.
//
// Mönstren är medvetet breda (hellre ett falskt larm att läsa igenom
// manuellt än att missa en riktig hemlighet): vanliga API-nyckel-
// prefix, "Bearer "-headrar, JWT:er (eyJ...), och långa sammanhängande
// hex/base64-liknande strängar (32+ tecken utan mellanslag/bindestreck
// i naturlig text) som inte är kända, ofarliga identifierare.
const SECRET_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bBearer\s+\S+/i, label: 'en "Bearer <token>"-header' },
  { pattern: /\bsk_(live|test)_[A-Za-z0-9]+/, label: 'ett Stripe secret key-prefix (sk_live_/sk_test_)' },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}/, label: 'något som ser ut som en JWT (eyJ...)' },
  { pattern: /CRON_SECRET\s*[:=]\s*['"][^'"]+['"]/, label: 'ett klartextvärde tilldelat CRON_SECRET' },
  { pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/, label: 'en lång, sammanhängande base64-liknande sträng (40+ tecken)' },
]

function assertNoSecrets(filePath: string) {
  const content = read(filePath)
  for (const { pattern, label } of SECRET_PATTERNS) {
    const match = content.match(pattern)
    assertTrue(!match, `${filePath}: inga hemligheter i klartext (${label}) - ${match ? `träff: "${match[0].slice(0, 20)}..."` : 'ingen träff'}`)
  }
}

for (const file of [
  'supabase/migrations/20261012040000_schedule_release_expired_orders.sql',
  'supabase/rollbacks/20261012040000_schedule_release_expired_orders_rollback.sql',
]) {
  assertNoSecrets(file)
}

// === Migrationens innehåll ===

{
  const migration = read('supabase/migrations/20261012040000_schedule_release_expired_orders.sql')
  assertTrue(migration.includes('begin;') && migration.includes('commit;'), 'Migrationen är omsluten av begin/commit')
  assertTrue(migration.includes('create extension if not exists pg_cron with schema pg_catalog'), 'Migrationen försöker aktivera pg_cron (if not exists - ofarlig att köra om, även efter en Dashboard-aktivering)')
  assertTrue(
    migration.includes("select jobid from cron.job where jobname = 'release-expired-orders'") &&
      migration.includes('cron.unschedule(r.jobid)'),
    'Migrationen avschemalägger ett eventuellt BEFINTLIGT jobb med samma namn innan den schemalägger ett nytt (idempotent, inga dubbletter vid omkörning)',
  )
  assertTrue(
    migration.includes("cron.schedule(\n  'release-expired-orders',\n  '*/5 * * * *',\n  $$select public.release_expired_orders();$$\n)"),
    'cron.schedule anropas med rätt jobbnamn, var-5:e-minut-schema och det schema-kvalificerade kommandot select public.release_expired_orders()',
  )
  // Kollar bara KODRADER (inte -- kommentarer, som förklarande NÄMNER
  // "pg_net"/"CRON_SECRET" i prosa om varför de INTE behövs här) -
  // samma princip som "security definer"-kontrollen i check-archive.ts/
  // check-cancel-order.ts.
  assertTrue(
    migration.includes("to_regprocedure('public.release_expired_orders()') is null") &&
      migration.indexOf('to_regprocedure') < migration.indexOf('create extension if not exists'),
    'Migrationen avbryter med ett tydligt fel INNAN något skapas om release_expired_orders() saknas',
  )
  const migrationCodeOnly = migration
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  assertTrue(
    !migrationCodeOnly.includes('pg_net') && !migrationCodeOnly.includes('http_post'),
    'Ingen KODRAD går via HTTP/pg_net - a1 (direkt SQL) har inget behov av det',
  )
}

// === Rollback-filens innehåll ===

{
  const rollback = read('supabase/rollbacks/20261012040000_schedule_release_expired_orders_rollback.sql')
  assertTrue(rollback.includes('begin;') && rollback.includes('commit;'), 'Reservfilen är omsluten av begin/commit')
  assertTrue(
    rollback.includes("select jobid from cron.job where jobname = 'release-expired-orders'") &&
      rollback.includes('cron.unschedule(r.jobid)'),
    'Reservfilen avschemalägger jobbet (idempotent - ofarlig om jobbet redan är borta)',
  )
  assertTrue(
    !rollback.includes('drop extension') && !rollback.includes('drop function'),
    'Reservfilen rör varken extensionen eller release_expired_orders()-funktionen - bara schemaläggningen',
  )
}

// === GitHub Actions-workflowen: nu reserv, var 30:e minut, rättad
// kommentar ===

{
  const workflow = read('.github/workflows/release-expired-orders.yml')
  assertTrue(workflow.includes("cron: '*/30 * * * *'"), 'Workflowens cron-schema är nu var 30:e minut')
  assertTrue(!workflow.includes("cron: '*/10 * * * *'"), 'Det gamla var-10:e-minut-schemat är borta')
  assertTrue(workflow.includes('RESERV'), 'Kommentaren säger tydligt att workflowen nu är en reserv, inte primär')
  assertTrue(workflow.includes('best effort'), 'Kommentaren förklarar varför det deklarerade intervallet inte är en garanti')
  assertTrue(workflow.includes('20261012040000_schedule_release_expired_orders.sql'), 'Kommentaren pekar till den nya pg_cron-migrationen som nu är primär')
}

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
