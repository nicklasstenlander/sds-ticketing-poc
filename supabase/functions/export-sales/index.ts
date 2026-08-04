// export-sales
//
// Admin-skyddad exportfunktion (CSV och SIE4) för bokföring. Läser ENDAST
// betalda ordrar (status = 'paid') och använder alltid ordrens egen
// pris/moms-ögonblicksbild (orders.price_ore / orders.vat_rate) - ALDRIG
// eventets nuvarande värden. Detta är avgörande: ändras ett events
// momssats i efterhand ska redan exporterade/bokförda ordrar förbli
// oförändrade vid en ny export (se migrationskommentaren i
// 20260101000300_stripe_vat_export.sql och Definition of Done punkt 10 i
// Tilläggsordern).
//
// GET export-sales?format=csv&scope=day&date=2026-01-12
// GET export-sales?format=csv&scope=range&from=2026-01-01&to=2026-01-31
// GET export-sales?format=csv&scope=event&event_id=<uuid>
// GET export-sales?format=sie&scope=...   (samma tre lägen)
//
// OBS - datumtolkning: "day"/"range" filtrerar på orders.paid_at jämfört
// mot UTC-midnatt för angivet datum (inte svensk lokal tid). För en PoC med
// låg volym och manuell, sällan körd export är detta en medveten
// förenkling - flagga för användaren i README om exakta dygnsgränser i
// svensk tid blir viktigt senare.
//
// VIKTIGT - SIE-filen: strukturellt korrekt enligt SIE4-skelettet i
// Tilläggsordern, men den FÖRSTA riktiga filen bör granskas av en
// redovisningskonsult innan den importeras skarpt i Fortnox. Se README.md.
import { handleOptions, corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { bearerTokenFrom, verifyAdminToken } from '../_shared/adminToken.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { encodeCp437 } from '../_shared/cp437.ts'

interface PaidOrderRow {
  id: string
  event_id: string
  qty: number
  price_ore: number
  vat_rate: number
  paid_at: string
  stripe_session_id: string | null
  events: { title: string } | { title: string }[] | null
}

interface SaleRow {
  orderId: string
  eventTitle: string
  qty: number
  priceOre: number
  vatRate: number
  paidAt: string
  stripeSessionId: string | null
  bruttoOre: number
  momsOre: number
  nettoOre: number
}

// Konfigurerbar kontoplansmappning för SIE-exporten - INTE hårdkodad i
// bokföringslogiken. Sätts som Supabase secrets/env-variabler om Moon
// Movements riktiga kontoplan skiljer sig från default-värdena nedan (som
// är exempel från Tilläggsordern, inte bekräftade riktiga konton).
function accountConfig() {
  return {
    receivable: Deno.env.get('SIE_ACCOUNT_RECEIVABLE') ?? '1580',
    revenue: Deno.env.get('SIE_ACCOUNT_REVENUE') ?? '3041',
    vat: {
      6: Deno.env.get('SIE_ACCOUNT_VAT_6') ?? '2631',
      12: Deno.env.get('SIE_ACCOUNT_VAT_12') ?? '2621',
      25: Deno.env.get('SIE_ACCOUNT_VAT_25') ?? '2611',
      0: Deno.env.get('SIE_ACCOUNT_VAT_0') ?? '',
    } as Record<number, string>,
  }
}

function eventTitleOf(row: PaidOrderRow): string {
  const rel = row.events
  if (Array.isArray(rel)) return rel[0]?.title ?? 'Okänt event'
  return rel?.title ?? 'Okänt event'
}

// Moms beräknas ur bruttobeloppet (priset kunden faktiskt betalade
// inkluderar moms, precis som Stripe Checkout-priset i create-order gör) -
// inte lagt ovanpå ett nettopris. netto = brutto / (1 + vat/100).
function calcAmounts(bruttoOre: number, vatRate: number) {
  if (vatRate === 0) return { momsOre: 0, nettoOre: bruttoOre }
  const nettoOre = Math.round(bruttoOre / (1 + vatRate / 100))
  const momsOre = bruttoOre - nettoOre
  return { momsOre, nettoOre }
}

function toSaleRows(orders: PaidOrderRow[]): SaleRow[] {
  return orders.map((o) => {
    const bruttoOre = o.price_ore * o.qty
    const { momsOre, nettoOre } = calcAmounts(bruttoOre, o.vat_rate)
    return {
      orderId: o.id,
      eventTitle: eventTitleOf(o),
      qty: o.qty,
      priceOre: o.price_ore,
      vatRate: o.vat_rate,
      paidAt: o.paid_at,
      stripeSessionId: o.stripe_session_id,
      bruttoOre,
      momsOre,
      nettoOre,
    }
  })
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

function buildCsv(rows: SaleRow[]): string {
  const header = [
    'datum',
    'order_id',
    'event',
    'antal',
    'brutto_ore',
    'moms_ore',
    'netto_ore',
    'momssats',
    'betalsatt',
    'stripe_session_id',
  ].join(',')

  const lines = rows.map((r) =>
    [
      r.paidAt,
      r.orderId,
      csvEscape(r.eventTitle),
      String(r.qty),
      String(r.bruttoOre),
      String(r.momsOre),
      String(r.nettoOre),
      `${r.vatRate}%`,
      'Kort (Stripe)',
      r.stripeSessionId ?? '',
    ].join(','),
  )

  return [header, ...lines].join('\n') + '\n'
}

function sieDate(iso: string): string {
  // SIE-datum: ÅÅÅÅMMDD, ingen tid, inget bindestreck.
  return iso.slice(0, 10).replace(/-/g, '')
}

function buildSie(rows: SaleRow[]): string {
  const cfg = accountConfig()

  // En verifikation per (dag, betalsätt, momssats) - betalsätt är alltid
  // "Kort (Stripe)" i denna PoC (ingen annan betalmetod stöds ännu, se
  // Tilläggsordern avsnitt 9), men grupperingen är förberedd för fler
  // betalsätt senare utan att verifikationslogiken behöver ändras.
  const groups = new Map<string, SaleRow[]>()
  for (const row of rows) {
    const key = `${sieDate(row.paidAt)}|Stripe|${row.vatRate}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const usedVatRates = new Set(rows.map((r) => r.vatRate))
  const accountLines: string[] = [
    `#KONTO ${cfg.receivable} "Avräkning Stripe"`,
    `#KONTO ${cfg.revenue} "Biljettintäkter"`,
  ]
  for (const vatRate of usedVatRates) {
    if (vatRate === 0) continue
    const acct = cfg.vat[vatRate]
    if (acct) accountLines.push(`#KONTO ${acct} "Utgående moms ${vatRate}%"`)
  }

  const now = new Date()
  const genDate = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`

  const years = rows.map((r) => Number(sieDate(r.paidAt).slice(0, 4)))
  const minYear = years.length ? Math.min(...years) : now.getUTCFullYear()
  const maxYear = years.length ? Math.max(...years) : now.getUTCFullYear()

  const header = [
    '#FLAGGA 0',
    '#PROGRAM "SDS Biljetter" 1.0',
    '#FORMAT PC8',
    `#GEN ${genDate}`,
    '#SIETYP 4',
    '#FNAMN "Moon Movements AB"',
    `#RAR 0 ${minYear}0101 ${maxYear}1231`,
    ...accountLines,
  ]

  const verifications: string[] = []
  let serial = 1
  for (const [key, groupRows] of groups) {
    const [date] = key.split('|')
    const brutto = groupRows.reduce((sum, r) => sum + r.bruttoOre, 0)

    // Nollbeloppsgrupper (t.ex. ett gratis testköp, price_ore = 0) ger en
    // helt tom verifikation - balanserar tekniskt (0 = 0), men är bara
    // brus i bokföringen. Hoppa över den gruppen helt i SIE-läget. Gäller
    // INTE CSV-exporten (se buildCsv) - där är nollbelopps-ordrar en
    // informativ rad, inte en bokföringspost som måste balansera.
    if (brutto === 0) continue

    const netto = groupRows.reduce((sum, r) => sum + r.nettoOre, 0)
    const moms = groupRows.reduce((sum, r) => sum + r.momsOre, 0)
    const vatRate = groupRows[0].vatRate
    const vatAccount = cfg.vat[vatRate]

    const transLines = [`#TRANS ${cfg.receivable} {} ${oreToKronorString(brutto)}`]
    transLines.push(`#TRANS ${cfg.revenue} {} ${oreToKronorString(-netto)}`)
    if (moms > 0) {
      if (!vatAccount) {
        console.warn(`Inget konto konfigurerat för momssats ${vatRate}% - momsraden utelämnas ur SIE-filen.`)
      } else {
        transLines.push(`#TRANS ${vatAccount} {} ${oreToKronorString(-moms)}`)
      }
    }

    verifications.push(
      [
        `#VER A ${serial} ${date} "Biljettförsäljning ${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}"`,
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

  const adminPin = Deno.env.get('ADMIN_PIN')
  if (!adminPin) {
    return jsonResponse({ error: 'ADMIN_PIN är inte konfigurerad på servern.' }, 500)
  }

  const token = bearerTokenFrom(req)
  if (!(await verifyAdminToken(adminPin, token))) {
    return jsonResponse({ error: 'Ej behörig. Logga in i admin igen.' }, 401)
  }

  const url = new URL(req.url)
  const format = url.searchParams.get('format')
  const scope = url.searchParams.get('scope')

  if (format !== 'csv' && format !== 'sie') {
    return jsonResponse({ error: 'format måste vara "csv" eller "sie".' }, 400)
  }
  if (scope !== 'day' && scope !== 'range' && scope !== 'event') {
    return jsonResponse({ error: 'scope måste vara "day", "range" eller "event".' }, 400)
  }

  const supabase = createAdminClient()

  let query = supabase
    .from('orders')
    .select('id, event_id, qty, price_ore, vat_rate, paid_at, stripe_session_id, events(title)')
    .eq('status', 'paid')
    .order('paid_at', { ascending: true })

  if (scope === 'day') {
    const date = url.searchParams.get('date')
    if (!date || Number.isNaN(Date.parse(date))) {
      return jsonResponse({ error: 'date krävs (ÅÅÅÅ-MM-DD) för scope=day.' }, 400)
    }
    const start = `${date}T00:00:00.000Z`
    const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('paid_at', start).lt('paid_at', end)
  } else if (scope === 'range') {
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      return jsonResponse({ error: 'from och to krävs (ÅÅÅÅ-MM-DD) för scope=range.' }, 400)
    }
    const start = `${from}T00:00:00.000Z`
    const end = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('paid_at', start).lt('paid_at', end)
  } else {
    const eventId = url.searchParams.get('event_id')
    if (!eventId) {
      return jsonResponse({ error: 'event_id krävs för scope=event.' }, 400)
    }
    query = query.eq('event_id', eventId)
  }

  const { data, error } = await query
  if (error) {
    return jsonResponse({ error: `Databasfel: ${error.message}` }, 500)
  }

  const rows = toSaleRows((data ?? []) as PaidOrderRow[])

  if (format === 'csv') {
    const csv = buildCsv(rows)
    // UTF-8 med BOM så att Excel (som annars gissar Windows-1252) tolkar
    // åäö rätt vid dubbelklick-öppning.
    const bom = new Uint8Array([0xef, 0xbb, 0xbf])
    const body = new Uint8Array([...bom, ...new TextEncoder().encode(csv)])
    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="forsaljning-${scope}.csv"`,
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
      'Content-Disposition': `attachment; filename="forsaljning-${scope}.se"`,
    },
  })
})
