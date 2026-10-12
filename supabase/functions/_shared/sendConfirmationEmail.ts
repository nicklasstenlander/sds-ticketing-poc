// Delad bekräftelsemejl-funktion (ordern "Avbokning, återbetalning,
// omsändning och köparmeddelanden" 2026-10-12, STEG 2.1) - flyttad hit
// från stripe-webhook/index.ts OFÖRÄNDRAD (samma HTML, samma PDF-logik,
// samma Resend-anrop) så att admin-resend-tickets kan återanvända
// EXAKT samma kod, inklusive PDF-bilagan, istället för en egen kopia
// som riskerar glida isär. stripe-webhooks eget beteende (vad som
// skickas, när) är oförändrat - bara VAR koden bor har flyttat.
//
// webhook_events-idempotensspärren (stripe-webhook/index.ts) rörs INTE
// av den här flytten - den ligger kvar i Deno.serve-handlern där den
// alltid låg, helt oberoende av var sendConfirmationEmail själv bor.
import { createStripeClient } from './stripe.ts'
import { buildTicketsPdf, bytesToBase64, MAX_TICKETS_PER_PDF, ticketsPdfFilename } from './ticketPdf.ts'
import type Stripe from 'npm:stripe@17'

/** "Namn <adress@exempel.se>" -> "adress@exempel.se". Redan bara en
 * adress (inget "<...>"): returneras oförändrad. Används för biljett-
 * PDF:ens sidfot (ordern "Biljett-PDF" 2026-10-05, 2.0) - RESEND_FROM/
 * SUPPORT_REPLY_TO_EMAIL kan vara i endera formatet (se README avsnitt
 * 3, exemplet "Biljetter <biljetter@dindomän.se>"), men en PDF-sidfot
 * ska bara visa den rena adressen, inte ett e-postheader-format. */
function extractEmailAddress(value: string): string {
  const match = value.match(/<([^<>]+)>/)
  return (match ? match[1] : value).trim()
}

export interface ReceiptLine {
  name: string
  qty: number
  unitPriceOre: number
  vatRate: number
}

/** Moms beräknas ur bruttobeloppet, samma princip som export-sales
 * (calcAmounts): netto = brutto / (1 + vat/100). */
function calcVatOre(bruttoOre: number, vatRate: number): number {
  if (vatRate === 0) return 0
  const nettoOre = Math.round(bruttoOre / (1 + vatRate / 100))
  return bruttoOre - nettoOre
}

