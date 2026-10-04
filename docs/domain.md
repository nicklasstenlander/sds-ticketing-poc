# Egen domän: biljetter.sollentunadansochscenskola.se

Frontendens produktionsadress är på väg att bytas från GitHub Pages
standardadress (`https://nicklasstenlander.github.io/sds-ticketing-poc/`)
till en egen subdomän. Detta dokument är den samlade sanningen för hur
det är/ska vara kopplat, så att en framtida session (eller Nicklas om det
gått ett tag) slipper gissa.

**Status när detta skrevs (2026-10-04):** koden är förberedd (`vite.config.ts`
har `base: './'`, `public/CNAME` finns i repot) men **domänen är INTE
driftsatt än** - DNS är inte verifierad, GitHub Pages "Custom domain" är
inte bekräftad, och `FRONTEND_BASE_URL`/Supabase Auth-inställningarna
pekar fortfarande på den gamla github.io-adressen tills vidare steg körs
(se "Att göra" nedan). Uppdatera det här stycket när läget ändras.

## Varför `base: './'`

`vite.config.ts` byggde tidigare med `base: '/sds-ticketing-poc/'`
(rotrelativ, hårdkodat repo-namn) - fungerade bara på
`github.io/sds-ticketing-poc/`, hade gått sönder på en egen domäns rot.
Nu `base: './'` (relativ): samma `dist/`-bygge fungerar oförändrat både
under `/sds-ticketing-poc/` OCH i roten av `biljetter.sollentuna...se/`,
utan att vite.config.ts någonsin behöver ändras igen vid ett domänbyte.
Verifierat genom att servera samma `dist/` på båda sätten lokalt och
bekräfta att `index.html`, alla assets (JS/CSS/ikoner/logotyp) och
`embed.js` svarar 200 i båda fallen (2026-10-04).

**En sak att komma ihåg om du någonsin bygger en ABSOLUT URL i
frontend-koden:** `import.meta.env.BASE_URL` är nu bara strängen `"./"`,
inte en rotrelativ sökväg - `window.location.origin + BASE_URL` ger en
trasig URL. Använd istället `new URL('vägen', window.location.href).href`
(se `src/pages/AdminEmbedPage.tsx`, `embedScriptUrl()`) - webbläsarens
egna URL-upplösning, fungerar oavsett bas. Vanliga `<img src>`/
`<script src>`-attribut behöver INTE denna omväg - webbläsaren löser upp
relativa `src`/`href`-attribut på egen hand.

## 1. DNS (görs av Nicklas hos sin DNS-leverantör)

`biljetter.sollentunadansochscenskola.se` är en SUBDOMÄN (inte apex), så
det ska vara en **CNAME-post**, inte A-poster:

```
Typ:   CNAME
Namn:  biljetter
Värde: nicklasstenlander.github.io.
TTL:   valfri (t.ex. 3600)
```

(Om DNS-leverantören kräver fullt kvalificerat namn i "Namn"-fältet:
`biljetter.sollentunadansochscenskola.se.`)

DNS-propagering kan ta allt från minuter till några timmar. Kontrollera
med t.ex. `dig biljetter.sollentunadansochscenskola.se CNAME`.

## 2. GitHub Pages (Settings → Pages i repot)

`public/CNAME` i repot innehåller redan `biljetter.sollentunadansochscenskola.se`
och kopieras rakt av till `dist/CNAME` vid varje bygge - GitHub Pages
läser av den filen automatiskt vid deploy och fyller i fältet "Custom
domain" i repots Pages-inställningar åt dig. Du behöver bara:

1. Vänta tills DNS (steg 1) har propagerat.
2. Pusha/deploya detta (efter Nicklas godkännande, som vanligt).
3. Öppna repots **Settings → Pages** och bekräfta att "Custom domain"
   visar `biljetter.sollentunadansochscenskola.se` med en grön bock (DNS
   verifierad) - annars visas en felbanner med vad som är fel.
