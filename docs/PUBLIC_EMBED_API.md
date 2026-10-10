# `public-embed` — publikt API-kontrakt

Detta dokument beskriver det stabila kontraktet för `public-embed`, den
publika, tokenfria Edge Function-endpointen som redan driver
Squarespace-widgeten (`embed.js`) och som CORE-appen (iOS, App Store)
nu också läser för att visa Sollentuna Dans & Scenskolas föreställningar
natively.

## Bindande regel

**Fält läggs bara till i detta svar, döps aldrig om och tas aldrig
bort.** CORE-appen ligger i App Store och kan inte uppdateras samma dag
ett svar ändras — en trasig förändring här slår ut appen för alla
användare tills en ny version godkänts av Apple. Lägg hellre till ett
nytt fält än att ändra betydelsen av ett befintligt. Ändringar av det
här dokumentet kräver en egen order.

## Anropet

```
GET https://oyqgxnmwojjjpoubdlfa.supabase.co/functions/v1/public-embed?events=<slug1>,<slug2>,...
GET https://oyqgxnmwojjjpoubdlfa.supabase.co/functions/v1/public-embed?organizer=<arrangör-slug>
```

- Exakt en av `events` (kommaseparerade event-slugs, max 12) eller
  `organizer` (en arrangörs slug — alla dess kommande publicerade event,
  listan uppdateras automatiskt när nya events läggs till) måste anges.
- **Inga headers krävs.** Inte `apikey`, inte `Authorization` — detta är
  en medvetet tokenfri, publik endpoint. En `apikey`-header **får**
  skickas (t.ex. om ett framtida gateway-krav tillkommer) utan att
  svaret ändras — skicka den gärna proaktivt i CORE-appen som en
  framtidssäkring, men den är inte nödvändig idag.
- Svaret har alltid `Cache-Control: no-store`. Lita aldrig på en cachad
  `sales_state` eller `from_price_ore` — hämta om vid behov.
- CORS: `Access-Control-Allow-Origin: *` (relevant för widgeten, inte
  för en native app).

## Svarsform

```json
{
  "events": [ { ... } ],
  "server_time": "2026-10-10T12:00:00.000Z"
}
```

`server_time` är serverns egen klocka vid svarstillfället (ISO 8601,
UTC). Används för klockkorrigerad nedräkning mot `sales_open_at`: räkna
ut skillnaden mellan klientens egen klocka och `server_time` vid hämtningen,
och applicera samma skillnad på varje efterföljande lokal tick — lita
aldrig på att klientens klocka är korrekt (se `computeClockSkewMs` i
`embed.js` för referensimplementationen).

## Fält per event

| Fält | Typ | Null? | Beskrivning |
|---|---|---|---|
| `slug` | string | nej | Eventets identitet. Appen har ingen separat `id` — använd `slug`. |
| `title` | string | nej | |
| `organizer_name` | string | ja | |
| `starts_at` | string (ISO 8601, UTC) | ja i typen, i praktiken alltid satt för ett publicerat event | |
| `venue` | string | ja | |
| `from_price_ore` | int | ja | Lägsta pris **bland betalda biljettyper** (pris > 0), i ören. `null` om eventet saknar betalda typer (inga typer alls, eller bara gratistyper — se `free_ticket_names` för att skilja de två åt). **Räknar aldrig in gratistyper** — se "Rättelse 2026-10-10" nedan. |
| `free_ticket_names` | string[] | nej (tom lista, aldrig `null`) | Namnen på biljettyper med pris 0, i databasordning. Tom lista om inga gratistyper finns. |
| `poster_landscape_url` | string | ja | Absolut, publik URL. Garanterat satt bara när den pekar på projektets eget Storage (`https://oyqgxnmwojjjpoubdlfa.supabase.co/storage/v1/object/public/...`) — en otillåten extern URL ger `null`, aldrig den otillåtna URL:en. Validerat server-sidan (appen behöver inte dubbelkolla). |
| `poster_portrait_url` | string | ja | Samma regler som `poster_landscape_url`. Appen använder landscape och faller tillbaka på portrait om landscape saknas. |
| `purchase_url` | string | nej | Färdig, absolut länk till köpsidan, t.ex. `https://biljetter.sollentunadansochscenskola.se/#/kop/<slug>`. Byggd på servern från `FRONTEND_BASE_URL` — appen ska **aldrig** bygga den här URL:en själv. Öppnas i en webbvy. |
| `sales_open_at` | string (ISO 8601, UTC) | ja | Satt bara när `sales_state="upcoming"` är relevant (nedräkningsmål). |
| `sales_state` | `"upcoming"` \| `"open"` \| `"sold_out"` | nej | Beräknad av servern — appen ska aldrig räkna ut detta själv. Exakt dessa tre värden, inget fjärde. |

**Vilka event som tas med:** bara publicerade event vars föreställning
inte redan ägt rum. Ett inställt event, eller ett vars datum passerat,
**finns inte med i listan alls** — det finns ingen `"closed"`-status.
Tolka "finns inte i listan" som "visas inte", precis som widgeten redan
gör.

**Exponeras aldrig:** personuppgifter, eller försäljningssiffror
(`sold_count`, antal kvar). Bara det beräknade `sales_state`.

## Rättelse 2026-10-10: `from_price_ore` räknade fel

Innan den här ordern räknade `from_price_ore` lägsta pris över **alla**
biljettyper, inklusive gratistyper (pris 0). Ett event som blandade en
gratis barntyp med betalda vuxentyper visade därför "Från 0 kr" på den
publika listan — även när den billigaste riktiga biljetten kostade
betydligt mer. Skarpt exempel (`test-slapp`, före rättelsen):
Ordinarie 295 kr, Billig 3 kr, Barn 0 kr (gratis) → svaret visade
`from_price_ore: 0`.

`from_price_ore` är nu definierad som lägsta pris **bland betalda
typer**, och `free_ticket_names` listar gratistyperna separat. Samma
rättelse och samma nya fält gäller `public-events` (den andra publika
listnings-endpointen, används av Squarespace-snutten "Kommande
evenemang") — de två endpointerna delar prissammanfattningslogik
(`supabase/functions/_shared/ticketPricing.ts`) av samma skäl som de
redan delade `sales_state`-logiken.

## Exempelsvar

Se [`public-embed.example.json`](./public-embed.example.json) — ett
komplett, verkligt svarsformat med fem event: ett riktigt (`test-slapp`,
hämtat från Live) plus fyra syntetiska som tillsammans täcker alla tre
`sales_state`, `venue: null`, båda affischerna `null`,
`from_price_ore: null` (både "inga biljettyper alls" och "alla typer
gratis"), och en tom `free_ticket_names`.

`scripts/check-public-embed-contract.ts` validerar exempelfilen mot
exakt den nyckeluppsättning och de typer som dokumenteras ovan — kör med:

```
deno run --allow-env --allow-read scripts/check-public-embed-contract.ts
```

## Curl-exempel

```bash
curl -s "https://oyqgxnmwojjjpoubdlfa.supabase.co/functions/v1/public-embed?events=test-slapp"
```

Inga headers behövs.
