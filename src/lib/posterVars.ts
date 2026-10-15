import type { CSSProperties } from 'react'

// Affischens båda format som CSS-variabler (--poster-l = liggande, --poster-p
// = stående). CSS väljer vilken som ligger närmast bakom affischen (den
// suddade ytan i .poster-frame och .stage-backdrop) beroende på skärmbredd,
// och faller tillbaka på det andra formatet om bara ett finns - så sidan
// klarar vilken affisch en arrangör än laddar upp.
function cssUrl(url: string | null | undefined): string | undefined {
  return url ? `url(${JSON.stringify(url)})` : undefined
}

export function posterVars(landscape: string | null | undefined, portrait: string | null | undefined): CSSProperties {
  return { '--poster-l': cssUrl(landscape), '--poster-p': cssUrl(portrait) } as CSSProperties
}
