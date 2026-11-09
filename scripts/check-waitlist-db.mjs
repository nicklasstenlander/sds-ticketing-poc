// Väntelista (2026-11): prövar migrationen 20261109020000_waitlist.sql mot en
// riktig Postgres i minnet (PGlite) - unik adress per speltid (oavsett
// versaler), att en borttagen rad inte blockerar en ny anmälan, och
// gränserna för antal och status.
//
// Kör (PGlite är inget beroende i projektet, installeras tillfälligt):
//   npm i --no-save @electric-sql/pglite@0.2.17 && node scripts/check-waitlist-db.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
const db = new PGlite()
await db.exec(`create table events (id uuid primary key default gen_random_uuid(), title text);`)
await db.exec(readFileSync(`${repo}/supabase/migrations/20261109020000_waitlist.sql`, 'utf8'))

let fails = 0
const ok = (cond, label) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`); if (!cond) fails++ }
const fails_ = async (sql, p) => { try { await db.query(sql, p); return false } catch { return true } }

const ev = (await db.query(`insert into events(title) values ('A') returning id, waitlist_enabled`)).rows[0]
const ev2 = (await db.query(`insert into events(title) values ('B') returning id`)).rows[0]
ok(ev.waitlist_enabled === false, 'väntelistan är av som standard')

const ins = `insert into waitlist_entries(event_id, name, email, qty) values ($1, $2, $3, $4) returning id`
const first = (await db.query(ins, [ev.id, 'Anna', 'anna@x.se', 2])).rows[0]
ok(Boolean(first.id), 'anmälan sparas')
ok(await fails_(ins, [ev.id, 'Anna igen', 'ANNA@x.se', 1]), 'samma adress (annan skiftläge) två gånger till samma speltid nekas')
ok(!(await fails_(ins, [ev2.id, 'Anna', 'anna@x.se', 1])), 'samma adress till en annan speltid går bra')
await db.query(`update waitlist_entries set status = 'removed' where id = $1`, [first.id])
ok(!(await fails_(ins, [ev.id, 'Anna', 'anna@x.se', 1])), 'efter borttagning kan samma adress anmäla sig igen')
ok(await fails_(ins, [ev.id, 'Bo', 'bo@x.se', 0]), 'antal 0 nekas')
ok(await fails_(ins, [ev.id, 'Bo', 'bo@x.se', 11]), 'antal 11 nekas')
ok(await fails_(`update waitlist_entries set status = 'okänd'`), 'okänd status nekas')

console.log(fails ? `\n${fails} FEL` : '\nAlla kontroller godkända.')
process.exit(fails ? 1 : 0)
