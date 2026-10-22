// Webbläsartest för /evenemang (ordern "Klickbara föreställningar på
// /evenemang", 2026-10-22): klick på en ruta byter stor föreställning,
// gruppering, okänd slug, null-datum och bakåtknappen. Körs mot Vites
// dev-server i Chromium via Playwright; Supabase mockas med page.route, så
// testet når aldrig den riktiga databasen (VITE_SUPABASE_URL pekar på en
// påhittad värd och allt som inte är localhost avbryts).
//
// Kör:
//   node scripts/test-events-page.mjs
//
// Skärmbilder (telefon och desktop) sparas i OUT_DIR (utanför repot,
// committas aldrig).
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const PORT = 5199
const BASE_URL = `http://localhost:${PORT}/`
const MOCK_SUPABASE = 'http://supabase.mock.invalid'
const OUT_DIR = process.env.RIDEAU_TEST_OUT || path.join('/tmp', 'rideau-events-page')

const ticket = (price_ore) => [{ id: `tt-${price_ore}`, name: 'Ordinarie', price_ore }]
function event(slug, title, starts_at, extra = {}) {
  return {
    id: slug,
    slug,
    title,
    venue: 'Sollentuna Kulturscen',
    starts_at,
    status: 'published',
    created_at: '2026-09-01T00:00:00Z',
    sales_open_at: null,
    capacity: 100,
    sold_count: 0,
    poster_landscape_url: null,
    poster_portrait_url: null,
    ticket_types: ticket(15000),
    organizers: { name: 'Sollentuna Dans & Scenskola', slug: 'sds' },
    ...extra,
  }
}
// Affischer som data-URI:er (inga nätverksanrop). Färgerna skiljer formaten åt.
const svgPoster = (w, h, fill) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${fill}"/></svg>`)}`
const LANDSCAPE = svgPoster(1600, 900, '#c0392b')
const PORTRAIT = svgPoster(900, 1350, '#2980b9')
const EVENTS = [
  event('atw-1000', 'Around the World', '2026-12-05T09:00:00Z'),
  event('atw-1300', 'Around the World', '2026-12-05T12:00:00Z'),
  event('atw-1600', 'Around the World', '2026-12-06T15:00:00Z'),
  event('color-me', 'COLOR ME', '2026-12-12T17:00:00Z', {
    sales_open_at: '2026-11-02T08:00:00Z',
    poster_landscape_url: LANDSCAPE,
    poster_portrait_url: PORTRAIT,
  }),
  event('julshow', 'Julshow', '2026-12-19T16:00:00Z', { ticket_types: ticket(0) }),
  event('workshop', 'Workshop', null),
]

let failures = 0
function check(ok, label, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!ok) failures++
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE_URL)).ok) return
    } catch {
      // inte uppe än
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('Vite startade inte')
}

const vite = spawn(path.join(REPO_ROOT, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
  cwd: REPO_ROOT,
  env: { ...process.env, VITE_SUPABASE_URL: MOCK_SUPABASE, VITE_SUPABASE_ANON_KEY: 'mock-anon-key' },
  stdio: 'ignore',
})

