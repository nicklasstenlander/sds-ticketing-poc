export type EventStatus = 'draft' | 'published' | 'cancelled'

export interface EventRow {
  id: string
  slug: string
  title: string
  venue: string | null
  starts_at: string
  status: EventStatus
  created_at: string
  // Delad kapacitetspool (rättelseordern 2026-08-05) - eventet har ETT
  // totalt platsantal som alla biljettyper delar, inte en egen kapacitet
  // per typ.
  capacity: number
  sold_count: number
  // Affischer (Tilläggsordern 2026-08-05) - nullable, ett event kan
  // publiceras utan affisch.
  poster_landscape_url: string | null
  poster_portrait_url: string | null
}

// Publika sidor (EventsPage, PurchasePage) joinar organizers(name) via
// PostgREST-embedding för att visa vilken arrangör som står bakom eventet
// (Tilläggsordern 2026-08-05, "Flera arrangörer") - PostgREST returnerar
// en relation, inte ett skalärt fält, därför en egen typ istället för att
// lägga organizer_name direkt på EventRow (som gäller admin-anrop där
// namnet inte hämtas alls).
export interface EventOrganizerRelation {
  name: string
}

export interface TicketTypeSummary {
  ticket_type_count: number
  min_price_ore: number | null
  max_price_ore: number | null
}

// Admin-events/admin-event-tickets kompletterar EventRow med denna
// aggregerade sammanfattning över eventets biljettyper (bara pris/antal
// typer - kapacitet/sålt finns redan direkt på EventRow, se ovan).
export interface AdminEventRow extends EventRow {
  ticket_types_summary: TicketTypeSummary
}

export interface TicketTypeRow {
  id: string
  event_id: string
  name: string
  price_ore: number
  vat_rate: number
  // sold_count är bara rapportering ("35 sålda Ordinarie") - ingen egen
  // kapacitetsspärr på biljettypen längre, se EventRow.capacity.
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

// orders är numera en "header" - de faktiska raderna (biljettyp + antal)
// ligger i OrderItemRow. ticket_type_id/price_ore/vat_rate/qty finns kvar
// på OrderRow bara för historiska (förkundvagns-) ordrar - null på alla
// nya ordrar, använd inte dessa fält för nya köp, se total_ore + items.
export interface OrderRow {
  id: string
  event_id: string
  ticket_type_id: string | null
  buyer_name: string
  buyer_email: string
  qty: number | null
  status: OrderStatus
  created_at: string
  stripe_session_id: string | null
  expires_at: string | null
  paid_at: string | null
  price_ore: number | null
  vat_rate: number | null
  discount_code_id: string | null
  discount_amount_ore: number
  total_ore: number | null
}

export interface OrderItemRow {
  id: string
  order_id: string
  ticket_type_id: string
  qty: number
  unit_price_ore: number
  vat_rate: number
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
