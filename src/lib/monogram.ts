// Initialer för affischlösa event (ram med monogram istället för tomt hål).
export function monogram(title: string): string {
  const words = title.split(/\s+/).filter((w) => w.length > 2 || /^\p{Lu}/u.test(w))
  return (words.length > 0 ? words : title.split(/\s+/))
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
}
