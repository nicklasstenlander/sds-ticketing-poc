// platform-export-revenue
//
// Tilläggsordern 2026-08-07, avsnitt 5 - "den viktigaste nya delen".
// Platform-admin-skyddad exportfunktion (CSV och SIE4) för CHILDPROOF ABs
// EGEN bokföring av plattformsavgiften (application_fee_amount) - INTE
// samma sak som export-sales, som är arrangörens egen biljettförsäljning.
// Läses tvärs över ALLA arrangörer (ingen organizer_id-filtrering) - en
// period med köp från både SDS och Testscenen ska visa båda i en
// sammanslagen lista, med arrangörens namn synligt per rad för
// spårbarhet.
//
// EN RAD PER ORDER (inte per order_item, till skillnad från export-sales)
// - platform_fee_ore/platform_fee_vat_ore är en ORDER-nivå-snapshot
// (sätts en gång i create-order, se Tilläggsordern avsnitt 2), inte en
// radvis siffra.
//
// Egna SIE-kontonummer (PLATFORM_SIE_ACCOUNT_REVENUE/_VAT/_CLEARING) -
// separata secrets från organizernas SIE_ACCOUNT_*, eftersom
// plattformsavgiften alltid har 25% moms (teknisk/SaaS-tjänst) medan
// arrangörernas biljettmoms är 6% (kulturell verksamhet) - att blanda
// dessa i samma bokföring vore direkt fel. Se README/skill för
// motiveringen.
//
// GET platform-export-revenue?format=csv&scope=day&date=2026-08-07
// GET platform-export-revenue?format=csv&scope=range&from=...&to=...
// GET platform-export-revenue?format=sie&scope=...   (samma tre lägen)
import { handleOptions, corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requirePlatformAdmin } from '../_shared/platformAdmin.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { encodeCp437 } from '../_shared/cp437.ts'
import { PLATFORM_FEE_VAT_RATE } from '../_shared/platformFee.ts'

interface OrderRow {
  id: string
  paid_at: string
  stripe_session_id: string | null
  platform_fee_ore: number | null
  platform_fee_vat_ore: number | null
  events: { title: string; organizers: { name: string } | { name: string }[] | null } | { title: string; organizers: { name: string } | { name: string }[] | null }[] | null
}

interface RevenueRow {
  orderId: string
  organizerName: string
  eventTitle: string
  paidAt: string
  stripeSessionId: string | null
  feeBruttoOre: number
  feeMomsOre: number
  feeNettoOre: number
}

function single<T>(rel: T | T[] | null): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel
}

function platformAccountConfig() {
  return {
    revenue: Deno.env.get('PLATFORM_SIE_ACCOUNT_REVENUE') ?? '3041',
    vat: Deno.env.get('PLATFORM_SIE_ACCOUNT_VAT') ?? '2611',
    clearing: Deno.env.get('PLATFORM_SIE_ACCOUNT_CLEARING') ?? '1580',
  }
}

function toRevenueRows(orders: OrderRow[]): RevenueRow[] {
  const rows = orders
    .map((order) => {
      // Ordrar utan sparad platform_fee_ore (skapade INNAN denna
      // tilläggsorder deployades) exkluderas hellre än att visas med
      // felaktiga 0-belopp - de kan inte bokföras korrekt i efterhand,
      // avgiften finns bara i Stripes transaktionslogg för dem.
      if (order.platform_fee_ore === null || order.platform_fee_vat_ore === null) return null
      const event = single(order.events)
      const organizer = event ? single(event.organizers) : null
      const feeBruttoOre = order.platform_fee_ore
      const feeMomsOre = order.platform_fee_vat_ore
      const feeNettoOre = feeBruttoOre - feeMomsOre
      return {
        orderId: order.id,
        organizerName: organizer?.name ?? 'Okänd arrangör',
        eventTitle: event?.title ?? 'Okänt event',
        paidAt: order.paid_at,
        stripeSessionId: order.stripe_session_id,
        feeBruttoOre,
        feeMomsOre,
        feeNettoOre,
      } satisfies RevenueRow
    })
    .filter((r): r is RevenueRow => r !== null)

  rows.sort((a, b) => a.paidAt.localeCompare(b.paidAt))
  return rows
}

function csvEscape(value: string): string {
  if (/[",\n;]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function oreToKronorString(ore: number): string {
  return (ore / 100).toFixed(2)
}

function buildCsv(rows: RevenueRow[]): string {
  const header = [
    'datum',
    'order_id',
    'arrangor',
    'event',
    'plattformsavgift_brutto_ore',
    'plattformsavgift_moms_ore',
    'plattformsavgift_netto_ore',
    'stripe_session_id',
  ].join(',')

  const lines = rows.map((r) =>
    [
      r.paidAt,
      r.orderId,
      csvEscape(r.organizerName),
      csvEscape(r.eventTitle),
      String(r.feeBruttoOre),
      String(r.feeMomsOre),
      String(r.feeNettoOre),
      r.stripeSessionId ?? '',
    ].join(','),
  )

  return [header, ...lines].join('\n') + '\n'
}

function sieDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '')
}

