// Köparmejl vid full återbetalning i Stripe (charge.refunded) - ordern
// "Skicka mejl till köparen vid full återbetalning" 2026-11.
//
// Bakgrund: handleChargeRefunded avbokar ordern via cancel_paid_order,
// men köparen fick inget besked och det gamla biljettmejlet såg giltigt
// ut. Det här mejlet berättar att ordern är avbokad, att pengarna är på
// väg och att biljetterna är ogiltiga. INGA biljetter/QR skickas igen.
//
// Tre delar:
//   - shouldSendRefundEmail / buildRefundEmail: rena, testas i
//     scripts/check-refund-email.ts.
//   - sendRefundEmail: Resend-anropet (samma nyckel, avsändare och
//     tidsgräns som bekräftelsemejlet).
//   - attemptRefundEmail: läser orderdata, avgör villkoren, skickar.
//     KASTAR ALDRIG - ett mejlfel får inte få webhooken att svara fel
//     (Stripe skulle då retry:a hela eventet, och eftersom ordern då
//     redan är avbokad skulle en retry ändå inte skicka något mejl).
import type { createAdminClient } from './supabaseAdmin.ts'
import { captureEdgeException } from './sentry.ts'
import { shortEmailErrorCode } from './emailErrorCode.ts'

export interface RefundEmailDecisionInput {
  /** isFullRefund(charge) */
  fullRefund: boolean
  /** cancelPaidOrder(...).cancelled - sant bara om DEN HÄR händelsen
   * avbokade ordern (redan avbokad order / omlevererat event = false). */
  cancelled: boolean
  totalOre: number | null
  archivedReason: string | null
  buyerEmail: string | null
}

/** Alla fem villkor måste gälla. Delåterbetalning, redan avbokad order,
 * gratisorder, testorder och saknad e-post ger inget mejl. */
export function shouldSendRefundEmail(input: RefundEmailDecisionInput): boolean {
  return (
    input.fullRefund &&
    input.cancelled &&
    (input.totalOre ?? 0) > 0 &&
    input.archivedReason !== 'test' &&
    typeof input.buyerEmail === 'string' &&
    input.buyerEmail.trim() !== ''
  )
}

export interface RefundEmailInput {
  buyerName: string
  eventTitle: string
  eventStartsAt: string
  organizerName: string | null
  /** charge.amount_refunded, i öre. */
  refundedOre: number
  orderId: string
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** "1 080 kr" - hela kronor utan decimaler, annars två decimaler. */
export function formatRefundAmount(ore: number): string {
  const kronor = ore / 100
  const whole = Number.isInteger(kronor)
  const formatted = kronor.toLocaleString('sv-SE', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })
  return `${formatted} kr`
}

/** Samma tidsformat som biljettmejlet (sv-SE, Europe/Stockholm, long +
 * kort tid) men med veckodag ("dag, datum, klockslag"): dateStyle 'full'. */
export function formatRefundEventTime(startsAt: string): string {
  return new Date(startsAt).toLocaleString('sv-SE', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  })
}

