// Ett enda datumformat i hela API:et: ISO 8601, UTC, INGA fraktionella
// sekunder - "2026-05-10T17:58:03Z".
//
// Motiv: Postgres/PostgREST serialiserar timestamptz som t.ex.
// "2026-05-10T17:58:03.482+00:00" (offset, mikrosekunder). Swifts
// `.iso8601`-strategi i JSONDecoder klarar INTE fraktionella sekunder som
// standard. Blandar man format mellan endpoints (offset i den ena,
// "Z" med decimaler i den andra) fungerar en enda JSONDecoder-konfiguration
// för den ena endpointen och failar tyst för den andra. Alla timestamps som
// lämnar en Edge Function-response ska därför gå genom denna funktion.
export function toIso8601Seconds(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${date.toISOString().slice(0, 19)}Z`
}
