// Lokal mock-server för docs/embed-test.html (ordern "Schemalagt
// biljettsläpp och inbäddningsbar widget", steg 2.6: "en lokal testsida
// mot en mockserver"). Rör INTE den riktiga databasen eller några
// hemligheter - serverar bara en handfull hårdkodade testevent i exakt
// samma JSON-form som supabase/functions/public-embed/index.ts, plus
// embed.js och testsidan själv som statiska filer, så att
// document.currentScript-baserad bas-URL och köplänkar fungerar mot en
// riktig lokal origin (inte bara file://).
//
// Kör med:
//   deno run --allow-net --allow-read scripts/embed-mock-server.ts
// och öppna http://localhost:8787/docs/embed-test.html
//
// "test-upcoming" har ett sales_open_at satt till NU+20s VID VARJE ANROP
// (inte hårdkodat) - så släppövergången (nedräkning -> ombegäran ->
// "Köp biljetter") går att observera inom en kort testsession, utan att
// vänta de 5 minuter som produktionsverifieringen använder.
const PORT = 8787

function minutesFromNow(min: number): string {
  return new Date(Date.now() + min * 60000).toISOString()
}

function secondsFromNow(sec: number): string {
  return new Date(Date.now() + sec * 1000).toISOString()
}

function buildEvents() {
  return [
    {
      slug: 'test-open',
      title: 'Vinterföreställningen (öppet köp)',
      organizer_name: 'Testarrangören',
      starts_at: minutesFromNow(60 * 24 * 10),
      venue: 'Dansscenen',
      from_price_ore: 15000,
      // Otillåten extern affisch - ska INTE renderas av widgeten
      // (ordern 2.1: "affischer visas bara om URL:en börjar med
      // projektets Storage-adress"). Verifieras visuellt i test-pass.
      poster_landscape_url: 'https://picsum.photos/seed/rideau/800/450',
      poster_portrait_url: 'https://picsum.photos/seed/rideau2/400/600',
      sales_open_at: null,
      sales_state: 'open',
    },
    {
      slug: 'test-upcoming',
      title: 'Julföreställningen (släpps snart)',
      organizer_name: 'Testarrangören',
      starts_at: minutesFromNow(60 * 24 * 20),
      venue: 'Dansscenen',
      from_price_ore: 20000,
      // Betrodd prefix (matchar isTrustedPosterUrl i embed.js) men pekar
      // inte på en riktig lagrad bild - ger en trasig bild-ikon lokalt,
      // vilket räcker för att verifiera att KODVÄGEN (rendera <img>)
      // faktiskt tas, utan att röra riktig Storage-data.
      poster_landscape_url: 'https://oyqgxnmwojjjpoubdlfa.supabase.co/storage/v1/object/public/posters/test-landscape.png',
      poster_portrait_url: 'https://oyqgxnmwojjjpoubdlfa.supabase.co/storage/v1/object/public/posters/test-portrait.png',
      sales_open_at: secondsFromNow(20),
      sales_state: 'upcoming',
    },
    {
      slug: 'test-soldout',
      title: 'Vårshowen (slutsåld)',
      organizer_name: 'Testarrangören',
      starts_at: minutesFromNow(60 * 24 * 30),
      venue: 'Aulan',
      from_price_ore: 18000,
      poster_landscape_url: null,
      poster_portrait_url: null,
      sales_open_at: null,
      sales_state: 'sold_out',
    },
    {
      slug: 'test-upcoming-long',
      title: 'Höstshowen (släpps om en vecka)',
      organizer_name: 'Testarrangören',
      starts_at: minutesFromNow(60 * 24 * 45),
      venue: 'Dansscenen',
      from_price_ore: 12000,
      poster_landscape_url: null,
      poster_portrait_url: null,
      sales_open_at: minutesFromNow(60 * 24 * 7),
      sales_state: 'upcoming',
    },
    // --- Innehållsvarianter (ordern "Widgeten ska fungera i smala vyer"
    // 2026-10-06, avsnitt 6: "normal titel, mycket lång titel, ett långt
    // ord ... lång plats, saknad affisch") ---
    {
      slug: 'test-long-title',
      title: 'En mycket lång titel som definitivt behöver radbrytas flera gånger för att få plats i en smal kolumn',
      organizer_name: 'Testarrangören',
      starts_at: minutesFromNow(60 * 24 * 12),
      venue: 'Dansscenen',
      from_price_ore: 15000,
      poster_landscape_url: null,
      poster_portrait_url: null,
      sales_open_at: null,
      sales_state: 'open',
    },
    {
      slug: 'test-long-word',
      title: 'Avslutningsföreställningen',
      organizer_name: 'Testarrangören',
      starts_at: minutesFromNow(60 * 24 * 13),
      venue: 'Dansscenen',
      from_price_ore: 15000,
      poster_landscape_url: null,
      poster_portrait_url: null,
      sales_open_at: null,
      sales_state: 'open',
    },
    {
      slug: 'test-long-venue',
      title: 'Vårshow för alla åldrar',
      organizer_name: 'Testarrangören',
      starts_at: minutesFromNow(60 * 24 * 14),
      venue: 'Sollentuna Dans- och Scenskolas stora aula vid Turebergstorg',
      from_price_ore: 15000,
      poster_landscape_url: null,
      poster_portrait_url: null,
      sales_open_at: null,
      sales_state: 'open',
    },
  ]
}

