// Formulärsutkast i sessionStorage (ordern "Köpvillkor godkända, gå live"
// 2026-10-12, tillägget om sessionStorage-skydd) - skydd mot att
// köpformuläret (namn, e-post, valda biljettantal) nollställs om
// köparen öppnar villkorslänken i SAMMA flik istället för en ny (vissa
// inbäddade webbläsare respekterar inte target=_blank) och sedan går
// tillbaka. Sparar BARA namn, e-post och biljettantal - INTE kryssrutan
// för villkor (köparen ska kryssa i den på nytt varje gång, se
// PurchasePage.tsx) och INTE rabattkoden eller något om betalningen.
//
// sessionStorage, ALDRIG localStorage - utkastet ska inte överleva att
// fliken stängs. Nyckel per event-slug (flera köp i olika flikar ska
// inte kunna krocka). All läsning/skrivning i try/catch - sidan ska
// fungera identiskt om lagringen är blockerad eller kvoterad (privat
// läge, inbäddad webbläsare med egna begränsningar, etc.).
const TTL_MS = 30 * 60 * 1000
const PREFIX = 'rideau-purchase-draft:'

export interface PurchaseDraft {
  name: string
  email: string
  quantities: Record<string, number>
}

interface StoredDraft extends PurchaseDraft {
  savedAt: number
}

function isStoredDraft(value: unknown): value is StoredDraft {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.savedAt === 'number' &&
    typeof v.name === 'string' &&
    typeof v.email === 'string' &&
    typeof v.quantities === 'object' &&
    v.quantities !== null
  )
}

export function loadPurchaseDraft(slug: string): PurchaseDraft | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + slug)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isStoredDraft(parsed)) return null
    if (Date.now() - parsed.savedAt > TTL_MS) return null
    return { name: parsed.name, email: parsed.email, quantities: parsed.quantities }
  } catch {
    return null
  }
}

export function savePurchaseDraft(slug: string, draft: PurchaseDraft): void {
  try {
    const stored: StoredDraft = { ...draft, savedAt: Date.now() }
    sessionStorage.setItem(PREFIX + slug, JSON.stringify(stored))
  } catch {
    // Blockerad eller kvoterad lagring - inget att göra, formuläret
    // fungerar ändå, bara utan skyddet.
  }
}

export function clearPurchaseDraft(slug: string): void {
  try {
    sessionStorage.removeItem(PREFIX + slug)
  } catch {
    // se savePurchaseDraft
  }
}