export function buildRefundEmail(input: RefundEmailInput): { subject: string; html: string; text: string } {
  const when = formatRefundEventTime(input.eventStartsAt)
  const amount = formatRefundAmount(input.refundedOre)
  const sender = input.organizerName ?? 'Arrangören'
  const subject = `Din order har avbokats och återbetalats – ${input.eventTitle}`

  const paragraphs = [
    `Din order till ${input.eventTitle} ${when} har avbokats och ${amount} har återbetalats till din ursprungliga betalningsmetod. Pengarna syns normalt inom 5–10 bankdagar. Betalade du med Apple Pay kan det visas som en minskning av det ursprungliga köpet i stället för en separat insättning.`,
    'Biljetterna i ordern är nu ogiltiga och kan inte användas vid insläppet.',
    'Hör av dig till oss om du har frågor.',
  ]

  const text = [
    `Hej ${input.buyerName},`,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    'Vänliga hälsningar,',
    sender,
    '',
    `Ordernummer: ${input.orderId}`,
  ].join('\n')

  // Samma enkla layout som bekräftelsemejlet (sendConfirmationEmail).
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h1 style="font-size:20px;">Din order har avbokats och återbetalats</h1>
      <p>Hej ${escapeHtml(input.buyerName)},</p>
      ${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n      ')}
      <p>Vänliga hälsningar,<br/>${escapeHtml(sender)}</p>
      <p style="color:#666;font-size:13px;">Ordernummer: ${escapeHtml(input.orderId)}</p>
    </div>
  `

  return { subject, html, text }
}

/** Skickar mejlet via Resend. Returnerar Resends mejl-id. Kastar vid fel
 * (bara statuskoden i meddelandet - Resends svarstext kan eka
 * e-postadressen). Idempotency-Key skyddar mot dubbelutskick om samma
 * uppgift av någon anledning körs två gånger inom 24 h. */
export async function sendRefundEmail(to: string, input: RefundEmailInput): Promise<string | null> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const resendFrom = Deno.env.get('RESEND_FROM') ?? 'biljett@resend.dev'
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY saknas - hoppar över återbetalningsmejl (endast för lokal utveckling).')
    return null
  }
  const { subject, html, text } = buildRefundEmail(input)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `refund-email/${input.orderId}`,
    },
    body: JSON.stringify({ from: resendFrom, to, subject, html, text }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) {
    console.error('Resend-fel vid återbetalningsmejl (loggas inte till webhook_events):', response.status)
    throw new Error(`Resend svarade ${response.status} - återbetalningsmejlet skickades inte`)
  }
  const body = (await response.json().catch(() => null)) as { id?: string } | null
  return body?.id ?? null
}

export type RefundEmailResult =
  | { sent: true; emailId: string | null }
  | { sent: false; reason: 'conditions_not_met' | 'order_not_found' | 'error' }

/** Läser order + event + arrangör, avgör villkoren och skickar. Fångar
 * ALLA fel (loggar utan personuppgifter, rapporterar till Sentry) - kastar
 * aldrig. Anropas i bakgrunden (EdgeRuntime.waitUntil) EFTER att
 * cancelPaidOrder lyckats. */
export async function attemptRefundEmail(params: {
  supabase: ReturnType<typeof createAdminClient>
  orderId: string
  fullRefund: boolean
  cancelled: boolean
  refundedOre: number
}): Promise<RefundEmailResult> {
  const { supabase, orderId } = params
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('buyer_name, buyer_email, total_ore, archived_reason, events(title, starts_at, organizers(name))')
      .eq('id', orderId)
      .maybeSingle()
    if (error) throw new Error(`Kunde inte läsa order ${orderId} för återbetalningsmejl: ${error.message}`)
    if (!data) return { sent: false, reason: 'order_not_found' }

    const row = data as unknown as {
      buyer_name: string
      buyer_email: string | null
      total_ore: number | null
      archived_reason: string | null
      events: { title: string; starts_at: string; organizers: { name: string } | null } | null
    }

    if (
      !shouldSendRefundEmail({
        fullRefund: params.fullRefund,
        cancelled: params.cancelled,
        totalOre: row.total_ore,
        archivedReason: row.archived_reason,
        buyerEmail: row.buyer_email,
      })
    ) {
      return { sent: false, reason: 'conditions_not_met' }
    }
    if (!row.events) throw new Error(`Order ${orderId} saknar event - kan inte skicka återbetalningsmejl`)

    const emailId = await sendRefundEmail(row.buyer_email as string, {
      buyerName: row.buyer_name,
      eventTitle: row.events.title,
      eventStartsAt: row.events.starts_at,
      organizerName: row.events.organizers?.name ?? null,
      refundedOre: params.refundedOre,
      orderId,
    })
    // Inga personuppgifter i loggraden - bara order-id och belopp.
    console.log('Återbetalningsmejl skickat', orderId, params.refundedOre, 'öre', emailId ?? '(ingen Resend-nyckel)')
    return { sent: true, emailId }
  } catch (err) {
    console.error('Återbetalningsmejl misslyckades', orderId, params.refundedOre, 'öre', shortEmailErrorCode(err))
    try {
      await captureEdgeException(err)
    } catch {
      // Sentry-fel får aldrig heller propagera.
    }
    return { sent: false, reason: 'error' }
  }
}
