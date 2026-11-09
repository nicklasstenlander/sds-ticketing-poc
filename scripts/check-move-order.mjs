// Flytta order (2026-11): kör databasfunktionen move_paid_order mot en riktig
// Postgres i minnet (PGlite) med de tabeller och kapacitetsfunktioner den
// använder, och prövar varje utfall.
//
// Kör (PGlite är inget beroende i projektet, installeras tillfälligt):
//   npm i --no-save @electric-sql/pglite@0.2.17 && node scripts/check-move-order.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const repo = fileURLToPath(new URL('..', import.meta.url))
const db = new PGlite()
const cartSql = readFileSync(`${repo}/supabase/migrations/20260106000100_order_items_cart.sql`, 'utf8')
const fnStart = cartSql.indexOf('create or replace function reserve_shared_capacity_multi')
const fnEnd = cartSql.indexOf('$$;', cartSql.indexOf('create or replace function release_shared_capacity_multi')) + 3
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table organizers (id uuid primary key default gen_random_uuid(), name text);
create table events (id uuid primary key default gen_random_uuid(), organizer_id uuid references organizers(id), title text not null, venue text, starts_at timestamptz, status text not null default 'published', archived_at timestamptz, capacity int not null, sold_count int not null default 0);
create table ticket_types (id uuid primary key default gen_random_uuid(), event_id uuid references events(id), name text not null, price_ore int not null, vat_rate int not null default 6, sold_count int not null default 0, sort_order int not null default 0, created_at timestamptz default now());
create table orders (id uuid primary key default gen_random_uuid(), event_id uuid not null references events(id), buyer_name text not null, buyer_email text not null, status text not null, archived_at timestamptz, total_ore int);
create table order_items (id uuid primary key default gen_random_uuid(), order_id uuid not null references orders(id), ticket_type_id uuid not null references ticket_types(id), qty int not null, unit_price_ore int not null, vat_rate int not null);
create table tickets (id uuid primary key default gen_random_uuid(), order_id uuid not null references orders(id), event_id uuid not null references events(id), ticket_type_id uuid references ticket_types(id), ticket_code text unique not null, holder_name text, status text not null default 'valid');
` + cartSql.slice(fnStart, fnEnd))
await db.exec(readFileSync(`${repo}/supabase/migrations/20261109010000_move_paid_order.sql`, 'utf8'))

let fails = 0
const ok = (cond, label) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`); if (!cond) fails++ }
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]

const org = (await one(`insert into organizers(name) values ('SDS') returning id`)).id
const org2 = (await one(`insert into organizers(name) values ('Annan') returning id`)).id
const ev = async (title, venue, cap, sold = 0, extra = {}) => (await one(
  `insert into events(organizer_id,title,venue,capacity,sold_count,status) values ($1,$2,$3,$4,$5,$6) returning id`,
  [extra.org ?? org, title, venue, cap, sold, extra.status ?? 'published'])).id
const tt = async (event, name, price, sold = 0) => (await one(`insert into ticket_types(event_id,name,price_ore,sold_count) values ($1,$2,$3,$4) returning id`, [event, name, price, sold])).id

const A = await ev('Around the World', 'Berga Teater', 200, 3)
const B = await ev('Around the World', 'Berga Teater', 200, 199)
const C = await ev('Around the World', 'Berga Teater', 200, 10)
const Other = await ev('Color Me', 'Berga Teater', 280, 0)
const Draft = await ev('Around the World', 'Berga Teater', 200, 0, { status: 'draft' })
const Foreign = await ev('Around the World', 'Berga Teater', 200, 0, { org: org2 })
const aOrd = await tt(A, 'Ordinarie', 20000, 2); const aBarn = await tt(A, 'Barn 0–3 år', 0, 1)
await tt(B, 'Ordinarie', 20000, 199); await tt(B, 'Barn 0–3 år', 0)
const cOrd = await tt(C, 'Ordinarie', 20000, 10); const cBarn = await tt(C, 'Barn 0–3 år', 0)
await tt(Other, 'Ordinarie', 15000)
await tt(Draft, 'Ordinarie', 20000); await tt(Foreign, 'Ordinarie', 20000)

const order = (await one(`insert into orders(event_id,buyer_name,buyer_email,status,total_ore) values ($1,'Anna','a@x.se','paid',40000) returning id`, [A])).id
await db.query(`insert into order_items(order_id,ticket_type_id,qty,unit_price_ore,vat_rate) values ($1,$2,2,20000,6),($1,$3,1,0,6)`, [order, aOrd, aBarn])
await db.query(`insert into tickets(order_id,event_id,ticket_type_id,ticket_code) values ($1,$2,$3,'OLD1'),($1,$2,$3,'OLD2'),($1,$2,$4,'OLD3')`, [order, A, aOrd, aBarn])