const browser = await chromium.launch()
try {
  await waitForServer()
  await mkdir(OUT_DIR, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith(MOCK_SUPABASE)) {
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(EVENTS) })
    }
    if (url.startsWith(`http://localhost:${PORT}`)) return route.continue()
    return route.abort()
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))

  // Riktigt musklick mitt på ett element. locator.click() vägrar här, eftersom
  // titellänken MEDVETET ligger ovanpå affisch och datum (.show-tile-link::after).
  const mouseClick = async (locator) => {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  }
  const featureTitle = () => page.locator('.feature-title').innerText()
  // Väntar in Reacts omrendering efter en navigering (URL:en byts före den).
  const featureIs = (title) =>
    page
      .waitForFunction((t) => document.querySelector('.feature-title')?.textContent === t, title, { timeout: 5000 })
      .then(() => true, () => false)
  const tileTitles = () => page.locator('.show-tile .show-title').allInnerTexts()

  // 1. Utan slug: samma som idag (första föreställningen stort).
  await page.goto(`${BASE_URL}#/evenemang`)
  await page.locator('.feature-title').waitFor()
  check(await featureIs('Around the World'), 'utan slug: Around the World stort')
  check((await page.locator('.feature .time-chip').count()) === 3, 'gruppering: Around the World har alla tre tider i en presentation')
  check(
    JSON.stringify(await tileTitles()) === JSON.stringify(['COLOR ME', 'Julshow', 'Workshop']),
    'Fler föreställningar utan den stora',
    JSON.stringify(await tileTitles()),
  )
  check(
    (await page.locator('.show-tile', { hasText: 'Workshop' }).innerText()).includes('Datum saknas'),
    'null-datum: rutan visas med "Datum saknas" utan krasch',
  )
  const link = page.locator('.show-tile-link', { hasText: 'COLOR ME' })
  check((await link.evaluate((a) => a.tagName)) === 'A', 'rutan är en riktig <a>')
  check((await link.getAttribute('href')) === '#/evenemang/color-me', 'länken pekar på /#/evenemang/color-me', await link.getAttribute('href'))

  // Ruta på bred skärm (flera kolumner): stående affisch i 2:3-ram.
  const colorPoster = page.locator('.show-tile', { hasText: 'COLOR ME' }).locator('.poster')
  const tilePoster = () =>
    colorPoster.evaluate((frame) => {
      const { width, height } = frame.getBoundingClientRect()
      return { src: frame.querySelector('img')?.currentSrc, ratio: Math.round((width / height) * 100) / 100 }
    })
  let tp = await tilePoster()
  check(tp.src === PORTRAIT && tp.ratio === 0.67, 'desktop: ruta visar stående affisch i 2:3', `ratio ${tp.ratio}`)

  await page.screenshot({ path: path.join(OUT_DIR, 'desktop-1280.png'), fullPage: true })

  // 2. Klick på AFFISCHEN (inte titeln) byter vy, scrollar upp.
  const colorTile = page.locator('.show-tile', { hasText: 'COLOR ME' })
  await colorTile.scrollIntoViewIfNeeded()
  check((await page.evaluate(() => window.scrollY)) > 0, 'förutsättning: sidan är nedscrollad')
  await mouseClick(colorTile.locator('.poster'))
  await page.waitForURL('**/#/evenemang/color-me')
  check(await featureIs('COLOR ME'), 'klick på affisch: COLOR ME stort')
  check(await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 }).then(() => true, () => false), 'klick: scrollat till toppen')
  check(
    JSON.stringify(await tileTitles()) === JSON.stringify(['Around the World', 'Julshow', 'Workshop']),
    'tidigare stora ligger i listan, utan dubbletter',
    JSON.stringify(await tileTitles()),
  )
  check((await page.locator('.feature .sales-notice').count()) === 1, 'släppinfo visas för COLOR ME')
  check(
    await page.evaluate(() => document.activeElement?.classList.contains('feature-title') ?? false),
    'fokus flyttas till den stora rubriken',
  )

  // 3. Bakåtknappen tillbaka till utgångsläget.
  await page.goBack()
  await page.waitForURL((u) => u.hash === '#/evenemang')
  check(await featureIs('Around the World'), 'bakåt: Around the World stort igen')
  await page.goForward()
  await page.waitForURL('**/#/evenemang/color-me')
  check(await featureIs('COLOR ME'), 'framåt: COLOR ME stort igen')

  // 4. Klick på datum i en ruta och på titeln via tangentbord.
  await mouseClick(page.locator('.show-tile', { hasText: 'Julshow' }).locator('.show-date'))
  await page.waitForURL('**/#/evenemang/julshow')
  check(await featureIs('Julshow'), 'klick på datum: Julshow stort')
  await page.locator('.show-tile-link', { hasText: 'Around the World' }).focus()
  await page.keyboard.press('Enter')
  await page.waitForURL('**/#/evenemang/atw-1000')
  check(await featureIs('Around the World'), 'tangentbord (Enter): Around the World stort')

  // 5. Länk till en senare tid i gruppen ger ändå hela gruppen.
  await page.goto(`${BASE_URL}#/evenemang/atw-1300`)
  await page.locator('.feature-title').waitFor()
  check(
    (await featureTitle()) === 'Around the World' && (await page.locator('.feature .time-chip').count()) === 3,
    'slug atw-1300: hela Around the World med alla tider',
  )

  // 6. Okänd slug: listan som vanligt plus en notis.
  await page.goto(`${BASE_URL}#/evenemang/finns-inte`)
  await page.locator('.feature-title').waitFor()
  check(await featureIs('Around the World'), 'okänd slug: standardvyn visas')
  check((await page.getByRole('status').innerText()).includes('hittade inte'), 'okänd slug: notis visas')

  // 7. Speltiderna i en ruta går fortfarande direkt till köp, inte till detaljvyn.
  await page.goto(`${BASE_URL}#/evenemang`)
  await page.locator('.show-tile', { hasText: 'Julshow' }).locator('a.time-chip').click()
  await page.waitForURL('**/#/kop/julshow')
  check(true, 'speltid i ruta leder till /#/kop/julshow')

  // 8. Telefonbredd.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${BASE_URL}#/evenemang`)
  await page.locator('.feature-title').waitFor()
  await colorPoster.scrollIntoViewIfNeeded()
  tp = await tilePoster()
  check(tp.src === LANDSCAPE && tp.ratio === 1.78, 'telefon: ruta visar liggande affisch i 16:9', `ratio ${tp.ratio}`)
  await page.screenshot({ path: path.join(OUT_DIR, 'phone-390-lista.png'), fullPage: true })
  await page.goto(`${BASE_URL}#/evenemang/color-me`)
  await page.locator('.feature-title').waitFor()
  check((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'telefon: ingen horisontell scroll')
  await page.screenshot({ path: path.join(OUT_DIR, 'phone-390.png'), fullPage: true })

  check(pageErrors.length === 0, 'inga JavaScript-fel på sidan', pageErrors.join(' | '))
  console.log(`\nSkärmbilder: ${OUT_DIR}`)
} finally {
  await browser.close()
  vite.kill()
}

if (failures > 0) {
  console.error(`\n${failures} kontroll(er) misslyckades`)
  process.exit(1)
}
console.log('\nAlla kontroller OK')
