# SODSS Biljett - Proof of Concept

Ett helt fristående proof-of-concept för ett biljettflöde: **skapa event →
köp biljett (ingen betalning) → mail med QR-kod → scanna i app**.

> **OBS:** Detta är ett NYTT, isolerat projekt. Det delar INGET med
> produktions-SODSS/CORE - ingen gemensam Supabase, inga CogWork-anrop,
> inga dans.se-referenser, ingen delad kodbas. Allt provisioneras från
> grunden enligt instruktionerna nedan.

Syftet är att bevisa att hela kedjan fungerar tekniskt. Det är INTE en
färdig produkt - UI:t är medvetet enkelt/fult, men flödet är komplett och
fungerande.

## Status

| Steg | Status |
|---|---|
| Nytt Supabase-projekt skapat (org "SDS Biljett PoC", projekt `sds-ticketing-poc`, project-ref `oyqgxnmwojjjpoubdlfa`, region North EU/Stockholm) | ✅ Klart |
| Databasmigrationer körda, RLS bekräftat aktiverat på alla tabeller | ✅ Klart |
| Storage-bucket `qr` bekräftat skapad och publik | ✅ Klart |
| `.env` ifylld med riktig `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` | ✅ Klart |
| Secrets satta (`RESEND_API_KEY`, `SCANNER_BEARER_TOKEN`) | ⬜ Återstår - se avsnitt 3 |
| Resend konfigurerat | ⬜ Återstår - se avsnitt 4 |
| Edge Functions deployade med korrekt `verify_jwt` (av för publika/token-baserade, PÅ för admin-*/export-sales) | ⬜ Återstår - se avsnitt 5 |
| curl-verifiering av samtliga funktioner | ⬜ Återstår - se avsnitt 5 |
| Frontend deployad | ⬜ Återstår - se avsnitt 7 |
| Stripe Checkout (Test mode) - `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` | ✅ Redan satta av kontoägaren (enligt Tilläggsorder) |
| Ny migration för Stripe/moms/export - körd i SQL Editor | ⬜ Återstår - se avsnitt 8 |
| `FRONTEND_BASE_URL`, `CRON_SECRET` secrets | ⬜ Återstår - se avsnitt 8 |
| Schemalagt jobb för `release-expired-orders` (GitHub Actions) | ⬜ Återstår - se avsnitt 8 |
| Kontonummer för SIE-export konfigurerade (annars används exempelvärden) | ⬜ Återstår - se avsnitt 9 |

De återstående secrets-värdena, Resend-nyckeln och CLI-inloggningen är
sådant bara du kan göra - se respektive avsnitt nedan för exakta kommandon.

## Vad ingår

