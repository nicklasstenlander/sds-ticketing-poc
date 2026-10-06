// Testmatris för embed.js i smala vyer (ordern "Widgeten ska fungera i
// smala vyer", 2026-10-06, avsnitt 6). Körs mot den lokala mockservern
// (scripts/embed-mock-server.ts) i riktiga webbläsare via Playwright.
//
// Kör:
//   node scripts/test-embed-matrix.mjs
//
// Startar mockservern själv (Deno), navigerar docs/embed-test.html i
// matris-läge (?layout=...&width=...&...) för varje kombination, mäter
// widgeten programmatiskt och sparar en skärmbild per kombination i
// OUT_DIR (utanför repot, committas aldrig).
import { chromium, firefox, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const BASE_URL = 'http://localhost:8787'
const OUT_DIR = process.env.RIDEAU_TEST_OUT || path.join('/tmp', 'rideau-embed-matrix')

const LAYOUTS = ['horizontal', 'portrait', 'landscape', 'button', 'showtimes', 'grid', 'agenda', 'banner']
const SINGLE_EVENT = new Set(['horizontal', 'portrait', 'landscape', 'button'])
const WIDTHS = [240, 280, 320, 360, 390, 430, 520, 768, 1100]
const SHOW_ALL = 'poster,date,place,price,organizer,countdown'

function multiMix(primarySlug) {
  return [primarySlug, 'test-upcoming', 'test-soldout'].join(',')
}

// --- Fallkatalog (ordern: "normal titel, mycket lång titel, ett långt
// ord ... lång plats, saknad affisch ... fem event och tolv event ...
// ljust och mörkt tema") ---
function caseParams(caseName, layout) {
  const multi = !SINGLE_EVENT.has(layout)
  switch (caseName) {
    case 'normal':
      return { events: multi ? multiMix('test-open') : 'test-open', show: SHOW_ALL }
    case 'long-title':
      return { events: multi ? multiMix('test-long-title') : 'test-long-title', show: SHOW_ALL }
    case 'long-word':
      return { events: multi ? multiMix('test-long-word') : 'test-long-word', show: SHOW_ALL }
    case 'long-venue':
      return { events: multi ? multiMix('test-long-venue') : 'test-long-venue', show: SHOW_ALL }
    case 'sold-out-no-poster':
      return { events: multi ? multiMix('test-soldout') : 'test-soldout', show: SHOW_ALL }
    case 'upcoming-no-countdown':
      return { events: multi ? multiMix('test-upcoming-long') : 'test-upcoming-long', show: 'poster,date,place,price' }
    case 'upcoming-with-countdown':
      return { events: multi ? multiMix('test-upcoming') : 'test-upcoming', show: SHOW_ALL }
    case 'dark':
      return { events: multi ? multiMix('test-open') : 'test-open', show: SHOW_ALL, theme: 'dark' }
    case 'five-events':
      return { events: 'test-many-1,test-many-2,test-many-3,test-many-4,test-many-5', show: SHOW_ALL }
    case 'twelve-events':
      return { organizer: 'testmany', show: SHOW_ALL }
    default:
      throw new Error('Okänt testfall: ' + caseName)
  }
}

const SINGLE_EVENT_CASES = [
  'normal',
  'long-title',
  'long-word',
  'long-venue',
  'sold-out-no-poster',
  'upcoming-no-countdown',
  'upcoming-with-countdown',
  'dark',
]
const MULTI_EVENT_CASES = [...SINGLE_EVENT_CASES, 'five-events', 'twelve-events']

function buildCombos() {
  const combos = []
  // 1) Breddsvep - alla 9 bredder, alla 8 layouter, "long-title"-stress
  // (den hårdaste texten), Chromium, ljust tema.
  for (const layout of LAYOUTS) {
    for (const width of WIDTHS) {
      combos.push({
        group: 'width-sweep',
        browser: 'chromium',
        layout,
        width,
        case: 'long-title',
        params: caseParams('long-title', layout),
      })
    }
  }
  // 2) Full fall-matris vid 320/390 - alla layouter, alla tillämpliga
  // fall, Chromium. Detta är underlaget för kontaktbladen.
  for (const layout of LAYOUTS) {
    const cases = SINGLE_EVENT.has(layout) ? SINGLE_EVENT_CASES : MULTI_EVENT_CASES
    for (const width of [320, 390]) {
      for (const c of cases) {
        combos.push({ group: 'case-matrix', browser: 'chromium', layout, width, case: c, params: caseParams(c, layout) })
      }
    }
  }
  // 3) Stickprov i Firefox/WebKit - 320/390, alla layouter, "normal".
  for (const browser of ['firefox', 'webkit']) {
    for (const layout of LAYOUTS) {
      for (const width of [320, 390]) {
        combos.push({ group: 'cross-browser', browser, layout, width, case: 'normal', params: caseParams('normal', layout) })
      }
    }
  }
  return combos
}

function comboId(c) {
  return `${c.group}_${c.browser}_${c.layout}_${c.width}_${c.case}`
}

function comboUrl(c) {
  const qs = new URLSearchParams({ layout: c.layout, width: String(c.width), ...c.params })
  return `${BASE_URL}/docs/embed-test.html?${qs.toString()}`
}

// --- Automatiska kontroller (ordern avsnitt 6, de fyra punkterna) ---
async function measureCombo(page) {
  return page.evaluate(() => {
    const host = document.getElementById('matrix-host')
    const widgetEl = host.querySelector('.rideau-widget')
    const root = widgetEl && widgetEl.shadowRoot
    const issues = []

    // 1) Ingen sidledes överflödning.
    if (host.scrollWidth > host.clientWidth + 1) {
      issues.push(`host scrollWidth(${host.scrollWidth}) > clientWidth(${host.clientWidth})`)
    }
    if (widgetEl.scrollWidth > widgetEl.clientWidth + 1) {
      issues.push(`widget scrollWidth(${widgetEl.scrollWidth}) > clientWidth(${widgetEl.clientWidth})`)
    }

    if (!root) {
      issues.push('ingen shadowRoot hittad (widgeten monterades aldrig)')
      return { issues, buttonCount: 0, textBoxCount: 0 }
    }

    // 2) Ingen lodrät bokstavsstapel - ingen textbärande ruta smalare än
    // 80px (eller sitt längsta ord, om kortare) medan den är högre än
    // tre radhöjder.
    const allEls = root.querySelectorAll('*')
    let textBoxCount = 0
    allEls.forEach((el) => {
      const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
      if (!hasOwnText) return
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      textBoxCount++
      const cs = getComputedStyle(el)
      const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3
      const words = el.textContent.trim().split(/\s+/)
      const longestWord = words.reduce((a, b) => (b.length > a.length ? b : a), '')
      // Grov uppskattning av det längsta ordets bredd (0.6em/tecken) -
      // räcker för att skilja "ett enda tecken per rad" (den faktiska
      // buggen) från en legitimt smal ruta med ett kort ord.
      const approxWordWidth = longestWord.length * parseFloat(cs.fontSize) * 0.55
      const minAcceptable = Math.min(80, approxWordWidth || 80)
      if (rect.height > lineHeight * 3 && rect.width < minAcceptable) {
        issues.push(
          `textruta för smal: "${el.textContent.trim().slice(0, 30)}" bredd=${Math.round(rect.width)}px höjd=${Math.round(rect.height)}px (${Math.round(rect.height / lineHeight)} radhöjder), gräns=${Math.round(minAcceptable)}px`,
        )
      }
    })

    // 3) Knappar/chips minst 44px höga.
    const interactive = root.querySelectorAll('.rw-btn, .rw-chip')
    let buttonCount = 0
    interactive.forEach((el) => {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return // osynlig (t.ex. inte aktuellt tillstånd)
      buttonCount++
      if (rect.height < 43.5) {
        issues.push(`för låg (${Math.round(rect.height)}px < 44px): "${el.textContent.trim().slice(0, 30)}"`)
      }
    })

    // 4) Texten överlappar inte - inga text-/knapprutor skär varandra.
    const boxes = []
    root.querySelectorAll('.rw-title, .rw-row, .rw-muted, .rw-chip, .rw-btn, .rw-price, .rw-countdown-line').forEach((el) => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) boxes.push({ el, rect })
    })
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].rect
        const b = boxes[j].rect
        // Hoppa över par där det ena innehåller det andra (förälder/barn,
        // t.ex. .rw-chip runt sin egen text) - bara SYSKON som skär
        // varandra är en bugg.
        if (boxes[i].el.contains(boxes[j].el) || boxes[j].el.contains(boxes[i].el)) continue
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (overlapX > 2 && overlapY > 2) {
          issues.push(
            `överlapp: "${boxes[i].el.textContent.trim().slice(0, 20)}" och "${boxes[j].el.textContent.trim().slice(0, 20)}"`,
          )
        }
      }
    }

    return { issues, buttonCount, textBoxCount }
  })
}

