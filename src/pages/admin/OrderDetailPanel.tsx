import { SidePanel } from '../../components/SidePanel'
import { formatKr } from '../../lib/formatPrice'
import { formatStockholmDateTimeLocale } from '../../lib/stockholmTime'
import type { OrderStatus, RecentOrderRow } from '../../lib/types'

const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Väntande',
  paid: 'Betald',
  expired: 'Utgången',
  cancelled: 'Avbokad',
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const cls =
    status === 'paid'
      ? 'bg-[var(--success-soft)] text-[var(--success-ink)]'
      : status === 'cancelled'
        ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
        : 'bg-[var(--warning-soft)] text-[var(--warning-ink)]'
  return (
    <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap ${cls}`}>
      {ORDER_STATUS_LABEL[status] ?? status}
    </span>
  )
}

function dt(iso: string | null): string {
  return iso ? formatStockholmDateTimeLocale(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '–'
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-[var(--border)] last:border-0 text-sm">
      <span className="text-[var(--text-muted)] shrink-0">{label}</span>
      <span className="text-right min-w-0 break-words">{children}</span>
    </div>
  )
}

export function OrderDetailPanel({ order, onClose }: { order: RecentOrderRow | null; onClose: () => void }) {
  return (
    <SidePanel
      open={Boolean(order)}
      title={order?.buyer_name ?? ''}
      subtitle={order?.buyer_email}
      onClose={onClose}
      elevated
      footer={
        order?.stripe_url ? (
          <a
            href={order.stripe_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary w-full justify-center text-center"
          >
            Öppna betalningen i Stripe ↗
          </a>
        ) : order ? (
          <p className="text-xs text-[var(--text-muted)] text-center">
            Ingen Stripe-betalning kopplad till ordern (t.ex. äldre köp eller gratisbiljett).
          </p>
        ) : null
      }
    >
      {order && (
        <div className="p-5 flex flex-col gap-6">
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Köp</h3>
            <Row label="Status">
              <OrderStatusBadge status={order.status} />
            </Row>
            <Row label="Betald">{dt(order.paid_at)}</Row>
            <Row label="Antal biljetter">{order.ticket_qty}</Row>
            {order.discount_amount_ore > 0 && <Row label="Rabatt">−{formatKr(order.discount_amount_ore)} kr</Row>}
            <Row label="Totalt">
              <strong>{order.total_ore !== null ? `${formatKr(order.total_ore)} kr` : '–'}</strong>
            </Row>
            <Row label="Bekräftelsemejl">{order.confirmation_email_sent_at ? `Skickat ${dt(order.confirmation_email_sent_at)}` : 'Ej skickat'}</Row>
          </section>

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Föreställning</h3>
            <Row label="Titel">{order.event.title}</Row>
            <Row label="Tid & datum">{dt(order.event.starts_at)}</Row>
            {order.event.venue && <Row label="Plats">{order.event.venue}</Row>}
          </section>

          {order.items.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Biljetter</h3>
              {order.items.map((item, i) => (
                <Row key={i} label={`${item.qty} × ${item.name ?? 'Biljett'}`}>
                  {formatKr(item.unit_price_ore * item.qty)} kr
                  <span className="block text-xs text-[var(--text-muted)]">
                    {formatKr(item.unit_price_ore)} kr/st · moms {item.vat_rate} %
                  </span>
                </Row>
              ))}
            </section>
          )}

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Referenser</h3>
            <Row label="Ordernummer">
              <span className="font-mono text-xs">{order.id}</span>
            </Row>
            {order.stripe_payment_intent_id && (
              <Row label="Stripe">
                <span className="font-mono text-xs">{order.stripe_payment_intent_id}</span>
              </Row>
            )}
          </section>
        </div>
      )}
    </SidePanel>
  )
}
