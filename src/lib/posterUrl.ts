// Affisch-URL (digital signage): hela konfigurationen ligger i URL:ens
// query-del, ingen databas behövs. Spelarsidan (/skylt) läser parametrarna
// och hämtar affischerna publikt (samma RLS som eventlistan: bara
// publicerade event syns). Kort och stabilt format:
//   o = p | l                stående / liggande
//   e = alla | id,id,...     alla kommande (uppdateras automatiskt) eller valda event
//   t = sekunder             visningstid per affisch
//   i = 1                    visa titel/datum/plats under affischen
//   f = 1                    ram med Rideau-logga runt affischen
//   q = 1                    visa QR-kod till biljettköp
//   r = 1                    visa när biljetterna släpps (för event som inte släppts än)

export type PosterOrientation = 'portrait' | 'landscape'

export interface PosterConfig {
  orientation: PosterOrientation
  // null = alla kommande publicerade event (nya event dyker upp av sig själva)
  eventIds: string[] | null
  seconds: number
  showInfo: boolean
  showFrame: boolean
  showQr: boolean
  showRelease: boolean
}

export const DEFAULT_POSTER_CONFIG: PosterConfig = {
  orientation: 'landscape',
  eventIds: null,
  seconds: 10,
  showInfo: false,
  showFrame: true,
  showQr: false,
  showRelease: false,
}

export const POSTER_SECONDS_OPTIONS = [5, 8, 10, 15, 20, 30, 60]

export function posterConfigToQuery(cfg: PosterConfig): string {
  const params = new URLSearchParams()
  params.set('o', cfg.orientation === 'portrait' ? 'p' : 'l')
  params.set('e', cfg.eventIds === null ? 'alla' : cfg.eventIds.join(','))
  params.set('t', String(cfg.seconds))
  if (cfg.showInfo) params.set('i', '1')
  if (cfg.showFrame) params.set('f', '1')
  if (cfg.showQr) params.set('q', '1')
  if (cfg.showRelease) params.set('r', '1')
  return params.toString()
}

export function parsePosterQuery(params: URLSearchParams): PosterConfig {
  const e = params.get('e')
  const eventIds = !e || e === 'alla' ? null : e.split(',').filter(Boolean)
  const t = Number(params.get('t'))
  return {
    orientation: params.get('o') === 'p' ? 'portrait' : 'landscape',
    eventIds,
    seconds: Number.isFinite(t) && t >= 3 && t <= 600 ? Math.round(t) : DEFAULT_POSTER_CONFIG.seconds,
    showInfo: params.get('i') === '1',
    showQr: params.get('q') === '1',
    showRelease: params.get('r') === '1',
    // Ram och logga visas också för äldre URL:er som bara har q/i/r (de tillvalen bor i ramen).
    showFrame: params.get('f') === '1' || params.get('q') === '1' || params.get('i') === '1' || params.get('r') === '1',
  }
}

// Absolut länk till en sida i appen (används i QR-koden på affischen).
export function appUrl(hashPath: string): string {
  return `${window.location.origin}${window.location.pathname}#${hashPath}`
}

// Absolut URL till spelaren. HashRouter -> "#/skylt?...". Byggs av
// sidans egen adress (inte BASE_URL), samma princip som embed-koden.
export function posterPlayerUrl(cfg: PosterConfig): string {
  const base = `${window.location.origin}${window.location.pathname}`
  return `${base}#/skylt?${posterConfigToQuery(cfg)}`
}
