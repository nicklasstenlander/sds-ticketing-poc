// Delad, ren filtreringsfunktion för export-sales/platform-export-revenue
// (ordern "Arkiv för ordrar och event" 2026-10-12, DEL 2 punkt 2):
// arkiverade ordrar med orsak 'test' (ingen riktig betalning) utesluts ur
// bokföringsexporterna, 'hidden' (riktig betalning, bara dold ur admin-
// vyer) ligger KVAR som standard - precis som en helt oarkiverad order.
//
// Ren funktion, oberoende av Supabase/Deno - samma motivering som
// scan-ticket/determineScanOutcome.ts: går att testa direkt utan en
// riktig databasanslutning, se scripts/check-archive.mjs.
export interface ArchiveSplitResult<T> {
  included: T[]
  excludedCount: number
  excludedTotalOre: number
}

export function splitArchivedTestItems<T>(
  items: T[],
  getArchivedReason: (item: T) => string | null | undefined,
  getAmountOre: (item: T) => number,
  getGroupKey: (item: T) => string,
): ArchiveSplitResult<T> {
  const included: T[] = []
  const excludedGroupKeys = new Set<string>()
  let excludedTotalOre = 0
  for (const item of items) {
    if (getArchivedReason(item) === 'test') {
      excludedGroupKeys.add(getGroupKey(item))
      excludedTotalOre += getAmountOre(item)
    } else {
      included.push(item)
    }
  }
  return { included, excludedCount: excludedGroupKeys.size, excludedTotalOre }
}
