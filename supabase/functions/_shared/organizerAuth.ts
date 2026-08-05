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
//
// UNDANTAG (uppföljning 2026-08-05, "platform-admin"): en användare som
// finns i platform_admins-tabellen får agera i VILKET workspace som helst
// - men bara genom att EXPLICIT ange vilket via X-Organizer-Id-headern,
// aldrig implicit "se allt". Headern litar vi bara på EFTER att vi
// bekräftat medlemskap i platform_admins server-side, och bara efter att
// ha verifierat att organizer_id:t faktiskt existerar - klienten kan
// alltså inte trolla fram ett organizer_id ur tomma intet, bara välja
// bland riktiga, existerande arrangörer. En vanlig arrangörsanvändare (ej
// platform-admin) kan skicka vilken X-Organizer-Id de vill utan effekt -
// den grenen nås aldrig för dem.
import { createAdminClient } from './supabaseAdmin.ts'

export interface OrganizerAuth {
  userId: string
  organizerId: string
  isPlatformAdmin: boolean
}

/**
 * Läser Authorization-headern, verifierar JWT:n mot Supabase Auth
 * (auth.getUser), och slår upp vilken arrangör användaren är medlem i -
 * eller, för en platform-admin, vilken arrangör hen har VALT att agera i
 * just nu. Returnerar null om något steg misslyckas - anroparen ska då
 * svara 401.
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

  const { data: platformAdmin } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (platformAdmin) {
    const requestedOrgId = (req.headers.get('X-Organizer-Id') ?? req.headers.get('x-organizer-id'))?.trim()
    if (!requestedOrgId) return null
    const { data: org, error: orgError } = await supabase
      .from('organizers')
      .select('id')
      .eq('id', requestedOrgId)
      .maybeSingle()
    if (orgError || !org) return null
    return { userId: userData.user.id, organizerId: org.id, isPlatformAdmin: true }
  }

  const { data: membership, error: membershipError } = await supabase
    .from('organizer_members')
    .select('organizer_id')
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (membershipError || !membership) return null

  return { userId: userData.user.id, organizerId: membership.organizer_id, isPlatformAdmin: false }
}
