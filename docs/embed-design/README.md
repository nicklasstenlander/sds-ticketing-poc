# Designreferens: Rideau embed-widget (2026-10-03)

Tio artboards från designcanvasen "Rideau, embed-widget: layoutförslag".
Filerna är vanlig HTML med inline-CSS och är **referens för mått, färger,
struktur och texter**, inte kod att kopiera rakt av.

Ignorera Design-canvasens egna delar: `<x-dc>`, `<helmet>`, skriptblocket
`DCLogic` och `support.js`. Allt innehåll i dem är exempeltext (titlar,
datum, priser, platser) och ska inte hårdkodas.

| Fil | Layout-id i koden | Motsvarar |
|---|---|---|
| `Horisontell.dc.html` | `horizontal` | A. Ett evenemang, stående affisch till vänster |
| `Staende.dc.html` | `portrait` | B. Stående kort |
| `Liggande.dc.html` | `landscape` | C. Liggande, bred affisch |
| `Knapp.dc.html` | `button` | D. Bara en knapp |
| `Speltider.dc.html` | `showtimes` | E. En föreställning, flera tillfällen |
| `Rutnat.dc.html` | `grid` | F. Rutnät, flera evenemang |
| `Agenda.dc.html` | `agenda` | G. Rader, flera evenemang |
| `Banner.dc.html` | `banner` | H. Banner med nedräkning |
| `Tillstand.dc.html` | (alla kortlayouter) | Före släpp, öppet, slutsålt |
| `Generator.dc.html` | (admin) | Embed-generatorn i admin |

## Färger och mått

Midnatt `#243B53`, Rampljus `#F6B93B`, Skymning `#5A3E9B`, Dimma `#EAEEF2`,
Salong `#FAFAF8`, Bläck `#171717`, dämpad text `#5A5A5A`, kant `#E5E5E1`.
Kort: radie 16, skugga `0 1px 3px rgba(0,0,0,.06)`. Knappar och chips: pill,
radie 999, minst 44 px höga. Text på Rampljus är alltid Bläck.
Typsnitt i mockarna är Manrope; widgeten ska använda systemtypsnitt.
