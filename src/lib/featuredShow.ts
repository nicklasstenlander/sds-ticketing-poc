// Vilken föreställning som visas stort på /evenemang (ordern "Klickbara
// föreställningar på /evenemang", 2026-10-22). Rena funktioner utan React
// eller Supabase, så att scripts/check-featured-show.ts kan testa dem
// fristående i Deno.

interface ShowLike {
  slug: string
  title: string
  venue: string | null
}

// En föreställning (samma titel/plats) visas som EN affischruta med en
// knapp per speltid - varje speltid är fortfarande ett eget event med eget
// pris, eget säljläge och egen köplänk.
export function groupShows<T extends ShowLike>(events: T[]): T[][] {
  const groups = new Map<string, T[]>()
  for (const e of events) {
    const key = [e.title, e.venue ?? ''].join('|')
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  return [...groups.values()]
}

// /evenemang/:slug - slugen kan vara VILKEN speltid som helst i en
// föreställning; hela gruppen visas då stort. Utan slug (eller med en slug
// som inte finns) visas den första föreställningen som tidigare. Övriga
// grupper behåller sin ordning i "Fler föreställningar", så den som var
// stor innan hamnar där utan dubbletter.
export function pickFeatured<T extends ShowLike>(
  groups: T[][],
  slug: string | undefined,
): { featured: T[] | undefined; rest: T[][]; notFound: boolean } {
  const index = slug ? groups.findIndex((g) => g.some((e) => e.slug === slug)) : -1
  const chosen = index === -1 ? 0 : index
  return {
    featured: groups[chosen],
    rest: groups.filter((_, i) => i !== chosen),
    notFound: Boolean(slug) && index === -1,
  }
}
