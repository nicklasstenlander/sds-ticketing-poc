// Biljett-PDF: en A4-sida per biljett, med en stor QR-kod som är ritad som vektorgrafik
// (skarp i alla utskriftsstorlekar, och bara några kilobyte per sida).
//
// Används av stripe-webhook för att bifoga biljetterna som en PDF i bekräftelsemailet.
// Modulen gör inga nätverksanrop och läser ingen hemlighet: den tar data in och ger bytes tillbaka.
//
// Gör tre saker med flit:
//  1. QR-koden genereras här ur samma text som den vanliga QR-bilden (qrPayload), inte ur en bild.
//  2. All text rensas så att typsnittet kan skriva den. Köparnamn kommer från Stripe och kan innehålla
//     tecken som standardtypsnittet inte klarar (pdf-lib kastar annars fel och köpet skulle sakna PDF).
//  3. Datum och tid visas alltid i Europe/Stockholm.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import qrcode from "npm:qrcode-generator@1.4.4";
import { LOGO_ASPECT, LOGO_PNG_BASE64 } from "./ticketPdfAssets.ts";

export interface TicketPdfTicket {
  /** Koden som visas i klartext under QR-koden (ticket_code). */
  code: string;
  /** Texten som QR-koden ska innehålla. Samma som i den vanliga QR-bilden. Standard: code. */
  qrPayload?: string;
  /** Biljettyp, t.ex. "Ordinarie". */
  typeName?: string | null;
}

export interface TicketPdfInput {
  eventTitle: string;
  startsAt?: string | Date | null;
  venue?: string | null;
  buyerName?: string | null;
  orderId: string;
  /** Säljare, t.ex. { legalName: "Moon Movements AB", orgNumber: "559317-1936" }. */
  seller?: { legalName?: string | null; orgNumber?: string | null } | null;
  /** Visas i sidfoten, t.ex. "info@sollentunadansochscenskola.se". */
  contactEmail?: string | null;
  tickets: TicketPdfTicket[];
}

export const MAX_TICKETS_PER_PDF = 60;

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MIDNATT = rgb(36 / 255, 59 / 255, 83 / 255);
const BLACK = rgb(0, 0, 0);
const INK = rgb(23 / 255, 23 / 255, 23 / 255);
const MUTED = rgb(90 / 255, 90 / 255, 90 / 255);
const BORDER = rgb(203 / 255, 210 / 255, 218 / 255);

// ---------------------------------------------------------------- text

/** Gör om text till tecken som standardtypsnittet (WinAnsi) kan skriva. Kastar aldrig. */
export function sanitizeForFont(font: PDFFont, input: string | null | undefined): string {
  if (!input) return "";
  let supported: Set<number> | null = null;
  try {
    supported = new Set(font.getCharacterSet());
  } catch {
    supported = null;
  }
  const ok = (cp: number) => (supported ? supported.has(cp) : cp < 256);
  const extra: Record<string, string> = { "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "ı": "i", "İ": "I" };
  let out = "";
  for (const ch of Array.from(input)) {
    const cp = ch.codePointAt(0)!;
    if (cp === 9 || cp === 10 || cp === 13 || cp === 0xa0) { out += " "; continue; }
    if (cp < 32) continue;
    if (ok(cp)) { out += ch; continue; }
    const mapped = extra[ch] ?? ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (mapped && Array.from(mapped).every((c) => ok(c.codePointAt(0)!))) { out += mapped; continue; }
    out += /\p{L}/u.test(ch) ? "?" : ""; // okända bokstäver blir ?, symboler och emoji tas bort
  }
  return out.replace(/ {2,}/g, " ").trim();
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= maxWidth;
  for (let word of words) {
    // bryt ord som är längre än raden
    while (!fits(word)) {
      let cut = word.length - 1;
      while (cut > 1 && !fits(word.slice(0, cut))) cut--;
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const next = cur ? `${cur} ${word}` : word;
    if (fits(next)) cur = next;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && !fits(last + "…")) last = last.slice(0, -1);
    kept[maxLines - 1] = last.trimEnd() + "…";
    return kept;
  }
  return lines;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Datum och klockslag i Stockholmstid, oavsett serverns tidszon. */
export function formatStockholm(value: string | Date | null | undefined): { date: string; time: string } | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d).replace(".", ":");
  return { date: capitalize(date), time };
}

