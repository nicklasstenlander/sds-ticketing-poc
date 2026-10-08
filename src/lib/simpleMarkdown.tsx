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

export function renderMarkdown(markdown: string): ReactNode {
  const blocks = markdown.trim().split(/\n{2,}/)
  return blocks.map((block, i) => {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (lines.length === 0) return null

    if (lines.length === 1 && lines[0].startsWith('# ')) {
      return (
        <h1 key={i} className="text-2xl font-bold text-[var(--text)] mb-4">
          {renderInline(lines[0].slice(2), `h1-${i}`)}
        </h1>
      )
    }
    if (lines.length === 1 && lines[0].startsWith('## ')) {
      return (
        <h2 key={i} className="text-lg font-bold text-[var(--text)] mt-8 mb-3">
          {renderInline(lines[0].slice(3), `h2-${i}`)}
        </h2>
      )
    }
    if (lines.every((l) => l.startsWith('- '))) {
      return (
        <ul key={i} className="list-disc pl-5 mb-4 space-y-1.5 text-base leading-relaxed text-[var(--text)]">
          {lines.map((l, j) => (
            <li key={j}>{renderInline(l.slice(2), `li-${i}-${j}`)}</li>
          ))}
        </ul>
      )
    }
    return (
      <p key={i} className="mb-4 text-base leading-relaxed text-[var(--text)]">
        {renderInline(lines.join(' '), `p-${i}`)}
      </p>
    )
  })
}
