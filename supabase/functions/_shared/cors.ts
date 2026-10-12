// Delad CORS-hjälp för alla edge functions i detta proof-of-concept.
// Eftersom detta är en isolerad PoC (inte samma projekt som SODSS CORE)
// tillåter vi alla origins - lås gärna ner detta till din faktiska
// frontend-domän innan ni går i produktion.
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-organizer-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  // Utan detta kan JS i webbläsaren INTE läsa dessa svars-headers över
  // CORS, trots att de finns i det råa svaret - bara en handfull
  // "safelistade" headers (Content-Type m.fl.) är annars läsbara.
  // Upptäckt vid ordern "Arkiv för ordrar och event" (2026-10-12): utan
  // den här raden skulle export-sales/platform-export-revenues nya
  // X-Excluded-Test-*-headers (DEL 2 punkt 2) tyst lästs som null i
  // AdminPage.tsx, exakt samma latenta brist som redan fanns för
  // Content-Disposition i downloadAdminFile (functionsApi.ts) - den har
  // alltid fallit tillbaka tyst till ett generiskt filnamn istället för
  // serverns tänkta, utan att synas som trasig.
  'Access-Control-Expose-Headers': 'Content-Disposition, X-Excluded-Test-Order-Count, X-Excluded-Test-Total-Ore',
}

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
