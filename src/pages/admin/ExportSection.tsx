import { useState } from 'react'
import { downloadAdminFile } from '../../lib/functionsApi'
import { formatKr } from '../../lib/formatPrice'
import type { AdminEventRow } from '../../lib/types'

type ExportScope = 'day' | 'range' | 'event'

// Exportknappar för bokföring (CSV och SIE4). Läggs som en egen sektion i
// admin-dashboarden - se supabase/functions/export-sales/index.ts för hur
// filerna byggs (alltid från ordrarnas egen pris/moms-ögonblicksbild, inte
// ticket_types nuvarande värden).
export function ExportSection({ events }: { events: AdminEventRow[] }) {
  const today = new Date().toISOString().slice(0, 10)

  const [scope, setScope] = useState<ExportScope>('day')
  const [date, setDate] = useState(today)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [eventId, setEventId] = useState(events[0]?.id ?? '')
  const [downloading, setDownloading] = useState<'csv' | 'sie' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  // Arkiv (ordern 2026-10-12, DEL 2 punkt 2) - "en rad med antal och
  // summa för uteslutna testordrar" i exportvyn, satt efter varje lyckad
  // nedladdning (null innan första nedladdningen - visa inget förrän
  // något faktiskt laddats ner).
  const [excludedTestNotice, setExcludedTestNotice] = useState<{ count: number; totalOre: number } | null>(null)

  function buildQuery(format: 'csv' | 'sie'): string | null {
    const params = new URLSearchParams({ format, scope })
    if (scope === 'day') {
      if (!date) return null
      params.set('date', date)
    } else if (scope === 'range') {
      if (!from || !to) return null
      params.set('from', from)
      params.set('to', to)
    } else {
      if (!eventId) return null
      params.set('event_id', eventId)
    }
    return `export-sales?${params.toString()}`
  }

  async function handleDownload(format: 'csv' | 'sie') {
    const query = buildQuery(format)
    if (!query) {
      setExportError('Fyll i datum/period/event innan export.')
      return
    }
    setDownloading(format)
    setExportError(null)
    try {
      const result = await downloadAdminFile(query, `forsaljning.${format === 'csv' ? 'csv' : 'se'}`)
      setExcludedTestNotice({ count: result.excludedTestCount, totalOre: result.excludedTestTotalOre })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export misslyckades.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <section className="card">
      <h2 className="text-lg font-extrabold mb-2 text-[var(--text)]">Exportera försäljning</h2>
      <p className="text-sm text-[var(--text-muted)] mb-4">
        CSV för kalkylark, SIE4 för bokföring (Fortnox m.fl.). Läser endast betalda ordrar och
        använder alltid priset/momsen som gällde vid köptillfället, inte biljettypens nuvarande
        värden.{' '}
        <strong>Granska den första SIE-filen med en redovisningskonsult innan skarp import.</strong>
      </p>

      <div className="flex flex-wrap gap-4 mb-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={scope === 'day'}
            onChange={() => setScope('day')}
          />
          Dagens datum
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={scope === 'range'}
            onChange={() => setScope('range')}
          />
          Period
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={scope === 'event'}
            onChange={() => setScope('event')}
          />
          Helt evenemang
        </label>
      </div>

      {scope === 'day' && (
        <div className="mb-4">
          <label className="block">
            <span className="block text-sm font-medium mb-2 text-[var(--text)]">Datum</span>
            <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="field"
          />
          </label>
        </div>
      )}

      {scope === 'range' && (
        <div className="flex gap-4 mb-4">
          <div>
            <label className="block">
              <span className="block text-sm font-medium mb-2 text-[var(--text)]">Från</span>
              <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="field"
            />
            </label>
          </div>
          <div>
            <label className="block">
              <span className="block text-sm font-medium mb-2 text-[var(--text)]">Till</span>
              <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="field"
            />
            </label>
          </div>
        </div>
      )}

      {scope === 'event' && (
        <div className="mb-4">
          <label className="block">
            <span className="block text-sm font-medium mb-2 text-[var(--text)]">Event</span>
            <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="field"
          >
            {events.length === 0 && <option value="">Inga events</option>}
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          </label>
        </div>
      )}

      {exportError && <p className="text-[var(--danger)] text-sm mb-3">{exportError}</p>}

      <div className="flex gap-4">
        <button type="button" onClick={() => handleDownload('csv')} disabled={downloading !== null} className="btn-primary">
          {downloading === 'csv' ? 'Laddar ner…' : 'Ladda ner CSV'}
        </button>
        <button type="button" onClick={() => handleDownload('sie')} disabled={downloading !== null} className="btn-secondary">
          {downloading === 'sie' ? 'Laddar ner…' : 'Ladda ner SIE'}
        </button>
      </div>

      {excludedTestNotice && (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          {excludedTestNotice.count === 0
            ? 'Inga arkiverade testordrar uteslutna ur den här exporten.'
            : `${excludedTestNotice.count} arkiverad${excludedTestNotice.count === 1 ? '' : 'e'} testorder${excludedTestNotice.count === 1 ? '' : 'ar'} (${formatKr(excludedTestNotice.totalOre)} kr) uteslutna ur den här exporten.`}
        </p>
      )}
    </section>
  )
}
