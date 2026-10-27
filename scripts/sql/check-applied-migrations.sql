-- ENBART LÄSNING - ändrar ingenting. Kör manuellt mot produktion:
--   supabase db query --linked -f scripts/sql/check-applied-migrations.sql -o table
-- (eller klistra in i SQL Editor).
--
-- supabase_migrations.schema_migrations är tom i produktion, så vilka
-- migrationer som faktiskt körts (manuellt via SQL Editor) går bara att
-- avgöra genom att leta efter objekten de skapar. present=false / MISSING
-- = migrationen har sannolikt inte körts.
with col(m, t, c) as (values
 ('20260806000000_stripe_connect', 'organizers', 'stripe_account_id'),
 ('20260807000000_platform_fee_flat_and_snapshot', 'orders', 'platform_fee_ore'),
 ('20260816000000_event_description', 'events', 'description'),
 ('20261002000000_organizer_payment_mode_direct', 'organizers', 'payment_mode'),
 ('20261002000100_organizer_receipt_fields', 'organizers', 'legal_name'),
 ('20261003000000_order_terms_acceptance', 'orders', 'terms_accepted_at'),
 ('20261003002000_event_sales_open_at', 'events', 'sales_open_at'),
 ('20261007000100_order_items_list_price', 'order_items', 'list_price_ore'),
 ('20261012000000_order_terms_version', 'orders', 'terms_version'),
 ('20261012010000_archive', 'events', 'archived_at'),
 ('20261012010000_archive', 'orders', 'archived_at'),
 ('20261012050000_order_stripe_payment_intent', 'orders', 'stripe_payment_intent_id'),
 ('20261012060000_webhook_events_status', 'webhook_events', 'status'),
 ('20261012070000_order_confirmation_email_sent_at', 'orders', 'confirmation_email_sent_at'),
 ('20261013010000_order_confirmation_email_tracking', 'orders', 'confirmation_email_claimed_at')),
fn(m, f) as (values
 ('20260106000100_order_items_cart', 'release_expired_orders'),
 ('20260106000100_order_items_cart', 'release_shared_capacity_multi'),
 ('20260805020000_duplicate_event', 'duplicate_event'),
 ('20261012020000_cancel_order_function', 'cancel_paid_order'),
 ('20261012080000 + 20261013030000 finalize_paid_order', 'finalize_paid_order'),
 ('20261013020000_claim_confirmation_email_function', 'claim_confirmation_email'),
 ('20261013040000_core_event_stats_function', 'core_event_stats')),
tbl(m, t) as (values
 ('20260805000000_platform_admins', 'platform_admins'),
 ('20260807000000_organizer_applications', 'organizer_applications'),
 ('20260807000000_organizer_applications', 'form_submission_attempts'))
select 'kolumn' as typ, m as migration, t || '.' || c as objekt,
       exists (select 1 from information_schema.columns x
               where x.table_schema = 'public' and x.table_name = t and x.column_name = c)::text as present
  from col
union all
-- Signatur + ACL: 20261012030000_lock_down_definer_functions har körts om
-- anon/authenticated saknas i ACL:en för release_expired_orders m.fl.
select 'funktion', m, f,
       coalesce((select string_agg(pg_get_function_identity_arguments(p.oid) || ' acl=' || coalesce(p.proacl::text, 'default'), ' | ')
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = f), 'MISSING')
  from fn
union all
select 'tabell', m, t, (to_regclass('public.' || t) is not null)::text from tbl
union all
select 'index', '20261007000000_tickets_ticket_type_id_index', 'tickets_ticket_type_id_idx',
       (to_regclass('public.tickets_ticket_type_id_idx') is not null)::text
union all
select 'constraint', '20260805020000_duplicate_event', 'events_published_requires_starts_at',
       exists (select 1 from pg_constraint where conname = 'events_published_requires_starts_at')::text
union all
select 'constraint', '20261012060000_webhook_events_status', 'webhook_events_status_check',
       exists (select 1 from pg_constraint where conname = 'webhook_events_status_check')::text
union all
select 'extension', '20261012040000_schedule_release_expired_orders', e.name,
       coalesce(e.installed_version, 'ej installerad') || ' (tillgänglig ' || e.default_version || ')'
  from pg_available_extensions e where e.name = 'pg_cron'
union all
select 'drift', '-', 'pending-ordrar förbi expires_at (frigörs av första cron-körningen)',
       (select count(*)::text from orders where status = 'pending' and expires_at < now())
order by 2, 3;