// ---------------------------------------------------------------- grafik

function roundedRectPath(w: number, h: number, r: number): string {
  return `M${r},0 H${w - r} Q${w},0 ${w},${r} V${h - r} Q${w},${h} ${w - r},${h} H${r} Q0,${h} 0,${h - r} V${r} Q0,0 ${r},0 Z`;
}

/** QR-kod som en enda vektorsökväg i modulenheter, inklusive tyst zon (4 moduler). */
function qrPath(payload: string): { path: string; units: number } {
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const parts: string[] = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (qr.isDark(r, c)) {
        let run = 1;
        while (c + run < n && qr.isDark(r, c + run)) run++;
        parts.push(`M${c + quiet},${r + quiet}h${run}v1h-${run}z`);
        c += run;
      } else c++;
    }
  }
  return { path: parts.join(""), units: n + quiet * 2 };
}

function drawQr(page: PDFPage, payload: string, x: number, topY: number, size: number) {
  const { path, units } = qrPath(payload);
  page.drawSvgPath(path, { x, y: topY, scale: size / units, color: BLACK, borderWidth: 0 });
}

// ---------------------------------------------------------------- PDF

export async function buildTicketsPdf(input: TicketPdfInput): Promise<Uint8Array> {
  const { tickets } = input;
  if (!tickets || tickets.length === 0) throw new Error("Inga biljetter att skriva ut.");
  if (tickets.length > MAX_TICKETS_PER_PDF) throw new Error(`För många biljetter för en PDF (max ${MAX_TICKETS_PER_PDF}).`);

  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  const logo = await doc.embedPng(Uint8Array.from(atob(LOGO_PNG_BASE64), (c) => c.charCodeAt(0)));

  const clean = (s: string | null | undefined, f: PDFFont = regular) => sanitizeForFont(f, s);

  const title = clean(input.eventTitle, bold) || "Evenemang";
  const when = formatStockholm(input.startsAt);
  const venue = clean(input.venue);
  const buyer = clean(input.buyerName);
  const orderShort = (input.orderId || "").replace(/-/g, "").slice(0, 8).toUpperCase();
  const sellerName = clean(input.seller?.legalName);
  const sellerOrg = clean(input.seller?.orgNumber);
  const seller = sellerName ? `${sellerName}${sellerOrg ? ` (org.nr ${sellerOrg})` : ""}` : "";
  const contact = clean(input.contactEmail);

  try {
    doc.setTitle(`Biljetter: ${title}`);
    doc.setAuthor("Rideau");
    doc.setProducer("Rideau");
    doc.setCreator("Rideau");
    doc.setSubject(`Biljetter till ${title}`);
    doc.setLanguage("sv-SE");
  } catch { /* metadata är valfri */ }

  const CARD_X = 40, CARD_W = PAGE_W - 80, CARD_TOP = PAGE_H - 48, CARD_H = 420;
  const PAD = 24, QR = 170;
  const qrX = CARD_X + CARD_W - PAD - QR;
  const leftX = CARD_X + PAD;
  const leftW = qrX - 20 - leftX;
  const n = tickets.length;

  tickets.forEach((t, i) => {
    const page = doc.addPage([PAGE_W, PAGE_H]);

    // ram
    page.drawSvgPath(roundedRectPath(CARD_W, CARD_H, 14), {
      x: CARD_X, y: CARD_TOP, color: rgb(1, 1, 1), borderColor: BORDER, borderWidth: 1,
    });

    // sidhuvud: logotyp och "Biljett x av y"
    const logoW = 118, logoH = logoW / LOGO_ASPECT;
    page.drawImage(logo, { x: leftX, y: CARD_TOP - 20 - logoH, width: logoW, height: logoH });
    const label = `Biljett ${i + 1} av ${n}`;
    const labelSize = 12;
    page.drawText(label, {
      x: CARD_X + CARD_W - PAD - bold.widthOfTextAtSize(label, labelSize),
      y: CARD_TOP - 20 - logoH / 2 - 4, size: labelSize, font: bold, color: MIDNATT,
    });
    page.drawLine({
      start: { x: leftX, y: CARD_TOP - 82 }, end: { x: CARD_X + CARD_W - PAD, y: CARD_TOP - 82 },
      thickness: 1, color: BORDER,
    });

    // vänsterspalten har en fast höjd (ned till avdelaren), så titel och uppgifter anpassas till den
    const typeName = clean(t.typeName);
    const blocks: [string, string][] = [];
    if (when) blocks.push(["DATUM OCH TID", `${when.date}, kl. ${when.time}`]);
    if (venue) blocks.push(["PLATS", venue]);
    if (typeName) blocks.push(["BILJETTYP", typeName]);
    const AVAIL = 228;              // från CARD_TOP - 112 ned till avdelaren
    const BLOCK_H = 50;             // etikett, ett värde och luft
    let titleLines = wrapText(title, bold, 24, leftW, 3);
    if (titleLines.length * 29 + 12 + blocks.length * BLOCK_H > AVAIL) titleLines = wrapText(title, bold, 24, leftW, 2);

    let y = CARD_TOP - 112;
    for (const line of titleLines) {
      page.drawText(line, { x: leftX, y: y - 18, size: 24, font: bold, color: MIDNATT });
      y -= 29;
    }
    y -= 12;
    for (const [lab, val] of blocks) {
      page.drawText(lab, { x: leftX, y: y - 9, size: 8.5, font: bold, color: MUTED });
      // ett värde per block: för långt värde kortas med … i stället för att trycka ned nästa
      let vSize = 14;
      while (vSize > 10.5 && regular.widthOfTextAtSize(val, vSize) > leftW) vSize -= 0.5;
      const vLine = wrapText(val, regular, vSize, leftW, 1)[0] ?? "";
      page.drawText(vLine, { x: leftX, y: y - 26, size: vSize, font: regular, color: INK });
      y -= BLOCK_H;
    }

    // QR och kod i klartext
    const payload = t.qrPayload || t.code;
    drawQr(page, payload, qrX, CARD_TOP - 104, QR);
    const code = clean(t.code, mono);
    let codeSize = 11;
    while (codeSize > 6 && mono.widthOfTextAtSize(code, codeSize) > QR - 8) codeSize -= 0.25;
    page.drawText(code, {
      x: qrX + (QR - mono.widthOfTextAtSize(code, codeSize)) / 2, y: CARD_TOP - 104 - QR - 8,
      size: codeSize, font: mono, color: INK,
    });

    // nedre remsa
    page.drawLine({
      start: { x: leftX, y: CARD_TOP - 350 }, end: { x: CARD_X + CARD_W - PAD, y: CARD_TOP - 350 },
      thickness: 1, color: BORDER,
    });
    const partsRow = [buyer ? `Köpare: ${buyer}` : "", orderShort ? `Order: ${orderShort}` : ""].filter(Boolean).join("   |   ");
    let by = CARD_TOP - 368;
    if (partsRow) {
      const lines = wrapText(partsRow, regular, 10, CARD_W - PAD * 2, 1);
      page.drawText(lines[0] ?? "", { x: leftX, y: by, size: 10, font: regular, color: INK }); by -= 15;
    }
    if (seller) {
      const lines = wrapText(`Säljare: ${seller}`, regular, 10, CARD_W - PAD * 2, 1);
      page.drawText(lines[0] ?? "", { x: leftX, y: by, size: 10, font: regular, color: INK }); by -= 18;
    }
    page.drawText("Visa QR-koden på mobilen eller skriv ut sidan. Biljetten gäller en gång vid entrén.", {
      x: leftX, y: by, size: 9, font: regular, color: MUTED,
    });

    // sidfot
    const foot = contact
      ? `Frågor om din biljett? Svara på mailet eller skriv till ${contact}.`
      : "Frågor om din biljett? Svara på mailet.";
    page.drawText(foot, { x: CARD_X, y: 56, size: 9, font: regular, color: MUTED });
  });

  return await doc.save();
}

// ---------------------------------------------------------------- hjälpare för mailet

/** Filnamn utan å, ä, ö och specialtecken, t.ex. "Biljetter-Vinterforestallningen.pdf". */
export function ticketsPdfFilename(eventTitle: string): string {
  const slug = (eventTitle || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `Biljetter${slug ? `-${slug}` : ""}.pdf`;
}

/** Base64 för Resends bilagor (content). Bearbetar i delar så att stora filer inte spränger anropsstacken. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
