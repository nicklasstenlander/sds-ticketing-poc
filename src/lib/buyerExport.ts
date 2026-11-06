// Hjälpfunktioner för köparlistor på Dashboard: namnuppdelning, CSV-export
// och utskrift (PDF via webbläsarens "Spara som PDF").

/** orders.buyer_name är ETT fält - förnamn = första ordet, efternamn = resten. */
export function splitBuyerName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Semikolonseparerad CSV med BOM - öppnas rätt (å/ä/ö, kolumner) i svensk Excel. */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]): void {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function fileSafe(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'lista'
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/**
 * Öppnar ett eget utskriftsfönster med en ren tabell och anropar print() -
 * användaren väljer "Spara som PDF" i webbläsarens dialog. Eget fönster
 * istället för print-CSS på admin-sidan, så utskriften inte beror på
 * resten av sidans layout.
 */
export function printTable(opts: {
  title: string
  subtitle?: string
  header: string[]
  rows: (string | number)[][]
  /** Index på kolumner som ska högerjusteras (siffror). */
  numericColumns?: number[]
}): boolean {
  const win = window.open('', '_blank')
  if (!win) return false
  const numeric = new Set(opts.numericColumns ?? [])
  const th = opts.header
    .map((h, i) => `<th${numeric.has(i) ? ' class="num"' : ''}>${escapeHtml(h)}</th>`)
    .join('')
  const trs = opts.rows
    .map(
      (r) =>
        `<tr>${r.map((c, i) => `<td${numeric.has(i) ? ' class="num"' : ''}>${escapeHtml(String(c))}</td>`).join('')}<td class="check"></td></tr>`,
    )
    .join('')
  win.document.write(`<!doctype html><html lang="sv"><head><meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #171717; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { font-size: 12px; color: #5f5f5c; margin: 0 0 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th { text-align: left; border-bottom: 1.5px solid #171717; padding: 6px 8px; }
  td { border-bottom: 1px solid #e5e5e1; padding: 6px 8px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  td.check { width: 18px; }
  td.check::after { content: ""; display: inline-block; width: 11px; height: 11px; border: 1px solid #5f5f5c; }
  tr { break-inside: avoid; }
</style></head><body>
<h1>${escapeHtml(opts.title)}</h1>
${opts.subtitle ? `<p>${escapeHtml(opts.subtitle)}</p>` : ''}
<table><thead><tr>${th}<th></th></tr></thead><tbody>${trs}</tbody></table>
<script>window.onload = function () { window.focus(); window.print(); };</script>
</body></html>`)
  win.document.close()
  return true
}
