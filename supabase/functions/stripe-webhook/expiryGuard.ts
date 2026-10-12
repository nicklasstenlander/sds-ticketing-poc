// Ren beslutsfunktion för handleCheckoutExpired i index.ts (ordern
// "Avbokning, återbetalning, omsändning och köparmeddelanden" 2026-10-
// 12, STEG 2 tillägg B - rättelse av en BEFINTLIG bugg, upptäckt i
// rapporten för STEG 1).
//
// Egen fil, skild från index.ts, av samma skäl som scan-ticket/
// determineScanOutcome.ts: ska gå att importera från
// scripts/check-cancel-order.ts UTAN att samtidigt köra index.ts:s
// Deno.serve(...) som sidoeffekt av importen.
//
// Buggen som rättas: den villkorade UPDATE:en (`.eq('status','pending')`)
// i handleCheckoutExpired gav aldrig ett databasfel om noll rader
// matchade - bara om något gick FEL, inte om uppdateringen helt enkelt
// inte träffade något (t.ex. för att release_expired_orders-cronet hann
// flippa samma order till 'expired' en millisekund tidigare). Koden
// fortsatte då ändå till release_shared_capacity_multi - en andra,
// felaktig frigörning av samma ordens platser.
//
// Fixen: kedja .select('id') på update:en och kontrollera hur många
// rader som FAKTISKT kom tillbaka, exakt samma princip som
// release_expired_orders redan använder (UPDATE ... RETURNING, bara
// raderna som verkligen bytte status). Den här funktionen är den rena
// "ska vi frigöra?"-kontrollen av det resultatet.
export function shouldReleaseAfterExpiryUpdate(updatedRows: { id: string }[] | null): boolean {
  return Boolean(updatedRows && updatedRows.length > 0)
}