4. Så fort DNS är verifierad erbjuder GitHub ett certifikat automatiskt
   (Let's Encrypt) - kan ta upp till ett dygn första gången. Kryssa i
   **"Enforce HTTPS"** så fort den rutan går att kryssa i.

**Den gamla adressen** (`nicklasstenlander.github.io/sds-ticketing-poc/`)
fortsätter normalt att fungera som projektsidans standardadress även
efter att en egen domän lagts till - inget behöver stängas av, men den
är inte längre den adress som delas ut/länkas till i produktion.

## 3. Supabase Auth (Dashboard → Authentication → URL Configuration)

Supabase Auth har en allow-list för vilka adresser `redirectTo` (används
av `admin-invite-member` och organizer-skapandet i `_shared/
createOrganizer.ts`, båda mot `/#/admin/valkommen`) får peka på. Lägg
till den nya domänen UTAN att ta bort den gamla förrän du bekräftat att
allt fungerar:

- **Site URL:** `https://biljetter.sollentunadansochscenskola.se`
- **Redirect URLs** (lägg till, ta inte bort den gamla direkt):
  `https://biljetter.sollentunadansochscenskola.se/*`

(`*`-wildcarden behövs eftersom HashRouter lägger allt efter domänen i
`#/...`-fragmentet, som Supabase ändå aldrig ser server-side - men
Supabase URL-matchning kräver ändå ett exakt eller wildcard-mönster på
sökvägsdelen.)

## 4. `FRONTEND_BASE_URL` (Supabase secret - körs av Nicklas, INTE av Claude)

Används av `create-order`, `admin-invite-member`, `admin-connect-stripe`,
`public-apply-organizer` och `_shared/createOrganizer.ts` (alla stripper
redan ett eventuellt avslutande snedstreck själva - värdet funkar med
eller utan). Körs av Nicklas när DNS+Pages+Auth (steg 1-3) är bekräftat
klara:

```bash
supabase secrets set FRONTEND_BASE_URL=https://biljetter.sollentunadansochscenskola.se --project-ref oyqgxnmwojjjpoubdlfa
```

Detta är INTE en hemlighet i sig (bara webbplatsens publika adress), men
sätts ändå som secret eftersom det bara läses server-side i Edge
Functions - se README.md avsnitt 8.

**Secrets kräver ingen omdeploy** av funktionerna - en ny `secrets set`
slår igenom på nästa anrop direkt.

## Ordning (för att undvika stopp/trasiga länkar under bytet)

1. DNS (steg 1) - kan göras när som helst, ingen påverkan förrän Pages
   faktiskt pekas dit.
2. Pusha koden i detta repo (`base: './'` + `public/CNAME`) - den gamla
   github.io-adressen fortsätter fungera precis som innan under tiden.
3. Bekräfta grön bock + HTTPS i GitHub Pages-inställningarna (steg 2).
4. Lägg till (inte ta bort) den nya domänen i Supabase Auth (steg 3).
5. Öppna `https://biljetter.sollentunadansochscenskola.se/#/evenemang`
   och `/#/admin` manuellt, bekräfta att sidan laddar och att inloggning
   fungerar - INNAN du ändrar `FRONTEND_BASE_URL`.
6. Sätt `FRONTEND_BASE_URL` (steg 4) sist - det är det som faktiskt
   styr vilka länkar Stripe Checkout/inbjudningsmail/
   arrangörsansökningar pekar på.
7. Testa ett riktigt flöde (Stripe Checkout cancel/success-länk, en
   admin-inbjudan) mot den nya domänen innan du uppdaterar några externa
   länkar (Squarespace-knappen, e-postmallar, etc.) till den.

## Återställning (om något går fel)

Ingenting i detta byte är destruktivt eller svårt att backa:

- **DNS:** ta bort CNAME-posten hos DNS-leverantören - den gamla
  github.io-adressen påverkas inte.
- **GitHub Pages:** ta bort värdet i fältet "Custom domain" i repots
  Settings → Pages (eller ta bort `public/CNAME` i en ny commit och
  pusha) - Pages faller tillbaka till standardadressen.
- **Supabase Auth:** ta bort den nya domänen ur Redirect URLs/Site URL,
  låt den gamla github.io-adressen stå kvar.
- **`FRONTEND_BASE_URL`:** sätt tillbaka till
  `https://nicklasstenlander.github.io/sds-ticketing-poc` (ingen
  omdeploy behövs, se ovan).
- **Koden** (`base: './'`, `public/CNAME`) behöver INTE rullas tillbaka
  även om domänbytet pausas eller avbryts helt - `base: './'` fungerar
  lika bra kvar på github.io/sds-ticketing-poc/ som innan (det är hela
  poängen med den relativa basen), så detta kan ligga kvar committat och
  deployat oavsett vad som händer med själva domänen.
