import { useEffect, type ReactNode } from 'react'

interface SidePanelProps {
  open: boolean
  title: string
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Lägger panelen ovanpå en annan panel (t.ex. orderdetalj från köparlistan). */
  elevated?: boolean
}

// Utskjutande panel från höger (desktop) / nedifrån (mobil) - samma
// mönster som BookingListPanel i CORE. Stängs via bakgrund, krysset eller Esc.
export function SidePanel({ open, title, subtitle, onClose, children, footer, elevated }: SidePanelProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const z = elevated ? 'z-[70]' : 'z-50'
  const zBackdrop = elevated ? 'z-[60]' : 'z-40'

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/25 ${zBackdrop} transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!open}
        className={`fixed inset-x-0 bottom-0 ${z} flex max-h-[88dvh] w-full flex-col rounded-t-[24px] bg-[var(--surface)] text-[var(--text)] shadow-2xl transition-transform duration-300 ease-out md:inset-x-auto md:bottom-auto md:right-0 md:top-0 md:h-full md:max-h-none md:max-w-md md:rounded-none ${
          open ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-y-0 md:translate-x-full'
        }`}
      >
        <div className="mx-auto mt-3 h-1 w-11 rounded-full bg-[var(--border-strong)] md:hidden" />
        <div className="flex items-start justify-between gap-4 p-5 border-b border-[var(--border)]">
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-[var(--text)] break-words">{title}</h2>
            {subtitle && <div className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng"
            className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{open && children}</div>
        {footer && open && <div className="border-t border-[var(--border)] p-4">{footer}</div>}
      </div>
    </>
  )
}
