# Miljövariabler och bearer-token för iOS-appen

Detta dokument är avsett att skickas vidare till den som bygger den native
iOS-scanner-appen. Appen pratar ENDAST med de två publika Edge Functions som
listas nedan - den har ingen egen Supabase-inloggning och rör aldrig
databasen direkt.

## Bas-URL

Alla Supabase Edge Functions för ett projekt nås under:

```
https://<project-ref>.supabase.co/functions/v1/<function-namn>
```

Detta är den enda formen som finns i Supabase officiella dokumentation -
bekräfta gärna själv mot [supabase.com/docs/guides/functions](https://supabase.com/docs/guides/functions/quickstart)
om du är osäker. Ersätt `<project-ref>` med referensen för det NYA,
fristående `sds-ticketing-poc`-projektet (samma värde som finns i
`VITE_SUPABASE_URL`, t.ex. om `VITE_SUPABASE_URL=https://abcd1234.supabase.co`
så är bas-URL:en `https://abcd1234.supabase.co/functions/v1`).

**Konkret för detta projekt:** project-ref är `oyqgxnmwojjjpoubdlfa`, så
bas-URL:en är `https://oyqgxnmwojjjpoubdlfa.supabase.co/functions/v1`.

**OBS - `verify_jwt` måste vara avstängt:** dessa funktioner tar emot en
egen statisk bearer-token, INTE en Supabase-utfärdad JWT. Backend-ägaren
måste ha bekräftat med curl (se README.md, avsnittet "Verifiera verify_jwt
med curl") att båda funktionerna faktiskt svarar korrekt INNAN token delas
med dig - annars kan ett 401-svar bero på gatewayens JWT-krav istället för
själva token-värdet, vilket är väldigt förvirrande att felsöka från
app-sidan.

## Ett enda datumformat i hela API:et

Alla timestamps i svaren nedan är ISO 8601, UTC, UTAN fraktionella
sekunder:

```
2026-05-10T17:58:03Z
```

Detta är medvetet - Swifts `.iso8601`-`DateDecodingStrategy` i
`JSONDecoder` parsar INTE millisekunder/mikrosekunder som standard. En
enda `JSONDecoder`-konfiguration (`.iso8601`) räcker alltså för BÅDA
endpoints nedan; ingen custom date-parsing-logik ska behövas.

## Endpoints

### 1. Lista events

```
GET https://<project-ref>.supabase.co/functions/v1/list-events
Authorization: Bearer <SCANNER_BEARER_TOKEN>
```

Svar:

```json
{
  "events": [
    {
      "id": "uuid",
      "title": "Vårshow 2026",
      "venue": "Aulan",
      "date": "2026-05-10T18:00:00Z",
      "capacity": 120,
      "sold_count": 87,
      "checked_in_count": 23
    }
  ]
}
```

**`checked_in_count` är obligatoriskt och alltid med i svaret.** Det är
antalet biljetter till eventet som just nu har status `checked_in` -
alltså antalet incheckade, INTE antalet sålda (`sold_count`).
Skannervyn ska visa `checked_in_count`, inte `sold_count`. Med två
entréer/enheter igång samtidigt kan appen inte räkna detta lokalt - varje
enhet ser bara sina egna scanningar - så det är alltid servern som räknar.

### 2. Scanna biljett

```
POST https://<project-ref>.supabase.co/functions/v1/scan-ticket
Authorization: Bearer <SCANNER_BEARER_TOKEN>
Content-Type: application/json

{ "ticket_code": "8QK2R7ZXNPB4W0VE1TS93CMHYA", "device": "iPhone - Entré 1" }
```

Svar:

```json
{
  "result": "ok",
  "holder_name": "Anna Andersson",
  "event_title": "Vårshow 2026",
  "ticket_type": null,
  "checked_in_at": "2026-05-10T17:58:03Z"
}
```

`result` är alltid en av: `"ok"` (giltig, nu incheckad), `"duplicate"`
(redan incheckad tidigare - `checked_in_at` visar ORIGINALTIDEN, inte
scan-tillfället), eller `"invalid"` (okänd eller annullerad kod).

`ticket_type` är alltid `null` i denna PoC - det finns bara en biljettyp per
event. Fältet finns med i svaret redan nu så appens datamodell inte behöver
ändras den dag fler biljettyper införs.

**Viktigt för appens design:** servern är alltid facit. Appen ska aldrig
själv avgöra om en biljett är giltig baserat på lokal cache eller tidigare
scan - varje scan måste gå mot `scan-ticket` och visa exakt det `result` som
kommer tillbaka (grönt för `ok`, gult för `duplicate`, rött för `invalid`).

## Bearer-token

```
SCANNER_BEARER_TOKEN = <sätts via supabase secrets set>
```

Detta är EN gemensam, statisk hemlig token som backend-ägaren genererar
(t.ex. `openssl rand -hex 32`) och sätter med:

```
supabase secrets set SCANNER_BEARER_TOKEN=<det genererade värdet>
```

Det faktiska värdet delas separat (t.ex. via en lösenordshanterare) - lägg
ALDRIG in det riktiga värdet i kod, README eller versionshantering. Appen
ska bunta med tokenet i sin build-konfiguration (t.ex. som en
build-konfigurationsvariabel per miljö - test/prod), inte hårdkodat i
källkoden.

## Sammanfattning - vad iOS-utvecklaren behöver få av backend-ägaren

- [x] `<project-ref>` = `oyqgxnmwojjjpoubdlfa` (bas-URL:
      `https://oyqgxnmwojjjpoubdlfa.supabase.co/functions/v1`)
- [ ] Det faktiska värdet för `SCANNER_BEARER_TOKEN`
- [ ] Bekräftelse på att `list-events` och `scan-ticket` är deployade MED
      `verify_jwt` avstängt (`supabase functions deploy list-events
      scan-ticket --no-verify-jwt`, plus `verify_jwt = false` i
      `supabase/config.toml`)
- [ ] Bekräftelse på att ovanstående faktiskt VERIFIERATS med curl (se
      README.md) - inte bara att deploy-kommandot kördes utan fel
