// Kontroller för ordern "Föreställningar-statistik från Rideau till
// CORE" 2026-10-13, Fas 1. Deno-skript, samma mönster som övriga
// check-*.ts - statiska textkontroller av migrationen och
// stats-for-core/index.ts, eftersom den riktiga logiken ligger i SQL
// (plpgsql) och inte går att enhetstesta isolerat utan en databas i
// den här miljön.
//
// Täcker (enligt ordertexten, 1c):
//   - auth fail-closed, fel token -> 401
//   - inga PII-fält i svaret (buyer_name/buyer_email/order_id)
//   - null-säkert starts_at (aldrig new Date(null) eller en påhittad
//     fallback-tid)
//   - nettointäkt-beräkningen (och dess KÄNDA begränsning - se
//     migrationens egen kommentar: netto gäller bara HELT
//     återbetalda ordrar, inte partiella, eftersom det beloppet
//     aldrig persisteras någonstans i schemat idag)
//   - datumgrupp i Stockholmstid, inte UTC
//
// Kör: deno run --allow-read scripts/check-core-stats.ts

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}
function assertTrue(actual: unknown, label: string) {
  assertEqual(Boolean(actual), true, label)
}

const root = new URL('..', import.meta.url)
function read(relPath: string): string {
  return Deno.readTextFileSync(new URL(relPath, root))
}
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
}

// === 1. Migrationen: core_event_stats ===
{
  const migration = read('supabase/migrations/20261013040000_core_event_stats_function.sql')
  const codeOnly = stripSqlComments(migration)

  assertTrue(migration.includes('begin;') && migration.includes('commit;'), 'Migrationen är omsluten av begin/commit')
  assertTrue(!/\bsecurity definer\b/i.test(codeOnly), 'INGEN security definer i någon KODRAD')
  assertTrue(
    migration.includes('revoke all on function core_event_stats(uuid) from public') &&
      migration.includes('revoke all on function core_event_stats(uuid) from anon') &&
      migration.includes('revoke all on function core_event_stats(uuid) from authenticated') &&
      migration.includes('grant execute on function core_event_stats(uuid) to service_role'),
    'EXECUTE revokeras explicit per roll och beviljas bara service_role',
  )

  // Ingen skrivning - bara select/with, aldrig insert/update/delete på
  // någon av de riktiga datatabellerna (förutom "v_result" som är en
  // lokal plpgsql-variabel, inte en tabell).
  assertTrue(
    !/\b(insert into|update\s+(orders|tickets|order_items|events|ticket_types)|delete from)\b/i.test(codeOnly),
    'Funktionen skriver ALDRIG till någon tabell - rent skrivskyddad aggregering',
  )

  // Bara betalda ordrar, testarkiverade uteslutna, 'hidden' INKLUDERAS
  // (medvetet, enligt instruktion - flaggat i migrationens kommentar).
  assertTrue(codeOnly.includes("o.status = 'paid'"), "Bara ordrar med status='paid' räknas med")
  assertTrue(
    codeOnly.includes("coalesce(o.archived_reason, '') <> 'test'"),
    "archived_reason='test' utesluts explicit",
  )
  assertTrue(
    !codeOnly.includes("<> 'hidden'") && !codeOnly.includes("!= 'hidden'"),
    "archived_reason='hidden' utesluts INTE - inkluderas enligt instruktion (riktig betalning, bara dold)",
  )
  assertTrue(migration.includes("archived_reason='hidden'"), 'Migrationen flaggar uttryckligen i sin egen kommentar att hidden-ordrar inkluderas')

  // Arkiverade EVENT utesluts helt (inte bara per order).
  assertTrue(codeOnly.includes('e.archived_at is null'), 'Arkiverade event (events.archived_at) utesluts helt')

  // sold/checked_in från tickets.status - INTE ticket_scans, och
  // INTE de (felaktiga) spec-värdena 'valid'/'använda' - de riktiga
  // värdena är 'valid'/'checked_in'/'void'.
  assertTrue(
    codeOnly.includes("t.status in ('valid', 'checked_in')") && !codeOnly.includes('ticket_scans'),
    "sold räknar tickets.status in ('valid','checked_in') - aldrig ticket_scans (skulle dubbelräkna omskanningar)",
  )
  assertTrue(codeOnly.includes("t.status = 'checked_in'"), "checked_in räknar tickets.status='checked_in' specifikt")

  // revenue_ore från order_items (pris-snapshot), ALDRIG från
  // ticket_types (nuvarande pris, kan ha ändrats sedan köpet).
  assertTrue(codeOnly.includes('oi.unit_price_ore * oi.qty'), 'revenue_ore summerar order_items.unit_price_ore * qty - pris-snapshotten vid köpet')
  assertTrue(!codeOnly.includes('tt.price_ore'), 'revenue_ore läser ALDRIG ticket_types.price_ore (nuvarande pris, inte pris-snapshotten)')

  // capacity = events.capacity (den delade poolen) - ticket_types har
  // ingen egen capacity-kolumn längre (droppad 2026-01-06).
  assertTrue(codeOnly.includes("'capacity', e.capacity"), 'capacity hämtas från events.capacity (den delade poolen)')
  assertTrue(!codeOnly.includes('tt.capacity'), 'Läser ALDRIG ticket_types.capacity - kolumnen finns inte längre (droppad i shared_capacity_pool-migrationen)')

  // starts_at skickas igenom RAKT AV - null-säkert eftersom det bara
  // är ett jsonb_build_object-fält, ingen coalesce till en påhittad
  // fallback-tid.
  assertTrue(codeOnly.includes("'starts_at', e.starts_at"), 'starts_at skickas igenom direkt (null förblir null, ingen påhittad fallback-tid)')
  assertTrue(!codeOnly.includes("coalesce(e.starts_at"), 'starts_at har INGEN coalesce-fallback - null ska synas som null, inte gissas fram')

  // Stockholmstid, inte UTC, för by_day.
  assertTrue(
    codeOnly.includes("at time zone 'Europe/Stockholm'"),
    'by_day grupperas på datum i Europe/Stockholm, inte UTC',
  )
  assertTrue(!/at time zone 'utc'/i.test(codeOnly), 'Ingen UTC-gruppering kvar av misstag')

  // Känd begränsning (partiell återbetalning) ska vara DOKUMENTERAD i
  // filen, så den inte kan försvinna tyst vid en framtida redigering.
  assertTrue(
    migration.includes('PARTIELL återbetalning') && migration.includes('GÖR INGENTING'),
    'Migrationen dokumenterar uttryckligen att partiella återbetalningar inte persisteras någonstans och därför inte dras av från revenue_ore',
  )

  // Inga personuppgifter eller order-id:n i utdatan. o.id/oi.* används
  // bara som JOIN-villkor (tillåtet) - aldrig som ett eget fält i
  // jsonb_build_object, vilket den explicita fältlistan nedan bekräftar.
  for (const forbidden of ['buyer_name', 'buyer_email', "'order_id'"]) {
    assertTrue(!codeOnly.includes(forbidden), `Returnerar aldrig ${forbidden} - bara aggregat`)
  }
  assertTrue(
    codeOnly.includes(
      "jsonb_build_object(\n      'event_id', e.id,\n      'slug', e.slug,\n      'title', e.title,\n      'starts_at', e.starts_at,\n      'status', e.status,\n      'capacity', e.capacity,\n      'sold', coalesce(tix.sold, 0),\n      'checked_in', coalesce(tix.checked_in, 0),\n      'revenue_ore', coalesce(rev.revenue_ore, 0),\n      'by_ticket_type', coalesce(btt.rows, '[]'::jsonb),\n      'by_day', coalesce(bd.rows, '[]'::jsonb)\n    )",
    ),
    'Toppnivå-objektets fältlista är exakt den avsedda (inget orderfält smugit in)',
  )
}

