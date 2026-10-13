// Delad "claim + skicka + markera/spår"-logik för bekräftelsemejlet
// (ordern "Webhooken är för långsam" 2026-10-13, ny plan punkt 2/3).
// EN implementation, tre anropare:
//   - stripe-webhooks bakgrundsuppgift (EdgeRuntime.waitUntil, körs
//     EFTER svaret till Stripe) - force=false.
//   - retry-confirmation-emails (schemalagt återförsök för mejl som
//     fastnat) - force=false.
//   - admin-resend-tickets (manuell, avsiktlig ombegäran) - force=true.
// Ingen av dem bygger om "claim, skicka, markera/spåra"-logiken själv -
// bara QR-uppladdningen (som skiljer sig: webhooken bygger den
// parallellt i förgrunden, admin-resend-tickets regenererar defensivt
// saknade filer, retry-confirmation-emails litar på att den redan
// finns) sker utanför den här funktionen och skickas in som
// ticketsWithQr.
import type { createAdminClient } from './supabaseAdmin.ts'
import { claimConfirmationEmail } from './claimConfirmationEmail.ts'
import { sendConfirmationEmail, fetchPaymentMethodType } from './sendConfirmationEmail.ts'
import { shortEmailErrorCode } from './emailErrorCode.ts'

export interface ConfirmationEmailOrderItem {
  typeName: string | null
  qty: number
  unitPriceOre: number
  vatRate: number
}

export interface ConfirmationEmailTicket {
  ticket_code: string
  qrUrl: string
  typeName: string | null
}

export interface ConfirmationEmailAttemptInput {
  supabase: ReturnType<typeof createAdminClient>
  orderId: string
  paymentIntentId: string | null
  paidAt: string | null
  buyerName: string
  buyerEmail: string
  totalOre: number | null
  eventTitle: string
  eventVenue: string | null
  eventStartsAt: string
  organizerLegalName: string | null
  organizerOrgNumber: string | null
  organizerTermsUrl: string | null
  orderItems: ConfirmationEmailOrderItem[]
  ticketsWithQr: ConfirmationEmailTicket[]
  /** true = admin-resend-tickets (manuell, avsiktlig ombegäran - ska
   * kunna skicka om ÄVEN om mejlet redan skickats). false = den
   * automatiska vägen (webhookens bakgrundsuppgift, det schemalagda
   * återförsöket) - skickar ALDRIG om confirmation_email_sent_at redan
   * är satt. Se claim_confirmation_email-migrationens kommentar. */
  force: boolean
}

export type ConfirmationEmailAttemptResult =
  | { sent: true }
  | { sent: false; reason: 'already_sent_or_claimed' }
  | { sent: false; reason: 'error'; code: string }

export async function attemptConfirmationEmail(input: ConfirmationEmailAttemptInput): Promise<ConfirmationEmailAttemptResult> {
  const claimed = await claimConfirmationEmail(input.supabase, input.orderId, input.force)
  if (!claimed) {
    return { sent: false, reason: 'already_sent_or_claimed' }
  }

  try {
    const paymentMethod = await fetchPaymentMethodType(input.paymentIntentId)
    await sendConfirmationEmail({
      buyerName: input.buyerName,
      buyerEmail: input.buyerEmail,
      eventTitle: input.eventTitle,
      eventVenue: input.eventVenue,
      eventStartsAt: input.eventStartsAt,
      orderId: input.orderId,
      paidAt: input.paidAt ?? new Date().toISOString(),
      tickets: input.ticketsWithQr,
      termsUrl: input.organizerTermsUrl,
      receipt: {
        sellerLegalName: input.organizerLegalName,
        sellerOrgNumber: input.organizerOrgNumber,
        totalOre: input.totalOre ?? 0,
        paymentMethod,
        lines: input.orderItems.map((item) => ({
          name: item.typeName ?? 'Biljett',
          qty: item.qty,
          unitPriceOre: item.unitPriceOre,
          vatRate: item.vatRate,
        })),
      },
    })

    // Granskning 2026-10-13, fråga 2b: Resend har redan bekräftat
    // leverans här - ett fel i DENNA skrivning får ALDRIG göra att vi
    // rapporterar sent:false (mejlet gick trots allt iväg). Ett enkelt
    // omförsök (vanlig transient DB-blipp) innan vi ger upp - "minsta
    // rimliga åtgärd", ingen stor idempotensmekanism mot Resend här.
    let markSentError = (
      await input.supabase
        .from('orders')
        .update({ confirmation_email_sent_at: new Date().toISOString(), confirmation_email_last_error: null })
        .eq('id', input.orderId)
    ).error
    if (markSentError) {
      markSentError = (
        await input.supabase
          .from('orders')
          .update({ confirmation_email_sent_at: new Date().toISOString(), confirmation_email_last_error: null })
          .eq('id', input.orderId)
      ).error
    }
    if (markSentError) {
      // KÄND LUCKA (granskning 2026-10-13, fråga 2b): confirmation_
      // email_sent_at förblir null trots att mejlet faktiskt skickades.
      // Nästa försök (den automatiska vägen, efter att claimed_at åldrats
      // ut - se claim_confirmation_email) ser sent_at=null och skickar
      // OM - ett dubblettmejl är möjligt, inte uteslutet av den här
      // ändringen. Det vi gör här är bara att göra luckan SYNLIG (en
      // egen felkod, grepbar i admin-list-stuck-emails/loggar) istället
      // för tyst - en riktig fix (t.ex. en Resend-idempotensnyckel) är
      // en separat, större åtgärd.
      console.error('Kunde inte markera mejl som skickat (två försök) - dubblettrisk vid nästa omförsök', input.orderId, markSentError.message)
      const { error: traceError } = await input.supabase
        .from('orders')
        .update({ confirmation_email_last_error: 'mark_sent_failed' })
        .eq('id', input.orderId)
      if (traceError) {
        console.error('Kunde inte ens skriva mark_sent_failed-felspåret', input.orderId, traceError.message)
      }
    }
    return { sent: true }
  } catch (err) {
    const code = shortEmailErrorCode(err)
    console.error('Mejlutskick misslyckades', input.orderId, code)
    const { error: traceError } = await input.supabase
      .from('orders')
      .update({ confirmation_email_last_error: code })
      .eq('id', input.orderId)
    if (traceError) {
      console.error('Kunde inte skriva felspår för mejlutskick', input.orderId, traceError.message)
    }
    return { sent: false, reason: 'error', code }
  }
}