async function runBrowser(engine, combos, results) {
  const launcher = { chromium, firefox, webkit }[engine]
  const browser = await launcher.launch()
  const page = await browser.newPage()
  for (const combo of combos) {
    const id = comboId(combo)
    try {
      await page.setViewportSize({ width: Math.max(combo.width + 64, 300), height: 900 })
      await page.goto(comboUrl(combo), { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('body[data-test-ready]', { timeout: 5000 })
      await page.waitForTimeout(80) // sista layout-/fontstabilisering
      const measurement = await measureCombo(page)
      const shotPath = path.join(OUT_DIR, 'shots', `${id}.png`)
      const host = page.locator('#matrix-host')
      await host.screenshot({ path: shotPath })
      results.push({ id, combo, ok: measurement.issues.length === 0, ...measurement, shotPath })
      console.log(`${measurement.issues.length === 0 ? 'OK  ' : 'FAIL'} ${id}`)
      if (measurement.issues.length > 0) {
        for (const issue of measurement.issues) console.log('       - ' + issue)
      }
    } catch (err) {
      results.push({ id, combo, ok: false, issues: ['undantag: ' + (err && err.message)], shotPath: null })
      console.log(`FAIL ${id}  (undantag: ${err && err.message})`)
    }
  }
  await browser.close()
}

async function buildContactSheet(width, results, outPath) {
  const items = results.filter((r) => r.combo.width === width && r.combo.group === 'case-matrix' && r.shotPath)
  const imgs = items
    .map(
      (r) => `
    <figure style="margin:0;border:2px solid ${r.ok ? '#2f8f5b' : '#dc2626'};border-radius:8px;padding:8px;background:#fff">
      <figcaption style="font:600 12px monospace;margin-bottom:6px;color:#171717">${r.combo.layout} / ${r.combo.case} ${r.ok ? '✓' : '✗ (' + r.issues.length + ')'}</figcaption>
      <img src="file://${r.shotPath}" style="max-width:360px;display:block" />
    </figure>`,
    )
    .join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Kontaktblad ${width}px</title></head>
<body style="margin:0;padding:20px;background:#EAEEF2;font-family:system-ui">
<h1 style="font-size:18px">Kontaktblad - ${width}px (${items.length} kombinationer, ${items.filter((r) => !r.ok).length} fallerade)</h1>
<div style="display:flex;flex-wrap:wrap;gap:16px">${imgs}</div>
</body></html>`
  const htmlPath = path.join(OUT_DIR, `contact-sheet-${width}.html`)
  await writeFile(htmlPath, html, 'utf-8')

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
  await page.goto('file://' + htmlPath)
  await page.waitForTimeout(200)
  await page.screenshot({ path: outPath, fullPage: true })
  await browser.close()
  console.log(`Kontaktblad sparat: ${outPath}`)
}

async function main() {
  await mkdir(path.join(OUT_DIR, 'shots'), { recursive: true })

  console.log('Startar mockservern...')
  const server = spawn('deno', ['run', '--allow-net', '--allow-read', 'scripts/embed-mock-server.ts'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  await new Promise((resolve) => setTimeout(resolve, 1200))

  try {
    const combos = buildCombos()
    const byBrowser = { chromium: [], firefox: [], webkit: [] }
    for (const c of combos) byBrowser[c.browser].push(c)

    const results = []
    for (const engine of ['chromium', 'firefox', 'webkit']) {
      if (byBrowser[engine].length === 0) continue
      console.log(`\n=== ${engine}: ${byBrowser[engine].length} kombinationer ===`)
      await runBrowser(engine, byBrowser[engine], results)
    }

    const failed = results.filter((r) => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} kombinationer godkända.`)
    if (failed.length > 0) {
      console.log('\nFallerade kombinationer:')
      for (const r of failed) console.log('  ' + r.id)
    }

    await writeFile(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2), 'utf-8')

    console.log('\nBygger kontaktblad för 320 och 390px...')
    await buildContactSheet(320, results, path.join(OUT_DIR, 'contact-sheet-320.png'))
    await buildContactSheet(390, results, path.join(OUT_DIR, 'contact-sheet-390.png'))

    console.log(`\nAllt sparat i ${OUT_DIR} (committas inte).`)
    if (failed.length > 0) process.exitCode = 1
  } finally {
    server.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
