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
| Databasmigrationer körda, RLS bekräftat aktiverat på alla fyra tabeller | ✅ Klart |
| Storage-bucket `qr` bekräftat skapad och publik | ✅ Klart |
| `.env` ifylld med riktig `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` | ✅ Klart |
| Secrets satta (`RESEND_API_KEY`, `ADMIN_PIN`, `SCANNER_BEARER_TOKEN`) | ⬜ Återstår - se avsnitt 3 |
| Resend konfigurerat | ⬜ Återstår - se avsnitt 4 |
| Edge Functions deployade med `verify_jwt` av | ⬜ Återstår - se avsnitt 5 |
| curl-verifiering av samtliga sju funktioner | ⬜ Återstår - se avsnitt 5 |
| Frontend deployad | ⬜ Återstår - se avsnitt 7 |

De tre återstående secrets-värdena, Resend-nyckeln och CLI-inloggningen är
sådant bara du kan göra - se respektive avsnitt nedan för exakta kommandon.

## Vad ingår

- `/admin` - PIN-skyddad admin-vy: skapa event, se sålda biljetter per
  event, se biljettstatus och incheckningstid.
- `/kop/:slug` - publik köpsida (namn, e-post, antal 1-6, ingen betalning).
- `/kop/:slug/klar` - bekräftelsesida med ordernummer och biljettkoder i
  klartext (fallback om mailet inte når fram).
- Fyra publika/interna Edge Functions (`create-order`, `scan-ticket`,
  `list-events`, `admin-auth`) samt fyra admin-interna Edge Functions
  (`admin-create-event`, `admin-events`, `admin-event-tickets`) - se
  "Arkitekturbeslut" nedan för varför de sistnämnda behövdes.

## Vad ingår INTE (medvetet)

Betalning, flera biljettyper, PDF-generering, Apple/Google Wallet,
återbetalning/avbokning, offline-stöd, reservationstimeout/pending-orders,
inloggning utöver PIN-koden, SODSS-varumärkesanpassad design.

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

Följande tre hemligheter måste däremot sättas explicit, och används ENDAST
server-side (aldrig i frontendens `VITE_`-variabler):

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
supabase secrets set ADMIN_PIN=1234           # välj en egen PIN-kod
supabase secrets set SCANNER_BEARER_TOKEN=$(openssl rand -hex 32)
```

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

### Varför `verify_jwt` måste vara AV på alla sju funktioner

Supabase Edge Functions kräver som standard en giltig **Supabase-utfärdad**
JWT i `Authorization`-headern. Gatewayen avvisar anropet med 401 **innan**
funktionskoden ens körs. Ingen av våra sju funktioner skickar en sådan JWT:

- `create-order` skickar ingen `Authorization`-header alls (publik).
- `scan-ticket`/`list-events` skickar `SCANNER_BEARER_TOKEN` - en egen
  statisk hemlighet, inte en Supabase-JWT.
- `admin-auth`/`admin-create-event`/`admin-events`/`admin-event-tickets`
  skickar antingen inget (admin-auth) eller vår egen HMAC-signerade
  admin-sessionstoken - inte heller det en Supabase-JWT.

Med standardinställningen skulle alltså **samtliga** funktioner ge 401 på
gatewaynivå, oavsett vad koden i funktionen gör. Detta är löst på två sätt
samtidigt (bälte och hängslen):

1. `supabase/config.toml` sätter `verify_jwt = false` per funktion - detta
   är den metod Supabase CLI:t själv rekommenderar och läses vid varje
   `supabase functions deploy`.
2. Deploykommandona nedan skickar även den explicita flaggan
   `--no-verify-jwt`.

**Känd CLI-svaghet:** det finns rapporterade fall (Supabase CLI, GitHub-
issue #4059) där `verify_jwt`-inställningen ibland inte appliceras korrekt
vid en OMDEPLOY av en redan existerande funktion, även om `config.toml` är
korrekt. Om en funktion börjar ge 401 efter en omdeploy trots korrekt
token: kör om deploy-kommandot för just den funktionen (redeploy brukar
lösa det), och verifiera alltid med curl-stegen nedan innan du litar på
att det fungerar - anta aldrig att en lyckad `deploy`-körning räcker som
bevis.

```bash
supabase functions deploy create-order --no-verify-jwt
supabase functions deploy scan-ticket --no-verify-jwt
supabase functions deploy list-events --no-verify-jwt
supabase functions deploy admin-auth --no-verify-jwt
supabase functions deploy admin-create-event --no-verify-jwt
supabase functions deploy admin-events --no-verify-jwt
supabase functions deploy admin-event-tickets --no-verify-jwt
```

(Eller `supabase functions deploy --no-verify-jwt` utan namn för att
deploya alla på en gång - men deploya då fortfarande om enskilda funktioner
separat om curl-verifieringen nedan avslöjar problem med bara en av dem.)

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
   hemligheterna (`SCANNER_BEARER_TOKEN`, `ADMIN_PIN`, `RESEND_API_KEY`,
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

- **Admin-autentisering:** `admin-auth` jämför PIN-koden mot secreten
  `ADMIN_PIN` server-side och utfärdar en kortlivad (12h), HMAC-signerad
  sessionstoken (signerad med `ADMIN_PIN` som HMAC-nyckel, ingen extra
  secret behövs). PIN-koden jämförs eller lagras aldrig i klient-JS.

- **Extra admin-funktioner utöver spec-listan:** utöver de fyra uttryckligen
  namngivna funktionerna (`create-order`, `scan-ticket`, `list-events`,
  `admin-auth`) tillkommer `admin-create-event`, `admin-events` och
  `admin-event-tickets`. Anledningen: RLS nekar all åtkomst till
  `orders`/`tickets` för anon-nyckeln (per spec), och `events`-policyn
  visar bara publicerade events - admin-panelen (skapa event, se
  utkast, se biljettlistor) MÅSTE därför gå via egna service-role-skyddade
  Edge Functions, precis som `create-order`/`scan-ticket` gör. Alla dessa
  tre kräver en giltig admin-sessionstoken i `Authorization`-headern.

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
  `scan-ticket`/`list-events`) och `ADMIN_PIN` (i `admin-auth`) jämförs med
  `timingSafeEqual` i `supabase/functions/_shared/adminToken.ts` istället
  för `===`, för att inte läcka information om var första avvikande tecken
  finns via svarstiden. Admin-sessionstokens HMAC-signatur jämfördes redan
  konstanttid från början.

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

- **`verify_jwt = false` på samtliga sju funktioner:** se avsnitt 5 ovan
  för fullständig motivering - ingen av funktionerna använder en riktig
  Supabase-utfärdad JWT, så gatewayens standardkrav måste stängas av för
  alla, inte bara de två som pratar med iOS-appen.

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

## iOS-appen

Se [`IOS_HANDOFF.md`](./IOS_HANDOFF.md) för exakt vilka URL:er, endpoints
och tokens den native scanner-appen behöver.
