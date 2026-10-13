// Tidtagning per steg (ordern "Webhooken är för långsam" 2026-10-13,
// STEG B0) - gated bakom DEBUG_TIMING, AVSTÄNGD SOM STANDARD. Loggar
// BARA ett stegnamn och millisekunder sedan föregående steg i samma
// begäran - aldrig e-post, namn, belopp eller annan personuppgift.
//
// Avsedd att slås PÅ tillfälligt för en enskild mätning
// (`supabase secrets set DEBUG_TIMING=true`) och stängas AV igen
// direkt efteråt (`supabase secrets unset DEBUG_TIMING`, eller sätt
// till "false") - inte lämnas påslagen i drift, då blir den bara
// permanent brus i loggarna.
const DEBUG_TIMING = Deno.env.get('DEBUG_TIMING') === 'true'

export type Tick = (label: string) => void

/** En tick-funktion per begäran (en per Deno.serve-anrop). Varje
 * anrop loggar tiden sedan FÖREGÅENDE tick, inte sedan start - gör
 * det direkt synligt vilket enskilt steg som tar tid, inte bara en
 * totalsumma. Returnerar en no-op-funktion (inget overhead, ingen
 * loggrad) när DEBUG_TIMING inte är satt. */
export function startTimer(): Tick {
  if (!DEBUG_TIMING) return () => {}
  let last = performance.now()
  return (label: string) => {
    const now = performance.now()
    console.log(`[timing] ${label}: ${Math.round(now - last)}ms`)
    last = now
  }
}
