/* Network effects reset pending UI and invalidate generation counters on context/unmount changes. */
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, listChildren, listParents, createChild, updateChild, createParent, saveConsent, type Child, type User, type ChildInput } from './api'
import { useAuth } from './auth'
import { useI18n } from './i18n/LanguageContext'
import { useAlive } from './pilot-utils'

function Consent({ child }: { child: Child }) {
  const { token } = useAuth()
  const { t } = useI18n()
  const alive = useAlive()
  const [saved, setSaved] = useState(child.photoConsent)
  const [draft, setDraft] = useState(child.photoConsent)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [success, setSuccess] = useState(false)
  async function save() {
    if (!token || busy) return
    setBusy(true); setError(false); setSuccess(false)
    try {
      const result = await saveConsent(token, child.id, draft)
      if (alive.current) { setSaved(result.child.photoConsent); setSuccess(true) }
    } catch { if (alive.current) setError(true) }
    finally { if (alive.current) setBusy(false) }
  }
  return <article className="roster-card">
    <h2>{child.name}</h2><p>{child.groupName}</p>
    <p>{t.permission}: <strong>{saved ? t.allowed : t.notAllowed}</strong></p>
    <fieldset disabled={busy}><legend>{t.consentTitle} · {child.name}</legend>
      <label className="choice"><input type="radio" name={`consent-${child.id}`} checked={draft} onChange={() => { setDraft(true); setSuccess(false) }} />{t.allowPhotos}</label>
      <label className="choice"><input type="radio" name={`consent-${child.id}`} checked={!draft} onChange={() => { setDraft(false); setSuccess(false) }} />{t.denyPhotos}</label>
    </fieldset>
    <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? t.attendanceSaving : t.saveChoice}</button>
    {success && <p role="status">{t.attendanceSaved}</p>}
    {error && <p role="alert" className="form-error">{t.saveError} <button type="button" onClick={() => void save()}>{t.attendanceRetry}</button></p>}
  </article>
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
      <div className="actions"><button className="btn primary" disabled={busy} onClick={() => { createRequest.current = null; setError(''); setEditing(null); setDraft({ name: '', groupName: '', parentUserId: parents[0]?.id || '' }); setSuccess(false) }}>{t.createChild}</button>
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
        {!parents.length && <p>{t.noParents}</p>}
        {editing && editing.parentUserId !== draft.parentUserId && <p role="status" className="notice">{t.transferWarning}</p>}
        <div className="actions"><button className="btn primary" disabled={!parents.length}>{busy ? t.attendanceSaving : t.save}</button><button type="button" className="btn ghost" onClick={() => setEditing(undefined)}>{t.cancel}</button></div>
      </fieldset></form>}
    </>}
    {!loading && error !== 'load' && !children.length && <p>{t.attendanceEmpty}</p>}
    {!loading && children.map((child) => user?.role === 'parent' ? <Consent key={child.id} child={child} /> : <article className="roster-card" key={child.id}><h2>{child.name}</h2><p>{child.groupName}</p><p>{t.permission}: <strong>{child.photoConsent ? t.allowed : t.notAllowed}</strong></p>{director && <><p>{t.linkedParent}: {parents.find((p) => p.id === child.parentUserId)?.name}</p><button className="btn ghost" disabled={busy} onClick={() => { setEditing(child); setDraft({ name: child.name, groupName: child.groupName, parentUserId: child.parentUserId }); setSuccess(false) }}>{t.edit} · {child.name}</button></>}</article>)}
  </section>
}
