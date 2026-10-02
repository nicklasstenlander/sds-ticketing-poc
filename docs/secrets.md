# Secrets — namn, aldrig värden

Snapshot av `supabase secrets list` för projekt `oyqgxnmwojjjpoubdlfa`, taget
i samband med pre-live-backupen (tagg `pre-live-2026-10-02`). **Inga
värden i denna fil** — bara namn och vad respektive secret gör. Aktuella
värden ska finnas i 1Password.

## Supabase Edge Function secrets

| Secret | Används av | Vad den gör |
|---|---|---|
| `SCANNER_BEARER_TOKEN` | `scan-ticket`, `list-events` | Statisk bearer-token för iOS-scannerappen (Inslapp). Ingen Supabase-JWT — en delad hemlighet. |
| `STRIPE_SECRET_KEY` | `_shared/stripe.ts`, `create-order`, `admin-connect-stripe`, m.fl. | Stripe API-nyckel för plattformskontot. **Pekar idag på Moon Movements ABs Stripe-konto — måste bytas till Childproof AB innan Live mode.** |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` | Signeringshemlighet för webhook-destinationen "Biljett-checkout" (Ditt konto, `checkout.session.*`). |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `stripe-webhook` | Signeringshemlighet för den andra webhook-destinationen "Stripe Connect-onboarding" (Anslutna konton, `account.updated`). `stripe-webhook` provar `STRIPE_WEBHOOK_SECRET` först och faller tillbaka hit. |
| `PLATFORM_FEE_RATE` | `_shared/platformFee.ts` | Plattformsavgift i percent-läge (t.ex. `0.02` = 2 %), delas av alla arrangörer. Gäller bara när `PLATFORM_FEE_MODE` inte är satt till `flat_per_ticket`. |
| `RESEND_API_KEY` | mail-utskick (bekräftelse, admin-inbjudan, m.fl.) | API-nyckel till Resend. |
| `RESEND_FROM` | samma | Avsändaradress för utgående mail. |
| `FRONTEND_BASE_URL` | `create-order`, `public-apply-organizer`, `admin-invite-member` | Basen för länkar som skickas i mail/redirects (t.ex. tillbaka till köpsidan). |
| `CRON_SECRET` | `release-expired-orders` | Delas med GitHub Actions-schemat (`release-expired-orders.yml`) som auktorisering för cron-anropet. |
| `SIE_ACCOUNT_CLEARING`, `SIE_ACCOUNT_REVENUE`, `SIE_ACCOUNT_VAT` | — | ⚠️ **Matchar inte vad koden läser.** `platform-export-revenue/index.ts` läser `PLATFORM_SIE_ACCOUNT_REVENUE`/`_VAT`/`_CLEARING` (med `PLATFORM_`-prefix) — dessa tre secrets utan prefix läses alltså aldrig, funktionen faller tillbaka på sina hårdkodade default-konton (3041/2611/1580). Antingen döp om secreten eller rätta koden innan plattformens egen bokföringsexport litas på. |
| `ADMIN_PIN` | — (avvecklad) | Äldre delad PIN-kod för admin-inloggning (se `_shared/adminToken.ts`). Läses inte längre av någon funktion — ersatt av riktig Supabase Auth per arrangör. Säker att ta bort. |
| `ADMIN_SESSION_SECRET` | — (avvecklad) | Hörde ihop med samma äldre PIN-flöde som ovan. Läses inte längre. Säker att ta bort. |

**Satt men inte verifierad i det här repot:** `SUPPORT_REPLY_TO_EMAIL`
(valfri — `admin-reject-application` faller tillbaka på `RESEND_FROM` om
den saknas) och `SIE_ACCOUNT_RECEIVABLE`, `SIE_ACCOUNT_VAT_6/_12/_25`
(valfria — `export-sales` har egna defaultkonton om de saknas). Inga av
dessa fanns i secrets-listan vid backuptillfället.

**Supabase-hanterade (sätts aldrig manuellt):** `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`,
`SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` —
injiceras automatiskt av Supabase i varje Edge Function, finns med i
`secrets list` men är inte något ni själva satt eller behöver flytta
över manuellt till ett nytt projekt.

## GitHub Actions secrets (repo → Settings → Secrets and variables → Actions)

| Secret | Används av | Vad den gör |
|---|---|---|
| `VITE_SUPABASE_URL` | `deploy.yml` | Byggs in i frontend-bundlen (GitHub Pages-deploy). |
| `VITE_SUPABASE_ANON_KEY` | `deploy.yml` | Samma, publik anon-nyckel. |
| `SUPABASE_FUNCTIONS_URL` | `release-expired-orders.yml` | Bas-URL till Edge Functions, t.ex. `https://oyqgxnmwojjjpoubdlfa.supabase.co/functions/v1`. |
| `CRON_SECRET` | `release-expired-orders.yml` | Samma värde som Supabase-secreten `CRON_SECRET` ovan. |

## Checklista innan detta repo kopieras till ett nytt Childproof-projekt

- [ ] Alla värden ovan (utom de avvecklade och de Supabase-hanterade) finns
      sparade i 1Password
- [ ] `PLATFORM_SIE_ACCOUNT_*`/`SIE_ACCOUNT_*`-missmatchen ovan är
      undersökt och åtgärdad (antingen i kod eller i secret-namnen)
- [ ] `ADMIN_PIN`/`ADMIN_SESSION_SECRET` borttagna (`supabase secrets unset`)
- [ ] `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_CONNECT_WEBHOOK_SECRET`
      bytta till Childproof ABs eget Stripe-konto innan Live mode
