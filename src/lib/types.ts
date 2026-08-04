export type EventStatus = 'draft' | 'published' | 'cancelled'

export interface EventRow {
  id: string
  slug: string
  title: string
  venue: string | null
  starts_at: string
  capacity: number
  sold_count: number
  status: EventStatus
  created_at: string
  price_ore: number
  vat_rate: number
}

export type TicketStatus = 'valid' | 'checked_in' | 'void'

export interface TicketRow {
  id: string
  order_id: string
  event_id: string
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
}