function buildSie(rows: RevenueRow[]): string {
  const cfg = platformAccountConfig()

  // En verifikation per dag (samma princip som export-sales: dag +
  // betalsätt + momssats - här är momssatsen alltid 25%, konstant, så
  // grupperingen förenklas till bara dag).
  const groups = new Map<string, RevenueRow[]>()
  for (const row of rows) {
    const key = sieDate(row.paidAt)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const now = new Date()
  const genDate = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`

  const years = rows.map((r) => Number(sieDate(r.paidAt).slice(0, 4)))
  const minYear = years.length ? Math.min(...years) : now.getUTCFullYear()
  const maxYear = years.length ? Math.max(...years) : now.getUTCFullYear()

  const header = [
    '#FLAGGA 0',
    '#PROGRAM "ScenPass plattformsintakt" 1.0',
    '#FORMAT PC8',
    `#GEN ${genDate}`,
    '#SIETYP 4',
    '#FNAMN "Childproof AB"',
    `#RAR 0 ${minYear}0101 ${maxYear}1231`,
    `#KONTO ${cfg.clearing} "Avräkning Stripe (plattformsavgift)"`,
    `#KONTO ${cfg.revenue} "Plattformsintäkt (serviceavgift)"`,
    `#KONTO ${cfg.vat} "Utgående moms ${PLATFORM_FEE_VAT_RATE}%"`,
  ]

  const verifications: string[] = []
  let serial = 1
  for (const [date, groupRows] of groups) {
    const brutto = groupRows.reduce((sum, r) => sum + r.feeBruttoOre, 0)
    // Nollbeloppsgrupper hoppas över i SIE-läget (rent bokföringsbrus),
    // samma princip som export-sales - inte i CSV-läget.
    if (brutto === 0) continue

    const netto = groupRows.reduce((sum, r) => sum + r.feeNettoOre, 0)
    const moms = groupRows.reduce((sum, r) => sum + r.feeMomsOre, 0)

    const transLines = [`#TRANS ${cfg.clearing} {} ${oreToKronorString(brutto)}`]
    transLines.push(`#TRANS ${cfg.revenue} {} ${oreToKronorString(-netto)}`)
    if (moms > 0) {
      transLines.push(`#TRANS ${cfg.vat} {} ${oreToKronorString(-moms)}`)
    }

    verifications.push(
      [
        `#VER A ${serial} ${date} "Plattformsavgift ${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}"`,
        '{',
        ...transLines.map((l) => `  ${l}`),
        '}',
      ].join('\n'),
    )
    serial += 1
  }

  return [...header, '', ...verifications, ''].join('\n')
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req)
  if (preflight) return preflight

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Metoden stöds inte.' }, 405)
  }

  // Platform-admin-skyddat, INTE resolveOrganizer - detta körs tvärs
  // över alla arrangörer, det finns inget enskilt workspace att härleda
  // (se _shared/platformAdmin.ts, samma mönster som admin-list-
  // organizers). En vanlig arrangörs-admin (utan platform_admins-rad)
  // nekas alltid 403, oavsett headers/body - se DoD-punkt 9.
  const auth = await requirePlatformAdmin(req)
  if (!auth.ok) {
    return jsonResponse({ error: 'Ej behörig.' }, auth.status)
  }

  const url = new URL(req.url)
  const format = url.searchParams.get('format')
  const scope = url.searchParams.get('scope')

  if (format !== 'csv' && format !== 'sie') {
    return jsonResponse({ error: 'format måste vara "csv" eller "sie".' }, 400)
  }
  if (scope !== 'day' && scope !== 'range') {
    return jsonResponse({ error: 'scope måste vara "day" eller "range".' }, 400)
  }

  const supabase = createAdminClient()

  // orders är grunden här (INTE order_items - plattformsavgiften är en
  // order-nivå-snapshot, se filkommentaren ovan). Ingen organizer_id-
  // filtrering - avsiktligt tvärgående över ALLA arrangörer.
  let query = supabase
    .from('orders')
    .select(
      'id, paid_at, stripe_session_id, status, platform_fee_ore, platform_fee_vat_ore, events!inner(title, organizers(name))',
    )
    .eq('status', 'paid')

  if (scope === 'day') {
    const date = url.searchParams.get('date')
    if (!date || Number.isNaN(Date.parse(date))) {
      return jsonResponse({ error: 'date krävs (ÅÅÅÅ-MM-DD) för scope=day.' }, 400)
    }
    const start = `${date}T00:00:00.000Z`
    const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('paid_at', start).lt('paid_at', end)
  } else {
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      return jsonResponse({ error: 'from och to krävs (ÅÅÅÅ-MM-DD) för scope=range.' }, 400)
    }
    const start = `${from}T00:00:00.000Z`
    const end = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('paid_at', start).lt('paid_at', end)
  }

  const { data, error } = await query
  if (error) {
    return jsonResponse({ error: `Databasfel: ${error.message}` }, 500)
  }

  const rows = toRevenueRows((data ?? []) as unknown as OrderRow[])

  if (format === 'csv') {
    const csv = buildCsv(rows)
    const bom = new Uint8Array([0xef, 0xbb, 0xbf])
    const body = new Uint8Array([...bom, ...new TextEncoder().encode(csv)])
    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="plattformsintakt-${scope}.csv"`,
      },
    })
  }

  const sie = buildSie(rows)
  const body = encodeCp437(sie)
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="plattformsintakt-${scope}.se"`,
    },
  })
})
