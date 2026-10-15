import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { AdminNav } from '../components/AdminNav'
import { callFunction } from '../lib/functionsApi'
import { supabase } from '../lib/supabaseClient'
import type { AdminOrderRow, EventRow, TicketRow, TicketTypeRow } from '../lib/types'
import { formatStockholmDateTimeLocale } from '../lib/stockholmTime'
import { formatKr } from '../lib/formatPrice'
import { confirmDialog } from '../lib/confirmDialog'

interface AdminEventTicketsResponse {
  event: EventRow
  ticket_types: TicketTypeRow[]
  tickets: TicketRow[]
  orders: AdminOrderRow[]
}

const ORDER_STATUS_LABEL: Record<AdminOrderRow['status'], string> = {
  pending: 'Väntande',
  paid: 'Betald',
  expired: 'Utgången',
  cancelled: 'Avbokad',
}

const STATUS_LABEL: Record<TicketRow['status'], string> = {
  valid: 'Giltig (ej incheckad)',
  checked_in: 'Incheckad',
  void: 'Annullerad',
}

const STATUS_STYLE: Record<TicketRow['status'], string> = {
  valid: 'bg-[#ececea] text-[var(--text)]',
  checked_in: 'bg-[var(--success-soft)] text-[var(--success-ink)]',
  void: 'bg-red-100 text-[var(--danger)]',
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
    <Layout
      wide
      band={
        <>
          <AdminNav />
          <Link to="/admin" className="admin-back">
            &larr; Tillbaka till admin
          </Link>
          {data && (
            <div className="hero-split admin-event-hero">
              <div className="min-w-0">
                <h1 className="page-title">{data.event.title}</h1>
                <p className="page-lede">
                  {data.event.starts_at
                    ? // steg 1b: explicit Europe/Stockholm (se stockholmTime.ts).
                      formatStockholmDateTimeLocale(data.event.starts_at, { dateStyle: 'long', timeStyle: 'short' })
                    : 'Inget datum satt ännu — sätt det på admin-huvudsidan innan publicering'}
                  {data.event.venue ? ` · ${data.event.venue}` : ''}
                </p>
                {/* Kapaciteten är en delad pott för HELA eventet (rättelseordern
                    2026-08-05) - visas här en gång, inte upprepad per
                    biljettyp. Redigeras från admin-huvudsidan (AdminPage.tsx). */}
                <p className="admin-band-meta">
                  {data.event.sold_count} / {data.event.capacity} sålda totalt
                </p>
              </div>
              {(data.event.poster_landscape_url || data.event.poster_portrait_url) && (
                <div className="admin-event-poster">
                  <img
                    src={(data.event.poster_landscape_url ?? data.event.poster_portrait_url)!}
                    alt={`Affisch: ${data.event.title}`}
                  />
                </div>
              )}
            </div>
          )}
        </>
      }
    >
      {error && <p className="text-[var(--danger)] mt-4">{error}</p>}
      {!data && !error && <p className="text-[var(--text-muted)] mt-4">Laddar…</p>}

      {data && (
        <div>
          {/* Arkiverat event (ordern "Arkiv för ordrar och event"
              2026-10-12) - synligt här även om man kommer direkt till
              den här sidan (t.ex. en sparad länk) utan att ha sett
              badgen i adminlistan. Återställning görs från adminlistan
              (AdminPage.tsx), inte här - undviker två olika ställen med
              samma knapp. */}
          {data.event.archived_at && (
            <p className="mb-6 rounded-lg border border-[var(--border)] bg-[#ececea] px-4 py-3 text-sm text-[var(--text)]">
              Det här eventet är arkiverat (orsak: {data.event.archived_reason === 'test' ? 'testdata' : 'dold'}).
              Återställ det från adminlistan för att redigera igen.
            </p>
          )}

          <PostersSection
            eventId={data.event.id}
            posterLandscapeUrl={data.event.poster_landscape_url}
            posterPortraitUrl={data.event.poster_portrait_url}
            onChange={load}
          />

          <TicketTypesSection eventId={data.event.id} ticketTypes={data.ticket_types} onChange={load} />

          <OrdersSection orders={data.orders} tickets={data.tickets} onChange={load} />

          <h2 className="text-lg font-extrabold mb-3 mt-8">Biljetter ({data.tickets.length})</h2>
          {data.tickets.length === 0 ? (
            <p className="text-[var(--text-muted)]">Inga biljetter sålda ännu.</p>
          ) : (
            <div className="overflow-x-auto border border-[var(--border)] rounded-lg bg-white">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--text-muted)]">
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
                      <tr key={ticket.id} className="border-b border-[var(--border)] last:border-0">
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
      <h2 className="text-lg font-extrabold mb-3">Affischer</h2>
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
    <div className="border border-[var(--border)] rounded-lg p-4 bg-white">
      <div className="block text-sm font-semibold mb-2">
        Affisch ({spec.label})
      </div>
      {currentUrl && (
        <img
          src={currentUrl}
          alt={`${spec.label}-affisch`}
          className={
            orientation === 'landscape'
              ? 'w-full aspect-video object-cover rounded mb-3 border border-[var(--border)]'
              : 'w-32 aspect-[9/16] object-cover rounded mb-3 border border-[var(--border)]'
          }
        />
      )}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        disabled={uploading}
        aria-label={`Välj fil: affisch (${spec.label})`}
        className="file-input"
      />
      {uploading && <p className="text-[var(--text-muted)] text-xs mt-2">Laddar upp…</p>}
      {error && <p className="text-[var(--danger)] text-xs mt-2">{error}</p>}
    </div>
  )
}

// Ordrar (ordern "Arkiv för ordrar och event" 2026-10-12, DEL 2 punkt 1 -
// "order-arkivering som tillägg, enskilt och flerval"). Döljer arkiverade
// ordrar som standard ("Visa arkiverade ordrar"-växel, samma princip som
// adminlistans "Visa arkiverade" för event). EN delad reason-väljare för
// både enskild och flervalsarkivering - admin kryssar i en eller flera
// rader och klickar "Arkivera valda", inget separat enrads-flöde.
// Återställning är per rad (reversibelt, inget val av orsak behövs).
function OrdersSection({
  orders,
  tickets,
  onChange,
}: {
  orders: AdminOrderRow[]
  tickets: TicketRow[]
  onChange: () => Promise<void>
}) {
  const [showArchived, setShowArchived] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pickingReason, setPickingReason] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  // Sök (ordern "Avbokning, återbetalning, omsändning och köparmeddelanden"
  // 2026-10-12, STEG 2.3) - ett klientsidigt textfilter på redan hämtade
  // ordrar för DET HÄR eventet, inte en ny sökendpoint. "Söker bara inom
  // arrangörens egna event" är redan sant per konstruktion - orders kommer
  // bara från admin-event-tickets, som redan är scopead till arrangörens
  // eget event, se filkommentaren där.
  const [search, setSearch] = useState('')
  // Skicka biljetter igen (2.1/2.3) - resendOrderId är raden vars
  // bekräftelseruta är öppen just nu, resendTo det redigerbara
  // mottagarfältet (förifyllt med köparens egen adress).
  const [resendOrderId, setResendOrderId] = useState<string | null>(null)
  const [resendTo, setResendTo] = useState('')
  const [resendBusyId, setResendBusyId] = useState<string | null>(null)
  const [resendMessage, setResendMessage] = useState<{ orderId: string; text: string; isError: boolean } | null>(null)
  // Avboka order (2.2/2.3)
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null)
  const [cancelMessage, setCancelMessage] = useState<{ orderId: string; text: string } | null>(null)

  const visibleOrders = (showArchived ? orders : orders.filter((o) => !o.archived_at)).filter((o) => {
    const term = search.trim().toLowerCase()
    if (!term) return true
    return (
      o.buyer_name.toLowerCase().includes(term) ||
      o.buyer_email.toLowerCase().includes(term) ||
      o.id.toLowerCase().includes(term)
    )
  })
  const selectedActiveIds = [...selected].filter((id) => orders.some((o) => o.id === id && !o.archived_at))

  function openResend(order: AdminOrderRow) {
    setResendOrderId(order.id)
    setResendTo(order.buyer_email)
    setResendMessage(null)
  }

  async function confirmResend(order: AdminOrderRow) {
    setResendBusyId(order.id)
    try {
      const res = await callFunction<{ result: string; regenerated_qr_count: number }>('admin-resend-tickets', {
        auth: true,
        method: 'POST',
        body: { order_id: order.id, to: resendTo.trim() },
      })
      setResendMessage({
        orderId: order.id,
        text: res.regenerated_qr_count > 0 ? `Skickat. (${res.regenerated_qr_count} QR-kod(er) genererades om.)` : 'Skickat.',
        isError: false,
      })
      setResendOrderId(null)
    } catch (err) {
      setResendMessage({
        orderId: order.id,
        text: err instanceof Error ? err.message : 'Kunde inte skicka.',
        isError: true,
      })
    } finally {
      setResendBusyId(null)
    }
  }

  async function handleCancelOrder(order: AdminOrderRow) {
    // Varning om redan incheckade biljetter (admin bad om detta separat,
    // 2026-10-12) - cancel_paid_order (databasfunktionen) sätter ALLA
    // ordens biljetter till void oavsett status, inklusive redan
    // incheckade. Det ändras inte här - bara en tydlig varning INNAN
    // bekräftelse, beräknad klientsidigt från data.tickets (redan
    // hämtat av admin-event-tickets för gästlistan, inget nytt anrop).
    const checkedInCount = tickets.filter((t) => t.order_id === order.id && t.status === 'checked_in').length
    const checkedInWarning =
      checkedInCount > 0
        ? `\n\nOBS: ${checkedInCount} biljett${checkedInCount === 1 ? '' : 'er'} på den här ordern är redan incheckad${checkedInCount === 1 ? '' : 'e'}.`
        : ''
    if (
      !await confirmDialog(
        `Avboka ordern för ${order.buyer_name}? En eventuell återbetalning görs separat i Stripe - den här åtgärden rör inte Stripe.${checkedInWarning}`,
      )
    ) {
      return
    }
    setCancelBusyId(order.id)
    setCancelMessage(null)
    try {
      const res = await callFunction<{ result: string; warning: string | null; already_cancelled?: boolean }>(
        'admin-cancel-order',
        { auth: true, method: 'POST', body: { order_id: order.id } },
      )
      setCancelMessage({ orderId: order.id, text: res.warning ?? 'Ordern är avbokad.' })
      await onChange()
    } catch (err) {
      setCancelMessage({ orderId: order.id, text: err instanceof Error ? err.message : 'Kunde inte avboka ordern.' })
    } finally {
      setCancelBusyId(null)
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleArchiveSelected(reason: 'test' | 'hidden') {
    if (selectedActiveIds.length === 0) return
    const reasonLabel = reason === 'test' ? 'testdata (utesluts ur bokföringsexporten)' : 'dold (ligger kvar i bokföringsexporten)'
    if (!await confirmDialog(`Arkivera ${selectedActiveIds.length} order${selectedActiveIds.length === 1 ? '' : 'ar'} som ${reasonLabel}? Går att återställa senare.`)) {
      return
    }
    setPickingReason(false)
    setError(null)
    setBusyIds(new Set(selectedActiveIds))
    try {
      await callFunction('admin-archive-orders', {
        auth: true,
        method: 'POST',
        body: { order_ids: selectedActiveIds, action: 'archive', reason },
      })
      setSelected(new Set())
      await onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte arkivera ordrarna.')
    } finally {
      setBusyIds(new Set())
    }
  }

  async function handleRestore(order: AdminOrderRow) {
    setError(null)
    setBusyIds((prev) => new Set(prev).add(order.id))
    try {
      await callFunction('admin-archive-orders', {
        auth: true,
        method: 'POST',
        body: { order_ids: [order.id], action: 'restore' },
      })
      await onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte återställa ordern.')
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        next.delete(order.id)
        return next
      })
    }
  }

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-extrabold">Ordrar ({orders.length})</h2>
        <label className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => {
              setShowArchived(e.target.checked)
              setSelected(new Set())
            }}
          />
          Visa arkiverade ordrar
        </label>
      </div>

      {error && <p className="text-[var(--danger)] text-sm mb-2">{error}</p>}

      <div className="mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sök namn, e-post eller ordernummer…"
          className="field max-w-sm text-sm"
        />
      </div>

      {visibleOrders.length === 0 ? (
        <p className="text-[var(--text-muted)]">Inga ordrar{search.trim() ? ' matchar sökningen' : ' ännu'}.</p>
      ) : (
        <>
          <div className="overflow-x-auto border border-[var(--border)] rounded-lg bg-white">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--text-muted)]">
                  <th className="px-4 py-2"></th>
                  <th className="px-4 py-2">Köpare</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Antal</th>
                  <th className="px-4 py-2">Belopp</th>
                  <th className="px-4 py-2">Villkor</th>
                  <th className="px-4 py-2">Datum</th>
                  <th className="px-4 py-2">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => {
                  const canAct = order.status === 'paid' && !order.archived_at
                  return (
                    <tr key={order.id} className="border-b border-[var(--border)] last:border-0 align-top">
                      <td className="px-4 py-2">
                        {!order.archived_at && (
                          <input
                            type="checkbox"
                            checked={selected.has(order.id)}
                            onChange={() => toggleSelected(order.id)}
                            disabled={busyIds.has(order.id)}
                          />
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div>{order.buyer_name}</div>
                        <div className="text-xs text-slate-400">{order.buyer_email}</div>
                        <div className="text-xs text-slate-300 font-mono">{order.id}</div>
                      </td>
                      <td className="px-4 py-2">{ORDER_STATUS_LABEL[order.status]}</td>
                      <td className="px-4 py-2">{order.ticket_qty}</td>
                      <td className="px-4 py-2">{order.total_ore !== null ? `${formatKr(order.total_ore)} kr` : '-'}</td>
                      <td className="px-4 py-2">{order.terms_version ?? '–'}</td>
                      <td className="px-4 py-2">
                        {new Date(order.created_at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-col gap-1">
                          {order.archived_at ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs px-2 py-0.5 rounded-full bg-[#ececea] text-[var(--text-muted)]">
                                Arkiverad ({order.archived_reason === 'test' ? 'testdata' : 'dold'})
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRestore(order)}
                                disabled={busyIds.has(order.id)}
                                className="text-xs underline disabled:opacity-50"
                              >
                                {busyIds.has(order.id) ? 'Återställer…' : 'Återställ'}
                              </button>
                            </div>
                          ) : canAct ? (
                            resendOrderId === order.id ? (
                              <div className="flex flex-col gap-1.5 max-w-[220px]">
                                <input
                                  type="email"
                                  value={resendTo}
                                  onChange={(e) => setResendTo(e.target.value)}
                                  className="field text-xs py-1"
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => confirmResend(order)}
                                    disabled={resendBusyId === order.id}
                                    className="text-xs underline disabled:opacity-50"
                                  >
                                    {resendBusyId === order.id ? 'Skickar…' : 'Bekräfta'}
                                  </button>
                                  <button type="button" onClick={() => setResendOrderId(null)} className="text-xs underline">
                                    Avbryt
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex gap-3">
                                <button type="button" onClick={() => openResend(order)} className="text-xs underline">
                                  Skicka biljetter igen
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCancelOrder(order)}
                                  disabled={cancelBusyId === order.id}
                                  className="text-xs underline text-[var(--danger)] disabled:opacity-50"
                                >
                                  {cancelBusyId === order.id ? 'Avbokar…' : 'Avboka order'}
                                </button>
                              </div>
                            )
                          ) : null}
                          {/* Meddelanden visas OBEROENDE av canAct - en
                              avbokning gör ju att ordern slutar vara
                              "paid" vid nästa omladdning (onChange), och
                              Stripe-varningen är precis det admin behöver
                              se KVAR efter att avbokningen lyckats. */}
                          {resendMessage?.orderId === order.id && (
                            <span className={`text-xs ${resendMessage.isError ? 'text-[var(--danger)]' : 'text-[var(--success-ink)]'}`}>
                              {resendMessage.text}
                            </span>
                          )}
                          {cancelMessage?.orderId === order.id && (
                            <span className="text-xs text-[var(--warning-ink)]">{cancelMessage.text}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {pickingReason ? (
              <>
                <span className="text-sm text-[var(--text)]">Arkivera {selectedActiveIds.length} valda som:</span>
                <button type="button" onClick={() => handleArchiveSelected('test')} className="admin-action-btn">
                  Testdata (uteslut ur export)
                </button>
                <button type="button" onClick={() => handleArchiveSelected('hidden')} className="admin-action-btn">
                  Dölj (riktig betalning, kvar i export)
                </button>
                <button type="button" onClick={() => setPickingReason(false)} className="admin-action-btn">
                  Avbryt
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setPickingReason(true)}
                disabled={selectedActiveIds.length === 0}
                className="admin-action-btn disabled:opacity-50"
              >
                Arkivera valda ({selectedActiveIds.length})
              </button>
            )}
          </div>
        </>
      )}
    </section>
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
    if (!await confirmDialog(`Radera biljettypen "${t.name}"?`, { danger: true, confirmLabel: 'Radera' })) return
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
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-extrabold">Biljettyper</h2>
        <button
          type="button"
          onClick={() => setShowAddForm((s) => !s)}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] underline"
        >
          {showAddForm ? 'Avbryt' : 'Lägg till biljettyp +'}
        </button>
      </div>

      {rowError && <p className="text-[var(--danger)] text-sm mb-3">{rowError}</p>}

      {showAddForm && (
        <form onSubmit={handleAdd} className="border border-[var(--border)] rounded-lg p-4 mb-4 space-y-4 bg-white">
          <div>
            <label className="block">
              <span className="block text-sm font-medium mb-2">Namn</span>
              <input required value={name} onChange={(e) => setName(e.target.value)} className="field" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block">
                <span className="block text-sm font-medium mb-2">Pris (kr)</span>
                <input
                type="number"
                min={0}
                step="0.01"
                value={priceKr}
                onChange={(e) => setPriceKr(Number(e.target.value))}
                className="field"
              />
              </label>
            </div>
            <div>
              <label className="block">
                <span className="block text-sm font-medium mb-2">Moms</span>
                <select value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))} className="field">
                {VAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              </label>
            </div>
          </div>
          {formError && <p className="text-[var(--danger)] text-sm">{formError}</p>}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Sparar…' : 'Lägg till'}
          </button>
        </form>
      )}

      {ticketTypes.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm mb-2">
          Inga biljettyper ännu. Eventet kan inte publiceras förrän minst en finns.
        </p>
      ) : (
        <div className="overflow-x-auto border border-[var(--border)] rounded-lg bg-white">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[var(--text-muted)]">
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
                  <tr key={t.id} className="border-b border-[var(--border)] last:border-0 bg-[var(--editing-soft)]">
                    <td colSpan={5} className="px-4 py-3">
                      <form onSubmit={handleSaveEdit} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                        <div>
                          <label className="block">
                            <span className="block text-xs font-medium mb-1">Namn</span>
                            <input required value={editName} onChange={(e) => setEditName(e.target.value)} className="field" />
                          </label>
                        </div>
                        <div>
                          <label className="block">
                            <span className="block text-xs font-medium mb-1">Pris (kr)</span>
                            <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={editPriceKr}
                            onChange={(e) => setEditPriceKr(Number(e.target.value))}
                            className="field"
                          />
                          </label>
                        </div>
                        <div>
                          <label className="block">
                            <span className="block text-xs font-medium mb-1">Moms</span>
                            <select value={editVatRate} onChange={(e) => setEditVatRate(Number(e.target.value))} className="field">
                            {VAT_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          </label>
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
                        {editError && <p className="text-[var(--danger)] text-xs col-span-full">{editError}</p>}
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={t.id} className="border-b border-[var(--border)] last:border-0">
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
                        className="text-[var(--text-muted)] hover:text-[var(--text)] underline text-xs mr-3"
                      >
                        Redigera
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(t)}
                        disabled={deletingId === t.id}
                        className="text-[var(--danger)] hover:underline underline text-xs disabled:opacity-50"
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
