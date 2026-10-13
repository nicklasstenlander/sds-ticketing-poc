import { createRoot } from 'react-dom/client'
import { useEffect, useRef } from 'react'

interface ConfirmOptions {
  confirmLabel?: string
  cancelLabel?: string
  // Röd bekräftaknapp för oåterkalleliga åtgärder (radera, ta bort).
  danger?: boolean
}

function ConfirmDialog({
  message,
  options,
  onResult,
}: {
  message: string
  options: ConfirmOptions
  onResult: (ok: boolean) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-describedby="confirm-message"
      onCancel={(e) => {
        e.preventDefault()
        onResult(false)
      }}
      onClick={(e) => {
        if (e.target === ref.current) onResult(false)
      }}
    >
      <p id="confirm-message" className="confirm-message">
        {message}
      </p>
      <div className="confirm-actions">
        <button type="button" className="btn-secondary" onClick={() => onResult(false)} autoFocus>
          {options.cancelLabel ?? 'Avbryt'}
        </button>
        <button
          type="button"
          className={options.danger ? 'btn-primary btn-danger' : 'btn-primary'}
          onClick={() => onResult(true)}
        >
          {options.confirmLabel ?? 'Bekräfta'}
        </button>
      </div>
    </dialog>
  )
}

// Ersätter window.confirm() - samma anrop (await), men en formgiven dialog
// med fokusfälla (native <dialog>.showModal()), Esc = avbryt och
// avbryt som förvald knapp så att Enter aldrig råkar radera något.
export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const done = (ok: boolean) => {
      root.unmount()
      host.remove()
      resolve(ok)
    }
    root.render(<ConfirmDialog message={message} options={options} onResult={done} />)
  })
}