export async function sendConfirmationEmail(params: {
  buyerName: string
  buyerEmail: string
  eventTitle: string
  eventVenue: string | null
  eventStartsAt: string
  orderId: string
  paidAt: string
  tickets: { ticket_code: string; qrUrl: string; typeName: string | null }[]
  // Köpvillkor-länk längst ned i mailet (ordern "Före försäljning"
  // 2026-10-05, 1.3) - bara när arrangören har satt terms_url (samma
  // fält som redan styr köpsidans villkorskryssruta). INTE i PDF:en,
  // vars layout är godkänd och inte ska ändras.
  termsUrl: string | null
  receipt: {
    sellerLegalName: string | null
    sellerOrgNumber: string | null
    totalOre: number
    paymentMethod: string | null
    lines: ReceiptLine[]
  }
}) {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const resendFrom = Deno.env.get('RESEND_FROM') ?? 'biljett@resend.dev'

  if (!resendApiKey) {
    console.warn('RESEND_API_KEY saknas - hoppar över mailutskick (endast för lokal utveckling).')
    return
  }

  const eventDate = new Date(params.eventStartsAt).toLocaleString('sv-SE', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  })

  // Samma mönster som tidigare (icke-Stripe-versionen av create-order):
  // QR-bilderna länkas som riktiga https-URL:er till Storage, inte
  // data-URI:er, eftersom Gmail m.fl. blockerar data-URI-bilder i mail.
  const ticketsHtml = params.tickets
    .map(
      (ticket) => `
        <div style="margin:24px 0;padding:16px;border:1px solid #ddd;border-radius:8px;text-align:center;">
          <img src="${ticket.qrUrl}" alt="QR-kod för biljett" width="220" height="220" style="display:block;margin:0 auto 12px;" />
          <div style="font-family:monospace;font-size:16px;letter-spacing:2px;">${ticket.ticket_code}</div>
        </div>
      `,
    )
    .join('')

  // Kvittodel (ordern 2026-10-01, A5) - under QR-koderna. Saknas
  // sellerLegalName för arrangören (inte satt via SQL ännu): hoppa över
  // HELA kvittodelen, kraschar inte - mailet är fortfarande giltigt utan
  // den, precis som innan denna order.
  const r = params.receipt
  const purchaseDate = new Date(params.paidAt).toLocaleString('sv-SE', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  })
  const vatRates = new Set(r.lines.map((l) => l.vatRate))
  const totalVatOre = r.lines.reduce((sum, l) => sum + calcVatOre(l.unitPriceOre * l.qty, l.vatRate), 0)
  const vatLabel = vatRates.size === 1 ? `moms ${[...vatRates][0]} %` : 'moms'
  // Stripe Link syns som ett eget betalsätt ("link") men är i grunden ett
  // sparat kort - visas som "Kort (Stripe Link)" istället för den råa,
  // engelska Stripe-termen. Allt annat (Apple Pay/Google Pay/Klarna m.fl.
  // - Checkout Session sätter inget payment_method_types, Stripe Dashboard
  // styr vilka som faktiskt erbjuds) blir "Annat betalsätt" istället för
  // att läcka ett oöversatt Stripe-internt namn till köparen.
  const paymentMethodLabel =
    r.paymentMethod === 'card'
      ? 'Kort'
      : r.paymentMethod === 'swish'
        ? 'Swish'
        : r.paymentMethod === 'link'
          ? 'Kort (Stripe Link)'
          : r.paymentMethod
            ? 'Annat betalsätt'
            : r.paymentMethod
  const receiptHtml = r.sellerLegalName
    ? `
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #ddd;font-size:13px;color:#333;">
        <p style="margin:0 0 8px;">
          Säljare: ${r.sellerLegalName}${r.sellerOrgNumber ? ` (org.nr ${r.sellerOrgNumber})` : ''}<br/>
          Ordernummer: ${params.orderId}<br/>
          Köpdatum: ${purchaseDate}${paymentMethodLabel ? `<br/>Betalsätt: ${paymentMethodLabel}` : ''}
        </p>
        <table style="width:100%;border-collapse:collapse;">
          ${r.lines
            .map(
              (l) => `
            <tr>
              <td style="padding:2px 0;">${l.qty} × ${l.name}</td>
              <td style="padding:2px 0;text-align:right;">${((l.unitPriceOre * l.qty) / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr</td>
            </tr>
          `,
            )
            .join('')}
        </table>
        <p style="margin:8px 0 0;font-weight:bold;">
          Totalt: ${(r.totalOre / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr
          <span style="font-weight:normal;color:#666;"> (varav ${vatLabel}: ${(totalVatOre / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr)</span>
        </p>
      </div>
    `
    : ''

  // Biljett-PDF som bilaga (ordern "Biljett-PDF" 2026-10-05). Eget
  // try/catch - en trasig PDF får ALDRIG stoppa mailet (ordern 2.2).
  // Körs sist, strax före Resend-anropet. Vid den ORDINARIE vägen
  // (stripe-webhook) körs sendConfirmationEmail bara EN gång per betald
  // order - idempotensspärren i Deno.serve-handlern (webhook_events
  // unique_violation) stoppar en Stripe-retry av samma event innan
  // handleCheckoutCompleted ens nås (ordern 2.5). admin-resend-tickets
  // (STEG 2.1) anropar denna funktion en gång PER adminklick - PDF:en
  // byggs då om från grunden varje gång, medvetet (ingen sparad kopia
  // att återanvända).
  let pdfAttachment: { filename: string; content: string } | undefined
  if (params.tickets.length > MAX_TICKETS_PER_PDF) {
    console.log(`Biljett-PDF: hoppar över (${params.tickets.length} biljetter > max ${MAX_TICKETS_PER_PDF}).`)
  } else {
    try {
      const pdfStart = performance.now()
      const contactEmail = extractEmailAddress(Deno.env.get('SUPPORT_REPLY_TO_EMAIL') ?? resendFrom)
      const pdfBytes = await buildTicketsPdf({
        eventTitle: params.eventTitle,
        startsAt: params.eventStartsAt,
        venue: params.eventVenue,
        buyerName: params.buyerName,
        orderId: params.orderId,
        seller: { legalName: r.sellerLegalName, orgNumber: r.sellerOrgNumber },
        contactEmail,
        tickets: params.tickets.map((t) => ({ code: t.ticket_code, typeName: t.typeName })),
      })
      const pdfMs = Math.round(performance.now() - pdfStart)
      // Ingen personuppgift i loggraden - bara antal/byte/ms.
      console.log(`Biljett-PDF: byggd på ${pdfMs} ms, ${params.tickets.length} biljetter, ${pdfBytes.length} byte.`)

      const base64 = bytesToBase64(pdfBytes)
      // Spärr (ordern 2.3) - långt under Resends egen 40 MB-gräns (efter
      // kodning), men ingen anledning att komma nära den.
      if (base64.length > 10_000_000) {
        console.log(`Biljett-PDF: hoppar över bilagan, base64 för stor (${base64.length} tecken).`)
      } else {
        pdfAttachment = { filename: ticketsPdfFilename(params.eventTitle), content: base64 }
      }
    } catch (err) {
      // Inga personuppgifter i loggraden (ordern 2.2) - bara feltyp/
      // meddelande, aldrig köparens namn/e-post.
      console.error(
        'Biljett-PDF: kunde inte byggas, skickar mailet utan bilaga.',
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h1 style="font-size:20px;">Din biljett till ${params.eventTitle}</h1>
      <p>Hej ${params.buyerName},</p>
      <p>Tack för ditt köp! Här är din/dina biljett(er) till <strong>${params.eventTitle}</strong>${params.eventVenue ? ` på ${params.eventVenue}` : ''}, ${eventDate}.</p>
      <p>Visa QR-koden vid entrén, eller uppge koden i klartext om bilden inte laddas.</p>
      ${pdfAttachment ? '<p>Biljetterna finns också som en PDF i bilagan, som du kan skriva ut.</p>' : ''}
      ${ticketsHtml}
      <p style="color:#666;font-size:13px;">Ordernummer: ${params.orderId}</p>
      ${receiptHtml}
      ${
        params.termsUrl
          ? `<p style="color:#666;font-size:13px;">Köpvillkor: <a href="${params.termsUrl}">${params.termsUrl}</a></p>`
          : ''
      }
    </div>
  `

  const emailResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFrom,
      to: params.buyerEmail,
      subject: `Din biljett till ${params.eventTitle}`,
      html,
      ...(pdfAttachment ? { attachments: [pdfAttachment] } : {}),
    }),
  })

  if (!emailResponse.ok) {
    const errText = await emailResponse.text()
    console.error('Resend-fel:', errText)
  }
}

/** Hämtar det faktiska betalsättet (kort/Swish) för kvittot (A5) - en
 * Checkout Session med dynamiska betalmetoder avslöjar inte vilken
 * som faktiskt användes, bara vilka som erbjöds, så den riktiga typen
 * måste hämtas från PaymentIntentens senaste charge. Icke-kritiskt för
 * ordern att lyckas - ett fel här loggas bara, kvittot visar då ingen
 * betalsättsrad istället för att krascha hela mailutskicket. Flyttad
 * hit tillsammans med sendConfirmationEmail (STEG 2.1) - används bara
 * av den ORDINARIE vägen (stripe-webhook har redan Session-objektet),
 * admin-resend-tickets har ingen Session att hämta från och skickar
 * därför paymentMethod=null (kvittot visar då ingen betalsättsrad,
 * exakt som för en order utan sellerLegalName). */
export async function fetchPaymentMethodType(session: Stripe.Checkout.Session): Promise<string | null> {
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  if (!paymentIntentId) return null
  try {
    const stripe = createStripeClient()
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
    const charge = pi.latest_charge
    return charge && typeof charge !== 'string' ? (charge.payment_method_details?.type ?? null) : null
  } catch (err) {
    console.error('Kunde inte hämta betalsätt för kvitto', paymentIntentId, err instanceof Error ? err.message : err)
    return null
  }
}
