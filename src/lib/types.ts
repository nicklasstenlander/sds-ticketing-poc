export type EventStatus = 'draft' | 'published'

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

export interface OrderRow {
  id: string
  event_id: string
  buyer_name: string
  buyer_email: string
  qty: number
  status: string
  created_at: string
}