- `/admin` - inloggningsskyddad admin-vy (riktig Supabase Auth,
  e-post + lösenord per arrangörsanvändare - se avsnitt "Flera
  arrangörer" nedan): skapa event (inkl. pris och momssats), se sålda
  biljetter per event, se biljettstatus och incheckningstid, samt
  exportera betald försäljning som CSV/SIE4. En inloggad användare ser
  och kan bara redigera sin EGEN arrangörs event - detta gäller på
  databasnivå (RLS) och i varje admin-Edge Function, inte bara i UI:t.
- `/kop/:slug` - publik köpsida (namn, e-post, antal 1-6) som skickar
  vidare till **Stripe Checkout (Test mode)** för betalning.
- `/kop/:slug/klar` - bekräftelsesida som pollar orderstatus tills
  betalningen är bekräftad (eller sessionen gått ut/avbrutits).
- Publika/interna Edge Functions: `create-order`, `order-status`,
  `stripe-webhook`, `release-expired-orders`, `scan-ticket`, `list-events`.
- Admin-interna Edge Functions (kräver en inloggad arrangörsanvändares
  Supabase Auth-JWT): `admin-create-event`, `admin-update-event`,
  `admin-delete-event`, `admin-events`, `admin-event-tickets`,
  `admin-ticket-types`, `admin-discount-codes`, `admin-upload-poster`,
  `export-sales` - se "Arkitekturbeslut" nedan för varför dessa behövdes
  utöver spec-listan.
- Admin kan redigera (titel, plats, datum, kapacitet, pris, momssats) och
  radera event. Ett event med sålda biljetter kan inte raderas - det
  markeras `cancelled` istället (döljs från publik köpsida/scanner-app,
  syns fortsatt i admin och i exportunderlaget).

## Vad ingår INTE (medvetet)

Flera biljettyper eller momssatser per event, PDF-generering, Apple/Google
Wallet, återbetalning/avbokning i UI (hanteras manuellt i Stripe
Dashboard, se avsnitt 8b för Connect-kontons refunds-begränsning),
offline-stöd, SODSS-varumärkesanpassad design, Swish,
Stripe Invoicing/fakturering, automatisk schemalagd SIE-export (manuell
nedladdning i v1).
(Denna lista är historisk och inte fullt uppdaterad - inloggning,
Stripe Connect/eget underkonto per arrangör och självregistrering av
arrangörer har alla byggts sedan dess, se respektive avsnitt.)

---

## 1. Skapa ett nytt Supabase-projekt

**Redan klart för det här repot** - projektet finns och är länkat:

- Organisation: **SDS Biljett PoC** (egen, separat organisation - INTE
  samma som CORE:s "SDS"-organisation)
- Projekt: **sds-ticketing-poc**
- Project-ref: **`oyqgxnmwojjjpoubdlfa`**
- Region: **North EU (Stockholm)**
- Project URL: `https://oyqgxnmwojjjpoubdlfa.supabase.co`

`.env` i repot är redan ifylld med `VITE_SUPABASE_URL` och den publika
"publishable key" (nya API-nyckelformatet, `sb_publishable_...` - fungerar
identiskt med den äldre `anon key` för `@supabase/supabase-js`) för detta
projekt.

Om du någon gång behöver återskapa detta från grunden på ett nytt projekt,
gör såhär:

1. Gå till [supabase.com](https://supabase.com) och skapa ett **nytt,
   fristående** projekt i en **egen organisation** (döp det gärna till
   t.ex. `sds-ticketing-poc` - ANVÄND INTE ett befintligt SODSS/CORE-projekt
   eller CORE:s organisation).
2. Notera **Project URL** och **publishable/anon key** under
   *Project Settings → API Keys* - dessa behövs för frontendens `.env`.
3. Installera Supabase CLI lokalt om du inte redan har den:
   ```bash
   npm install -g supabase
   ```
4. Logga in och länka CLI:n till det nya projektet:
   ```bash
   supabase login
   supabase link --project-ref <ditt-project-ref>
   ```

## 2. Kör databasmigrationerna

**Redan klart för det här projektet** - samtliga tre migrationer har körts
i SQL Editor och verifierats: alla fyra tabeller (`events`, `orders`,
`tickets`, `ticket_scans`) finns med `rowsecurity = true`, och
storage-bucketen `qr` är bekräftat skapad och markerad **Public** (kollad
under *Storage → qr* i Dashboard).

Migrationerna i `supabase/migrations/` skapar hela schemat, RLS-policies
(neka allt som standard, förutom att anon får läsa publicerade events), de
atomiska kapacitetsreservationsfunktionerna, samt det publika
storage-bucketet `qr`. Om du behöver köra om dem mot ett nytt/annat
projekt:

**Alternativ A - via CLI (rekommenderas):**

```bash
supabase db push
```

**Alternativ B - manuellt i SQL Editor:**

Öppna *SQL Editor* i Supabase Dashboard och kör innehållet i
`supabase/migrations/20260101000000_init.sql`,
`supabase/migrations/20260101000100_storage_qr_bucket.sql` och
`supabase/migrations/20260101000200_capacity_functions.sql`, i den
ordningen. Migrationerna är skrivna för att köra rent på ett helt tomt
projekt.

## 3. Sätt hemligheter (secrets) för Edge Functions

**Detta steget är INTE gjort än** - det innebär att skriva in API-nycklar/
tokens, vilket görs bäst av dig själv direkt i terminalen eller Dashboard
(*Project Settings → Edge Functions → Secrets*), inte av en assistent.

Börja med att logga in och länka CLI:n till det befintliga projektet (om du
inte redan gjort det i en tidigare terminalsession):

```bash
supabase login
supabase link --project-ref oyqgxnmwojjjpoubdlfa
```

`SUPABASE_SERVICE_ROLE_KEY` och `SUPABASE_URL` finns automatiskt
tillgängliga i alla Edge Functions - de behöver INTE sättas manuellt.

Följande hemligheter måste däremot sättas explicit, och används ENDAST
server-side (aldrig i frontendens `VITE_`-variabler):

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
supabase secrets set SCANNER_BEARER_TOKEN=$(openssl rand -hex 32)
```

> **`ADMIN_PIN` är borttagen** (Tilläggsordern 2026-08-05, "Flera
> arrangörer: riktiga inloggningar och dataisolering") - admin-inloggning
> sker numera med riktig Supabase Auth (e-post + lösenord per
> arrangörsanvändare), inte en delad PIN-kod. Om `ADMIN_PIN` redan är satt
> som secret på projektet gör det ingen skada att lämna kvar den (ingen
> kod läser den längre), men den kan tas bort med
> `supabase secrets unset ADMIN_PIN`.

Valfritt - avsändaradress för Resend (annars används `biljett@resend.dev`,
som bara fungerar för testmail till din egen Resend-inloggade adress):

```bash
supabase secrets set RESEND_FROM="Biljetter <biljetter@dindomän.se>"
```

## 4. Konfigurera Resend

1. Skapa ett konto på [resend.com](https://resend.com).
2. Lägg till och verifiera en avsändardomän under *Domains* (DNS-poster:
   SPF/DKIM enligt Resends instruktioner), eller använd Resends
   testadress `onboarding@resend.dev` för snabba tester (mail går då bara
   fram till den e-post du själv registrerade Resend-kontot med).
3. Skapa en API-nyckel under *API Keys* och sätt den som
   `RESEND_API_KEY` (steg 3 ovan).
4. Sätt `RESEND_FROM` till en adress på den verifierade domänen, t.ex.
   `Biljetter <biljetter@dindomän.se>`.

## 5. Deploya Edge Functions

### Varför `verify_jwt` är AV på de publika/token-baserade funktionerna
### men PÅ på admin-*/export-sales (sedan Tilläggsordern 2026-08-05)

Supabase Edge Functions kräver som standard en giltig **Supabase-utfärdad**
JWT i `Authorization`-headern. Gatewayen avvisar anropet med 401 **innan**
funktionskoden ens körs.

- `create-order`/`order-status`/`public-events` skickar ingen
  `Authorization`-header alls (publika) → `verify_jwt = false`.
- `scan-ticket`/`list-events` skickar `SCANNER_BEARER_TOKEN` - en egen
  statisk hemlighet, inte en Supabase-JWT → `verify_jwt = false`.
- `stripe-webhook`/`release-expired-orders` skickar inte heller en
  Supabase-JWT (Stripe-signatur respektive `CRON_SECRET`) →
  `verify_jwt = false`.
- `admin-create-event`/`admin-update-event`/`admin-delete-event`/
  `admin-events`/`admin-event-tickets`/`admin-ticket-types`/
  `admin-discount-codes`/`admin-upload-poster`/`export-sales` kräver
  DÄREMOT numera en riktig Supabase Auth-JWT för en inloggad
  arrangörsanvändare (Tilläggsordern 2026-08-05, "Flera arrangörer: riktiga
  inloggningar och dataisolering" - ersätter den tidigare delade PIN-koden
  och `admin-auth`, som är borttagen) → `verify_jwt = true`. Gatewayen
  verifierar JWT-signaturen INNAN funktionskoden körs; funktionskoden
  härleder därefter `organizer_id` från JWT:n via `organizer_members` (se
  `supabase/functions/_shared/organizerAuth.ts`) - klienten skickar aldrig
  och litas aldrig på för `organizer_id`.

Detta är löst på två sätt samtidigt (bälte och hängslen):

1. `supabase/config.toml` sätter `verify_jwt` per funktion (`false` för de
   publika/token-baserade, `true` för admin-*/export-sales) - detta är den
   metod Supabase CLI:t själv rekommenderar och läses vid varje
   `supabase functions deploy`.
2. Deploykommandona nedan skickar den explicita flaggan `--no-verify-jwt`
   ENDAST för funktionerna som ska ha `verify_jwt = false`. Admin-*/
   export-sales deployas UTAN den flaggan - att av misstag lägga till
   `--no-verify-jwt` på en admin-funktion skulle stänga av JWT-
   verifieringen på gatewaynivå och göra funktionens egen
   `resolveOrganizer()`-kontroll till den enda spärren, vilket inte är
   den avsedda bälte-och-hängslen-modellen.

**Känd CLI-svaghet:** det finns rapporterade fall (Supabase CLI, GitHub-
issue #4059) där `verify_jwt`-inställningen ibland inte appliceras korrekt
vid en OMDEPLOY av en redan existerande funktion, även om `config.toml` är
korrekt. Om en funktion börjar ge fel typ av 401 efter en omdeploy: kör om
deploy-kommandot för just den funktionen (redeploy brukar lösa det), och
verifiera alltid med curl-stegen nedan innan du litar på att det fungerar
- anta aldrig att en lyckad `deploy`-körning räcker som bevis.

```bash
# verify_jwt = false - publika/token-baserade funktioner
supabase functions deploy create-order --no-verify-jwt
supabase functions deploy order-status --no-verify-jwt
supabase functions deploy scan-ticket --no-verify-jwt
supabase functions deploy list-events --no-verify-jwt
supabase functions deploy public-events --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy release-expired-orders --no-verify-jwt

# verify_jwt = true - kräver en inloggad arrangörsanvändares Supabase
# Auth-JWT. INGEN --no-verify-jwt-flagga på dessa.
supabase functions deploy admin-create-event
supabase functions deploy admin-update-event
supabase functions deploy admin-delete-event
supabase functions deploy admin-events
supabase functions deploy admin-event-tickets
supabase functions deploy admin-ticket-types
supabase functions deploy admin-discount-codes
supabase functions deploy admin-upload-poster
supabase functions deploy export-sales
```

### Bekräftad bas-URL-form

Supabase Edge Functions nås under:

```
https://<project-ref>.supabase.co/functions/v1/<funktionsnamn>
```

Detta är den enda formen som finns i Supabase officiella dokumentation.
(Formen `https://<project-ref>.functions.supabase.co` som tidigare cirkulerade
i det här repot fanns INTE i dokumentationen och har tagits bort - både
`src/lib/supabaseClient.ts` och `IOS_HANDOFF.md` använder nu den bekräftade
formen ovan.)

### Verifiera `verify_jwt` med curl - INNAN token delas med iOS-utvecklaren

Kör detta direkt efter deploy, med `<token>` utbytt mot det riktiga värdet
av `SCANNER_BEARER_TOKEN` (project-ref nedan är redan ifyllt -
`oyqgxnmwojjjpoubdlfa`, dvs. `sds-ticketing-poc`):

```bash
# 1. UTAN token -> ska ge 401 FRÅN VÅR EGEN KOD ("Ej behörig."),
#    INTE Supabase-gatewayens generiska JWT-felmeddelande. Om du ser ett
#    fel om "missing authorization header" eller "invalid JWT" istället
#    för "Ej behörig." har verify_jwt INTE stängts av korrekt - felsök
#    det innan du går vidare, annars ser en riktig token-bugg likadan ut.
curl -i https://oyqgxnmwojjjpoubdlfa.supabase.co/functions/v1/list-events

# 2. MED rätt token -> ska ge 200 och en events-lista (kan vara tom []).
curl -i https://oyqgxnmwojjjpoubdlfa.supabase.co/functions/v1/list-events \
  -H "Authorization: Bearer <token>"

# 3. scan-ticket med en påhittad kod -> ska ge 200 med "result":"invalid",
#    INTE 401.
curl -i -X POST https://oyqgxnmwojjjpoubdlfa.supabase.co/functions/v1/scan-ticket \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"ticket_code":"TESTKOD123","device":"curl-test"}'

# 4. create-order (publik, ingen token alls) -> ska INTE ge 401 på grund
#    av saknad Authorization-header. Ett annat fel (t.ex. "Event saknas.")
#    här är helt förväntat och OK - poängen är bara att gatewayen släpper
#    igenom anropet till funktionskoden.
curl -i -X POST https://oyqgxnmwojjjpoubdlfa.supabase.co/functions/v1/create-order \
  -H "Content-Type: application/json" \
  -d '{}'
```

Gör detta för samtliga sju funktioner innan du markerar dem som klara i
`IOS_HANDOFF.md` - annars felsöker iOS-utvecklaren en 401 som inte har
något med token-VÄRDET att göra.

## 6. Konfigurera och kör frontend lokalt

```bash
npm install
cp .env.example .env
# Fyll i VITE_SUPABASE_URL och VITE_SUPABASE_ANON_KEY i .env
npm run dev
```

Bygg för produktion:

```bash
npm run build
```

## 7. Deploya frontend (GitHub Pages)

1. Pusha till `main` - GitHub Actions-workflowen
   (`.github/workflows/deploy.yml`) bygger och publicerar automatiskt.
2. Första gången: aktivera GitHub Pages under repo → Settings → Pages →
   Source: "GitHub Actions" (INTE "Deploy from a branch").
3. Lägg till repository secrets under Settings → Secrets and variables →
   Actions: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` - samma två
   publika värden som redan finns i din lokala `.env`. Detta är den
   publika anon/publishable-nyckeln, inte service role-nyckeln - samma
   nyckel som redan är avsedd att synas i klientkoden. Inga av de fem
   hemligheterna (`SCANNER_BEARER_TOKEN`, `RESEND_API_KEY`,
   `RESEND_FROM`, service role-nyckeln) ska någonsin läggas som
   GitHub-secret här - de rör bara Edge Functions och är redan satta som
   Supabase secrets (avsnitt 3).
4. Sajten publiceras på
   `https://<användarnamn>.github.io/sds-ticketing-poc/`.

Routing körs via `HashRouter` (URL:er som `/#/admin`, `/#/kop/test-event`)
eftersom GitHub Pages inte har någon serverkonfiguration som kan skicka
godtyckliga sökvägar till `index.html` - en direktnavigering till `/admin`
skulle annars ge 404 från GitHub, inte appen. Se `src/App.tsx` och
`vite.config.ts` (`base: '/sds-ticketing-poc/'` - byt ut repo-namnet där om
det faktiska GitHub-repot heter något annat).

## 8. Stripe Checkout (Test mode), moms och det utgångna-jobbet

> **VIKTIGT:** hela denna PoC är kopplad mot Stripe **Test mode**.
> `STRIPE_SECRET_KEY` ska alltid vara en `sk_test_...`-nyckel -
> `_shared/stripe.ts` vägrar aktivt att starta om nyckeln inte börjar med
> `sk_test_`, som ett skyddsnät mot att av misstag koppla in en riktig
> live-nyckel. Byt aldrig till en `sk_live_...`-nyckel utan en uttrycklig,
> separat instruktion.

**Redan gjort av kontoägaren** (enligt Tilläggsordern): `STRIPE_SECRET_KEY`
och `STRIPE_WEBHOOK_SECRET` är redan satta som Supabase secrets, och en
webhook är konfigurerad i Stripe Dashboard mot

```
https://oyqgxnmwojjjpoubdlfa.supabase.co/functions/v1/stripe-webhook
```

med händelserna `checkout.session.completed` och `checkout.session.expired`.

### Vad som återstår

1. **Kör den nya migrationen** (`supabase/migrations/20260101000300_stripe_vat_export.sql`)
   - via `supabase db push` eller manuellt i SQL Editor, samma mönster som
   avsnitt 2. Den lägger till `price_ore`/`vat_rate` på `events`,
   Stripe-/moms-/utgångsfälten på `orders`, tabellen `webhook_events` samt
   databasfunktionen `release_expired_orders()`.

2. **Sätt `FRONTEND_BASE_URL`** (används av `create-order` för att bygga
   Stripe Checkouts `success_url`/`cancel_url`, och är INTE hemlig - det är
   bara webbplatsens publika adress):
   ```bash
   supabase secrets set FRONTEND_BASE_URL=https://<användarnamn>.github.io/sds-ticketing-poc
   ```

3. **Sätt `CRON_SECRET`** - en egen hemlighet (som `SCANNER_BEARER_TOKEN`)
   som skyddar `release-expired-orders` mot att anropas av någon annan än
   det schemalagda jobbet:
   ```bash
   supabase secrets set CRON_SECRET=$(openssl rand -hex 32)
   ```

4. **Deploya de nya funktionerna** (se avsnitt 5 för fullständig
   `verify_jwt`-förklaring - `config.toml` är redan uppdaterad med
   samtliga; notera att `admin-create-event`/`export-sales` INTE ska ha
   `--no-verify-jwt` sedan Tilläggsordern 2026-08-05):
   ```bash
   supabase functions deploy create-order --no-verify-jwt
   supabase functions deploy order-status --no-verify-jwt
   supabase functions deploy stripe-webhook --no-verify-jwt
   supabase functions deploy release-expired-orders --no-verify-jwt
   supabase functions deploy admin-create-event
   supabase functions deploy export-sales
   ```

5. **Schemalägg `release-expired-orders`.** Detta är ett komplement till
   `checkout.session.expired`-webhooken (webhooken kör normalt långt innan
   detta jobb hinner titta på ordern - jobbet är bara ett säkerhetsnät om en
   webhook-leverans skulle utebli). Ett GitHub Actions-workflow
   (`.github/workflows/release-expired-orders.yml`) kör var 10:e minut och
   anropar funktionen - kräver två repository secrets under Settings →
   Secrets and variables → Actions:
   - `SUPABASE_FUNCTIONS_URL` = `https://oyqgxnmwojjjpoubdlfa.supabase.co/functions/v1`
   - `CRON_SECRET` = samma värde som sattes i steg 3

### Varför `expires_at` är 30 minuter, inte 15

Tilläggsordern föreslog 15 minuters giltighetstid för Checkout-sessionen.
Stripes API kräver dock att ett anpassat `expires_at` för en Checkout
Session är **minst 30 minuter** framåt i tiden - ett värde under det
avvisas av Stripe med ett valideringsfel. `CHECKOUT_EXPIRY_MINUTES` i
`supabase/functions/_shared/stripe.ts` är därför satt till Stripes
minimivärde, 30 minuter, och `orders.expires_at`/`release_expired_orders()`
använder samma värde så att databasens och Stripes uppfattning om när
ordern går ut alltid stämmer överens.

### Moms och prisfält

- **Event:** `price_ore` (pris per biljett, i öre) och `vat_rate` (6/12/25/0
  %, default 6 - standard för scenframträdande) sätts vid eventskapande i
  `/admin` och kan i nuläget inte redigeras i efterhand (det finns ingen
  redigera-event-funktion i denna PoC, bara skapa).
- **Order:** `price_ore`/`vat_rate` kopieras (snapshot) från eventet vid
  köptillfället och ändras ALDRIG efteråt - se kommentaren i
  `20260101000300_stripe_vat_export.sql`. All bokföringsexport (avsnitt 9)
  läser alltid ordrens egna värden, aldrig eventets nuvarande.
- **Orderstatus-livscykel:** `pending` → `paid` (via `stripe-webhook`) eller
  `pending` → `expired` (via webhookens `checkout.session.expired` ELLER
  `release-expired-orders`-jobbet). `cancelled` finns i schemat för en
  eventuell framtida admin-avbokningsfunktion men sätts inte av något
  flöde i denna PoC.

## 8b. Stripe Connect - eget underkonto per arrangör (Tilläggsordern 2026-08-06)

Varje arrangör har ett eget Stripe **Standard**-Connect-konto (inte
Express/Custom - arrangören sköter sin egen KYC-onboarding direkt mot
Stripe och Stripe bär supportbördan för deras konto). Pengar för deras
köp går direkt dit, plattformens avgift dras automatiskt som en
`application_fee_amount` (satt via secreten `PLATFORM_FEE_RATE`, t.ex.
`0.02` för 2%) - ingen manuell utbetalning från er sida.

**Flöde:** admin-anropar `admin-connect-stripe` (POST) → Stripe skapar
kontot + en Account Link → arrangören slutför KYC på Stripes hostade sida
→ Stripe skickar `account.updated` till `stripe-webhook`, som sätter
`organizers.stripe_onboarding_complete = true` när kontot faktiskt kan ta
emot betalningar. `create-order` avvisar en order (`409`) om arrangören
saknar ett slutfört Connect-konto - samma spärr finns även vid
publicering (`admin-update-event`), så det upptäcks långt innan någon
kund hinner fram till Checkout.

**Krävs i Stripe Dashboard:** webhook-endpointen måste ha "Listen to
events on Connected accounts" ikryssad, annars kommer `account.updated`
aldrig fram och `stripe_onboarding_complete` fastnar på `false` även efter
en lyckad onboarding.

**Två webhook-destinationer, två hemligheter.** I Stripes nuvarande
Workbench-UI går det inte att i efterhand ändra en befintlig
händelsedestinations "Händelser från"-omfattning (Ditt konto / Anslutna
konton) - fältet låses efter att destinationen skapats. Den befintliga
"Biljett-checkout"-destinationen (Ditt konto, `checkout.session.*`) kan
alltså inte byggas ut att även ta emot `account.updated`. Istället finns
en andra, separat destination ("Stripe Connect-onboarding", Anslutna
konton, samma URL) med sin egen signeringshemlighet, sparad som secreten
`STRIPE_CONNECT_WEBHOOK_SECRET`. `stripe-webhook` provar `STRIPE_WEBHOOK_SECRET`
först och faller tillbaka på `STRIPE_CONNECT_WEBHOOK_SECRET` om den första
verifieringen misslyckas, innan den avvisar med 400.

> ⚠️ **Plattformskontot är preliminärt, inte permanent.** Det Stripe-konto
> som `STRIPE_SECRET_KEY` pekar på just nu är Moon Movements ABs konto.
> Det separata bolaget som ska äga plattformen på sikt (Childproof AB) är
> inte bildat än. Helt okej i Test mode - men **`STRIPE_SECRET_KEY` MÅSTE
> bytas till Childproof ABs eget Stripe-konto innan Live mode aktiveras
> för någon arrangör.** Se även kommentaren ovanför nyckel-läsningen i
> `supabase/functions/_shared/stripe.ts`.

**Explicit utanför omfattning i denna omgång:** Express/Custom-konton,
differentierad avgiftsnivå per arrangör i UI (går via `PLATFORM_FEE_RATE`
som secret, men alla arrangörer delar samma sats), automatisk fakturering
av plattformsavgiften (Connects `application_fee` räcker), och refunds
över Connect-gränsen (`reverse_transfer` - hanteras manuellt i respektive
arrangörs eget Stripe-dashboard tills vidare).


## 9. Exportera försäljning (CSV och SIE4)

`/admin` har en exportsektion längst ner: tre lägen (dagens datum, valfri
period, helt evenemang) och två filformat.

- **CSV** - en rad per betald order (`datum, order_id, event, antal,
  brutto_ore, moms_ore, netto_ore, momssats, betalsätt,
  stripe_session_id`). UTF-8 med BOM, öppnas rätt direkt i Excel.
- **SIE4** - en verifikation per dag och betalsätt (grupperas dessutom per
  momssats om samma dag/period skulle innehålla flera momssatser).
  Kontering: debet avräkningskonto med bruttobeloppet, kredit
  intäktskonto med nettobeloppet, kredit utgående moms-konto med
  momsbeloppet. CP437-kodad enligt SIE4-standarden.

> **VIKTIGT - granska första SIE-filen manuellt.** SIE4 har ett strikt
> filhuvud och en ovanlig teckenkodning. Strukturen i
> `supabase/functions/export-sales/index.ts` följer SIE4-skelettet, men
> **den första riktiga exporten bör granskas av en redovisningskonsult
> innan den importeras skarpt i Fortnox** - ett formatfel upptäcks annars
> inte förrän det redan ligger i bokföringen.

**Rättad 2026-08-04 (Rättelseorder):** `_shared/cp437.ts` NFC-normaliserar
nu texten innan CP437-mappning (skyddar mot "uppdelad" Unicode-text, t.ex.
inklistrad från en PDF, som annars gav `?` istället för å/ä/ö), och
SIE-verifikationer med totalt bruttobelopp 0 kr (t.ex. ett gratis testköp)
hoppas nu över helt i SIE-läget - de balanserade tekniskt men var bara
brus. Om din senast deployade `export-sales`-funktion är äldre än detta:
**deploya om den** (`supabase functions deploy export-sales`, UTAN
`--no-verify-jwt` sedan Tilläggsordern 2026-08-05 - se avsnitt 5) innan
du testar igen - koden i repot kan ha rättningar
som inte finns i en tidigare deployad version. Verifiera enligt punkt 3-4
i Definition of Done nedan (`file --mime-encoding` ska INTE visa `utf-8`,
och filen öppnad med CP437 som kodning ska visa å/ä/ö korrekt).

### Konfigurera kontoplan (valfritt - annars används exempelkonton)

Kontonumren nedan är EXEMPEL från Tilläggsordern, inte bekräftade riktiga
konton för Moon Movements AB. Sätt dem som Supabase secrets när de riktiga
kontona är klara:

```bash
supabase secrets set SIE_ACCOUNT_RECEIVABLE=1580   # avräkningskonto (Stripe)
supabase secrets set SIE_ACCOUNT_REVENUE=3041       # biljettintäkter
supabase secrets set SIE_ACCOUNT_VAT_6=2631         # utgående moms 6 %
supabase secrets set SIE_ACCOUNT_VAT_12=2621        # utgående moms 12 %
supabase secrets set SIE_ACCOUNT_VAT_25=2611        # utgående moms 25 %
```

Om ingen av dessa sätts används default-värdena ovan automatiskt.

## 10. Redigera och radera event

Ny migration (`supabase/migrations/20260101000400_event_cancelled_status.sql`)
lägger till statusvärdet `cancelled` på `events` - kör den (samma mönster
som avsnitt 2/8) innan du deployar `admin-update-event`/`admin-delete-event`.

- **`admin-update-event`** - PATCH-liknande: bara fält som skickas i body
  uppdateras. Kapaciteten kan aldrig sättas lägre än `sold_count` (kollas
  både i UI innan submit och i funktionen som den faktiska spärren).
  Pris/momssats kan redigeras fritt när som helst - påverkar aldrig redan
  skapade ordrar, eftersom `orders.price_ore`/`vat_rate` är en
  ögonblicksbild tagen vid köptillfället (avsnitt 8). Ett redan
  `cancelled`-event kan inte redigeras (409) - att återställa ett inställt
  event är explicit utanför omfattning i denna PoC.
- **`admin-delete-event`** - raderar eventet permanent OM det saknar
  kopplade ordrar (alla statusar räknas, inte bara betalda). Har eventet
  ordrar sätts `status = 'cancelled'` istället för en rå delete - aldrig
  tvärtom. `cancelled`-event döljs automatiskt från `list-events` och
  `/kop/:slug` (båda filtrerar redan på `status = 'published'` via RLS
  respektive service-role-frågan), men syns fortsatt i admin-listan
  (gråtonad, märkt "Inställt") och i `export-sales` underlag.

```bash
supabase functions deploy admin-update-event
supabase functions deploy admin-delete-event
```
(Ingen `--no-verify-jwt` sedan Tilläggsordern 2026-08-05 - se avsnitt 5.)

---

## 11. ScenPass-designmockupen (landningssida, /evenemang, riktig QR, admin-wizard, dashboard)

Produktnamnet är "Rideau" (se `src/lib/constants.ts`, `APP_NAME`) - döpt om
från det ursprungliga arbetsnamnet "ScenPass" i Tilläggsordern 2026-08-07,
"Omdöpning: ScenPass -> Rideau". Rubriken på det här avsnittet behåller det
gamla namnet eftersom den beskriver ordern som ursprungligen gav mockupen
det namnet, inte den nuvarande produkten.

Nya routes (vid tillfället för denna order): `/` (statisk landningssida),
`/evenemang` (ersätter gamla `/` - listar publicerade event),
`/admin/dashboard` (sålt/kapacitet per event, byggt enbart från redan
hämtad `admin-events`-data, ingen ny backend-aggregering).

**Uppdatering (Tilläggsordern 2026-08-07, "Omdöpning: ScenPass -> Rideau"):**
den statiska landningssidan på `/` togs bort igen - Squarespace har numera
en egen sida som länkar direkt till `/evenemang`. `/` (och alla okända
sökvägar) redirectar dit istället, se `src/App.tsx`.

**`order-status` är ändrad** - returnerar nu `tickets: { ticket_code,
qr_url }[]` när `status = 'paid'`, byggt från den befintliga publika
Storage-bucketen `qr` (samma bilder som redan mailas ut, inget nytt
lagras). Bekräftelsesidan visar dessa i ett biljett-kort per köpt
biljett istället för ett fejk-QR-mönster. **Denna redeploy gjordes INTE
av mig i den här körningen** (miljön hade varken Supabase CLI-inloggning
eller webbläsarautomation tillgänglig) - kör:

```bash
supabase functions deploy order-status --no-verify-jwt
```

innan bekräftelsesidan visar riktiga QR-koder i produktion.

Admin: "Skapa nytt event" öppnar en 3-stegswizard
(`src/pages/admin/CreateEventWizard.tsx`) som anropar det befintliga
`admin-create-event` - inget nytt på backend-sidan, ingen redeploy krävs
för wizarden. Redigering av befintliga event använder fortsatt det
tidigare enstegsformuläret, och tvåkolumnslayouten i admin är oförändrad.

---

## 12. Flera arrangörer: riktiga inloggningar och dataisolering

Tilläggsordern 2026-08-05 ("Flera arrangörer: riktiga inloggningar och
dataisolering") ersätter den delade admin-PIN-koden med riktig Supabase
Auth, en per arrangör (`organizers`) och kopplade användare
(`organizer_members`). Varje event/biljettyp/rabattkod hör till exakt en
arrangör, och en inloggad användare ser och kan bara redigera sin EGEN
arrangörs data - både i varje admin-Edge-funktion (server-side kontroll,
se `supabase/functions/_shared/organizerAuth.ts`) och i databasens RLS-
policyer (se migrationen nedan).

1. **Kör migrationen** (samma mönster som avsnitt 2/8/10):
   ```bash
   # via SQL Editor i Supabase Dashboard, eller:
   supabase db push
   ```
   Filen `supabase/migrations/20260108000000_organizers_auth.sql` skapar
   `organizers`/`organizer_members`, lägger till `events.organizer_id`
   (backfyllat till en ny rad "Sollentuna Dans & Scenskola", slug `sds`,
   så att alla befintliga event får en ägare) och
   `discount_codes.organizer_id` (en dokumenterad avvikelse från
   ordertexten - se kommentaren högst upp i migrationsfilen för varför
   transitiv scoping via `event_id` inte räcker för globala koder).

2. **Skapa arrangörsanvändare.** Ingen självregistrering finns i denna
   PoC - varje inloggning skapas manuellt:
   - Supabase Dashboard → Authentication → Users → "Add user" (sätt
     e-post + lösenord, eller skicka en inbjudan).
   - Koppla användaren till en arrangör med en rad i `organizer_members`
     (SQL Editor):
     ```sql
     insert into organizer_members (organizer_id, user_id)
     values (
       (select id from organizers where slug = 'sds'),
       (select id from auth.users where email = 'namn@arrangor.se')
     );
     ```
   - För en ANDRA arrangör (t.ex. för att testa dataisoleringen), skapa
     först arrangören:
     ```sql
     insert into organizers (name, slug, contact_email)
     values ('Testscenen', 'testscenen', 'kontakt@testscenen.se');
     ```
     och koppla en andra testanvändare till den på samma sätt som ovan.

3. **Deploya om samtliga admin-*-funktioner och `export-sales`** - se
   avsnitt 5 ovan för fullständig `verify_jwt`-förklaring. Kom ihåg: dessa
   funktioner ska INTE ha `--no-verify-jwt` (de kräver nu en riktig
   Supabase Auth-JWT, till skillnad från övriga funktioner).

4. **Verifiera dataisoleringen manuellt** (den kritiska testpunkten i
   Tilläggsordern):
   - Logga in som arrangör A (SDS), skapa ett event.
   - Logga ut, logga in som arrangör B (Testscenen).
   - Bekräfta att arrangör B INTE ser arrangör A:s event i admin-listan,
     och att ett direkt `admin-update-event`/`admin-event-tickets`-anrop
     med arrangör A:s `event_id` ger 404 (inte 403 - avslöjar inte att
     raden finns).
   - Skapa en global rabattkod som arrangör A, bekräfta att den INTE går
     att använda vid köp på arrangör B:s event (se
     `validateDiscountCode` i `create-order/index.ts`, som numera kräver
     `discount_codes.organizer_id === events.organizer_id` oavsett
     `event_id`).
   - Bekräfta att den publika evenemangslistan (`/evenemang`) och
     köpsidan (`/kop/:slug`) visar "Arrangör: X" korrekt för respektive
     arrangörs event (`organizers(name)` - publikt läsbar via en egen
     RLS-policy, se migrationen).

## 13. Uppföljning: platform-admin (åtkomst till alla workspaces)

Uppföljning 2026-08-05 till avsnitt 12, efter en fråga om hur
plattformsägaren (Nicklas) kan få åtkomst till ALLA arrangörers
workspaces - inte bara en, som en vanlig `organizer_members`-rad ger.
Löst med en separat `platform_admins`-tabell (`user_id` → `auth.users`),
inte fler `organizer_members`-rader: en platform-admin väljer AKTIVT
vilket workspace hen agerar i just nu, istället för att implicit "se
allt" - samma "ett tydligt organizer_id per åtgärd"-princip som resten av
dataisoleringen bygger på, se `_shared/organizerAuth.ts`.

1. **Kör migrationen**
   `supabase/migrations/20260805000000_platform_admins.sql` (samma
   mönster som ovan).

2. **Gör en användare till platform-admin:**
   ```sql
   insert into platform_admins (user_id)
   values ((select id from auth.users where email = 'namn@exempel.se'));
   ```
   Användaren behöver INTE finnas i `organizer_members` - platform-admin-
   status ger tillgång oavsett.

3. **Deploya om** samtliga `admin-*`-funktioner + `export-sales` (nya
   `_shared/organizerAuth.ts`), samt den nya funktionen
   `admin-list-organizers` (platform-admin-only, listar alla arrangörer
   för workspace-växlaren).

4. **Logga in som vanligt** (samma e-post/lösenord-formulär som avsnitt
   12) - admin-sidan känner själv av platform-admin-status
   (`admin-list-organizers` svarar 200 istället för 403) och visar då en
   arrangörsväljare i headern. Vanliga arrangörsanvändare ser ingen
   skillnad alls.

**Säkerhetsdetalj:** `X-Organizer-Id`-headern som skickas när en
platform-admin bytt workspace (se `organizerContext.ts`/`functionsApi.ts`
på frontend) litas ALDRIG på blint - `resolveOrganizer()` kontrollerar
`platform_admins`-medlemskap FÖRST, och bara därefter, om det stämmer,
att det angivna `organizer_id`:t faktiskt existerar. En vanlig
arrangörsanvändare som skickar en egen `X-Organizer-Id` får ingen effekt
alls - den grenen nås aldrig för dem, de får sitt `organizer_id` uteslutande
via `organizer_members` precis som innan.

---

## Arkitekturbeslut och medvetna förenklingar

- **Biljettkod:** 128 bitars slumpmässighet (`crypto.getRandomValues`,
  16 bytes) kodad med Crockford base32 (alfabetet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`
  - inga tvetydiga tecken som 0/O, 1/I/L eller U). Koden är alltid
  slumpmässig, aldrig sekventiell eller härledd från order-id. Se
  `supabase/functions/_shared/base32.ts`.

- **QR-generering:** biblioteket [`qrcode`](https://www.npmjs.com/package/qrcode)
  (rent JS, ingen native canvas-dependency för PNG-läget) importeras via
  Denos `npm:`-specifier direkt i `create-order`. QR-koden innehåller
  ENDAST den råa biljettkoden som klartext - ingen URL, ingen JSON, ingen
  signatur. Scannern slår upp koden mot databasen server-side.

- **E-post och Gmail:** QR-bilden bäddas in som `<img src="https://...">`
  som pekar mot en riktig Storage-URL, INTE som en data-URI - Gmail och
  flera andra e-postklienter blockerar/visar inte data-URI-bilder i mail.
  Koden skrivs alltid ut i klartext under bilden också, som fallback om
  bilden av någon anledning inte laddas.

- **Atomisk kapacitetsreservation:** implementerad som en `SECURITY
  DEFINER`-databasfunktion (`reserve_event_capacity`, se
  `supabase/migrations/20260101000200_capacity_functions.sql`) som körs via
  `supabase.rpc(...)` från `create-order`. Detta är exakt samma
  atomicitetsgaranti som den enkla `UPDATE ... WHERE sold_count + qty <=
  capacity RETURNING sold_count`-satsen i grundspecen, bara paketerad så
  att den kan anropas via Supabase-klientbiblioteket. Noll rader tillbaka
  → HTTP 409 "slutsålt".

- **Admin-autentisering (ersatt 2026-08-05):** admin-inloggning skedde
  tidigare med en delad PIN-kod (`admin-auth`, HMAC-signerad
  sessionstoken). Sedan Tilläggsordern "Flera arrangörer: riktiga
  inloggningar och dataisolering" är detta ersatt med riktig Supabase
  Auth (e-post + lösenord per arrangörsanvändare, `admin-auth` borttagen).
  Varje arrangör (`organizers`) har en eller flera kopplade användare
  (`organizer_members`, `user_id` → `auth.users`). Admin-Edge-funktionerna
  härleder `organizer_id` uteslutande server-side från JWT:n via
  `supabase/functions/_shared/organizerAuth.ts` - ett `organizer_id` som
  eventuellt skickas från klienten litas ALDRIG på. Dataisolering
  garanteras dubbelt: dels av explicita ägarskapskontroller i varje
  admin-funktion (404 om ett event/en biljettyp/en rabattkod tillhör en
  annan arrangör), dels av RLS-policyer på `events`/`ticket_types`/
  `discount_codes`/`organizers` (se
  `supabase/migrations/20260108000000_organizers_auth.sql`). Nya
  arrangörsanvändare skapas manuellt i Supabase Dashboard → Authentication
  (eller via `supabase.auth.admin.createUser` från en betrodd miljö) och
  kopplas till en arrangör med en rad i `organizer_members` - det finns
  ingen självregistrering i denna PoC.

- **Extra admin-funktioner utöver spec-listan:** utöver de fyra uttryckligen
  namngivna funktionerna i grundspecen (`create-order`, `scan-ticket`,
  `list-events` och den numera borttagna `admin-auth`) tillkommer
  `admin-create-event`, `admin-update-event`, `admin-delete-event`,
  `admin-events`, `admin-event-tickets`, `admin-ticket-types`,
  `admin-discount-codes`, `admin-upload-poster` och `export-sales`.
  Anledningen: RLS nekar all åtkomst till `orders`/`tickets` för
  anon-nyckeln (per spec), och `events`-policyn visar bara publicerade
  events för icke-ägare - admin-panelen (skapa event, se utkast, se
  biljettlistor) MÅSTE därför gå via egna Edge Functions, precis som
  `create-order`/`scan-ticket` gör. Samtliga kräver en giltig, inloggad
  arrangörsanvändares Supabase Auth-JWT i `Authorization`-headern.

- **Deploy-mål frontend:** GitHub Pages, samma repo som koden. Bygget körs
  av `.github/workflows/deploy.yml` vid varje push till `main`. Kräver
  `base: '/sds-ticketing-poc/'` i `vite.config.ts` (Pages utan egen domän
  serverar inte från roten) och `HashRouter` istället för `BrowserRouter`
  (Pages har ingen serverkonfiguration som kan skicka godtyckliga
  sökvägar till `index.html` - en direktnavigering till `/admin` skulle
  annars ge 404 från GitHub). Planen är att, om detta fungerar väl, länka
  in sidan från CORE som en iframe-embed på en admin-flik - ett separat,
  senare beslut som inte påverkar något i denna PoC.

- **`void`-status på biljetter:** finns i schemat (för framtida
  annullering/manuell administration) men sätts aldrig av något flöde i
  denna PoC. `scan-ticket` behandlar en `void`-biljett som `invalid` om den
  någon gång skulle förekomma.

- **Konstanttidsjämförelse av hemligheter:** `SCANNER_BEARER_TOKEN` (i
  `scan-ticket`/`list-events`) jämförs med `timingSafeEqual` i
  `supabase/functions/_shared/adminToken.ts` istället för `===`, för att
  inte läcka information om var första avvikande tecken finns via
  svarstiden. Admin-inloggning använder numera Supabase Auth (se ovan)
  istället för en egen jämförd hemlighet, så den tidigare PIN-jämförelsen
  gäller inte längre.

- **Ett enda datumformat i hela API:et:** samtliga timestamps som lämnar en
  Edge Function går genom `toIso8601Seconds()` i
  `supabase/functions/_shared/time.ts` och blir alltid
  `2026-05-10T17:58:03Z` - UTC, inga fraktionella sekunder, inget
  offset-format. Detta gäller inte bara `scan-ticket`/`list-events` (som
  iOS-appen pratar med) utan även admin-funktionerna, så att det aldrig
  finns två format att hålla reda på i samma kodbas.

- **`checked_in_count` i `list-events`:** beräknas server-side med en
  samlad fråga mot `tickets` (grupperad i kod på `event_id`), inte en fråga
  per event. Detta är obligatoriskt i svaret eftersom skannervyn i appen
  ska visa antal INCHECKADE, inte antal sålda - med två entréer igång kan
  ingen enskild enhet räkna det lokalt, den ser bara sina egna scanningar.

- **`verify_jwt = false` på samtliga funktioner:** se avsnitt 5 ovan för
  fullständig motivering - ingen av funktionerna använder en riktig
  Supabase-utfärdad JWT, så gatewayens standardkrav måste stängas av för
  alla, inte bara de som pratar med iOS-appen. `stripe-webhook` är ett
  specialfall: Stripe skickar varken en Supabase-JWT eller ett
  `Authorization: Bearer`-värde alls (Stripe stöder inte egna headers på
  webhook-endpoints) - `stripe-signature`-verifieringen är där den enda
  auktoriseringen.

- **Biljetter skapas ENDAST av `stripe-webhook`, aldrig av `create-order`:**
  `create-order` reserverar kapacitet och skapar en `pending`-order + en
  Stripe Checkout Session, men rör aldrig `tickets`-tabellen. Detta är en
  medveten säkerhetsgräns - ingen kan få en biljett utan att Stripe
  faktiskt bekräftat en betalning via webhooken, oavsett vad en klient
  skickar till API:et.

- **Idempotens på Stripe-webhooken:** `webhook_events` (unik på
  `(provider, provider_event_id)`) skrivs INNAN någon databasändring görs.
  Misslyckas den INSERT:en med `23505` (unique violation) är eventet redan
  hanterat och funktionen svarar `200` direkt utan att upprepa arbetet -
  annars skulle en Stripe-retry (t.ex. efter ett tillfälligt nätverksfel på
  vår sida) kunna skapa dubbla biljetter eller skicka mailet två gånger.

- **Mailutskick i bakgrunden:** `stripe-webhook` köar bekräftelsemailet via
  `EdgeRuntime.waitUntil()` istället för att invänta Resend-anropet innan
  den svarar Stripe. Stripe förväntar sig ett snabbt `200` på webhooken -
  ett långsamt eller misslyckat mailanrop ska inte riskera att Stripe
  räknar leveransen som misslyckad och kör en retry av hela
  betalningshanteringen.

- **`order-status` istället för en bred RLS-policy:** bekräftelsesidans
  polling går via en liten, admin-oberoende Edge Function som ENDAST
  returnerar `status`/`ticket_count` - inte en `create policy ... on orders
  for select to anon using (true)`-policy, som skulle exponera hela
  order-raden (inklusive `buyer_email`/`buyer_name`) till anon-nyckeln så
  fort någon annan del av frontend gjorde en bredare `select` någon gång.
  Samma säkerhetsmönster som `scan-ticket`/`admin-event-tickets` redan
  använder i resten av repot.

- **Pris/moms-ögonblicksbild på ordern:** se avsnitt 8 - `orders.price_ore`/
  `orders.vat_rate` kopieras från eventet vid köptillfället och ändras
  aldrig efteråt. Utan detta skulle en ändring av ett events momssats i
  efterhand retroaktivt kunna ändra redovisningen för redan betalda,
  bokförda ordrar.

## Definition of done - manuell testkedja

När ni har satt upp projektet enligt ovan, verifiera hela kedjan så här:

1. Skapa ett event i `/admin` (kapacitet t.ex. 5).
2. Köp 2 biljetter via `/kop/:slug`.
3. Kontrollera att mailet kom fram med QR-bild + klartextkod.
4. Scanna båda koderna via `scan-ticket` → båda ska ge `"result": "ok"`.
5. Scanna en av koderna igen → `"result": "duplicate"` med den URSPRUNGLIGA
   incheckningstiden.
6. Scanna en påhittad kod → `"result": "invalid"`.
7. Försök köpa 4 till på samma event (kapacitet 5, 2 redan sålda) →
   `create-order` ska returnera HTTP 409 "slutsålt" för de sista biljetterna
   som skulle spränga kapaciteten.
8. Öppna eventet i `/admin` → biljettlistan ska visa båda som "Incheckad"
   med respektive incheckningstid.

### Stripe-flödet (Test mode, testkort `4242 4242 4242 4242`)

9. Köp → redirect till Stripe Checkout med rätt belopp och eventtitel.
10. Betala med testkortet → redirect till bekräftelsesidan, som visar "på
    väg" och växlar till bekräftat inom några sekunder utan omladdning.
11. Mail med QR kommer fram, precis som i det icke-Stripe-flödet.
    `orders.status` går `pending` → `paid`, `tickets` skapas först nu.
12. Avbryt en Checkout-session utan att betala, vänta ut `expires_at` (30
    min) eller trigga `checkout.session.expired` manuellt i Stripe
    Dashboard → `sold_count` återgår, ordern blir `expired`.
13. `stripe trigger checkout.session.completed` två gånger i rad med samma
    event-id (`stripe events resend <id>`) → andra anropet ska INTE skapa
    dubbla biljetter (idempotensspärren i `webhook_events`).
14. Webhook-loggen i Stripe Dashboard visar `200` på samtliga leveranser.
15. Skapa två event med olika momssats (t.ex. 6 % och 25 %), köp en biljett
    till vardera → CSV-exporten visar rätt `moms_ore`/`netto_ore` för båda,
    oberoende av varandra.
16. Ändra momssatsen på ett event EFTER att en betald order redan finns på
    det, exportera samma order igen → beloppen är oförändrade (bevisar att
    ordrens egen snapshot används, inte eventets nuvarande värde).
17. Kör alla tre exportlägen (dag, period, helt evenemang) mot samma
    testdata → summan för "helt evenemang" ska vara minst lika stor som
    summan av de dagliga exporterna för samma event.
18. SIE-filen öppnas utan fel i ett SIE-läsande verktyg (t.ex. Fortnox
    testimport eller ett fristående SIE-valideringsverktyg) - även om
    kontona i den inte är de riktiga än.
19. `file --mime-encoding forsaljning.se` visar INTE `utf-8` (t.ex.
    `unknown-8bit`) - annars går texten inte via CP437-konverteraren.
20. Filen öppnad i ett textredigeringsprogram med CP437 manuellt valt som
    kodning visar å/ä/ö korrekt i kontonamn och verifikationstext.
21. En export som innehåller minst en betald order (>0 kr) och minst en
    gratis testorder (0 kr) genererar INGEN `#VER`-post för gratisordern -
    beloppen i övriga `#VER`-poster är oförändrade.

### Redigera/radera event

22. Redigera ett event utan sålda biljetter → ändra pris, moms, kapacitet
    → sparas korrekt, verifierat i databasen.
23. Redigera pris/moms på ett event MED en redan betald order → gamla
    ordern behåller sin ursprungliga snapshot (samma test som i avsnitt 8,
    upprepat via UI istället för SQL).
24. Försök sänka kapaciteten under `sold_count` → blockerat i UI innan
    submit (rött fält, disabled spara-knapp), och blockerat i backend om
    UI:t på något sätt kringgås (t.ex. direkt API-anrop).
25. Radera ett event utan sålda biljetter → försvinner helt ur `events`.
26. Radera ett event MED sålda biljetter → blir `cancelled`, inte
    raderat, försvinner från publik `/kop/:slug` och `list-events` men
    syns fortfarande i admin-listan (gråtonad, "Inställt") och i
    export-underlaget.
27. Ett `cancelled` events kapacitet syns inte längre för köp - testa att
    `/kop/<slug>` för ett cancelled-event visar "eventet hittades inte",
    inte köpformuläret.

## iOS-appen

Se [`IOS_HANDOFF.md`](./IOS_HANDOFF.md) för exakt vilka URL:er, endpoints
och tokens den native scanner-appen behöver.
