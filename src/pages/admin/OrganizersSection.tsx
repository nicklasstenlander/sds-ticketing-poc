import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { callFunction } from '../../lib/functionsApi'

interface OrganizerListItem {
  id: string
  name: string
  slug: string
  contact_email: string | null
  status: 'invited' | 'active'
}

interface ListOrganizersResponse {
  organizers: OrganizerListItem[]
}

interface CreateOrganizerResponse {
  organizer_id: string
  slug: string
  invited_email: string
}

// Samma slugify som backend (admin-create-event/platform-create-organizer)
// - bara för att förhandsvisa slugen i UI:t medan man skriver, servern
// gör den auktoritativa (och unikhetssäkrade) versionen ändå.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/é/g, 'e')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
}

// Platform-admin-sektion: "Lägg till arrangör" + arrangörslistan med
// inbjuden/aktiv-status (Tilläggsordern 2026-08-06, "Självbetjänad
// onboarding av nya arrangörer"). Renderas bara när AdminDashboard vet
// att den inloggade användaren är platform-admin (samma villkor som
// workspace-växlaren) - vanliga arrangörsanvändare får aldrig se detta,
// och admin-list-organizers/platform-create-organizer svarar ändå 403 om
// någon skulle nå hit ändå.
export function OrganizersSection() {
  const [organizers, setOrganizers] = useState<OrganizerListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [contactEmail, setContactEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  async function loadOrganizers() {
    try {
      const res = await callFunction<ListOrganizersResponse>('admin-list-organizers', { auth: true })
      setOrganizers(res.organizers)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte hämta arrangörer.')
    }
  }

  useEffect(() => {
    loadOrganizers()
  }, [])

  function resetForm() {
    setName('')
    setSlug('')
    setSlugTouched(false)
    setContactEmail('')
    setFormError(null)
  }

  function handleNameChange(value: string) {
    setName(value)
    // Slugen auto-genereras från namnet tills användaren själv redigerar
    // den för hand - därefter slutar vi skriva över deras val.
    if (!slugTouched) setSlug(slugify(value))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    setConfirmation(null)
    try {
      const res = await callFunction<CreateOrganizerResponse>('platform-create-organizer', {
        auth: true,
        method: 'POST',
        body: { name, slug, contact_email: contactEmail },
      })
      setConfirmation(`Inbjudan skickad till ${res.invited_email}.`)
      resetForm()
      setShowForm(false)
      await loadOrganizers()
    } catch (err) {
      // Vid ett 502-fel ("arrangören skapades men inbjudan misslyckades",
      // se platform-create-organizer) har arrangörsraden redan skapats -
      // ladda om listan ändå så den syns direkt, inte bara felmeddelandet.
      setFormError(err instanceof Error ? err.message : 'Kunde inte skapa arrangören.')
      await loadOrganizers()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="card">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-[var(--text)]">Arrangörer</h2>
        {!showForm && (
          <button
            type="button"
            onClick={() => {
              setShowForm(true)
              setConfirmation(null)
            }}
            className="text-sm link-accent"
          >
            Lägg till arrangör +
          </button>
        )}
      </div>

      {confirmation && <p className="text-green-700 text-sm mb-3">{confirmation}</p>}
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-4 mb-4 pb-4 border-b border-[var(--border)]">
          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Namn</label>
            <input
              required
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="field"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Slug</label>
            <input
              required
              value={slug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value)
              }}
              className="field"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Auto-genererad från namnet, redigerbar. Bara a-ö, 0-9 och bindestreck.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Kontakt-e-post</label>
            <input
              type="email"
              required
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="field"
              placeholder="kontakt@arrangor.se"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              En inbjudan skickas hit direkt - mottagaren sätter sitt eget lösenord via länken.
            </p>
          </div>
          {formError && <p className="text-red-600 text-sm">{formError}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Skickar inbjudan…' : 'Skicka inbjudan'}
            </button>
            <button
              type="button"
              onClick={() => {
                resetForm()
                setShowForm(false)
              }}
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              Avbryt
            </button>
          </div>
        </form>
      )}

      {organizers === null && !error && <p className="text-[var(--text-muted)] text-sm">Laddar…</p>}
      {organizers !== null && (
        <ul className="space-y-2">
          {organizers.map((org) => (
            <li key={org.id} className="flex items-center justify-between text-sm py-1">
              <div className="min-w-0">
                <div className="text-[var(--text)] font-medium">{org.name}</div>
                <div className="text-[var(--text-muted)] text-xs truncate">
                  {org.slug}
                  {org.contact_email ? ` · ${org.contact_email}` : ''}
                </div>
              </div>
              <span
                className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${
                  org.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                }`}
              >
                {org.status === 'active' ? 'Aktiv' : 'Inbjuden'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
