# Stripe-konfiguration

Stripe-inställningar går inte att exportera som fil — de beskrivs här
istället, sammanställt från koden och README. Fälten märkta **"bekräfta i
Dashboard"** går inte att läsa ur koden och behöver kontrolleras manuellt
innan detta återskapas i ett nytt Stripe-konto (Childproof AB).

> ⚠️ **Plattformskontot är preliminärt.** `STRIPE_SECRET_KEY` pekar just nu
> på Moon Movements ABs Stripe-konto (Test mode). Det måste bytas till
> Childproof ABs eget konto innan Live mode aktiveras för någon arrangör
> — se `supabase/functions/_shared/stripe.ts`.

## Webhook-destinationer

Två separata destinationer krävs, mot samma URL men olika omfattning —
Stripes Workbench-UI låter inte en befintlig destinations "Händelser
från"-omfattning (Ditt konto / Anslutna konton) ändras i efterhand, så de
måste skapas som två från början.

| Namn | Omfattning | URL | Events | Secret |
|---|---|---|---|---|
| "Biljett-checkout" | Ditt konto | `https://<project-ref>.supabase.co/functions/v1/stripe-webhook` | `checkout.session.*` (completed + expired) | `STRIPE_WEBHOOK_SECRET` |
| "Stripe Connect-onboarding" | Anslutna konton — **"Listen to events on Connected accounts" måste vara ikryssad** | Samma URL | `account.updated` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

`stripe-webhook` (`supabase/functions/stripe-webhook/index.ts`) provar
`STRIPE_WEBHOOK_SECRET` först och faller tillbaka på
`STRIPE_CONNECT_WEBHOOK_SECRET` om den första signaturverifieringen
misslyckas, innan den avvisar med 400 — en och samma funktion hanterar
båda destinationerna.

**Glöms "Listen to events on Connected accounts" bort:** `account.updated`
når aldrig fram, och `organizers.stripe_onboarding_complete` fastnar på
`false` även efter en lyckad arrangörs-onboarding.

## Connect

- Kontotyp: **Standard** (inte Express/Custom) — arrangören sköter sin
  egen KYC-onboarding direkt mot Stripe, Stripe bär supportbördan för
  deras konto.
- Flöde: `admin-connect-stripe` skapar kontot + en Account Link →
  arrangören slutför KYC hos Stripe → `account.updated`-webhooken
  (ovan) sätter `stripe_onboarding_complete = true`.
- `create-order` och `admin-update-event` spärrar båda ordrar/publicering
  om arrangören saknar ett slutfört Connect-konto.
- **"Accounts v1 support"** — bekräfta i Dashboard vilket läge det nya
  Stripe-kontot har satt, och varför (gick inte att verifiera i koden för
  denna sammanställning).

## Plattformsavgift

Två lägen, styrs av `PLATFORM_FEE_MODE` (`supabase/functions/_shared/platformFee.ts`):

- **`percent`** (default om secreten saknas) — avgiften är en andel av
  biljettsumman (`PLATFORM_FEE_RATE`, t.ex. `0.02` = 2 %), bakas in i
  priset, syns inte som egen rad.
- **`flat_per_ticket`** — fast belopp per biljett i öre
  (`PLATFORM_FEE_FLAT_ORE`), oberoende av pris/rabattkoder, syns som egen
  rad ("Serviceavgift") på köpsidan och i Checkout.
- Momssats på avgiften är hårdkodad till 25 % (`PLATFORM_FEE_VAT_RATE`),
  inte konfigurerbar via secret.
- Avgiften dras automatiskt som Stripe Connects `application_fee_amount`
  — ingen manuell utbetalning.
- Gäller plattformsövergripande, aldrig per arrangör och aldrig blandat.

**Explicit utanför scope (gäller vid den här sammanställningen):**
differentierad avgiftsnivå per arrangör, automatisk fakturering av
avgiften utöver `application_fee`, och refunds över Connect-gränsen
(`reverse_transfer`) — hanteras manuellt i arrangörens eget
Stripe-dashboard.

## Betalmetoder

**Bekräfta i Dashboard** vilka betalmetoder som är aktiverade för
Checkout — inget i koden låser detta till ett specifikt urval.

## Secrets som hör ihop med detta dokument

Se `docs/secrets.md` för namnen (`STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`,
`PLATFORM_FEE_RATE`/`PLATFORM_FEE_MODE`/`PLATFORM_FEE_FLAT_ORE`). Inga
värden här.
