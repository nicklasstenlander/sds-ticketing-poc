// Köpvillkor - Sollentuna Dans & Scenskola / Moon Movements AB (ordern
// "Köpvillkor som egen sida i Rideau" 2026-10-07).
//
// BODY är kopierad ORDAGRANT från ordertextens Bilaga A - ändra inte
// texten här utan en ny order. Nicklas fyller i platshållarna
// ([hakparenteser]), får texten granskad (punkter märkta [granska]), och
// sätter DRAFT=false själv när den är klar - se scripts/check-terms.mjs
// (körs i `npm run build`), som stoppar en build om DRAFT=false men
// hakparenteser/"UTKAST"/"[granska]" fortfarande finns kvar i texten.
export const DRAFT = true
export const VERSION = 4
export const LAST_UPDATED = '[datum]'
export const TITLE = 'Köpvillkor för biljetter'

export const BODY = `
# Köpvillkor för biljetter

*Senast uppdaterad: [datum]*

## 1. Vem säljer biljetterna

Biljetterna säljs av **Moon Movements AB**, organisationsnummer 559317-1936, som driver Sollentuna Dans & Scenskola.

- Adress: [gatuadress, postnummer, ort]
- E-post: info@sollentunadansochscenskola.se
- Momsregistreringsnummer: [fylls i]

Köpet görs i biljettsystemet Rideau. Dessa villkor gäller biljetter till våra föreställningar och evenemang. De gäller inte kurser eller andra anmälningar, som har egna villkor.

## 2. Pris och betalning

Priset som visas innan du betalar är det du betalar. Det inkluderar moms, och hur mycket moms som ingår framgår av kvittot i bekräftelsemejlet. Inga extra avgifter tillkommer.

Du betalar via betaltjänsten Stripe, med de betalsätt som visas när du betalar. Vi ser aldrig dina kortuppgifter.

Köpet är genomfört när betalningen har gått igenom. Du får då ett bekräftelsemejl, och biljetterna visas också på sidan du kommer till efter betalningen.

## 3. Dina biljetter

Biljetterna skickas till e-postadressen du anger, direkt efter betalningen. Mejlet innehåller en QR-kod för varje biljett och en PDF som du kan skriva ut. Biljetterna visas också på sidan du kommer till efter betalningen.

- Kontrollera att du har skrivit rätt e-postadress. Kommer inget mejl inom några minuter: titta i skräpposten, och kontakta oss annars.
- Visa QR-koden på mobilen eller skriv ut sidan. Varje QR-kod fungerar **en gång**. Om en biljett kopieras eller delas släpps bara den som visar upp koden först in.
- Förlorar du en biljett kan du kontakta oss, så hjälper vi dig.

**Gratisbiljetter.** Barn 0–3 år går in utan kostnad, men har ändå en egen plats och en egen biljett. En gratisbiljett bokas tillsammans med minst en betald biljett, högst två gratisbiljetter per betald biljett. Vid entrén kan vi kontrollera att personen stämmer med biljettens typ.

## 4. Ingen ångerrätt

Biljetter till föreställningar som äger rum en bestämd dag omfattas inte av ångerrätt (2 kap. 11 § distansavtalslagen). Ett genomfört köp kan därför inte ångras. **[granska]**

Biljetter byts eller avbokas inte, om vi inte uttryckligen meddelar något annat. Har du fått förhinder är du välkommen att kontakta oss. Vi försöker hjälpa till, men det finns ingen skyldighet. **[granska]**

## 5. Inställd eller flyttad föreställning

- **Ställs föreställningen in** återbetalar vi det du har betalat för biljetterna, till det betalningssätt du använde. Vi meddelar dig via e-post.
- **Flyttas föreställningen** gäller din biljett det nya datumet. Kan du inte komma på det nya datumet har du rätt till återbetalning om du hör av dig inom [14] dagar efter att vi har meddelat det nya datumet. **[granska]**
- Mindre ändringar i program, medverkande eller tider ger inte rätt till återbetalning. **[granska]**

## 6. På plats

Vi förbehåller oss rätten att neka tillträde eller avvisa den som stör föreställningen eller andra besökare. Det ger inte rätt till återbetalning. **[granska]**

## 7. Personuppgifter

**Personuppgiftsansvarig** är Moon Movements AB (kontaktuppgifter i punkt 1).

- **Vad vi behandlar:** ditt namn, din e-postadress, vilka biljetter du har köpt och när, uppgifter om betalningen (belopp, betalsätt och transaktions-id) och tidpunkten då biljetten skannades vid entrén. Vi sparar också en kopia av betaltjänstens bekräftelse av betalningen, som innehåller uppgifter du angav vid betalningen, till exempel din e-postadress.
- **Kortuppgifter:** dina kortuppgifter hanteras av Stripe och når oss inte. Till Stripe skickar vi bara din e-postadress, inte ditt namn.
- **Varför:** för att genomföra köpet, skicka biljetter och kvitto, svara på frågor och släppa in dig vid entrén. Vi sparar också bokföringsunderlag så som lagen kräver.
- **Rättslig grund:** avtalet med dig, och rättsliga förpliktelser (bokföringslagen).
- **Hur länge:** orderuppgifter sparas så länge det behövs för köpet och för vår bokföring, normalt sju år. **[granska: systemet har idag ingen automatisk radering, den görs för hand på begäran. Texten ska inte lova mer än så]**
- **Vilka som hjälper oss (personuppgiftsbiträden):** Stripe (betalning), Resend (utskick av e-post) och Supabase (databas, hos en datacentral i Stockholm). Vissa av dem kan behandla uppgifter utanför EU/EES med stöd av EU-kommissionens standardavtalsklausuler. **[granska]**
- **Dina rättigheter:** du kan begära tillgång till, rättelse eller radering av dina uppgifter, och invända mot behandlingen. Radering kan inte ske för uppgifter vi är skyldiga att spara. Dina begäranden hanteras manuellt, så kontakta oss via e-postadressen i punkt 1.
- **Klagomål:** du kan lämna klagomål till Integritetsskyddsmyndigheten (IMY), imy.se.
- **Webbplatsen:** Vi använder inga kakor för spårning eller reklam, och inga verktyg för statistik. Typsnitt hämtas från vår egen server. Våra leverantörer (Supabase och Stripe) kan sätta tekniska kakor som behövs för säkerhet och betalning. **[granska: stämmer först när typsnitten har flyttats från Google och webbläsarens lagring är kontrollerad, se order-code-fore-forsaljning.md]**

Vi säljer inte dina uppgifter och använder dem inte för marknadsföring utan ditt samtycke.

## 8. Klagomål och tvister

Är du missnöjd, kontakta oss först så försöker vi lösa det. Som konsument kan du också vända dig till Allmänna reklamationsnämnden (ARN), arn.se. Svensk lag gäller för köpet.
`
