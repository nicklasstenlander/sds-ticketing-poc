import type { ReactNode } from 'react'

// Minimal, egen Markdown-rendering (ordern "Köpvillkor som egen sida i
// Rideau" 2026-10-07, punkt 1: "Lägg inte till något tungt bibliotek om
// det går att undvika") - stödjer bara det köpvillkorstexten faktiskt
// använder: "# "/"## "-rubriker, **fet**/*kursiv* text, och "- "-listor.
// Inget annat (länkar, kodblock, tabeller, nästlade listor, citat) -
// lägg inte till stöd för det i förväg, bygg ut om/när ett nytt
// innehåll faktiskt behöver det.

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // Delar på **fet** eller *kursiv* - split() med en fångande grupp
  // behåller avgränsarna i resultatet, så ren text och formaterade
  // spans hamnar i samma lista i rätt ordning.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((p) => p.length > 0)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={`${keyPrefix}-${i}`}>{part.slice(1, -1)}</em>
    }
    return part
  })
}

// Stabilt id för en "## "-rubrik, så att innehållsförteckningen på
// villkorssidan kan hoppa dit ("2. Pris och betalning" -> "villkor-2").
// Numret räcker och tål att rubriktexten ändras.
export function headingId(text: string, index: number): string {
  const num = text.match(/^(\d+)\./)?.[1]
  return `villkor-${num ?? index + 1}`
}

// "## "-rubrikerna i ordning, för innehållsförteckningen.
export function markdownHeadings(markdown: string): { id: string; text: string }[] {
  return markdown
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('## '))
    .map((l, i) => ({ id: headingId(l.slice(3), i), text: l.slice(3) }))
}

// Stilarna kommer från omslutande .terms-body i index.css - inga
// verktygsklasser här, så att sidan kan byta utseende (mörk scen, utskrift)
// utan att renderaren ändras.
export function renderMarkdown(markdown: string): ReactNode {
  let h2Index = 0
  const blocks = markdown.trim().split(/\n{2,}/)
  return blocks.map((block, i) => {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (lines.length === 0) return null

    if (lines.length === 1 && lines[0].startsWith('# ')) {
      return (
        <h1 key={i}>
          {renderInline(lines[0].slice(2), `h1-${i}`)}
        </h1>
      )
    }
    if (lines.length === 1 && lines[0].startsWith('## ')) {
      const text = lines[0].slice(3)
      const id = headingId(text, h2Index++)
      return (
        <h2 key={i} id={id} tabIndex={-1}>
          {renderInline(text, `h2-${i}`)}
        </h2>
      )
    }
    if (lines.every((l) => l.startsWith('- '))) {
      return (
        <ul key={i}>
          {lines.map((l, j) => (
            <li key={j}>{renderInline(l.slice(2), `li-${i}-${j}`)}</li>
          ))}
        </ul>
      )
    }
    return (
      <p key={i}>
        {renderInline(lines.join(' '), `p-${i}`)}
      </p>
    )
  })
}
