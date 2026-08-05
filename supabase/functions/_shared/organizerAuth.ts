// Härleder den inloggade arrangören från en riktig Supabase-JWT (Tilläggs-
// ordern 2026-08-05, "Flera arrangörer"). Ersätter admin-PIN-mönstret
// (_shared/adminToken.ts verifyAdminToken/issueAdminToken, nu obsoleta för
// admin-* funktionerna - kvar där bara för scan-ticket/list-events/
// release-expired-orders, som fortfarande använder statiska bearer-tokens,
// inte inloggning).
//
// VIKTIGT - lita ALDRIG på ett organizer_id som skickas från klienten.
// Varje admin-funktion ska anropa resolveOrganizer(req) och använda det
// returnerade organizerId för ALLA efterföljande queries - aldrig
// body.organizer_id eller liknande. RLS på events/ticket_types/
// discount_codes är ett skyddsnät för direkta klient-queries, men Edge
// Functions med service role kringgår RLS helt, så de måste skydda sig
// själva genom att alltid filtrera explicit på det här värdet.
import { createAdminClient } from './supabaseAdmin.ts'

export interface OrganizerAuth {
  userId: string
  organizerId: string
}

/**
 * Läser Authorization-headern, verifierar JWT:n mot Supabase Auth
 * (auth.getUser), och slår upp vilken arrangör användaren är medlem i.
 * Returnerar null om något steg misslyckas - anroparen ska då svara 401.
 *
 * OBS: verify_jwt = true i config.toml för admin-funktionerna innebär att
 * Supabase-gatewayen redan avvisat ogiltiga/utgångna JWT:er innan
 * funktionen ens körs - detta extra auth.getUser()-anrop är ändå det som
 * ger oss den faktiska user.id:n att slå upp organizer_members mot (samma
 * mönster som ordertextens kodexempel i avsnitt 4).
 */
export async function resolveOrganizer(req: Request): Promise<OrganizerAuth | null> {
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization')
  const match = authHeader?.match(/^Bearer\s+(.+)$/i)
  const jwt = match?.[1]
  if (!jwt) return null

  const supabase = createAdminClient()

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt)
  if (userError || !userData?.user) return null

  const { data: membership, error: membershipError } = await supabase
    .from('organizer_members')
    .select('organizer_id')
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (membershipError || !membership) return null

  return { userId: userData.user.id, organizerId: membership.organizer_id }
}
