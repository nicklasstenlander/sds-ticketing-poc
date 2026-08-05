// Uppföljning 2026-08-05 ("platform-admin"). Håller reda på vilket
// workspace (arrangör) en inloggad platform-admin har valt att agera i
// just nu - se _shared/organizerAuth.ts på backend-sidan för motsvarande
// serverkontroll. Vanliga arrangörsanvändare (ej platform-admin) berörs
// inte alls: getActiveOrganizerId() är då null och ingen X-Organizer-Id-
// header skickas (se functionsApi.ts), precis som innan denna uppföljning
// fanns.
//
// localStorage, inte React-state: valet ska överleva sidomladdningar (och
// callFunction/downloadAdminFile i functionsApi.ts är vanliga funktioner,
// inte React-komponenter, så de kan inte läsa Context/props).
const STORAGE_KEY = 'scenpass_active_organizer_id'

export function getActiveOrganizerId(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setActiveOrganizerId(id: string | null): void {
  if (id) {
    localStorage.setItem(STORAGE_KEY, id)
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}
