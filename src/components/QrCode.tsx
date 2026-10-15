import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

// QR-kod som ren SVG (skarp i alla storlekar, ingen bild att ladda). Alltid
// mörka moduler på vit botten med fyra moduler tyst zon, så den går att
// skanna även från en skärm på avstånd.
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`
      }
    }
    return { size: n + 8, path: d }
  }, [value])
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
