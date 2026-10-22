// Ordern "Klickbara föreställningar på /evenemang" (2026-10-22). Fristående
// Deno-kontroll av groupShows/pickFeatured (samma mönster som
// scripts/check-step1.ts - projektet har ingen vitest/jest). Klick,
// scroll och bakåtknappen testas i webbläsare av scripts/test-events-page.mjs.
//
// Kör: deno run scripts/check-featured-show.ts
import { groupShows, pickFeatured } from '../src/lib/featuredShow.ts'

let failures = 0
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} - fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`)
  if (!ok) failures++
}

const ev = (slug: string, title: string, venue: string | null = 'Scen') => ({ slug, title, venue })
const events = [
  ev('atw-1000', 'Around the World'),
  ev('atw-1300', 'Around the World'),
  ev('color-me', 'COLOR ME'),
  ev('atw-1600', 'Around the World'),
  ev('julshow', 'Julshow', null),
]
const groups = groupShows(events)
const slugs = (g: { slug: string }[] | undefined) => g?.map((e) => e.slug)

assertEqual(groups.map(slugs), [['atw-1000', 'atw-1300', 'atw-1600'], ['color-me'], ['julshow']], 'gruppering: alla tider för Around the World i en grupp')
assertEqual(
  groupShows([ev('a', 'Samma titel', 'Scen A'), ev('b', 'Samma titel', 'Scen B')]).length,
  2,
  'gruppering: samma titel på olika platser är olika föreställningar',
)

let r = pickFeatured(groups, undefined)
assertEqual([slugs(r.featured), r.rest.map((g) => g[0].slug), r.notFound], [['atw-1000', 'atw-1300', 'atw-1600'], ['color-me', 'julshow'], false], 'utan slug: första föreställningen stort, som idag')

r = pickFeatured(groups, 'color-me')
assertEqual([slugs(r.featured), r.rest.map((g) => g[0].slug), r.notFound], [['color-me'], ['atw-1000', 'julshow'], false], 'slug: vald stort, tidigare stora i listan utan dubbletter')

for (const s of ['atw-1000', 'atw-1300', 'atw-1600']) {
  r = pickFeatured(groups, s)
  assertEqual(slugs(r.featured), ['atw-1000', 'atw-1300', 'atw-1600'], `slug ${s}: hela Around the World med alla tider`)
}

r = pickFeatured(groups, 'finns-inte')
assertEqual([slugs(r.featured), r.rest.length, r.notFound], [['atw-1000', 'atw-1300', 'atw-1600'], 2, true], 'okänd slug: listan som vanligt + notFound')

r = pickFeatured([], 'color-me')
assertEqual([r.featured, r.rest, r.notFound], [undefined, [], true], 'inga föreställningar: ingen krasch')

const total = (x: ReturnType<typeof pickFeatured>) => (x.featured ? 1 : 0) + x.rest.length
assertEqual(['atw-1300', 'color-me', 'julshow', undefined].map((s) => total(pickFeatured(groups, s))), [3, 3, 3, 3], 'antal föreställningar oförändrat oavsett val')

if (failures > 0) {
  console.error(`\n${failures} kontroll(er) misslyckades`)
  Deno.exit(1)
}
console.log('\nAlla kontroller OK')
