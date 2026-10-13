-- orders.confirmation_email_{attempts,last_error,claimed_at} (ordern
-- "Webhooken är för långsam: sänk svarstiden utan att tappa mejl"
-- 2026-10-13, ny plan som ersätter B1/B2, punkt 2).
--
-- Additiva, nullable/default-värda kolumner, ingen backfill:
--
--   confirmation_email_attempts  - antal gånger ett utskick har
--                                  PÅBÖRJATS (claimats) för ordern.
--                                  Börjar på 0, ökas av
--                                  claim_confirmation_email().
--   confirmation_email_last_error - kort felkod vid ett misslyckat
--                                  utskick (se shortEmailErrorCode i
--                                  stripe-webhook/index.ts) - ALDRIG
--                                  namn, e-post eller rå feltext från
--                                  Resend/Stripe. Nollställs vid ett
--                                  lyckat utskick.
--   confirmation_email_claimed_at - satt av claim_confirmation_email()
--                                  precis INNAN utskicksförsöket
--                                  påbörjas ("claim före utskick") -
--                                  gör mejlutskicket från
--                                  bakgrundsuppgiften (EdgeRuntime.
--                                  waitUntil, körs EFTER svaret till
--                                  Stripe) säkert mot att köras två
--                                  gånger för samma order, även om
--                                  isolatet stängs ned eller en
--                                  samtidig (framtida) återförsöksväg
--                                  råkar träffa SAMMA order. Samma
--                                  2-minuters "ta över en övergiven
--                                  claim"-mönster som webhook_events
--                                  redan använder (se
--                                  webhookEventRetry.ts).
begin;

alter table orders
  add column confirmation_email_attempts int not null default 0,
  add column confirmation_email_last_error text,
  add column confirmation_email_claimed_at timestamptz;

commit;
