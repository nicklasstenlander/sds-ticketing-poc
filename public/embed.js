/*!
 * Rideau embed.js - inbäddningsbar biljettwidget.
 *
 * Ordern "Schemalagt biljettsläpp och inbäddningsbar widget med
 * kodgenerator" (2026-10-03), steg 2. Fristående vanilla-JS, INGA
 * beroenden, tänkt att klistras in (via Generator-sidan i admin) på t.ex.
 * en Squarespace-sida:
 *
 *   <div class="rideau-widget" data-layout="grid" data-events="slug1,slug2"
 *        data-show="poster,date,place,price,countdown" data-theme="light"
 *        data-accent="midnatt"></div>
 *   <script async src="https://din-sida.se/embed.js"></script>
 *
 * Bakåtkompatibilitet: detta skript klistras in på ANDRA MÄNNISKORS sidor.
 * Befintliga data-attribut byter ALDRIG betydelse i en senare version -
 * bara nya, valfria attribut/värden får läggas till. En gammal
 * inklistrad kodsnutt ska fortsätta fungera oförändrat för alltid.
 *
 * Designprinciper (se ordern 2.1 för fullständig motivering):
 *  - Shadow DOM, så värdsidans CSS aldrig läcker in och vice versa.
 *  - Basadressen för köplänkar härleds ur SKRIPTETS EGEN src
 *    (document.currentScript) - fungerar oförändrat den dagen appen
 *    flyttar till en egen subdomän, ingen hårdkodad adress här.
 *  - Inga cookies, ingen spårning, ingen localStorage. Enda externa
 *    anrop: public-embed och affischbilder.
 *  - XSS-säkert: all DOM byggs med createElement/textContent, aldrig
 *    innerHTML med data utifrån. Länkar pekar bara på appens egen adress.
 */
