// Prisformat (ordern "Små ändringar i frontend" 2026-10-10, punkt 3):
// heltal i kronor utan decimaler när beloppet är jämnt ("200 kr", inte
// "200,00 kr"), decimaler kvar när de faktiskt behövs ("295,50 kr").
// Gäller /evenemang och köpsidan - samma regel återimplementerad separat
// i embed.js (kan inte dela denna modul, bundlas separat, se formatPrice
// där).
export function formatKr(ore: number): string {
  const isWhole = ore % 100 === 0
  return (ore / 100).toLocaleString(
    'sv-SE',
    isWhole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  )
}
