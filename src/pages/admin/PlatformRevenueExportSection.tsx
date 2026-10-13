import { useState } from 'react'
import { downloadAdminFile } from '../../lib/functionsApi'
import { formatKr } from '../../lib/formatPrice'

type PlatformExportScope = 'day' | 'range'

// Plattformsintäkt (Tilläggsordern 2026-08-07, avsnitt 5) - Childproof ABs
// EGEN bokföring av plattformsavgiften (application_fee_amount), TVÄRS
// ÖVER alla arrangörer. Uttryckligen INTE samma sak som ExportSection
// ovan (som är en enskild arrangörs egen biljettförsäljning) - egen
// backend-funktion (platform-export-revenue), egna SIE-konton
// (PLATFORM_SIE_ACCOUNT_*), egen 25%-momssats. Samma tre-periods-UI-mönster
// som ExportSection, minus "helt evenemang" (plattformsavgiften är inte
// event-bunden på samma sätt - en period täcker per definition alla
// arrangörers event).
export function PlatformRevenueExportSection() {
  const today = new Date().toISOString().slice(0, 10)

  const [scope, setScope] = useState<PlatformExportScope>('day')
  const [date, setDate] = useState(today)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [downloading, setDownloading] = useState<'csv' | 'sie' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [excludedTestNotice, setExcludedTestNotice] = useState<{ count: number; totalOre: number } | null>(null)

  function buildQuery(format: 'csv' | 'sie'): string | null {
    const params = new URLSearchParams({ format, scope })
    if (scope === 'day') {
      if (!date) return null
      params.set('date', date)
    } else {
      if (!from || !to) return null
      params.set('from', from)
      params.set('to', to)
    }
    return `platform-export-revenue?${params.toString()}`
  }

  async function handleDownload(format: 'csv' | 'sie') {
    const query = buildQuery(format)
    if (!query) {
      setExportError('Fyll i datum/period innan export.')
      return
    }
    setDownloading(format)
    setExportError(null)
    try {
      const result = await downloadAdminFile(query, `plattformsintakt.${format === 'csv' ? 'csv' : 'se'}`)
      setExcludedTestNotice({ count: result.excludedTestCount, totalOre: result.excludedTestTotalOre })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export misslyckades.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <section className="card border-2 border-[var(--accent)]">
      <h2 className="text-lg font-extrabold mb-2 text-[var(--text)]">Plattformsintäkt (Childproof AB)</h2>
      <p className="text-sm text-[var(--text-muted)] mb-4">
        Egna siffror för Childproof AB - plattformsavgiften som togs ut från VARJE arrangörs
        försäljning, inte en enskild arrangörs egen omsättning. Läser tvärs över alla arrangörer,
        med arrangörens namn per rad. 25% moms (teknisk tjänst), separat från arrangörernas 6% på
        biljetter - blanda aldrig dessa i samma bokföring.
      </p>

      <div className="flex flex-wrap gap-4 mb-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={scope === 'day'} onChange={() => setScope('day')} />
          Dagens datum
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={scope === 'range'} onChange={() => setScope('range')} />
          Period
        </label>
      </div>

      {scope === 'day' && (
        <div className="mb-4">
          <label className="block">
            <span className="block text-sm font-medium mb-2 text-[var(--text)]">Datum</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field" />
          </label>
        </div>
      )}

      {scope === 'range' && (
        <div className="flex gap-4 mb-4">
          <div>
            <label className="block">
              <span className="block text-sm font-medium mb-2 text-[var(--text)]">Från</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="field" />
            </label>
          </div>
          <div>
            <label className="block">
              <span className="block text-sm font-medium mb-2 text-[var(--text)]">Till</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="field" />
            </label>
          </div>
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
