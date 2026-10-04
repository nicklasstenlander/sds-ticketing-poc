# Bädda in biljettwidgeten (embed.js)

En fristående, beroendefri JavaScript-fil som visar dina publicerade
evenemang direkt på en annan sida - t.ex. en Squarespace-sida - med knappar
som länkar till köpsidan. Byggs lättast via **Admin → Bädda in**
(`/#/admin/embed`), som genererar koden nedan åt dig utifrån dina egna
evenemang. Det här dokumentet beskriver vad koden gör, för den som vill
justera den för hand.

## Snabbstart

```html
<div class="rideau-widget"
  data-layout="grid"
  data-events="vinterforestallningen,julforestallning"
  data-show="poster,date,place,price,countdown"
  data-theme="light"></div>
<script async src="https://din-sida.se/embed.js"></script>
```

Klistra in detta i en **Code Block** på Squarespace (eller motsvarande
"inbäddad HTML"-block på andra sidbyggare). Flera widgetar fungerar fint på
samma sida, och skriptet kan inkluderas flera gånger utan problem.

## Attribut på `.rideau-widget`

| Attribut | Värden | Beskrivning |
|---|---|---|
| `data-layout` | `horizontal` \| `portrait` \| `landscape` \| `button` \| `showtimes` \| `grid` \| `agenda` \| `banner` | Se layouterna nedan. Standard: `grid`. |
| `data-events` | kommaseparerade slugs, t.ex. `evenemang-1,evenemang-2` | Vilka evenemang som ska visas. Max 12. Okända eller ej publicerade slugs ignoreras tyst. |
| `data-organizer` | din arrangörs-slug | Alternativ till `data-events` - visar ALLA dina publicerade kommande evenemang automatiskt, uppdateras själv när du publicerar nya. |
| `data-show` | kommaseparerad delmängd av `poster, date, place, price, organizer, countdown` | Vilka delar som visas per evenemang. Okända värden ignoreras. |
| `data-theme` | `light` \| `dark` | Standard: `light`. |
| `data-accent` | `midnatt` \| `skymning` \| `rampljus` | Knappfärg. Standard: `midnatt`. |
| `data-title` | valfri text | Egen rubrik för `showtimes`-layouten. Används annars det första evenemangets titel. |

De fyra enskilt-event-layouterna (`horizontal`, `portrait`, `landscape`,
`button`) visar alltid bara det FÖRSTA evenemanget i `data-events` (eller
det kronologiskt närmaste om `data-organizer` används).

## Layouter

- **horizontal** - ett evenemang, stående affisch till vänster, info till höger.
- **portrait** - ett evenemang, stående kort (affisch ovanpå).
- **landscape** - ett evenemang, bred liggande affisch ovanpå, info+knapp under.
- **button** - bara en köp-knapp plus en kort textrad (datum/pris) - inget kort, ingen titel.
- **showtimes** - en föreställning, flera speltillfällen som rader under en gemensam rubrik.
- **grid** - rutnät av kort, en kolumn på smala skärmar, upp till tre på breda.
- **agenda** - en rad per evenemang i en gemensam lista.
- **banner** - det närmast kommande evenemanget bland de valda, med nedräkning före släpp.

Alla layouter är responsiva mot **widgetens egen bredd** (fungerar ner till
280px), inte sidans - en widget i ett smalt sidofält ser likadan ut som en
bred i huvudinnehållet.

## Tillstånd per evenemang

- **Öppet köp** - en riktig länk "Köp biljetter" till köpsidan.
- **Släpps snart** (`sales_open_at` i framtiden) - en chip med släppdatum/tid
  (och en nedräkning om `countdown` finns i `data-show`), plus en
  inaktiverad köp-knapp i kortlayouterna. Widgeten hämtar ALLTID det
  verkliga tillståndet från servern vid släppet (med en liten slumpad
  fördröjning och omförsök var 5:e sekund i upp till en minut) - den gissar
  aldrig själv att köp är öppet.
- **Slutsålt** - en inaktiverad knapp märkt "Slutsålt".

## Vad som INTE skickas med

Widgeten visar aldrig antal sålda biljetter, kvarvarande platser eller
andra interna räknare - bara det färdiga köptillståndet. Den sätter inga
cookies, spårar inget och använder ingen `localStorage`. De enda externa
anropen är ett API-anrop för evenemangsdata och eventuella affischbilder.

## Bakåtkompatibilitet

Koden klistras in på sidor som Moon Movements inte kontrollerar efter att
den har limmats in. Därför:

- Ett befintligt attribut byter **aldrig** betydelse i en senare version av
  `embed.js`. Nya attribut eller nya tillåtna värden kan läggas till, men en
  gammal inklistrad kodsnutt ska fortsätta fungera precis som förut, för
  alltid.
- Filen serveras alltid från samma, ohashade sökväg (`/embed.js`) - en ny
  version skrivs över samma fil, ingen länk behöver uppdateras.
- `data-api` är ett internt testattribut (för en lokal mockserver under
  utveckling) och ska aldrig användas i en riktig inbäddning - det kan tas
  bort eller ändra betydelse utan varning.

## Lokal testning

Se `docs/embed-test.html` och `scripts/embed-mock-server.ts` - en lokal
mockserver som serverar testevent i exakt samma form som den riktiga
`public-embed`-funktionen, så alla layouter/tillstånd (inklusive själva
släppögonblicket) går att se utan att röra skarp data.
