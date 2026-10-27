# Migrationer — körstatus

**`supabase db push` får ALDRIG köras mot detta projekt.** `supabase
migration list --linked` visar `remote: ""` för samtliga migrationer,
även den allra första från januari — historiktabellen
(`supabase_migrations.schema_migrations`) har medvetet aldrig använts.
Varje migration har istället körts för hand i Supabase Dashboard → SQL
Editor, enligt projektets etablerade rutin. Ett `db push` skulle tolka
alla migrationer nedan som väntande och försöka köra dem på nytt mot ett
schema där de redan finns (t.ex. `create table` på en tabell som redan
finns) — det är inte en meningsfull körning, bara ett sätt att orsaka
fel.

Den här filen är det enda stället körstatus faktiskt spåras. Rutin:
bara fält som uttryckligen bekräftats av Nicklas fylls i — aldrig
gissade datum, även när det är så gott som säkert att en äldre migration
måste vara körd (systemet fungerar ju). Uppdatera raden samma dag en
migration bekräftas körd.

| Migration | Körd (datum) |
|---|---|
| `20260101000000_init.sql` | |
| `20260101000100_storage_qr_bucket.sql` | |
| `20260101000200_capacity_functions.sql` | |
| `20260101000300_stripe_vat_export.sql` | |
| `20260101000400_event_cancelled_status.sql` | |
| `20260105000000_ticket_types_and_discounts.sql` | |
| `20260106000000_shared_capacity_pool.sql` | |
| `20260106000100_order_items_cart.sql` | |
| `20260107000000_event_posters.sql` | |
| `20260108000000_organizers_auth.sql` | |
| `20260805000000_platform_admins.sql` | |
| `20260805020000_duplicate_event.sql` | |
| `20260806000000_stripe_connect.sql` | |
| `20260807000000_organizer_applications.sql` | |
| `20260807000000_platform_fee_flat_and_snapshot.sql` | |
| `20261002000000_organizer_payment_mode_direct.sql` | 2026-10-03 |
| `20261002000100_organizer_receipt_fields.sql` | 2026-10-03 |
| `20261003000000_order_terms_acceptance.sql` | 2026-10-03 |
| `20261003002000_event_sales_open_at.sql` | 2026-10-03 |
| `20261007000000_tickets_ticket_type_id_index.sql` | 2026-10-07 |
| `20261007000100_order_items_list_price.sql` | 2026-10-07 |
| `20260816000000_event_description.sql` | |
| `20261012000000_order_terms_version.sql` | |
| `20261012010000_archive.sql` | |
| `20261012020000_cancel_order_function.sql` | |
| `20261012030000_lock_down_definer_functions.sql` | |
| `20261012040000_schedule_release_expired_orders.sql` | 2026-10-27 ¹ |
| `20261012050000_order_stripe_payment_intent.sql` | |
| `20261012060000_webhook_events_status.sql` | |
| `20261012070000_order_confirmation_email_sent_at.sql` | |
| `20261012080000_finalize_paid_order_function.sql` | |
| `20261013010000_order_confirmation_email_tracking.sql` | |
| `20261013020000_claim_confirmation_email_function.sql` | |
| `20261013030000_finalize_paid_order_expanded.sql` | |
| `20261013040000_core_event_stats_function.sql` | |

¹ Körd med `supabase db query --linked -f <fil>` (inte SQL Editor),
PR #4. Verifierad samma dag: `cron.job` har en rad
`release-expired-orders`, `*/5 * * * *`, `active = true`, och de två
första körningarna i `cron.job_run_details` (07:50 och 07:55 UTC) hade
status `succeeded`. Avschemaläggning vid behov:
`supabase/rollbacks/20261012040000_schedule_release_expired_orders_rollback.sql`.

## Katalogkontroll 2026-10-27

`scripts/sql/check-applied-migrations.sql` (bara läsning) kördes mot
produktion 2026-10-27, före pg_cron-migrationen. Varje kontrollerat
objekt från migrationerna `20260106000100_order_items_cart.sql` till
och med `20261013040000_core_event_stats_function.sql` fanns. Det enda
som saknades var pg_cron. EXECUTE på de låsta funktionerna var begränsat
till `postgres`/`service_role`, vilket betyder att
`20261012030000_lock_down_definer_functions.sql` är körd. Kontrollen
visar att objekten finns, inte när migrationerna kördes, så tomma
datum ovan lämnas tomma enligt rutinen.

## Två migrationer med samma version

`20260807000000_organizer_applications.sql` och
`20260807000000_platform_fee_flat_and_snapshot.sql` har samma
versionsnummer. Versionen är primärnyckel i
`supabase_migrations.schema_migrations`, så de kan inte båda registreras
med `supabase migration repair`. Det spelar ingen roll så länge
historiktabellen inte används (se ovan), men den ena behöver döpas om
om det någon gång ändras.
