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

| Migration | Körd i SQL Editor (datum) |
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
