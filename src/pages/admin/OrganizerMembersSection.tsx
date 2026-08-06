import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { callFunction } from '../../lib/functionsApi'

interface OrganizerMember {
  id: string
  email: string
  status: 'invited' | 'active'
  is_self: boolean
}

interface ListMembersResponse {
  organizer: { id: string; name: string }
  members: OrganizerMember[]
}

interface InviteMemberResponse {
  invited_email: string
}

// Namnfält + medlemslista + "bjud in kollega"-formulär för en arrangörs
// EGEN arrangör (Tilläggsordern 2026-08-06, "Flera användare per
// arrangör"). Fungerar identiskt oavsett om det är en vanlig arrangörs-
// admin eller en platform-admin med ett workspace valt via
// X-Organizer-Id - alla fyra edge functions den pratar med härleder
// organizer_id via resolveOrganizer(req), som redan hanterar bägge
// fallen (se _shared/organizerAuth.ts).
export function OrganizerMembersSection() {
  const [organizerName, setOrganizerName] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [members, setMembers] = useState<OrganizerMember[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteConfirmation, setInviteConfirmation] = useState<string | null>(null)

  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  async function loadMembers() {
    try {
      const res = await callFunction<ListMembersResponse>('admin-list-members', { auth: true })
      setOrganizerName(res.organizer.name)
      setNameInput(res.organizer.name)
      setMembers(res.members)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Kunde inte hämta arrangörens uppgifter.')
    }
  }

  useEffect(() => {
    loadMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSaveName(e: FormEvent) {
    e.preventDefault()
    setSavingName(true)
    setNameError(null)
    setNameSaved(false)
    try {
      await callFunction('admin-update-organizer', {
        auth: true,
        method: 'POST',
        body: { name: nameInput },
      })
      setOrganizerName(nameInput)
      setNameSaved(true)
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Kunde inte spara namnet.')
    } finally {
      setSavingName(false)
    }
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteError(null)
    setInviteConfirmation(null)
    try {
      const res = await callFunction<InviteMemberResponse>('admin-invite-member', {
        auth: true,
        method: 'POST',
        body: { email: inviteEmail },
      })
      setInviteConfirmation(`Inbjudan skickad till ${res.invited_email}.`)
      setInviteEmail('')
      setShowInviteForm(false)
      await loadMembers()
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Kunde inte skicka inbjudan.')
    } finally {
      setInviting(false)
    }
  }

  async function handleRemove(member: OrganizerMember) {
    if (!window.confirm(`Ta bort ${member.email} från arrangören?`)) return
    setRemovingId(member.id)
    setRemoveError(null)
    try {
      await callFunction('admin-remove-member', {
        auth: true,
        method: 'POST',
        body: { member_id: member.id },
      })
      await loadMembers()
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Kunde inte ta bort medlemmen.')
    } finally {
      setRemovingId(null)
    }
  }

  const lastMember = (members?.length ?? 0) <= 1

  return (
    <div className="space-y-6">
      {loadError && <p className="text-red-600 text-sm">{loadError}</p>}

      <section className="card">
        <h2 className="font-semibold mb-4 text-[var(--text)]">Arrangörens namn</h2>
        <form onSubmit={handleSaveName} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-2 text-[var(--text)]">Namn</label>
            <input
              required
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value)
                setNameSaved(false)
              }}
              className="field"
              placeholder={organizerName ?? undefined}
            />
          </div>
          <button type="submit" disabled={savingName || nameInput === organizerName} className="btn-primary">
            {savingName ? 'Sparar…' : 'Spara'}
          </button>
        </form>
        {nameSaved && <p className="text-green-700 text-sm mt-2">Sparat. Syns direkt på publika event-kort.</p>}
        {nameError && <p className="text-red-600 text-sm mt-2">{nameError}</p>}
      </section>

      <section className="card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-[var(--text)]">Medlemmar</h2>
          {!showInviteForm && (
            <button
              type="button"
              onClick={() => {
                setShowInviteForm(true)
                setInviteConfirmation(null)
              }}
              className="text-sm link-accent"
            >
              Bjud in kollega +
            </button>
          )}
        </div>

        {inviteConfirmation && <p className="text-green-700 text-sm mb-3">{inviteConfirmation}</p>}
        {removeError && <p className="text-red-600 text-sm mb-3">{removeError}</p>}

        {showInviteForm && (
          <form onSubmit={handleInvite} className="space-y-4 mb-4 pb-4 border-b border-[var(--border)]">
            <div>
              <label className="block text-sm font-medium mb-2 text-[var(--text)]">E-post</label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="field"
                placeholder="kollega@arrangor.se"
                autoFocus
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">
                En inbjudan skickas hit direkt - mottagaren sätter sitt eget lösenord via länken och hamnar
                i samma arrangörs workspace.
              </p>
            </div>
            {inviteError && <p className="text-red-600 text-sm">{inviteError}</p>}
            <div className="flex gap-3">
              <button type="submit" disabled={inviting} className="btn-primary">
                {inviting ? 'Skickar inbjudan…' : 'Skicka inbjudan'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowInviteForm(false)
                  setInviteEmail('')
                  setInviteError(null)
                }}
                className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                Avbryt
              </button>
            </div>
          </form>
        )}

        {members === null && !loadError && <p className="text-[var(--text-muted)] text-sm">Laddar…</p>}
        {members !== null && (
          <ul className="space-y-2">
            {members.map((member) => {
              // Blockera "Ta bort" om det är den sista medlemmen (dödläge)
              // eller den inloggade användarens egen rad (ingen
              // självborttagning i denna version, se ordertextens punkt
              // 3) - bägge fallen grånas med en förklarande title-text
              // istället för att bara vara avstängda utan anledning.
              const disabledReason = lastMember
                ? 'Kan inte ta bort den sista medlemmen.'
                : member.is_self
                  ? 'Du kan inte ta bort dig själv.'
                  : null
              return (
                <li key={member.id} className="flex items-center justify-between text-sm py-1 gap-3">
                  <div className="min-w-0">
                    <div className="text-[var(--text)] font-medium truncate">
                      {member.email}
                      {member.is_self ? ' (du)' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        member.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {member.status === 'active' ? 'Aktiv' : 'Inbjuden'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemove(member)}
                      disabled={disabledReason !== null || removingId === member.id}
                      title={disabledReason ?? undefined}
                      className="text-red-600 hover:text-red-800 underline disabled:opacity-40 disabled:text-[var(--text-muted)] disabled:no-underline"
                    >
                      {removingId === member.id ? 'Tar bort…' : 'Ta bort'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