const move = (target, codes = ['N1', 'N2', 'N3'], o = org) => one(`select * from move_paid_order($1,$2,$3,$4,null)`, [order, target, o, codes])

ok((await move(A)).outcome === 'same_event', 'samma speltid avvisas')
ok((await move(Other)).outcome === 'invalid_target', 'annan föreställning avvisas')
ok((await move(Draft)).outcome === 'invalid_target', 'opublicerad speltid avvisas')
ok((await move(Foreign)).outcome === 'not_found' || (await move(Foreign, undefined, org2)).outcome === 'not_found', 'annan arrangör avvisas')
ok((await move(Foreign)).outcome === 'invalid_target', 'mål hos annan arrangör avvisas')
ok((await move(B)).outcome === 'no_capacity', 'fullt mål (1 plats kvar, 3 behövs) avvisas')
const bAfter = await one(`select sold_count from events where id=$1`, [B])
ok(bAfter.sold_count === 199, 'misslyckad reservation ändrar inte målets sold_count')

let threw = false
try { await move(C, ['X1']) } catch { threw = true }
ok(threw, 'fel antal koder kastar fel (ingen halv flytt)')

const r = await move(C)
ok(r.outcome === 'moved', 'flytt till ledig speltid lyckas')
ok(r.tickets.length === 3, 'tre nya biljetter returneras')
const evs = Object.fromEntries((await db.query(`select id, sold_count from events where id in ($1,$2)`, [A, C])).rows.map((x) => [x.id, x.sold_count]))
ok(evs[A] === 0 && evs[C] === 13, `platser flyttade (A ${evs[A]}, C ${evs[C]})`)
const tts = Object.fromEntries((await db.query(`select id, sold_count from ticket_types where id in ($1,$2,$3,$4)`, [aOrd, aBarn, cOrd, cBarn])).rows.map((x) => [x.id, x.sold_count]))
ok(tts[aOrd] === 0 && tts[aBarn] === 0 && tts[cOrd] === 12 && tts[cBarn] === 1, 'biljettypernas sold_count flyttade per typ')
const o2 = await one(`select event_id, total_ore from orders where id=$1`, [order])
ok(o2.event_id === C && o2.total_ore === 40000, 'ordern ligger på målet, beloppet orört')
const items = (await db.query(`select ticket_type_id, unit_price_ore from order_items where order_id=$1 order by unit_price_ore`, [order])).rows
ok(items[0].ticket_type_id === cBarn && items[1].ticket_type_id === cOrd && items[1].unit_price_ore === 20000, 'orderrader pekar på målets typer, snapshotpris orört')
const tk = (await db.query(`select ticket_code, status, event_id from tickets where order_id=$1 order by ticket_code`, [order])).rows
ok(tk.filter((t) => t.status === 'void' && t.event_id === A).length === 3, 'gamla biljetter makulerade och kvar på källan')
ok(tk.filter((t) => t.status === 'valid' && t.event_id === C).length === 3, 'nya biljetter giltiga på målet')
ok((await one(`select count(*)::int n from order_moves where order_id=$1`, [order])).n === 1, 'flytten loggad i order_moves')

await db.query(`update tickets set status='checked_in' where ticket_code='N1'`)
ok((await move(A, ['M1', 'M2', 'M3'])).outcome === 'checked_in', 'incheckad biljett stoppar flytt')
await db.query(`update tickets set status='valid' where ticket_code='N1'`)
await db.query(`update ticket_types set name='Barn' where id=$1`, [aBarn])
ok((await move(A, ['M1', 'M2', 'M3'])).outcome === 'type_mismatch', 'saknad biljettyp på målet stoppar flytt')
await db.query(`update ticket_types set name='Barn 0–3 år' where id=$1`, [aBarn])
const back = await move(A, ['M1', 'M2', 'M3'])
ok(back.outcome === 'moved', 'flytt tillbaka fungerar')
await db.query(`update orders set status='cancelled' where id=$1`, [order])
ok((await move(C, ['Z1', 'Z2', 'Z3'])).outcome === 'not_found', 'avbokad order kan inte flyttas')

console.log(fails ? `\n${fails} FEL` : '\nAlla kontroller godkända.')
process.exit(fails ? 1 : 0)
