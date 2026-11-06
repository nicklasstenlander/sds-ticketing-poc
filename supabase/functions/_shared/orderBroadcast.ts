// "Ny order"-ping till admin-dashboarden via Supabase Realtime Broadcast.
//
// Varför Broadcast och inte postgres_changes: postgres_changes kräver att
// orders läggs till i supabase_realtime-publikationen plus en RLS-policy
// för authenticated - dvs en databasändring. Broadcast skickas via
// Realtimes REST-API och rör inte databasen alls.
//
// Payloaden är TOM med avsikt - inga personuppgifter, inga belopp. Den
// säger bara "något har sålts, hämta om listan". Admin-UI:t hämtar sedan
// själva datan via admin-recent-orders (JWT-skyddad, organizer-scopead).
// Kanalen är publik (private: false), så den som känner till en
// arrangörs UUID kan i teorin se ATT en försäljning skett, men aldrig
// vad eller av vem.
//
// Anropas ENBART i bakgrunden (EdgeRuntime.waitUntil) från
// stripe-webhook efter ett första lyckat slutförande - ett fel här får
// aldrig påverka webhook-svaret till Stripe.
import type { createAdminClient } from './supabaseAdmin.ts'

export function orderChannelTopic(organizerId: string): string {
  return `rideau-orders:${organizerId}`
}

export const ORDER_PAID_EVENT = 'order_paid'

export async function broadcastOrderPaid(
  supabase: ReturnType<typeof createAdminClient>,
  eventId: string,
): Promise<void> {
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) return

    const { data: event, error } = await supabase
      .from('events')
      .select('organizer_id')
      .eq('id', eventId)
      .maybeSingle()
    if (error || !event?.organizer_id) return

    const res = await fetch(`${url.replace(/\/$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: orderChannelTopic(event.organizer_id),
            event: ORDER_PAID_EVENT,
            payload: {},
            private: false,
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) console.error('broadcastOrderPaid: Realtime svarade', res.status)
  } catch (err) {
    console.error('broadcastOrderPaid misslyckades (ignoreras):', err)
  }
}

export function scheduleOrderPaidBroadcast(
  supabase: ReturnType<typeof createAdminClient>,
  eventId: string | null,
): void {
  if (!eventId) return
  const task = broadcastOrderPaid(supabase, eventId)
  const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
    .EdgeRuntime
  if (edgeRuntime) edgeRuntime.waitUntil(task)
}
