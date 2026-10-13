// retry-confirmation-emails
//
// Återförsök för bekräftelsemejl som fastnat (ordern "Webhooken är för
// långsam" 2026-10-13, ny plan punkt 2). stripe-webhooks egen
// bakgrundsuppgift (EdgeRuntime.waitUntil, körs EFTER svaret till
// Stripe) skickar mejlet i nästan alla fall direkt - men om
// funktionsinstansen dör mitt i, eller Resend/Stripe svarar långsammare
// än timeout-fönstret (8 s / 5 s), finns annars INGET som försöker
// igen: confirmation_email_sent_at förblir null för alltid, och
// webhook_events-raden är redan 'done' (se finalize_paid_order-
// migrationens kommentar om varför den statusen INTE sätts förrän
// efter mejlschemaläggningen - men "schemalagd" är inte samma som
// "lyckades").
//
// MEKANISM (föreslagen och visad innan den byggdes - se chatten):
// schemalagt GitHub Actions-jobb (.github/workflows/retry-
// confirmation-emails.yml), SAMMA CRON_SECRET-mönster som release-
// expired-orders. pg_cron (den mekanism som används för release_
// expired_orders) passade INTE här: den funktionen är ren SQL och
// behöver aldrig lämna databasen, men att skicka mejl KRÄVER HTTP-
// anrop till Resend/Stripe, vilket bara en edge function kan göra -
// att låta pg_cron själv göra det hade krävt pg_net (medvetet undvikt
// tidigare i det här repot, se 20261012040000-migrationens kommentar).
//
// OBSERVERAT (gh run list, se release-expired-orders.yml:s kommentar):
// GitHub Actions' "on: schedule" är best effort och kan i praktiken
// dra 2,5-9 timmar mellan körningar, inte det deklarerade intervallet.
// Acceptabelt HÄR (till skillnad från release_expired_orders, som fick
// en pg_cron-lösning just för att undvika den fördröjningen) eftersom
// detta är ett RESERVNÄT för en kanal (webhookens egen bakgrunds-
// uppgift) som redan lyckas i nästan alla fall - admin-list-stuck-
// emails ger synlighet för en admin oavsett hur sällan jobbet faktiskt
// hinner köra.
//
// Villkor: status='paid', confirmation_email_sent_at is null, paid_at
// äldre än OLDER_THAN_MINUTES (3 - ger webhookens EGEN bakgrundsuppgift
// gott om tid att lyckas själv innan denna sveper in),
// confirmation_email_attempts < MAX_ATTEMPTS (5) - utan den gränsen
// skulle en order med en permanent trasig e-postadress försökas om i
// all evighet. Gränsen gäller BARA den här automatiska vägen - en
// admin som medvetet klickar "skicka om" (admin-resend-tickets,
// force=true) blockeras aldrig av den.
//
// QR laddades redan upp SYNKRONT i förgrunden av stripe-webhook innan
// ordern kunde bli 'paid' - ingen regenerering behövs här (till
// skillnad från admin-resend-tickets, som är ett bredare "något kan
// vara trasigt"-verktyg för GODTYCKLIGA betalda ordrar, även gamla).
//
// Autentiseras med en statisk bearer-token (CRON_SECRET), samma
// mönster som release-expired-orders.
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { bearerTokenFrom, timingSafeEqual } from '../_shared/adminToken.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { attemptConfirmationEmail } from '../_shared/attemptConfirmationEmail.ts'

const OLDER_THAN_MINUTES = 3
const MAX_ATTEMPTS = 5
const MAX_PER_RUN = 20 // skydd mot att en enda körning drar iväg för länge om många ordrar fastnat samtidigt

