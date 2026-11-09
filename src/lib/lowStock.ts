// "Få biljetter kvar" visas från och med 75% sålda (önskemål 2026-11-09,
// tidigare under 10% kvar). Samma gräns på /evenemang och köpsidan.
export const LOW_STOCK_SOLD_SHARE = 0.75

export function isLowStock(capacity: number, sold: number): boolean {
  if (capacity <= 0) return false
  return sold / capacity >= LOW_STOCK_SOLD_SHARE
}
