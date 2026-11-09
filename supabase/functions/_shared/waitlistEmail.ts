// Mejl till väntelistan (2026-11). buildWaitlistOfferEmail är ren och
// testbar (scripts/check-waitlist.ts); sendWaitlistOffer skickar via Resend
// med samma nyckel/avsändare och samma tidsgräns som bekräftelsemejlet.
//
// Erbjudandet reserverar ingen plats - mejlet säger det tydligt ("först
// till kvarn"), så att ingen tror att de har en biljett.

export interface WaitlistOfferInput {
  name: string
  eventTitle: string
  eventVenue: string | null
  eventStartsAt: string | null
  purchaseUrl: string
  organizerName: string | null
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildWaitlistOfferEmail(input: WaitlistOfferInput): { subject: string; html: string; text: string } {
  const when = input.eventStartsAt
    ? new Date(input.eventStartsAt).toLocaleString('sv-SE', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Stockholm',
      })
    : null
  const where = [when, input.eventVenue].filter(Boolean).join(', ')
  const subject = `Det finns platser till ${input.eventTitle}`
  const sender = input.organizerName ?? 'Arrangören'

  const text = [
    `Hej ${input.name}!`,
    '',
    `Du står på väntelistan till ${input.eventTitle}${where ? ` (${where})` : ''}, och nu har det blivit platser lediga.`,
    '',
    `Köp biljetter här: ${input.purchaseUrl}`,
    '',
    'Platserna är inte reserverade åt dig - först till kvarn gäller.',
    '',
    `Hälsningar, ${sender}`,
  ].join('\n')

  const html = `<!doctype html>
<html lang="sv"><body style="margin:0;padding:24px;background:#fafaf8;font-family:Arial,Helvetica,sans-serif;color:#171717">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px">
    <p style="margin:0 0 12px;font-size:16px">Hej ${escapeHtml(input.name)}!</p>
    <p style="margin:0 0 12px;font-size:16px;line-height:1.5">
      Du står på väntelistan till <strong>${escapeHtml(input.eventTitle)}</strong>${where ? ` (${escapeHtml(where)})` : ''}, och nu har det blivit platser lediga.
    </p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(input.purchaseUrl)}" style="display:inline-block;background:#f6b93b;color:#171717;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Köp biljetter</a>
    </p>
    <p style="margin:0 0 12px;font-size:14px;color:#5f5f5c;line-height:1.5">
      Platserna är inte reserverade åt dig – först till kvarn gäller.
    </p>
    <p style="margin:24px 0 0;font-size:14px;color:#5f5f5c">Hälsningar, ${escapeHtml(sender)}</p>
  </div>
</body></html>`

  return { subject, html, text }
}

export async function sendWaitlistOffer(to: string, input: WaitlistOfferInput): Promise<void> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const resendFrom = Deno.env.get('RESEND_FROM') ?? 'biljett@resend.dev'
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY saknas')
  }
  const { subject, html, text } = buildWaitlistOfferEmail(input)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: resendFrom, to, subject, html, text }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) {
    // Bara statuskoden - Resends svarstext kan eka e-postadressen.
    throw new Error(`Resend svarade ${response.status}`)
  }
}