function single<T>(rel: T | T[] | null): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    return jsonResponse({ error: 'CRON_SECRET är inte konfigurerad på servern.' }, 500)
  }
  const token = bearerTokenFrom(req)
  if (!token || !timingSafeEqual(token, cronSecret)) {
    return jsonResponse({ error: 'Ej behörig.' }, 401)
  }

  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - OLDER_THAN_MINUTES * 60 * 1000).toISOString()

  const { data: stuckOrders, error: stuckError } = await supabase
    .from('orders')
    .select(
      'id, buyer_name, buyer_email, total_ore, paid_at, stripe_payment_intent_id, event_id, events!inner(title, venue, starts_at, organizer_id)',
    )
    .eq('status', 'paid')
    .is('confirmation_email_sent_at', null)
    .lt('paid_at', cutoff)
    .lt('confirmation_email_attempts', MAX_ATTEMPTS)
    .order('paid_at', { ascending: true })
    .limit(MAX_PER_RUN)

  if (stuckError) {
    return jsonResponse({ error: `Databasfel: ${stuckError.message}` }, 500)
  }

  let sentCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const order of stuckOrders ?? []) {
    const event = single(order.events)
    if (!event) {
      errorCount += 1
      console.error('retry-confirmation-emails: order saknar event', order.id)
      continue
    }

    const { data: organizerRow } = await supabase
      .from('organizers')
      .select('legal_name, org_number, terms_url')
      .eq('id', event.organizer_id)
      .maybeSingle()

    const { data: orderItems, error: orderItemsError } = await supabase
      .from('order_items')
      .select('qty, unit_price_ore, vat_rate, ticket_type_id, ticket_types(name)')
      .eq('order_id', order.id)
    if (orderItemsError || !orderItems) {
      errorCount += 1
      console.error('retry-confirmation-emails: kunde inte hämta order_items', order.id, orderItemsError?.message)
      continue
    }

    const { data: tickets, error: ticketsError } = await supabase
      .from('tickets')
      .select('id, ticket_code, ticket_type_id')
      .eq('order_id', order.id)
    if (ticketsError || !tickets || tickets.length === 0) {
      errorCount += 1
      console.error('retry-confirmation-emails: hittade inga biljetter', order.id, ticketsError?.message)
      continue
    }

    const ticketTypeNameById = new Map(orderItems.map((item) => [item.ticket_type_id, single(item.ticket_types)?.name ?? null]))
    const ticketsWithQr = tickets.map((ticket) => {
      const path = `${order.id}/${ticket.id}.png`
      const { data: publicUrlData } = supabase.storage.from('qr').getPublicUrl(path)
      return {
        ticket_code: ticket.ticket_code,
        qrUrl: publicUrlData.publicUrl,
        typeName: ticketTypeNameById.get(ticket.ticket_type_id) ?? null,
      }
    })

    const result = await attemptConfirmationEmail({
      supabase,
      orderId: order.id,
      paymentIntentId: order.stripe_payment_intent_id,
      paidAt: order.paid_at,
      buyerName: order.buyer_name,
      buyerEmail: order.buyer_email,
      totalOre: order.total_ore,
      eventTitle: event.title,
      eventVenue: event.venue,
      eventStartsAt: event.starts_at,
      organizerLegalName: organizerRow?.legal_name ?? null,
      organizerOrgNumber: organizerRow?.org_number ?? null,
      organizerTermsUrl: organizerRow?.terms_url ?? null,
      orderItems: orderItems.map((item) => ({
        typeName: single(item.ticket_types)?.name ?? null,
        qty: item.qty,
        unitPriceOre: item.unit_price_ore,
        vatRate: item.vat_rate,
      })),
      ticketsWithQr,
      force: false,
    })

    if (result.sent) {
      sentCount += 1
      console.log('retry-confirmation-emails: skickade', order.id)
    } else if (result.reason === 'already_sent_or_claimed') {
      skippedCount += 1
    } else {
      errorCount += 1
      console.error('retry-confirmation-emails: misslyckades', order.id, result.code)
    }
  }

  return jsonResponse({ checked: (stuckOrders ?? []).length, sent: sentCount, skipped: skippedCount, errors: errorCount })
})