// === 2. stats-for-core/index.ts ===
{
  const content = read('supabase/functions/stats-for-core/index.ts')

  assertTrue(content.includes("if (req.method !== 'GET')") && content.includes('405'), 'Bara GET tillåts, allt annat 405')

  // Fail-closed: hemligheten kontrolleras FÖRE token-jämförelsen.
  const configCheckIndex = content.indexOf("if (!statsToken || !organizerId)")
  const tokenCheckIndex = content.indexOf('timingSafeEqual(provided, statsToken)')
  assertTrue(
    configCheckIndex !== -1 && tokenCheckIndex !== -1 && configCheckIndex < tokenCheckIndex,
    'CORE_STATS_TOKEN/CORE_STATS_ORGANIZER_ID kontrolleras FÖRE token-jämförelsen - fail-closed, saknad secret ger 500, aldrig en öppen väg',
  )
  assertTrue(content.includes('timingSafeEqual'), 'Token jämförs i konstant tid (samma hjälpfunktion som retry-confirmation-emails)')
  assertTrue(content.includes("statsResponse({ error: 'unauthorized' }, 401)"), 'Fel/saknad token ger 401 med en kort felkod, ingen intern detalj')

  // organizer_id kommer ALDRIG från klienten - bara från miljön.
  assertTrue(
    content.includes("Deno.env.get('CORE_STATS_ORGANIZER_ID')") &&
      !content.includes('req.headers.get') &&
      !/searchParams|url\.search/.test(content),
    'Arrangören läses BARA från miljövariabeln CORE_STATS_ORGANIZER_ID - aldrig från en header eller query-parameter',
  )

  assertTrue(content.includes("'Cache-Control': 'no-store'"), 'Svaret har Cache-Control: no-store (cachning sker ett steg bort, i Fas 2)')

  // Inga PII-fält i svarsformningen.
  for (const forbidden of ['buyer_name', 'buyer_email', 'order_id', 'phone']) {
    assertTrue(!content.includes(forbidden), `index.ts hanterar aldrig ${forbidden} - bara vidarebefordrar core_event_stats egna aggregat`)
  }

  // Rör ingenting i betal-/mejlspåret.
  for (const forbidden of ['stripe', 'resend', 'webhook_events', 'confirmation_email']) {
    assertTrue(!content.toLowerCase().includes(forbidden), `index.ts refererar aldrig ${forbidden} - helt frikopplat från betal-/mejlspåret`)
  }
}

// === 3. config.toml ===
{
  const configToml = read('supabase/config.toml')
  assertTrue(
    configToml.includes('[functions.stats-for-core]') && /\[functions\.stats-for-core\]\nverify_jwt = false/.test(configToml),
    'stats-for-core har verify_jwt=false (bearer-hemlighet, inte Supabase-JWT)',
  )
}

console.log(`\n${failures === 0 ? 'Alla kontroller gick igenom.' : `${failures} kontroll(er) misslyckades.`}`)
if (failures > 0) Deno.exit(1)