// 12 generiska event (ordern avsnitt 6: "fem event och tolv event") -
// hämtas via data-organizer="testmany" (alla 12) eller data-events med
// explicita slugs test-many-1..test-many-5 (fem). Alternerar
// öppet/slutsålt/släpps-snart så matrisen även träffar flera tillstånd
// samtidigt i en och samma rutnät/agenda-widget.
function buildManyEvents() {
  const states: Array<'open' | 'sold_out' | 'upcoming'> = ['open', 'sold_out', 'upcoming']
  return Array.from({ length: 12 }, (_, i) => {
    const n = i + 1
    const state = states[i % states.length]
    return {
      slug: `test-many-${n}`,
      title: `Föreställning ${n}`,
      organizer_name: 'Testarrangören',
      starts_at: minutesFromNow(60 * 24 * (5 + n)),
      venue: 'Dansscenen',
      from_price_ore: 10000 + n * 500,
      poster_landscape_url: null,
      poster_portrait_url: null,
      sales_open_at: state === 'upcoming' ? minutesFromNow(60 * 24 * 2) : null,
      sales_state: state,
    }
  })
}

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

async function serveStatic(path: string): Promise<Response> {
  const map: Record<string, { file: string; type: string }> = {
    '/docs/embed-test.html': { file: 'docs/embed-test.html', type: 'text/html; charset=utf-8' },
    '/embed.js': { file: 'public/embed.js', type: 'application/javascript; charset=utf-8' },
  }
  const entry = map[path]
  if (!entry) return new Response('Not found', { status: 404 })
  try {
    const content = await Deno.readTextFile(entry.file)
    return new Response(content, { headers: { 'Content-Type': entry.type } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

console.log(`Mock-server för embed-widgeten på http://localhost:${PORT}/docs/embed-test.html`)

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' } })
  }

  if (url.pathname === '/public-embed') {
    const events = buildEvents().concat(buildManyEvents())
    const organizer = url.searchParams.get('organizer')
    const eventsParam = url.searchParams.get('events')
    let selected = events
    if (organizer) {
      selected = organizer === 'testarrangor' ? buildEvents() : organizer === 'testmany' ? buildManyEvents() : []
    } else if (eventsParam) {
      const slugs = eventsParam.split(',').map((s) => s.trim())
      selected = events.filter((e) => slugs.indexOf(e.slug) !== -1)
    } else {
      selected = []
    }
    return corsJson({ events: selected, server_time: new Date().toISOString() })
  }

  if (url.pathname === '/docs/embed-test.html' || url.pathname === '/embed.js') {
    return serveStatic(url.pathname)
  }

  return new Response('Not found', { status: 404 })
})
