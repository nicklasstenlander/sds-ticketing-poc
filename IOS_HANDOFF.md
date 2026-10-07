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

{ "ticket_code": "8QK2R7ZXNPB4W0VE1TS93CMHYA", "device": "iPhone - Entré 1", "event_id": "550e8400-e29b-41d4-a716-446655440000" }
```

**`event_id` är VALFRITT** (ordern "Skannern ska veta vilken
föreställning den släpper in till", 2026-10-06, Del A/B) - id:t för den
föreställning som för närvarande är vald i appen (från `list-events`
nedan). Skickas det inte alls fungerar allt exakt som innan detta fält
fanns - helt bakåtkompatibelt, en äldre appversion kräver ingen
serverändring. Skickas det och inte ser ut som ett UUID: servern svarar
`400`. Skickas det och är ett giltigt UUID men skiljer sig från
biljettens EGNA event: biljetten avvisas (`"invalid"`) med ett
förklarande `message`, UTAN att checkas in och UTAN att avslöja om den
redan är incheckad på sitt rätta event (se `message` nedan).

Svar:

```json
{
  "result": "ok",
  "holder_name": "Anna Andersson",
  "event_title": "Vårshow 2026",
  "ticket_type": "Barn 0–3 år",
  "ticket_is_free": true,
  "order_summary": [
    { "name": "Vuxen", "qty": 2 },
    { "name": "Barn 0–3 år", "qty": 1 }
  ],
  "checked_in_at": "2026-05-10T17:58:03Z",
  "message": null
}
```

`result` är alltid en av: `"ok"` (giltig, nu incheckad), `"duplicate"`
(redan incheckad tidigare, på RÄTT föreställning - `checked_in_at` visar
ORIGINALTIDEN, inte scan-tillfället), eller `"invalid"` (okänd/
annullerad kod, inställd föreställning, eller fel föreställning).

**`ticket_type`/`ticket_is_free`/`order_summary` (ordern "Skannern ska
visa vilken typ av biljett som skannas", 2026-10-07, A2) - TRE NYA fält,
alltid med i svaret (`null` när de inte används). Innan denna order var
`ticket_type` alltid `null` ("bara en biljettyp per event, PoC") - det
stämmer inte längre, flera biljettyper per event (Vuxen/Barn/...) har
funnits sedan en tidigare order, och scan-ticket visar nu den verkliga
typen:**

- `ticket_type`: biljettypens namn, t.ex. `"Barn 0–3 år"`, annars `null`
  (en biljett utan typ, t.ex. en gammal testbiljett).
- `ticket_is_free`: `true` om priset för JUST DEN HÄR biljetten var 0 kr
  VID KÖPET, `false` om det inte var det, `null` om `ticket_type` är
  `null` ELLER om köpet gjordes INNAN migrationen
  `20261007000100_order_items_list_price.sql` (se nedan - ingen backfill
  gjordes av befintliga rader, så ett gammalt köp ger `null`, dvs
  "okänt", aldrig felaktigt `false`). **OBS, viktigt att detta görs
  rätt:** detta är INTE `order_items.unit_price_ore` (trots att en
  tidigare version av den här ordern sa så) - rabattkoder tillämpas PER
  RAD i `create-order`, så `unit_price_ore` är redan det RABATTERADE
  priset. En vuxenbiljett med en 100%-kod hade fått `unit_price_ore = 0`,
  omöjligt att skilja från en genuint gratis barnbiljett. Servern
  använder istället `order_items.list_price_ore` (radens pris FÖRE
  rabattkoden, ny nullable kolumn utan backfill - rent additiv mot
  tabellen, rör inga befintliga rader). **En vuxenbiljett som blev
  gratis via en rabattkod är INTE `ticket_is_free`** - visa den som
  vanlig, inte som gratis.
- `order_summary`: biljetterna i samma köp, högst 6 rader, t.ex.
  `[{"name":"Vuxen","qty":2},{"name":"Barn 0–3 år","qty":1}]`. Inga
  personuppgifter. `null` om fältet inte ska visas (se nedan). **OBS:**
  `order_summary` kan vara satt ÄVEN OM `ticket_type` är `null` (köpets
  sammansättning är oberoende av just den enskilda biljettraden) - anta
  inte att de två alltid är `null`/satta tillsammans. Se
  `docs/scan-response.example.json`, exemplet `unknown_type`, för det
  (ovanliga) fallet då alla tre verkligen är `null` samtidigt.

Fyra kompletta exempelsvar (vanlig biljett, gratisbiljett, rabatterad
vuxenbiljett som INTE är gratis, och okänd typ) finns i
[`docs/scan-response.example.json`](./docs/scan-response.example.json) -
`scripts/check-scan-ticket.ts` validerar att de har exakt rätt nycklar
och typer.

Alla tre fält är `null` tillsammans för de svar där typen INTE visas:
okänd biljettkod, inställd föreställning, och fel föreställning vald i
appen (precis de fall som redan sätter `message`, se nedan - men
`message` och typfälten är två oberoende fält, anta inte att det ena
styr det andra bara för att de råkar sammanfalla idag). Typen visas
DÄREMOT för en redan incheckad biljett (`"duplicate"`) och för en
annullerad biljett (`"invalid"` utan `message`).

Avkoda alla tre som valfria (`decodeIfPresent`) - en äldre appversion som
inte känner till fälten alls påverkas inte. **Dubbelkolla att appens
egna typer inte redan har ett fält som heter `ticket_type`,
`ticket_is_free` eller `order_summary` med en ANNAN betydelse** - annars
kan en befintlig `Codable`-struct råka matcha fel.

**`message` (alltid med i svaret - `null` när det inte
används):** en läsbar textsträng att visa i appen, bara ifylld för två
`"invalid"`-fall:

- Föreställningen är inställd: `"Föreställningen är inställd"`.
- Fel föreställning vald i appen: `"Biljetten gäller <titel>, <datum> kl.
  <HH:MM>"`, t.ex. `"Biljetten gäller Vårshow 2026, 10 maj kl. 19:00"`
  (alltid Europe/Stockholm, oavsett telefonens egen tidszon). Visas
  oavsett om biljetten redan var incheckad eller inte - appen får alltså
  ALDRIG av detta svar veta om en biljett till fel föreställning redan
  använts på sin egen föreställning.

Avkoda `message` som en valfri sträng (`String?`/`decodeIfPresent`) - ett
äldre klientbygge som inte känner till fältet alls påverkas inte, Swifts
`Codable` ignorerar okända JSON-nycklar som standard.

**Viktigt för appens design:** servern är alltid facit. Appen ska aldrig
själv avgöra om en biljett är giltig baserat på lokal cache eller tidigare
scan - varje scan måste gå mot `scan-ticket` och visa exakt det `result` som
kommer tillbaka (grönt för `ok`, gult för `duplicate`, rött för `invalid`).
Finns `message` för ett `"invalid"`-resultat: visa den texten tydligt
tillsammans med den röda avvisningen.

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
