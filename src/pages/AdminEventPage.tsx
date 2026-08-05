import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { callFunction } from '../lib/functionsApi'
import { supabase } from '../lib/supabaseClient'
import type { EventRow, TicketRow, TicketTypeRow } from '../lib/types'

interface AdminEventTicketsResponse {
  event: EventRow
  ticket_types: TicketTypeRow[]
  tickets: TicketRow[]
}

const STATUS_LABEL: Record<TicketRow['status'], string> = {
  valid: 'Giltig (ej incheckad)',
  checked_in: 'Incheckad',
  void: 'Annullerad',
}

const STATUS_STYLE: Record<TicketRow['status'], string> = {
  valid: 'bg-slate-100 text-slate-700',
  checked_in: 'bg-green-100 text-green-700',
  void: 'bg-red-100 text-red-700',
}

const VAT_OPTIONS = [
  { value: 6, label: '6 %' },
  { value: 12, label: '12 %' },
  { value: 25, label: '25 %' },
  { value: 0, label: '0 %' },
]

export function AdminEventPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<AdminEventTicketsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!id) return
    try {
      const res = await callFunction<AdminEventTicketsResponse>(
        `admin-event-tickets?event_id=${id}`,
        { auth: true },
      )
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte hämta data.')
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate('/admin')
        return
      }
      load()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate])

  return (
    <Layout>
      <Link to="/admin" className="text-sm text-slate-500 hover:text-slate-800">
        &larr; Tillbaka till admin
      </Link>

      {error && <p className="text-red-600 mt-4">{error}</p>}
      {!data && !error && <p className="text-slate-500 mt-4">Laddar…</p>}

      {data && (
        <div className="mt-4">
          <h1 className="text-2xl font-bold">{data.event.title}</h1>
          <p className="text-slate-500 mb-1">
            {new Date(data.event.starts_at).toLocaleString('sv-SE', {
              dateStyle: 'long',
              timeStyle: 'short',
            })}
            {data.event.venue ? ` · ${data.event.venue}` : ''}
          </p>
          {/* Kapaciteten är en delad pott för HELA eventet (rättelseordern
              2026-08-05) - visas här en gång, inte upprepad per
              biljettyp. Redigeras från admin-huvudsidan (AdminPage.tsx). */}
          <p className="text-slate-500 mb-8">
            {data.event.sold_count} / {data.event.capacity} sålda totalt
          </p>

          <PostersSection
            eventId={data.event.id}
            posterLandscapeUrl={data.event.poster_landscape_url}
            posterPortraitUrl={data.event.poster_portrait_url}
            onChange={load}
          />

          <TicketTypesSection eventId={data.event.id} ticketTypes={data.ticket_types} onChange={load} />

          <h2 className="font-semibold mb-3 mt-8">Biljetter ({data.tickets.length})</h2>
          {data.tickets.length === 0 ? (
            <p className="text-slate-500">Inga biljetter sålda ännu.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="px-4 py-2">Kod</th>
                    <th className="px-4 py-2">Biljettyp</th>
                    <th className="px-4 py-2">Innehavare</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Incheckad</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tickets.map((ticket) => {
                    const ticketType = data.ticket_types.find((t) => t.id === ticket.ticket_type_id)
                    return (
                      <tr key={ticket.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-2 font-mono">{ticket.ticket_code}</td>
                        <td className="px-4 py-2">{ticketType?.name ?? '-'}</td>
                        <td className="px-4 py-2">{ticket.holder_name ?? '-'}</td>
                        <td className="px-4 py-2">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[ticket.status]}`}
                          >
                            {STATUS_LABEL[ticket.status]}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          {ticket.checked_in_at
                            ? new Date(ticket.checked_in_at).toLocaleString('sv-SE', {
                                dateStyle: 'short',
                                timeStyle: 'medium',
                              })
                            : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Layout>
  )
}

// Affischer (Tilläggsordern 2026-08-05): en liggande (1920x1080) och en
// stående (1080x1920) affisch per event. Måtten valideras HÄR, klientsidigt,
// innan filen ens skickas iväg - servern (admin-upload-poster) gör
// medvetet ingen dimensionskontroll (kostsamt att avkoda en bild bara för
// att mäta den i en Edge Function), se Tilläggsordern avsnitt 3/4.
const POSTER_SPECS: Record<'landscape' | 'portrait', { w: number; h: number; label: string }> = {
  landscape: { w: 1920, h: 1080, label: 'liggande, 1920×1080' },
  portrait: { w: 1080, h: 1920, label: 'stående, 1080×1920' },
}

const ALLOWED_POSTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function checkImageDimensions(file: File, expected: { w: number; h: number }): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const tolerance = 0.05
      const okW = Math.abs(img.naturalWidth - expected.w) / expected.w <= tolerance
      const okH = Math.abs(img.naturalHeight - expected.h) / expected.h <= tolerance
      resolve(okW && okH)
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => resolve(false)
    img.src = URL.createObjectURL(file)
  })
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Kunde inte läsa filen.'))
    reader.readAsDataURL(file)
  })
}

function PostersSection({
  eventId,
  posterLandscapeUrl,
  posterPortraitUrl,
  onChange,
}: {
  eventId: string
  posterLandscapeUrl: string | null
  posterPortraitUrl: string | null
  onChange: () => Promise<void>
}) {
  return (
    <section className="mb-8">
      <h2 className="font-semibold mb-3">Affischer</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PosterUploadField
          eventId={eventId}
          orientation="landscape"
          currentUrl={posterLandscapeUrl}
          onChange={onChange}
        />
        <PosterUploadField
          eventId={eventId}
          orientation="portrait"
          currentUrl={posterPortraitUrl}
          onChange={onChange}
        />
      </div>
    </section>
  )
}

function PosterUploadField({
  eventId,
  orientation,
  currentUrl,
  onChange,
}: {
  eventId: string
  orientation: 'landscape' | 'portrait'
  currentUrl: string | null
  onChange: () => Promise<void>
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const spec = POSTER_SPECS[orientation]

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // så samma fil kan väljas igen om uppladdningen misslyckas
    if (!file) return

    setError(null)

    if (!ALLOWED_POSTER_TYPES.has(file.type)) {
      setError('Bilden måste vara JPEG, PNG eller WebP.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Bilden är för stor (max 5 MB).')
      return
    }

    const dimensionsOk = await checkImageDimensions(file, spec)
    if (!dimensionsOk) {
      const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
        const img = new Image()
        img.onload = () => {
          resolve({ w: img.naturalWidth, h: img.naturalHeight })
          URL.revokeObjectURL(img.src)
        }
        img.onerror = () => resolve(null)
        img.src = URL.createObjectURL(file)
      })
      setError(
        dims
          ? `Bilden är ${dims.w}×${dims.h} — ladda upp en ${spec.label}-bild.`
          : `Kunde inte läsa bildens mått — ladda upp en ${spec.label}-bild.`,
      )
      return
    }

    setUploading(true)
    try {
      const fileBase64 = await fileToBase64(file)
      await callFunction('admin-upload-poster', {
        auth: true,
        method: 'POST',
        body: {
          event_id: eventId,
          orientation,
          file_base64: fileBase64,
          content_type: file.type,
        },
      })
      await onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte ladda upp affischen.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white">
      <label className="block text-sm font-medium mb-2">
        Affisch ({spec.label})
      </label>
      {currentUrl && (
        <img
          src={currentUrl}
          alt={`${spec.label}-affisch`}
          className={
            orientation === 'landscape'
              ? 'w-full aspect-video object-cover rounded mb-3 border border-slate-200'
              : 'w-32 aspect-[9/16] object-cover rounded mb-3 border border-slate-200'
          }
        />
      )}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        disabled={uploading}
        className="text-sm"
      />
      {uploading && <p className="text-slate-500 text-xs mt-2">Laddar upp…</p>}
      {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
    </div>
  )
}

// Biljettyper (Tilläggsordern avsnitt 5, uppdaterad av rättelseordern
// 2026-08-05): lista, lägg till, redigera, radera. Ingen egen kapacitet
// på biljettypen längre - kapaciteten är en delad pott på eventet (se
// AdminEventPage-huvudkomponenten ovan och AdminPage.tsx). sold_count
// visas bara som rapportering ("35 sålda"), ingen spärr kopplad till den
// här. Raderingsspärren (kan inte radera en typ med sålda biljetter)
// gäller server-side (admin-ticket-types) - felmeddelandet därifrån visas
// rakt av här, ingen dubblerad logik i frontend.
function TicketTypesSection({
  eventId,
  ticketTypes,
  onChange,
}: {
  eventId: string
  ticketTypes: TicketTypeRow[]
  onChange: () => Promise<void>
}) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [name, setName] = useState('')
  const [priceKr, setPriceKr] = useState(295)
  const [vatRate, setVatRate] = useState(6)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPriceKr, setEditPriceKr] = useState(0)
  const [editVatRate, setEditVatRate] = useState(6)
  const [editError, setEditError] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  function resetAddForm() {
    setName('')
    setPriceKr(295)
    setVatRate(6)
    setFormError(null)
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      await callFunction('admin-ticket-types', {
        auth: true,
        method: 'POST',
        body: {
          action: 'create',
          event_id: eventId,
          name,
          price_ore: Math.round(priceKr * 100),
          vat_rate: vatRate,
        },
      })
      resetAddForm()
      setShowAddForm(false)
      await onChange()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Kunde inte skapa biljettypen.')
    } finally {
      setSubmitting(false)
    }
  }

  function startEdit(t: TicketTypeRow) {
    setEditingId(t.id)
    setEditName(t.name)
    setEditPriceKr(t.price_ore / 100)
    setEditVatRate(t.vat_rate)
    setEditError(null)
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingId) return
    setSavingEdit(true)
    setEditError(null)
    try {
      await callFunction('admin-ticket-types', {
        auth: true,
        method: 'POST',
        body: {
          action: 'update',
          ticket_type_id: editingId,
          name: editName,
          price_ore: Math.round(editPriceKr * 100),
          vat_rate: editVatRate,
        },
      })
      setEditingId(null)
      await onChange()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Kunde inte spara ändringarna.')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleDelete(t: TicketTypeRow) {
    if (!window.confirm(`Radera biljettypen "${t.name}"?`)) return
    setDeletingId(t.id)
    setRowError(null)
    try {
      await callFunction('admin-ticket-types', {
        auth: true,
        method: 'POST',
        body: { action: 'delete', ticket_type_id: t.id },
      })
      await onChange()
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Kunde inte radera biljettypen.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Biljettyper</h2>
        <button
          type="button"
          onClick={() => setShowAddForm((s) => !s)}
          className="text-sm text-slate-600 hover:text-slate-900 underline"
        >
          {showAddForm ? 'Avbryt' : 'Lägg till biljettyp +'}
        </button>
      </div>

      {rowError && <p className="text-red-600 text-sm mb-3">{rowError}</p>}

      {showAddForm && (
        <form onSubmit={handleAdd} className="border border-slate-200 rounded-lg p-4 mb-4 space-y-4 bg-white">
          <div>
            <label className="block text-sm font-medium mb-2">Namn</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="field" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Pris (kr)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={priceKr}
                onChange={(e) => setPriceKr(Number(e.target.value))}
                className="field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Moms</label>
              <select value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))} className="field">
                {VAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {formError && <p className="text-red-600 text-sm">{formError}</p>}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Sparar…' : 'Lägg till'}
          </button>
        </form>
      )}

      {ticketTypes.length === 0 ? (
        <p className="text-slate-500 text-sm mb-2">
          Inga biljettyper ännu. Eventet kan inte publiceras förrän minst en finns.
        </p>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-4 py-2">Namn</th>
                <th className="px-4 py-2">Pris</th>
                <th className="px-4 py-2">Moms</th>
                <th className="px-4 py-2">Sålt</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {ticketTypes.map((t) =>
                editingId === t.id ? (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0 bg-rose-50">
                    <td colSpan={5} className="px-4 py-3">
                      <form onSubmit={handleSaveEdit} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                        <div>
                          <label className="block text-xs font-medium mb-1">Namn</label>
                          <input required value={editName} onChange={(e) => setEditName(e.target.value)} className="field" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Pris (kr)</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={editPriceKr}
                            onChange={(e) => setEditPriceKr(Number(e.target.value))}
                            className="field"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Moms</label>
                          <select value={editVatRate} onChange={(e) => setEditVatRate(Number(e.target.value))} className="field">
                            {VAT_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button type="submit" disabled={savingEdit} className="btn-primary text-sm px-3 py-1.5">
                            Spara
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="btn-secondary text-sm px-3 py-1.5"
                          >
                            Avbryt
                          </button>
                        </div>
                        {editError && <p className="text-red-600 text-xs col-span-full">{editError}</p>}
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 font-medium">{t.name}</td>
                    <td className="px-4 py-2">
                      {(t.price_ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr
                    </td>
                    <td className="px-4 py-2">{t.vat_rate}%</td>
                    <td className="px-4 py-2">{t.sold_count}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => startEdit(t)}
                        className="text-slate-600 hover:text-slate-900 underline text-xs mr-3"
                      >
                        Redigera
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(t)}
                        disabled={deletingId === t.id}
                        className="text-red-600 hover:text-red-800 underline text-xs disabled:opacity-50"
                      >
                        {deletingId === t.id ? 'Raderar…' : 'Radera'}
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