(function () {
  'use strict'

  // Körs EN gång, synkront, medan detta skript (laddat med async) faktiskt
  // exekverar - document.currentScript är null i senare callbacks
  // (MutationObserver, setTimeout), så värdet måste sparas direkt här.
  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || ''
  var APP_BASE = SCRIPT_SRC.replace(/\/[^/]*$/, '') || ''

  // Konstant i bygget (inte hämtad från data-api) - se filkommentaren i
  // supabase/functions/public-embed/index.ts för samma projekt-URL.
  // Projekt-ref:et är inte en hemlighet (samma publika form som
  // VITE_SUPABASE_URL i appens egen .env.example, redan synlig för vem
  // som helst som öppnar nätverksfliken på den publika sidan).
  var DEFAULT_API_BASE = 'https://oyqgxnmwojjjpoubdlfa.supabase.co/functions/v1'

  var VALID_LAYOUTS = ['horizontal', 'portrait', 'landscape', 'button', 'showtimes', 'grid', 'agenda', 'banner']
  var SINGLE_EVENT_LAYOUTS = ['horizontal', 'portrait', 'landscape', 'button']
  var ROW_LAYOUTS = ['showtimes', 'agenda']
  var VALID_SHOW = ['poster', 'date', 'place', 'price', 'organizer', 'countdown']
  var ACCENTS = { midnatt: '#243B53', skymning: '#5A3E9B', rampljus: '#F6B93B' }

  var BACKGROUND_REFRESH_MS = 5 * 60 * 1000
  var RELEASE_POLL_INTERVAL_MS = 5000
  var RELEASE_POLL_MAX_MS = 60000

  // ---- Hjälpfunktioner: DOM-byggande (aldrig innerHTML med data) ----

  function el(tag, attrs, children) {
    var node = document.createElement(tag)
    if (attrs) {
      for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue
        var value = attrs[key]
        if (value === null || value === undefined) continue
        if (key === 'className') node.className = value
        else if (key === 'text') node.textContent = value
        else if (key === 'style') node.style.cssText = value
        else if (key.indexOf('aria-') === 0 || key.indexOf('data-') === 0) node.setAttribute(key, value)
        else node[key] = value
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        var child = children[i]
        if (child) node.appendChild(child)
      }
    }
    return node
  }

  function svgIcon(pathD, size) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', String(size || 18))
    svg.setAttribute('height', String(size || 18))
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.8')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.flex = 'none'
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', pathD)
    svg.appendChild(path)
    return svg
  }

  var ICON_CALENDAR = 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4'
  var ICON_PIN = 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'

  // ---- Tid/datum: Europe/Stockholm, oavsett besökarens egen tidszon ----

  function pad2(n) {
    return n < 10 ? '0' + n : String(n)
  }

  // "14 okt kl. 10:00" - Intl:s 'sv-SE' korta månadsförkortning har en
  // punkt ("okt.") som mockarna inte har, strippas här (samma fix som
  // src/lib/stockholmTime.ts formatStockholmDateTime).
  function formatStockholmDateTime(iso) {
    var d = new Date(iso)
    var datePart = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Stockholm',
      day: 'numeric',
      month: 'short',
    })
      .format(d)
      .replace(/\.$/, '')
    var timePart = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Stockholm',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(d)
    return datePart + ' kl. ' + timePart
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  function stockholmPart(d, opts) {
    var merged = { timeZone: 'Europe/Stockholm' }
    for (var k in opts) merged[k] = opts[k]
    return new Intl.DateTimeFormat('sv-SE', merged).format(d)
  }

  // "Lör 12 dec · 15:00" - kort veckodag, för kort/rutnät/showtimes.
  function formatStockholmShortDate(iso) {
    var d = new Date(iso)
    var weekday = capitalize(stockholmPart(d, { weekday: 'short' }).replace(/\.$/, ''))
    var day = stockholmPart(d, { day: 'numeric' })
    var month = stockholmPart(d, { month: 'short' }).replace(/\.$/, '')
    var time = stockholmPart(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    return weekday + ' ' + day + ' ' + month + ' · ' + time
  }

  // "Lördag · 15:00" - FULL veckodag + tid, för Agenda (Agenda.dc.html).
  function formatStockholmWeekdayAndTime(iso) {
    var d = new Date(iso)
    var weekday = capitalize(stockholmPart(d, { weekday: 'long' }))
    var time = stockholmPart(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    return weekday + ' · ' + time
  }

  // "Lördag 12 december 2026" - fullständigt datum, för Horisontell
  // (Horisontell.dc.html, som visar datum och tid på separata rader).
  function formatStockholmFullDate(iso) {
    var d = new Date(iso)
    return capitalize(stockholmPart(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
  }

  // "Kl. 15:00" - bara klockslaget. Mockuppen visar även "Dörrarna öppnar
  // 14:30" på samma rad - utelämnat avsiktligt, fältet finns inte i
  // databasschemat (ordern 2.5).
  function formatStockholmTimeOnly(iso) {
    var d = new Date(iso)
    return 'Kl. ' + stockholmPart(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  }

  var ICON_CLOCK = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2'

  function formatPrice(ore) {
    return 'Från ' + Math.round(ore / 100) + ' kr'
  }

  // ---- Försäljningsstatus/nedräkning: samma logik som src/lib/salesState.ts ----

  function computeClockSkewMs(serverTimeIso, clientNowAtFetchMs) {
    return new Date(serverTimeIso).getTime() - clientNowAtFetchMs
  }

  function computeCountdown(salesOpenAtIso, clockSkewMs, clientNowMs) {
    var effectiveNowMs = clientNowMs + clockSkewMs
    var remainingMs = Math.max(0, new Date(salesOpenAtIso).getTime() - effectiveNowMs)
    var totalSeconds = Math.floor(remainingMs / 1000)
    return {
      days: Math.floor(totalSeconds / 86400),
      hours: Math.floor((totalSeconds % 86400) / 3600),
      minutes: Math.floor((totalSeconds % 3600) / 60),
      seconds: totalSeconds % 60,
      reached: remainingMs <= 0,
    }
  }

  // ---- CSS (injiceras i varje widgets eget Shadow DOM) ----

  var STYLE = [
    ':host{all:initial;display:block;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-sizing:border-box}',
    '*{box-sizing:border-box}',
    '.rw{--accent:#243B53;--accent-text:#FFFFFF;--bg:#FAFAF8;--card-bg:#FFFFFF;--border:#E5E5E1;--text:#171717;--muted:#5A5A5A;--chip-bg:#F6B93B;--chip-text:#171717;--disabled-bg:#EAEEF2;--disabled-text:#5A5A5A;color:var(--text);font-size:15px;line-height:1.4}',
    '.rw[data-theme="dark"]{--bg:#141C27;--card-bg:#1C2836;--border:#2F4A66;--text:#F2F5F8;--muted:#9FB0C3;--disabled-bg:#263548;--disabled-text:#9FB0C3}',
    // :not(.rw-btn) - annars vinner denna över .rw-btn{color:var(--accent-text)}
    // pga högre specificitet (klass+tagg > enkel klass), och knappen
    // "Köp biljetter" (en <a>, till skillnad från de inaktiverade
    // knapparna som är <button>) ärver då fel textfärg från sidans
    // mörka brödtext istället för accentfärgens kontrastfärg.
    '.rw a:not(.rw-btn){color:inherit;text-decoration:none}',
    '.rw button,.rw a.rw-btn{font:inherit;cursor:pointer}',
    '.rw-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 24px;border:0;border-radius:999px;background:var(--accent);color:var(--accent-text);font-weight:700;font-size:15px;text-align:center;text-decoration:none}',
    '.rw-btn:focus-visible,.rw a:focus-visible,.rw button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}',
    '.rw-btn[disabled]{background:var(--disabled-bg);color:var(--disabled-text);cursor:default}',
    '.rw-chip{display:block;box-sizing:border-box;width:100%;padding:12px 14px;border-radius:999px;background:var(--chip-bg);color:var(--chip-text);text-align:center;font-size:13px;font-weight:700}',
    '.rw-card{display:flex;flex-direction:column;gap:10px;padding:16px;background:var(--card-bg);border:1px solid var(--border);border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}',
    '.rw-poster{width:100%;border-radius:10px;overflow:hidden;background:var(--disabled-bg)}',
    '.rw-poster img{display:block;width:100%;height:100%;object-fit:cover}',
    '.rw-eyebrow{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}',
    '.rw-title{margin:0;font-size:19px;font-weight:800;line-height:1.2}',
    '.rw-row{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--text)}',
    '.rw-muted{color:var(--muted);font-size:14px}',
    '.rw-price{text-align:center;font-size:14px;color:var(--muted)}',
    '.rw-error,.rw-empty{padding:16px;color:var(--muted);font-size:14px}',
    '.rw-grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}',
    '.rw-grid .rw-card{max-width:360px}',
    '.rw-horizontal{display:flex;gap:16px;align-items:flex-start}',
    '.rw-horizontal .rw-poster{width:140px;flex:none;aspect-ratio:2/3}',
    '.rw-landscape .rw-poster{aspect-ratio:16/9}',
    '.rw-landscape-row{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}',
    '.rw-portrait .rw-poster{aspect-ratio:2/3}',
    '.rw-list-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:12px}',
    '.rw-agenda-date{flex:none;width:52px;height:56px;border-radius:10px;background:var(--accent);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center}',
    '.rw-agenda-date .rw-agenda-month{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--chip-bg)}',
    '.rw-agenda-date .rw-agenda-day{font-size:20px;font-weight:800;line-height:1}',
    '.rw-banner{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;padding:20px;border-radius:16px;background:var(--accent);color:#fff}',
    '.rw-banner-eyebrow{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--chip-bg)}',
    '.rw-banner-title{margin:4px 0 0;font-size:20px;font-weight:800;color:#fff}',
    '.rw-banner-meta{font-size:13px;color:#C9D3DF;margin-top:4px}',
    '.rw-banner-buy{background:#FFFFFF;color:#171717}',
    '.rw-countdown{display:flex;gap:8px}',
    '.rw-countdown-box{width:52px;height:52px;border-radius:10px;background:rgba(255,255,255,.14);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center}',
    '.rw-countdown-box b{font-size:17px;line-height:1}',
    '.rw-countdown-box span{font-size:9px;text-transform:uppercase;color:#C9D3DF}',
    '.rw-sr-static{font-size:13px}',
    '@media (max-width:420px){.rw-horizontal{flex-direction:column}.rw-horizontal .rw-poster{width:100%;aspect-ratio:3/2}.rw-banner{flex-direction:column;align-items:flex-start}}',
  ].join('')

  // ---- Attribut-parsing ----

  function parseList(value, allowed) {
    if (!value) return []
    var parts = value
      .split(',')
      .map(function (s) {
        return s.trim()
      })
      .filter(Boolean)
    if (!allowed) return parts
    return parts.filter(function (p) {
      return allowed.indexOf(p) !== -1
    })
  }

  function readConfig(hostEl) {
    var layout = hostEl.getAttribute('data-layout') || 'grid'
    if (VALID_LAYOUTS.indexOf(layout) === -1) layout = 'grid'
    var show = parseList(hostEl.getAttribute('data-show'), VALID_SHOW)
    var theme = hostEl.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
    var accentKey = hostEl.getAttribute('data-accent') || 'midnatt'
    var accent = ACCENTS[accentKey] || ACCENTS.midnatt
    var accentText = accentKey === 'rampljus' ? '#171717' : '#FFFFFF'
    var organizer = hostEl.getAttribute('data-organizer')
    var events = parseList(hostEl.getAttribute('data-events'))
    var title = hostEl.getAttribute('data-title')
    // Bara för lokal testning mot en mock-server, aldrig i generatorn/
    // dokumentationen (ordern 2.3) - en ren basadress, "/public-embed"
    // läggs alltid på av oss, precis som för DEFAULT_API_BASE.
    // hasAttribute (inte bara ett sanningsvärde-test av strängen) så att
    // data-api="" ("samma origin som sidan", dvs mock-servern) faktiskt
    // används istället för att tyst falla tillbaka till produktions-API:et.
    var apiBase = hostEl.hasAttribute('data-api') ? hostEl.getAttribute('data-api') : DEFAULT_API_BASE
    return { layout: layout, show: show, theme: theme, accent: accent, accentText: accentText, organizer: organizer, events: events, title: title, apiBase: apiBase }
  }

  // ---- Nätverk ----

  function fetchEvents(config) {
    var url
    if (config.organizer) {
      url = config.apiBase + '/public-embed?organizer=' + encodeURIComponent(config.organizer)
    } else {
      url = config.apiBase + '/public-embed?events=' + encodeURIComponent(config.events.slice(0, 12).join(','))
    }
    var fetchedAtMs = Date.now()
    return fetch(url, { method: 'GET', cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json().then(function (body) {
        return { events: body.events || [], clockSkewMs: computeClockSkewMs(body.server_time, fetchedAtMs) }
      })
    })
  }

  // ---- Rendering: enskild händelses köp-del (knapp/chip/pris) ----

  function buildBuyBlock(ev, config, countdownState) {
    var frag = document.createDocumentFragment()
    var purchaseHref = APP_BASE + '/#/kop/' + encodeURIComponent(ev.slug)

    if (ev.sales_state === 'open') {
      var buyLink = el('a', {
        className: 'rw-btn',
        href: purchaseHref,
        text: 'Köp biljetter',
      })
      frag.appendChild(buyLink)
      if (config.show.indexOf('price') !== -1 && ev.from_price_ore != null) {
        frag.appendChild(el('div', { className: 'rw-price', text: formatPrice(ev.from_price_ore) }))
      }
    } else if (ev.sales_state === 'sold_out') {
      frag.appendChild(el('button', { className: 'rw-btn', disabled: true, type: 'button', text: 'Slutsålt' }))
    } else {
      // upcoming
      var staticText = 'Biljetter släpps ' + formatStockholmDateTime(ev.sales_open_at)
      var chip
      if (config.show.indexOf('countdown') !== -1 && countdownState) {
        chip = el('span', { className: 'rw-chip' }, [
          el('span', { 'aria-hidden': 'true', text: countdownText(countdownState) }),
        ])
        chip.appendChild(el('span', { className: 'rw-sr-only', text: staticText, style: 'position:absolute;left:-9999px' }))
      } else {
        chip = el('span', { className: 'rw-chip', text: staticText })
      }
      frag.appendChild(chip)
      if (ROW_LAYOUTS.indexOf(config.layout) === -1) {
        frag.appendChild(el('button', { className: 'rw-btn', disabled: true, type: 'button', text: 'Köp biljetter' }))
      }
    }
    return frag
  }

  function countdownText(c) {
    if (c.reached) return 'Släpps strax …'
    if (c.days > 0) return c.days + ' d ' + c.hours + ' tim ' + c.minutes + ' min'
    return pad2(c.hours) + ':' + pad2(c.minutes) + ':' + pad2(c.seconds)
  }

  function buildMetaRows(ev, config) {
    var rows = []
    if (config.show.indexOf('date') !== -1 && ev.starts_at) {
      rows.push(el('div', { className: 'rw-row' }, [svgIcon(ICON_CALENDAR, 16), el('span', { text: formatStockholmShortDate(ev.starts_at) })]))
    }
    if (config.show.indexOf('place') !== -1 && ev.venue) {
      rows.push(el('div', { className: 'rw-row' }, [svgIcon(ICON_PIN, 16), el('span', { text: ev.venue })]))
    }
    return rows
  }

  function buildPosterBox(ev, preferLandscape) {
    var url = preferLandscape ? ev.poster_landscape_url || ev.poster_portrait_url : ev.poster_portrait_url || ev.poster_landscape_url
    if (!url || !isTrustedPosterUrl(url)) return null
    var box = el('div', { className: 'rw-poster' })
    box.appendChild(el('img', { src: url, alt: '', loading: 'lazy' }))
    return box
  }

  // Affischer visas BARA om URL:en pekar på projektets eget Storage -
  // aldrig en godtycklig extern bild (ordern 2.1, "endast om URL:en
  // börjar med projektets Storage-adress").
  function isTrustedPosterUrl(url) {
    return typeof url === 'string' && /^https:\/\/oyqgxnmwojjjpoubdlfa\.supabase\.co\/storage\//.test(url)
  }

  // ---- Rendering: layouter ----

  function renderCardLayout(container, ev, config, countdownState, variant) {
    var card = el('div', { className: 'rw-card' })
    var preferLandscape = variant === 'landscape'
    var poster = config.show.indexOf('poster') !== -1 ? buildPosterBox(ev, preferLandscape) : null

    if (variant === 'horizontal') {
      // Horisontell.dc.html: datum och tid på VARSIN rad (till skillnad
      // från övriga layouter som slår ihop dem till "Lör 12 dec · 15:00"),
      // och knapp+pris sida vid sida istället för staplat.
      var right = el('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:0;flex:1;justify-content:center' })
      if (config.show.indexOf('organizer') !== -1 && ev.organizer_name) right.appendChild(el('div', { className: 'rw-eyebrow', text: ev.organizer_name }))
      right.appendChild(el('h3', { className: 'rw-title', text: ev.title, style: 'font-size:26px' }))
      if (config.show.indexOf('date') !== -1 && ev.starts_at) {
        right.appendChild(el('div', { className: 'rw-row' }, [svgIcon(ICON_CALENDAR, 18), el('span', { text: formatStockholmFullDate(ev.starts_at) })]))
        right.appendChild(el('div', { className: 'rw-row' }, [svgIcon(ICON_CLOCK, 18), el('span', { text: formatStockholmTimeOnly(ev.starts_at) })]))
      }
      if (config.show.indexOf('place') !== -1 && ev.venue) {
        right.appendChild(el('div', { className: 'rw-row' }, [svgIcon(ICON_PIN, 18), el('span', { text: ev.venue })]))
      }
      var buyRow = el('div', { style: 'display:flex;align-items:center;gap:16px;margin-top:4px' })
      buyRow.appendChild(buildBuyBlock(ev, config, countdownState))
      right.appendChild(buyRow)
      var wrap = el('div', { className: 'rw-horizontal' }, [poster, right])
      container.appendChild(wrap)
      return
    }

    if (poster) card.appendChild(poster)
    if (config.show.indexOf('organizer') !== -1 && ev.organizer_name) card.appendChild(el('div', { className: 'rw-eyebrow', text: ev.organizer_name }))
    card.appendChild(el('h3', { className: 'rw-title', text: ev.title }))

    if (variant === 'landscape') {
      // Liggande.dc.html: datum och plats på SAMMA rad (inte staplade).
      var row = el('div', { className: 'rw-landscape-row' })
      var info = el('div', { style: 'display:flex;flex-direction:column;gap:6px;min-width:0' })
      var inlineMeta = el('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px' })
      buildMetaRows(ev, config).forEach(function (r) {
        inlineMeta.appendChild(r)
      })
      info.appendChild(inlineMeta)
      row.appendChild(info)
      row.appendChild(buildBuyBlock(ev, config, countdownState))
      card.appendChild(row)
      container.appendChild(card)
      return
    }

    buildMetaRows(ev, config).forEach(function (r) {
      card.appendChild(r)
    })
    card.appendChild(buildBuyBlock(ev, config, countdownState))
    container.appendChild(card)
  }

  // "Bara en knapp" (Knapp.dc.html): INGEN kort-chrome, ingen titel - bara
  // köp-elementet och en kort textrad (datum · pris) sida vid sida.
  function renderButtonLayout(container, ev, config, countdownState) {
    var wrap = el('div', { style: 'display:flex;align-items:center;gap:16px;flex-wrap:wrap' })

    if (ev.sales_state === 'open') {
      wrap.appendChild(el('a', { className: 'rw-btn', href: APP_BASE + '/#/kop/' + encodeURIComponent(ev.slug), text: 'Köp biljetter' }))
      var bits = []
      if (config.show.indexOf('date') !== -1 && ev.starts_at) bits.push(formatStockholmShortDate(ev.starts_at).split('·')[0].trim())
      if (config.show.indexOf('place') !== -1 && ev.venue) bits.push(ev.venue)
      if (config.show.indexOf('price') !== -1 && ev.from_price_ore != null) bits.push(formatPrice(ev.from_price_ore).toLowerCase())
      if (bits.length > 0) wrap.appendChild(el('span', { className: 'rw-muted', text: bits.join(' · ') }))
    } else if (ev.sales_state === 'sold_out') {
      wrap.appendChild(el('button', { className: 'rw-btn', disabled: true, type: 'button', text: 'Slutsålt' }))
    } else {
      var staticText = 'Biljetter släpps ' + formatStockholmDateTime(ev.sales_open_at)
      if (config.show.indexOf('countdown') !== -1 && countdownState) {
        wrap.appendChild(el('span', { className: 'rw-chip', text: countdownText(countdownState) }))
        wrap.appendChild(el('span', { className: 'rw-sr-only', style: 'position:absolute;left:-9999px', text: staticText }))
      } else {
        wrap.appendChild(el('span', { className: 'rw-chip', text: staticText }))
      }
    }
    container.appendChild(wrap)
  }

  function renderGridLayout(container, events, config, countdownStates) {
    var grid = el('div', { className: 'rw-grid' })
    events.forEach(function (ev) {
      renderCardLayout(grid, ev, config, countdownStates[ev.slug], 'grid')
    })
    container.appendChild(grid)
  }

  // Agenda.dc.html: EN gemensam kortram runt alla rader, med en
  // avdelare (underkant-ram) mellan raderna istället för en bakgrund per
  // rad.
  function renderAgendaLayout(container, events, config, countdownStates) {
    var card = el('div', { className: 'rw-card', style: 'padding:8px;gap:0' })
    events.forEach(function (ev, i) {
      var d = ev.starts_at ? new Date(ev.starts_at) : null
      var month = d ? capitalize(stockholmPart(d, { month: 'short' }).replace(/\.$/, '')) : ''
      var day = d ? stockholmPart(d, { day: 'numeric' }) : ''
      var dateBox = el('div', { className: 'rw-agenda-date' }, [
        el('span', { className: 'rw-agenda-month', text: month }),
        el('span', { className: 'rw-agenda-day', text: day }),
      ])
      var mid = el('div', { style: 'display:flex;flex-direction:column;gap:4px;min-width:0;flex:1' })
      mid.appendChild(el('div', { className: 'rw-title', text: ev.title, style: 'font-size:18px' }))
      var bits = []
      if (config.show.indexOf('date') !== -1 && ev.starts_at) bits.push(formatStockholmWeekdayAndTime(ev.starts_at))
      if (config.show.indexOf('place') !== -1 && ev.venue) bits.push(ev.venue)
      if (bits.length > 0) mid.appendChild(el('div', { className: 'rw-muted', text: bits.join(' · ') }))
      var right = el('div', { style: 'flex:none' })
      right.appendChild(buildBuyBlock(ev, config, countdownStates[ev.slug]))
      var rowStyle = 'display:flex;align-items:center;gap:20px;padding:16px'
      if (i < events.length - 1) rowStyle += ';border-bottom:1px solid var(--border)'
      card.appendChild(el('div', { style: rowStyle }, [dateBox, mid, right]))
    })
    container.appendChild(card)
  }

  // Speltider.dc.html: en rubrik-kort (arrangör/titel/"Välj tillfälle"),
  // sedan en rad per valt event med kalenderikon + datum/tid och
  // köp-elementet till höger. Ikonen/texten blir gråtonad för slutsålda
  // tillfällen (mockuppens detalj).
  function renderShowtimesLayout(container, events, config, countdownStates) {
    var card = el('div', { className: 'rw-card' })
    if (config.show.indexOf('organizer') !== -1 && events[0] && events[0].organizer_name) {
      card.appendChild(el('div', { className: 'rw-eyebrow', text: events[0].organizer_name }))
    }
    var heading = config.title || (events[0] && events[0].title) || ''
    if (heading) card.appendChild(el('h3', { className: 'rw-title', text: heading, style: 'font-size:22px' }))
    card.appendChild(el('p', { className: 'rw-muted', text: 'Välj tillfälle', style: 'margin:0' }))
    events.forEach(function (ev) {
      var muted = ev.sales_state === 'sold_out'
      var left = el('div', { className: 'rw-row', style: 'font-weight:700;font-size:16px;color:' + (muted ? 'var(--muted)' : 'var(--accent)') })
      left.appendChild(svgIcon(ICON_CALENDAR, 18))
      if (ev.starts_at) left.appendChild(el('span', { text: formatStockholmShortDate(ev.starts_at) }))
      var right = el('div', { style: 'flex:none' })
      right.appendChild(buildBuyBlock(ev, config, countdownStates[ev.slug]))
      card.appendChild(el('div', { className: 'rw-list-row' }, [left, right]))
    })
    container.appendChild(card)
  }

  function renderBannerLayout(container, events, config, countdownStates) {
    var ev = events[0]
    if (!ev) return
    var left = el('div', {})
    left.appendChild(el('div', { className: 'rw-banner-eyebrow', text: 'Nästa föreställning' }))
    left.appendChild(el('h3', { className: 'rw-banner-title', text: ev.title }))
    var metaBits = []
    if (ev.starts_at) metaBits.push(formatStockholmShortDate(ev.starts_at))
    if (ev.venue) metaBits.push(ev.venue)
    left.appendChild(el('div', { className: 'rw-banner-meta', text: metaBits.join(' · ') }))

    var right = el('div', { style: 'display:flex;flex-direction:column;align-items:flex-end;gap:10px' })
    var cd = countdownStates[ev.slug]
    if (ev.sales_state === 'upcoming' && config.show.indexOf('countdown') !== -1 && cd) {
      var boxes = el('div', { className: 'rw-countdown' })
      var units = [
        [cd.days, 'dagar'],
        [cd.hours, 'tim'],
        [cd.minutes, 'min'],
      ]
      units.forEach(function (u) {
        boxes.appendChild(el('div', { className: 'rw-countdown-box', 'aria-hidden': 'true' }, [el('b', { text: String(u[0]) }), el('span', { text: u[1] })]))
      })
      right.appendChild(boxes)
      right.appendChild(
        el('span', {
          className: 'rw-sr-only',
          style: 'position:absolute;left:-9999px',
          text: 'Biljetter släpps ' + formatStockholmDateTime(ev.sales_open_at),
        }),
      )
      var chip = el('span', { className: 'rw-chip', text: 'Biljetter släpps ' + formatStockholmDateTime(ev.sales_open_at) })
      right.appendChild(chip)
    } else if (ev.sales_state === 'open') {
      // Bannerns bakgrund ÄR accentfärgen - en vanlig .rw-btn (som också
      // använder accentfärgen som bakgrund) skulle bli osynlig mot den.
      // Vit knapp ger garanterad kontrast oavsett vilken av de tre
      // accentfärgerna som är vald (Nicklas rapporterade detta 2026-10-04).
      right.appendChild(
        el('a', { className: 'rw-btn rw-banner-buy', href: APP_BASE + '/#/kop/' + encodeURIComponent(ev.slug), text: 'Köp biljetter' }),
      )
      if (config.show.indexOf('price') !== -1 && ev.from_price_ore != null) {
        right.appendChild(el('div', { className: 'rw-banner-meta', text: formatPrice(ev.from_price_ore) }))
      }
    } else {
      // Slutsålt: den gråa inaktiverade standardknappen syns redan bra
      // mot en mörk banner, ingen särskild styling behövs.
      right.appendChild(buildBuyBlock(ev, config, cd))
    }
    container.appendChild(el('div', { className: 'rw-banner' }, [left, right]))
  }

  function renderEvents(container, events, config, countdownStates) {
    container.textContent = ''
    if (events.length === 0) {
      container.appendChild(el('div', { className: 'rw-empty', text: 'Inga kommande föreställningar just nu.' }))
      return
    }
    if (config.layout === 'grid') return renderGridLayout(container, events, config, countdownStates)
    if (config.layout === 'agenda') return renderAgendaLayout(container, events, config, countdownStates)
    if (config.layout === 'showtimes') return renderShowtimesLayout(container, events, config, countdownStates)
    if (config.layout === 'banner') return renderBannerLayout(container, events, config, countdownStates)
    // Enskilt-event-layouter: alltid det FÖRSTA valda eventet.
    var ev = events[0]
    if (!ev) return
    if (config.layout === 'button') return renderButtonLayout(container, ev, config, countdownStates[ev.slug])
    return renderCardLayout(container, ev, config, countdownStates[ev.slug], config.layout)
  }

  function renderError(container) {
    container.textContent = ''
    var p = el('div', { className: 'rw-error' })
    p.appendChild(document.createTextNode('Kunde inte hämta föreställningar just nu. '))
    p.appendChild(el('a', { href: APP_BASE + '/#/evenemang', text: 'Se alla evenemang', style: 'text-decoration:underline' }))
    container.appendChild(p)
  }

  // ---- Montering av en widget ----

  function mountWidget(hostEl) {
    hostEl.setAttribute('data-rideau-mounted', '1')
    var config = readConfig(hostEl)
    if (SINGLE_EVENT_LAYOUTS.indexOf(config.layout) !== -1 && config.events.length > 1) {
      config.events = config.events.slice(0, 1)
    }

    var shadow = hostEl.attachShadow({ mode: 'open' })
    var style = document.createElement('style')
    style.textContent = STYLE
    shadow.appendChild(style)
    var root = el('div', { className: 'rw', 'data-theme': config.theme })
    root.style.setProperty('--accent', config.accent)
    root.style.setProperty('--accent-text', config.accentText)
    shadow.appendChild(root)
    root.appendChild(el('div', { className: 'rw-muted', text: 'Laddar …' }))

    var state = {
      events: [],
      clockSkewMs: 0,
      countdownIntervalId: null,
      releasePollTimeoutId: null,
      backgroundIntervalId: null,
    }

    function clearTimers() {
      if (state.countdownIntervalId) clearInterval(state.countdownIntervalId)
      if (state.releasePollTimeoutId) clearTimeout(state.releasePollTimeoutId)
      state.countdownIntervalId = null
      state.releasePollTimeoutId = null
    }

    function currentCountdownStates() {
      var out = {}
      state.events.forEach(function (ev) {
        if (ev.sales_state === 'upcoming' && ev.sales_open_at) {
          out[ev.slug] = computeCountdown(ev.sales_open_at, state.clockSkewMs, Date.now())
        }
      })
      return out
    }

    function render() {
      renderEvents(root, state.events, config, currentCountdownStates())
    }

    function hasUpcoming() {
      return state.events.some(function (ev) {
        return ev.sales_state === 'upcoming'
      })
    }

    function scheduleCountdownTick() {
      clearTimers()
      if (!hasUpcoming() || config.show.indexOf('countdown') === -1) return
      state.countdownIntervalId = setInterval(function () {
        var anyReached = state.events.some(function (ev) {
          return ev.sales_state === 'upcoming' && computeCountdown(ev.sales_open_at, state.clockSkewMs, Date.now()).reached
        })
        render()
        if (anyReached) {
          clearInterval(state.countdownIntervalId)
          state.countdownIntervalId = null
          startReleasePoll()
        }
      }, 1000)
    }

    // Vid släpp: slumpad fördröjning 0-3s (undviker att alla besökare
    // träffar servern i exakt samma millisekund), sedan ombegäran var 5:e
    // sekund tills servern faktiskt säger "open", max en minut (ordern
    // 2.3 - widgeten ska ALDRIG gissa att den är öppen, bara servern
    // avgör). Efter en minut ger den aggressiva pollningen upp - den
    // vanliga 5-minuters bakgrundsuppdateringen tar över därefter.
    function startReleasePoll() {
      var deadline = Date.now() + RELEASE_POLL_MAX_MS
      var initialDelay = Math.random() * 3000
      function poll() {
        refetch().then(function () {
          if (!hasUpcoming()) return
          if (Date.now() >= deadline) return
          state.releasePollTimeoutId = setTimeout(poll, RELEASE_POLL_INTERVAL_MS)
        })
      }
      state.releasePollTimeoutId = setTimeout(poll, initialDelay)
    }

    function refetch() {
      return fetchEvents(config)
        .then(function (result) {
          state.events = result.events
          state.clockSkewMs = result.clockSkewMs
          render()
          scheduleCountdownTick()
        })
        .catch(function () {
          renderError(root)
        })
    }

    refetch()

    state.backgroundIntervalId = setInterval(function () {
      if (document.visibilityState === 'visible') refetch()
    }, BACKGROUND_REFRESH_MS)

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refetch()
    })
  }

  function mountAll(rootNode) {
    var nodes = rootNode.querySelectorAll('.rideau-widget:not([data-rideau-mounted])')
    for (var i = 0; i < nodes.length; i++) mountWidget(nodes[i])
  }

  mountAll(document)

  // Widgetar som läggs till senare (Squarespace laddar ibland innehåll
  // dynamiskt) monteras automatiskt när de dyker upp i DOM:en.
  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes
      for (var j = 0; j < added.length; j++) {
        var node = added[j]
        if (node.nodeType !== 1) continue
        if (node.matches && node.matches('.rideau-widget:not([data-rideau-mounted])')) mountWidget(node)
        if (node.querySelectorAll) mountAll(node)
      }
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
})()
