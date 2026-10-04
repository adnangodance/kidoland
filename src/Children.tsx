/* Network effects reset pending UI and invalidate generation counters on context/unmount changes. */
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ApiError,
  listChildren,
  listParents,
  createChild,
  updateChild,
  createParent,
  saveConsent,
  listPickups,
  addPickup,
  deletePickup,
  listPickupLogs,
  recordPickupLog,
  type Child,
  type User,
  type ChildInput,
  type AuthorizedPickup,
  type PickupInput,
  type PickupLog,
} from './api'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import { useAlive } from './pilot-utils'
import { localCalendarDate } from './attendance-date'
import ChildAvatar from './ChildAvatar'

function Consent({ child }: { child: Child }) {
  const { token } = useAuth()
  const { t } = useI18n()
  const alive = useAlive()
  const [saved, setSaved] = useState(child.photoConsent)
  const [draft, setDraft] = useState(child.photoConsent)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [success, setSuccess] = useState(false)

  // Authorized Pickups & Logs
  const [pickups, setPickups] = useState<AuthorizedPickup[]>([])
  const [pickupsLoading, setPickupsLoading] = useState(false)
  const [showPickupForm, setShowPickupForm] = useState(false)
  const [pickupDraft, setPickupDraft] = useState<PickupInput>({ name: '', relationship: '', phone: '', isEmergency: false })
  const [pickupBusy, setPickupBusy] = useState(false)
  const [pickupError, setPickupError] = useState('')
  const [pickupNotice, setPickupNotice] = useState('')
  const [logs, setLogs] = useState<PickupLog[]>([])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setPickupsLoading(true)
    const today = localCalendarDate()
    Promise.all([
      listPickups(token, child.id),
      listPickupLogs(token, child.id, today),
    ]).then(([pRes, lRes]) => {
      if (!cancelled && alive.current) {
        setPickups(pRes.pickups)
        setLogs(lRes.logs)
      }
    }).catch(() => {
      // quiet fallback
    }).finally(() => {
      if (!cancelled && alive.current) setPickupsLoading(false)
    })
    return () => { cancelled = true }
  }, [token, child.id])

  async function save() {
    if (!token || busy) return
    setBusy(true); setError(false); setSuccess(false)
    try {
      const result = await saveConsent(token, child.id, draft)
      if (alive.current) { setSaved(result.child.photoConsent); setSuccess(true) }
    } catch { if (alive.current) setError(true) }
    finally { if (alive.current) setBusy(false) }
  }

  async function handleAddPickup(e: FormEvent) {
    e.preventDefault()
    if (!token || pickupBusy || !pickupDraft.name.trim() || !pickupDraft.relationship.trim()) return
    setPickupBusy(true); setPickupError(''); setPickupNotice('')
    try {
      const res = await addPickup(token, child.id, pickupDraft)
      if (alive.current) {
        setPickups((prev) => [...prev, res.pickup])
        setPickupDraft({ name: '', relationship: '', phone: '', isEmergency: false })
        setShowPickupForm(false)
        setPickupNotice(t.pickupAdded)
      }
    } catch {
      if (alive.current) setPickupError(t.saveError)
    } finally {
      if (alive.current) setPickupBusy(false)
    }
  }

  async function handleRemovePickup(pickupId: string) {
    if (!token || pickupBusy) return
    setPickupBusy(true); setPickupError(''); setPickupNotice('')
    try {
      await deletePickup(token, child.id, pickupId)
      if (alive.current) {
        setPickups((prev) => prev.filter((p) => p.id !== pickupId))
        setPickupNotice(t.pickupRemoved)
      }
    } catch {
      if (alive.current) setPickupError(t.saveError)
    } finally {
      if (alive.current) setPickupBusy(false)
    }
  }

  return <article className="roster-card">
    <div className="card-avatar-heading"><ChildAvatar name={child.name} size={42} /><div><h2>{child.name}</h2><p className="card-subtitle">{child.groupName}</p></div></div>
    {child.allergies && <p className="allergy-badge">⚠️ <strong>{t.allergies}:</strong> {child.allergies}</p>}
    <p>{t.permission}: <strong>{saved ? t.allowed : t.notAllowed}</strong></p>
    <fieldset disabled={busy}><legend>{t.consentTitle} · {child.name}</legend>
      <label className="choice"><input type="radio" name={`consent-${child.id}`} checked={draft} onChange={() => { setDraft(true); setSuccess(false) }} />{t.allowPhotos}</label>
      <label className="choice"><input type="radio" name={`consent-${child.id}`} checked={!draft} onChange={() => { setDraft(false); setSuccess(false) }} />{t.denyPhotos}</label>
    </fieldset>
    <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? t.attendanceSaving : t.saveChoice}</button>
    {success && <p role="status">{t.attendanceSaved}</p>}
    {error && <p role="alert" className="form-error">{t.saveError} <button type="button" onClick={() => void save()}>{t.attendanceRetry}</button></p>}

    <div className="pickups-section">
      <div className="pickups-header">
        <div>
          <h3>{t.authorizedPickups}</h3>
          <p className="card-subtitle">{t.authorizedPickupsSubtitle}</p>
        </div>
        <button type="button" className="btn ghost small-btn" disabled={pickupBusy} onClick={() => { setShowPickupForm(!showPickupForm); setPickupNotice(''); setPickupError('') }}>
          {showPickupForm ? t.cancel : `+ ${t.addPickupPerson}`}
        </button>
      </div>

      {pickupNotice && <p role="status" className="notice">{pickupNotice}</p>}
      {pickupError && <p role="alert" className="form-error">{pickupError}</p>}

      {showPickupForm && (
        <form className="login-form pickup-form" onSubmit={handleAddPickup}>
          <fieldset disabled={pickupBusy}>
            <label>{t.personName}<input required maxLength={100} placeholder={t.personNamePlaceholder} value={pickupDraft.name} onChange={(e) => setPickupDraft({ ...pickupDraft, name: e.target.value })} /></label>
            <label>{t.relationship}<input required maxLength={100} placeholder={t.relationshipPlaceholder} value={pickupDraft.relationship} onChange={(e) => setPickupDraft({ ...pickupDraft, relationship: e.target.value })} /></label>
            <label>{t.phoneNumber}<input type="tel" required maxLength={50} placeholder="+383 44 ..." value={pickupDraft.phone} onChange={(e) => setPickupDraft({ ...pickupDraft, phone: e.target.value })} /></label>
            <label className="choice"><input type="checkbox" checked={pickupDraft.isEmergency || false} onChange={(e) => setPickupDraft({ ...pickupDraft, isEmergency: e.target.checked })} />{t.isEmergency}</label>
            <div className="actions">
              <button className="btn primary">{pickupBusy ? t.attendanceSaving : t.addPickupPerson}</button>
              <button type="button" className="btn ghost" onClick={() => setShowPickupForm(false)}>{t.cancel}</button>
            </div>
          </fieldset>
        </form>
      )}

      {pickupsLoading ? <p role="status">{t.loading}</p> : pickups.length === 0 ? <p className="empty-hint">{t.noPickups}</p> : (
        <ul className="pickup-list">
          {pickups.map((p) => (
            <li key={p.id} className="pickup-item">
              <div className="pickup-details">
                <strong>{p.name}</strong>
                <div className="pickup-meta">
                  <span>{p.relationship}</span> · <span>📞 {p.phone}</span>
                  {p.isEmergency && <span className="badge emergency">{t.emergencyBadge}</span>}
                </div>
              </div>
              <button type="button" className="btn ghost small-btn" disabled={pickupBusy} onClick={() => void handleRemovePickup(p.id)}>{t.pickupRemove}</button>
            </li>
          ))}
        </ul>
      )}

      {logs.length > 0 && (
        <div className="pickup-logs-summary">
          <h4>{t.checkIn} / {t.checkOut}</h4>
          <ul className="pickup-log-list">
            {logs.map((log) => (
              <li key={log.id} className="pickup-log-item">
                <span>{log.action === 'check_in' ? `🟢 ${t.checkedIn}` : `👋 ${t.checkedOut}`} · {log.logTime}</span>
                <span><strong>{log.guardianName}</strong></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  </article>
}

function StaffChildCard({
  child,
  director,
  parentName,
  busy,
  onEdit,
}: {
  child: Child
  director: boolean
  parentName?: string
  busy: boolean
  onEdit: () => void
}) {
  const { token } = useAuth()
  const { t } = useI18n()
  const alive = useAlive()
  const [pickups, setPickups] = useState<AuthorizedPickup[]>([])
  const [logs, setLogs] = useState<PickupLog[]>([])
  const [showLogForm, setShowLogForm] = useState(false)
  const [action, setAction] = useState<'check_in' | 'check_out'>('check_in')
  const [guardianName, setGuardianName] = useState('')
  const [notes, setNotes] = useState('')
  const [logBusy, setLogBusy] = useState(false)
  const [logNotice, setLogNotice] = useState('')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!token || !expanded) return
    let cancelled = false
    const today = localCalendarDate()
    Promise.all([
      listPickups(token, child.id),
      listPickupLogs(token, child.id, today),
    ]).then(([pRes, lRes]) => {
      if (!cancelled && alive.current) {
        setPickups(pRes.pickups)
        setLogs(lRes.logs)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [token, child.id, expanded])

  async function handleRecordLog(e: FormEvent) {
    e.preventDefault()
    if (!token || logBusy || !guardianName.trim()) return
    setLogBusy(true); setLogNotice('')
    const today = localCalendarDate()
    const now = new Date()
    const logTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    try {
      const res = await recordPickupLog(token, child.id, {
        logDate: today,
        logTime,
        action,
        guardianName: guardianName.trim(),
        notes: notes.trim() || undefined,
      })
      if (alive.current) {
        setLogs((prev) => [res.log, ...prev])
        setGuardianName('')
        setNotes('')
        setShowLogForm(false)
        setLogNotice(t.logSaved)
      }
    } catch {
      // quiet
    } finally {
      if (alive.current) setLogBusy(false)
    }
  }

  return (
    <article className="roster-card">
      <div className="card-avatar-heading">
        <ChildAvatar name={child.name} size={42} />
        <div>
          <h2>{child.name}</h2>
          <p className="card-subtitle">{child.groupName}</p>
        </div>
      </div>
      {child.allergies && <p className="allergy-badge">⚠️ <strong>{t.allergies}:</strong> {child.allergies}</p>}
      <p>{t.permission}: <strong>{child.photoConsent ? t.allowed : t.notAllowed}</strong></p>
      {director && parentName && <p>{t.linkedParent}: {parentName}</p>}

      <div className="card-actions-row">
        <button type="button" className="btn ghost small-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▲ ' : '▼ '} {t.authorizedPickups} {logs.length > 0 ? `(${logs[0].action === 'check_in' ? '🟢' : '👋'})` : ''}
        </button>
        {director && (
          <button className="btn ghost small-btn" disabled={busy} onClick={onEdit}>
            {t.edit} · {child.name}
          </button>
        )}
      </div>

      {expanded && (
        <div className="staff-pickup-panel">
          <div className="pickup-subhead">
            <strong>{t.authorizedPickups}:</strong>
            <button type="button" className="btn ghost small-btn" onClick={() => setShowLogForm(!showLogForm)}>
              {showLogForm ? t.cancel : `+ ${t.checkIn} / ${t.checkOut}`}
            </button>
          </div>

          {logNotice && <p role="status" className="notice">{logNotice}</p>}

          {showLogForm && (
            <form className="login-form pickup-form" onSubmit={handleRecordLog}>
              <fieldset disabled={logBusy}>
                <label>{t.guardian}<input required maxLength={100} placeholder={t.guardianPlaceholder} value={guardianName} onChange={(e) => setGuardianName(e.target.value)} /></label>
                <div className="log-action-toggle">
                  <button type="button" className={`btn ${action === 'check_in' ? 'primary' : 'ghost'} small-btn`} onClick={() => setAction('check_in')}>
                    🟢 {t.checkIn}
                  </button>
                  <button type="button" className={`btn ${action === 'check_out' ? 'primary' : 'ghost'} small-btn`} onClick={() => setAction('check_out')}>
                    👋 {t.checkOut}
                  </button>
                </div>
                <label>{t.pickupNotes}<input maxLength={200} placeholder={t.pickupNotes} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
                <div className="actions">
                  <button className="btn primary small-btn">{logBusy ? t.attendanceSaving : t.saveLog}</button>
                  <button type="button" className="btn ghost small-btn" onClick={() => setShowLogForm(false)}>{t.cancel}</button>
                </div>
              </fieldset>
            </form>
          )}

          {pickups.length === 0 ? <p className="empty-hint">{t.noPickups}</p> : (
            <ul className="pickup-list">
              {pickups.map((p) => (
                <li key={p.id} className="pickup-item">
                  <div className="pickup-details">
                    <strong>{p.name}</strong> ({p.relationship})
                    <div className="pickup-meta">
                      <span>📞 {p.phone}</span>
                      {p.isEmergency && <span className="badge emergency">{t.emergencyBadge}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {logs.length > 0 && (
            <div className="pickup-logs-summary">
              <strong>{t.checkIn} / {t.checkOut}:</strong>
              <ul className="pickup-log-list">
                {logs.map((log) => (
                  <li key={log.id} className="pickup-log-item">
                    <span>{log.action === 'check_in' ? `🟢 ${t.checkedIn}` : `👋 ${t.checkedOut}`} · {log.logTime}</span>
                    <span><strong>{log.guardianName}</strong> {log.notes && `(${log.notes})`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export default function Children() {
  const { user, token } = useAuth()
  const { t } = useI18n()
  const alive = useAlive()
  const loads = useRef(0)
  const createRequest = useRef<{ payload: string; id: string } | null>(null)
  const director = user?.role === 'director'
  const [children, setChildren] = useState<Child[]>([])
  const [parents, setParents] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Child | null | undefined>(undefined)
  const [draft, setDraft] = useState<ChildInput>({ name: '', groupName: '', parentUserId: '' })
  const [parentOpen, setParentOpen] = useState(false)
  const [parentDraft, setParentDraft] = useState({ name: '', email: '', password: '' })
  async function reload() {
    if (!token) return
    const version = ++loads.current
    setLoading(true); setError('')
    try {
      const [c, p] = await Promise.all([listChildren(token), director ? listParents(token) : Promise.resolve({ parents: [] })])
      if (alive.current && version === loads.current) { setChildren(c.children); setParents(p.parents) }
    } catch { if (alive.current && version === loads.current) setError('load') }
    finally { if (alive.current && version === loads.current) setLoading(false) }
  }
  useEffect(() => { void reload(); return () => { loads.current++ } }, [token])
  async function saveChild(event: FormEvent) {
    event.preventDefault()
    if (!token || busy) return
    setBusy(true); setError(''); setSuccess(false)
    try {
      const payload = JSON.stringify(draft)
      if (!editing && createRequest.current?.payload !== payload) createRequest.current = { payload, id: crypto.randomUUID() }
      const { child } = editing ? await updateChild(token, editing.id, draft) : await createChild(token, { ...draft, requestId: createRequest.current!.id })
      if (alive.current) { loads.current++; setChildren((rows) => [...rows.filter((row) => row.id !== child.id), child].sort((a, b) => a.name.localeCompare(b.name))); setEditing(undefined); setSuccess(true) }
    } catch { if (alive.current) setError('save') }
    finally { if (alive.current) setBusy(false) }
  }
  async function provision(event: FormEvent) {
    event.preventDefault()
    if (!token || busy) return
    if (parentDraft.password.length < 10 || new TextEncoder().encode(parentDraft.password).length > 72) { setError('password'); return }
    setBusy(true); setError(''); setSuccess(false)
    try {
      const { parent } = await createParent(token, parentDraft)
      if (alive.current) { setParents((rows) => [...rows, parent]); setDraft((value) => ({ ...value, parentUserId: parent.id })); setParentDraft({ name: '', email: '', password: '' }); setParentOpen(false); setSuccess(true) }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        try {
          const { parents: rows } = await listParents(token)
          if (alive.current) {
            setParents(rows)
            const confirmed = rows.find((parent) => parent.email.toLowerCase() === parentDraft.email.trim().toLowerCase())
            if (confirmed) {
              setDraft((value) => ({ ...value, parentUserId: confirmed.id }))
              setParentDraft((value) => ({ ...value, password: '' }))
            }
            setError('email')
          }
        } catch { if (alive.current) setError('save') }
      } else if (alive.current) setError('save')
    }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className="panel">
    <h1>{user?.role === 'parent' ? t.consentTitle : t.childrenTitle}</h1>
    {user?.role === 'parent' && <p>{t.consentPurpose}</p>}
    {loading && <p role="status">{t.loading}</p>}
    {error && <p role="alert" className="form-error">{error === 'load' ? t.loadError : error === 'email' ? t.emailExists : error === 'password' ? t.passwordLimit : t.saveError}{error === 'load' && <button onClick={() => void reload()}>{t.attendanceRetry}</button>}</p>}
    {success && <p role="status">{t.attendanceSaved}</p>}
    {director && !loading && error !== 'load' && <>
      <div className="actions"><button className="btn primary" disabled={busy} onClick={() => { createRequest.current = null; setError(''); setEditing(null); setDraft({ name: '', groupName: '', parentUserId: parents[0]?.id || '', allergies: '' }); setSuccess(false) }}>{t.createChild}</button>
      <button className="btn ghost" disabled={busy} onClick={() => setParentOpen(!parentOpen)}>{t.newParent}</button></div>
      {parentOpen && <form className="login-form" onSubmit={provision}><h2>{t.newParent}</h2><fieldset disabled={busy}>
        <label>{t.parentName}<input required maxLength={200} value={parentDraft.name} onChange={(e) => setParentDraft({ ...parentDraft, name: e.target.value })} /></label>
        <label>{t.loginEmail}<input type="email" required value={parentDraft.email} onChange={(e) => setParentDraft({ ...parentDraft, email: e.target.value })} /></label>
        <label>{t.initialPassword}<input type="password" autoComplete="new-password" minLength={10} required value={parentDraft.password} onChange={(e) => setParentDraft({ ...parentDraft, password: e.target.value })} /></label>
        <p className="hint">{t.passwordLimit}</p>
        <button className="btn primary">{busy ? t.attendanceSaving : t.newParent}</button>
      </fieldset></form>}
      {editing !== undefined && <form className="login-form" onSubmit={saveChild}><h2>{editing ? `${t.edit}: ${editing.name}` : t.createChild}</h2><fieldset disabled={busy}>
        <label>{t.childName}<input required maxLength={200} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>{t.attendanceGroup}<input required maxLength={200} value={draft.groupName} onChange={(e) => setDraft({ ...draft, groupName: e.target.value })} /></label>
        <label>{t.linkedParent}<select required value={draft.parentUserId} onChange={(e) => setDraft({ ...draft, parentUserId: e.target.value })}><option value="">{t.selectParent}</option>{parents.map((parent) => <option key={parent.id} value={parent.id}>{parent.name} · {parent.email}</option>)}</select></label>
        <label>{t.allergies} ({t.optional})<input maxLength={200} placeholder={t.allergiesPlaceholder} value={draft.allergies || ''} onChange={(e) => setDraft({ ...draft, allergies: e.target.value })} /></label>
        {!parents.length && <p>{t.noParents}</p>}
        {editing && editing.parentUserId !== draft.parentUserId && <p role="status" className="notice">{t.transferWarning}</p>}
        <div className="actions"><button className="btn primary" disabled={!parents.length}>{busy ? t.attendanceSaving : t.save}</button><button type="button" className="btn ghost" onClick={() => setEditing(undefined)}>{t.cancel}</button></div>
      </fieldset></form>}
    </>}
    {!loading && error !== 'load' && !children.length && <p>{t.attendanceEmpty}</p>}
    {!loading && children.map((child) => user?.role === 'parent' ? (
      <Consent key={child.id} child={child} />
    ) : (
      <StaffChildCard
        key={child.id}
        child={child}
        director={director}
        parentName={parents.find((p) => p.id === child.parentUserId)?.name}
        busy={busy}
        onEdit={() => {
          setEditing(child)
          setDraft({ name: child.name, groupName: child.groupName, parentUserId: child.parentUserId, allergies: child.allergies || '' })
          setSuccess(false)
        }}
      />
    ))}
  </section>
}
