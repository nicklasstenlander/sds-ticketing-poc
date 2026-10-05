// Kontroll av supabase/functions/_shared/ticketPdf.ts.
// Kör: deno run --allow-env --allow-sys --allow-read --allow-net=registry.npmjs.org scripts/check-ticket-pdf.ts
// Avslutar med kod 1 om något avviker.

import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";
import {
  buildTicketsPdf, bytesToBase64, formatStockholm, MAX_TICKETS_PER_PDF, sanitizeForFont, ticketsPdfFilename,
} from "../supabase/functions/_shared/ticketPdf.ts";

let failed = 0, total = 0;
function check(name: string, cond: boolean, detail = "") {
  total++;
  if (!cond) { failed++; console.error(`FEL  ${name}${detail ? `  (${detail})` : ""}`); }
  else console.log(`ok   ${name}`);
}
async function throws(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}

const base = {
  eventTitle: "Vinterföreställningen",
  startsAt: "2026-12-12T14:00:00Z",
  venue: "Dansscenen",
  buyerName: "Nicklas Stenlander Marquart",
  orderId: "39e318a0-a147-454a-bba0-76dea22578db",
  seller: { legalName: "Moon Movements AB", orgNumber: "559317-1936" },
  contactEmail: "info@sollentunadansochscenskola.se",
};
const mk = (n: number) => Array.from({ length: n }, (_, i) => ({
  code: `CODE${String(i).padStart(4, "0")}ABCDEFGHJKMNPQRS`, typeName: i % 2 ? "Barn" : "Vuxen",
}));
const pages = async (b: Uint8Array) => (await PDFDocument.load(b)).getPageCount();

// ---- grundfall
const three = await buildTicketsPdf({ ...base, tickets: mk(3) });
check("PDF börjar med %PDF", new TextDecoder().decode(three.slice(0, 5)) === "%PDF-");
check("tre biljetter ger tre sidor", (await pages(three)) === 3);
check("tre biljetter är under 100 KB", three.length < 100_000, `${three.length} byte`);

// ---- tecken som typsnittet inte klarar
const helv = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
check("å ä ö behålls", sanitizeForFont(helv, "Åsa Öberg Ängel") === "Åsa Öberg Ängel");
check("é och ë behålls", sanitizeForFont(helv, "José Zoë") === "José Zoë");
check("Ł och ł blir L och l", sanitizeForFont(helv, "Łukasz Kowalski Wałęsa").startsWith("Lukasz Kowalski Wal"));
check("emoji tas bort", sanitizeForFont(helv, "Anna 🎉 Berg") === "Anna Berg");
check("kyrilliska blir frågetecken, kastar inte", /^\?+ \?+$/.test(sanitizeForFont(helv, "Анна Иванова")));
check("radbrytning och tab blir mellanslag", sanitizeForFont(helv, "A\nB\tC") === "A B C");
check("null och undefined ger tom text", sanitizeForFont(helv, null) === "" && sanitizeForFont(helv, undefined) === "");
const hostile = await buildTicketsPdf({
  ...base, eventTitle: "Łódź 🎭 Бал", buyerName: "Zoë Łukasz 🎉 Анна\nRad2", venue: "Teatern ✦ Å", tickets: mk(1),
});
check("PDF byggs trots konstiga tecken", (await pages(hostile)) === 1);

// ---- saknade och extrema fält
const minimal = await buildTicketsPdf({ eventTitle: "", orderId: "x", tickets: [{ code: "ABC123" }] });
check("minimala fält ger en sida", (await pages(minimal)) === 1);
const badDate = await buildTicketsPdf({ ...base, startsAt: "inte ett datum", tickets: mk(1) });
check("ogiltigt datum kastar inte", (await pages(badDate)) === 1);
const long = await buildTicketsPdf({
  ...base, eventTitle: "En mycket lång titel ".repeat(30) + "X".repeat(200),
  venue: "Plats ".repeat(60), buyerName: "Namn ".repeat(60), tickets: mk(1),
});
check("extremt långa texter ger en sida", (await pages(long)) === 1);

// ---- gränser
check("noll biljetter kastar fel", await throws(() => buildTicketsPdf({ ...base, tickets: [] })));
check(`${MAX_TICKETS_PER_PDF + 1} biljetter kastar fel`, await throws(() => buildTicketsPdf({ ...base, tickets: mk(MAX_TICKETS_PER_PDF + 1) })));
const t0 = performance.now();
const ten = await buildTicketsPdf({ ...base, tickets: mk(10) });
const tenMs = performance.now() - t0;
check("10 biljetter ger 10 sidor", (await pages(ten)) === 10);
console.log(`     10 biljetter: ${ten.length} byte, ${tenMs.toFixed(0)} ms (Edge Functions har 2000 ms CPU per anrop)`);
check("10 biljetter tar under 500 ms", tenMs < 500, `${tenMs.toFixed(0)} ms`);
const t1 = performance.now();
const max = await buildTicketsPdf({ ...base, tickets: mk(MAX_TICKETS_PER_PDF) });
const maxMs = performance.now() - t1;
check(`${MAX_TICKETS_PER_PDF} biljetter ger ${MAX_TICKETS_PER_PDF} sidor`, (await pages(max)) === MAX_TICKETS_PER_PDF);
console.log(`     ${MAX_TICKETS_PER_PDF} biljetter: ${max.length} byte, ${maxMs.toFixed(0)} ms`);
check(`${MAX_TICKETS_PER_PDF} biljetter tar under 1500 ms`, maxMs < 1500, `${maxMs.toFixed(0)} ms`);

// ---- tid
const w = formatStockholm("2026-12-12T14:00:00Z");
check("14:00 UTC i december blir 15:00", w?.time === "15:00" && w.date === "Lördag 12 december 2026", JSON.stringify(w));
const s = formatStockholm("2026-07-01T12:00:00Z");
check("12:00 UTC i juli blir 14:00", s?.time === "14:00", JSON.stringify(s));
// sommartiden slutar 2026-10-25 kl. 01:00 UTC
check("före sommartidens slut: 00:59 UTC blir 02:59", formatStockholm("2026-10-25T00:59:00Z")?.time === "02:59");
check("efter sommartidens slut: 01:01 UTC blir 02:01", formatStockholm("2026-10-25T01:01:00Z")?.time === "02:01");
check("null och skräp ger null", formatStockholm(null) === null && formatStockholm("skräp") === null);

// ---- filnamn och base64
check("filnamn utan å, ä, ö", ticketsPdfFilename("Vinterföreställningen") === "Biljetter-Vinterforestallningen.pdf");
check("tomt filnamn ger standardnamn", ticketsPdfFilename("") === "Biljetter.pdf");
check("farliga tecken i filnamn rensas", /^Biljetter(-[A-Za-z0-9-]*)?\.pdf$/.test(ticketsPdfFilename("../../etc/<script>\"x\"")));
check("filnamn begränsas i längd", ticketsPdfFilename("A".repeat(500)).length <= 60);
const rnd = new Uint8Array(200_000);
for (let o = 0; o < rnd.length; o += 65_536) crypto.getRandomValues(rnd.subarray(o, Math.min(o + 65_536, rnd.length)));
const back = Uint8Array.from(atob(bytesToBase64(rnd)), (c) => c.charCodeAt(0));
check("base64 av 200 KB går att avkoda till samma bytes", back.length === rnd.length && back.every((v, i) => v === rnd[i]));

console.log(`\n${total - failed}/${total} kontroller godkända`);
Deno.writeFileSync("/tmp/check-three.pdf", three);
if (failed) Deno.exit(1);
