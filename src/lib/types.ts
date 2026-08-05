export type EventStatus = 'draft' | 'published' | 'cancelled'

export interface EventRow {
  id: string
  slug: string
  title: string
  venue: string | null
  starts_at: string
  status: EventStatus
  created_at: string
}

export interface TicketTypeSummary {
  ticket_type_count: number
  total_capacity: number
  total_sold: number
  min_price_ore: number | null
  max_price_ore: number | null
}

// Admin-events/admin-event-tickets kompletterar EventRow med denna
// aggregerade sammanfattning (events har inte längre pris/kapacitet/sålt
// direkt - det ligger på ticket_types, se Tilläggsordern avsnitt 1).
export interface AdminEventRow extends EventRow {
  ticket_types_summary: TicketTypeSummary
}

export interface TicketTypeRow {
  id: string
  event_id: string
  name: string
  price_ore: number
  vat_rate: number
  capacity: number
  sold_count: number
  sort_order: number
  created_at: string
}

export type TicketStatus = 'valid' | 'checked_in' | 'void'

export interface TicketRow {
  id: string
  order_id: string
  event_id: string
  ticket_type_id: string | null
  ticket_code: string
  holder_name: string | null
  status: TicketStatus
  checked_in_at: string | null
  checked_in_by: string | null
}

export type OrderStatus = 'pending' | 'paid' | 'expired' | 'cancelled'

export interface OrderRow {
  id: string
  event_id: string
  ticket_type_id: string | null
  buyer_name: string
  buyer_email: string
  qty: number
  status: OrderStatus
  created_at: string
  stripe_session_id: string | null
  expires_at: string | null
  paid_at: string | null
  price_ore: number | null
  vat_rate: number | null
  discount_code_id: string | null
  discount_amount_ore: number
}

export type DiscountType = 'percent' | 'amount'

export interface DiscountCodeRow {
  id: string
  code: string
  discount_type: DiscountType
  value: number
  event_id: string | null
  max_uses: number | null
  used_count: number
  valid_from: string | null
  valid_until: string | null
  active: boolean
  created_at: string
  events?: { title: string } | { title: string }[] | null
}
