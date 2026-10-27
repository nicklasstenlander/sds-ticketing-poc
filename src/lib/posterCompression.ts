// Komprimering av affischer i webbläsaren innan uppladdning (egress-ordern
// 2026-10-26). Gratisplanen har 5 GB egress och evenemangslistan laddade
// ~2 MB affischer per sidvisning (PNG ~359 kB / JPG ~162 kB styck).
//
// Maxmåtten matchar största visningen i 2x-upplösning: liggande hero på
// smal skärm (<900px, fyller bredden) och stående i heron på bred skärm
// (16:9-ram ~600px hög -> ~1200px i 2x) / rutnätet (~350px bred -> 700px).
// Uppmätt på de befintliga affischerna: 30-150 kB i WebP q80, läsbar text.
//
// Samma mått och kvalitet används av engångsskriptet
// scripts/convert-posters-to-webp.mjs - ändra båda om de ändras.

export type PosterOrientation = 'landscape' | 'portrait'

export const POSTER_MAX_SIZE: Record<PosterOrientation, { w: number; h: number }> = {
  landscape: { w: 1600, h: 900 },
  portrait: { w: 800, h: 1422 },
}

export const POSTER_WEBP_QUALITY = 0.8
// Safari kan inte koda WebP i canvas (toBlob ger då PNG) - JPEG är då
// reserven. WebKits JPEG-kodare ger stora filer för foton (uppmätt: en
// 158 kB JPG blev 338 kB vid 0.82), så kvaliteten trappas ner tills
// filen når målet, och originalet behålls om det ändå är mindre.
const POSTER_JPEG_QUALITIES = [0.75, 0.65, 0.55]
const POSTER_TARGET_BYTES = 150 * 1024

/** Skalar ner (aldrig upp) så att bilden ryms inom maxmåtten, med bibehållna proportioner. */
export function posterTargetSize(w: number, h: number, orientation: PosterOrientation): { w: number; h: number } {
  const max = POSTER_MAX_SIZE[orientation]
  const scale = Math.min(1, max.w / w, max.h / h)
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** Skalar ner och kodar om affischen till WebP (JPEG i Safari). Blir
 * resultatet ändå större än originalet returneras originalet. */
export async function compressPoster(file: File, orientation: PosterOrientation): Promise<Blob> {
  const compressed = await encodePoster(file, orientation)
  return compressed.size < file.size ? compressed : file
}

async function encodePoster(file: File, orientation: PosterOrientation): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const size = posterTargetSize(bitmap.width, bitmap.height, orientation)
    const canvas = document.createElement('canvas')
    canvas.width = size.w
    canvas.height = size.h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Kunde inte komprimera bilden.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, size.w, size.h)

    const webp = await canvasToBlob(canvas, 'image/webp', POSTER_WEBP_QUALITY)
    if (webp && webp.type === 'image/webp') return webp
    let smallest: Blob | null = null
    for (const quality of POSTER_JPEG_QUALITIES) {
      const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality)
      if (!jpeg || jpeg.type !== 'image/jpeg') break
      if (!smallest || jpeg.size < smallest.size) smallest = jpeg
      if (jpeg.size <= POSTER_TARGET_BYTES) break
    }
    if (smallest) return smallest
    throw new Error('Kunde inte komprimera bilden.')
  } finally {
    bitmap.close()
  }
}
