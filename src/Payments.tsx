/* Network effects reset pending UI and invalidate generation counters on context/unmount changes. */
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { listChildren, listInvoices, createInvoice, markInvoicePaid, type Child, type Invoice } from './api'
import { useAuth } from './auth'
import { useI18n } from './i18n/LanguageContext'
import { localCalendarDate, validDate } from './attendance-date.js'
import { displayDate, euro, useAlive } from './pilot-utils'
type PendingInvoice = {
  form: { childId: string; periodLabel: string; dueDate: string; notes: string }
  items: { id: number; description: string; amount: string }[]
  request: { payload: string; id: string }
}
function pendingInvoice(key: string): PendingInvoice | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null') as PendingInvoice | null
    return value?.request?.id && value.form && Array.isArray(value.items) && value.items.length ? value : null
  } catch { return null }
}
export default function Payments() {
  const { token, user } = useAuth()
  const { t, lang } = useI18n()
  const alive = useAlive()
  const loads = useRef(0)
  const pendingKey = `kidoland.invoice-draft:${user!.id}`
  const [restored] = useState(() => pendingInvoice(pendingKey))
  const unresolved = useRef(Boolean(restored))
  const createRequest = useRef<{ payload: string; id: string } | null>(restored?.request || null)
  const [children, setChildren] = useState<Child[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [paidSaved, setPaidSaved] = useState(false)
  const [form, setForm] = useState(restored?.form || { childId: '', periodLabel: '', dueDate: localCalendarDate(), notes: '' })
  const [items, setItems] = useState(restored?.items || [{ id: 0, description: '', amount: '' }])
  const [nextId, setNextId] = useState(() => Math.max(...(restored?.items.map((item) => item.id) || [0])) + 1)
  const canCreate = user?.role !== 'parent'
  const canPaid = user?.role === 'director'
  function cents(value: string) {
    if (!/^\d+(\.\d{1,2})?$/.test(value)) return NaN
    const [whole, fraction = ''] = value.split('.')
    const exact = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
    return exact <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : NaN
  }
  const total = items.reduce((sum, item) => sum + cents(item.amount), 0)
  useEffect(() => {
    if (unresolved.current && createRequest.current) sessionStorage.setItem(pendingKey, JSON.stringify({ form, items, request: createRequest.current }))
  }, [form, items, pendingKey])
  async function reload() {
    if (!token) return
    const version = ++loads.current
    setLoading(true); setError('')
    try {
      const [c, i] = await Promise.all([listChildren(token), listInvoices(token)])
      if (alive.current && version === loads.current) { setChildren(c.children); setInvoices(i.invoices); setForm((draft) => ({ ...draft, childId: draft.childId || c.children[0]?.id || '' })) }
    } catch { if (alive.current && version === loads.current) setError('load') }
    finally { if (alive.current && version === loads.current) setLoading(false) }
  }
  useEffect(() => { void reload(); return () => { loads.current++ } }, [token])
  async function create(event: FormEvent) {
    event.preventDefault()
    if (!token || busy) return
    if (!Number.isSafeInteger(total) || total <= 0 || !validDate(form.dueDate) || items.some((item) => !item.description.trim() || !Number.isSafeInteger(cents(item.amount)) || cents(item.amount) <= 0)) { setError('save'); return }
    setBusy(true); setError(''); setSaved(false); setPaidSaved(false)
    try {
      const body = { ...form, items: items.map((item) => ({ description: item.description, amountCents: cents(item.amount) })) }
      const payload = JSON.stringify(body)
      if (createRequest.current?.payload !== payload) createRequest.current = { payload, id: crypto.randomUUID() }
      unresolved.current = true
      sessionStorage.setItem(pendingKey, JSON.stringify({ form, items, request: createRequest.current }))
      const submittedId = createRequest.current.id
      const { invoice } = await createInvoice(token, { ...body, requestId: submittedId })
      unresolved.current = false
      createRequest.current = null
      if (pendingInvoice(pendingKey)?.request.id === submittedId) sessionStorage.removeItem(pendingKey)
      if (alive.current) { setInvoices((rows) => [invoice, ...rows.filter((row) => row.id !== invoice.id)]); setSaved(true) }
    } catch { if (alive.current) setError('save') }
    finally { if (alive.current) setBusy(false) }
  }
  async function paid(id: string) {
    if (!token || busy) return
    setBusy(true); setError(''); setPaidSaved(false)
    try {
      const { invoice } = await markInvoicePaid(token, id)
      if (alive.current) { setInvoices((rows) => rows.map((row) => row.id === id ? invoice : row)); setPaidSaved(true) }
    } catch { if (alive.current) setError('save') }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className="panel"><h1>{t.paymentsTitle}</h1><p>{t.paymentsNote}</p>
    {loading && <p role="status">{t.loading}</p>}
    {error && <p className="form-error" role="alert">{error === 'load' ? t.loadError : t.saveError}{error === 'load' && <button onClick={() => void reload()}>{t.attendanceRetry}</button>}</p>}
    {(saved || paidSaved) && <p role="status">{t.attendanceSaved}</p>}
    {canCreate && !loading && error !== 'load' && children.length > 0 && <form className="login-form" onSubmit={create}><fieldset disabled={busy}>
      <label>{t.paymentsChild}<select required value={form.childId} onChange={(e) => { setSaved(false); setForm({ ...form, childId: e.target.value }) }}>{children.map((child) => <option key={child.id} value={child.id}>{child.name} · {child.groupName}</option>)}</select></label>
      <label>{t.paymentsPeriod}<input required maxLength={200} value={form.periodLabel} onChange={(e) => { setSaved(false); setForm({ ...form, periodLabel: e.target.value }) }} /></label>
      <label>{t.paymentsDueDate}<input required type="date" value={form.dueDate} onChange={(e) => { setSaved(false); setForm({ ...form, dueDate: e.target.value }) }} /></label>
      {items.map((item, index) => <fieldset key={item.id}><legend>{t.fee} {index + 1}</legend><label>{t.fee}<input required maxLength={200} value={item.description} onChange={(e) => { setSaved(false); setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, description: e.target.value } : row)) }} /></label><label>{t.paymentsAmountLabel}<input required type="number" min="0.01" step="0.01" value={item.amount} onChange={(e) => { setSaved(false); setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, amount: e.target.value } : row)) }} /></label><button type="button" className="btn ghost" disabled={items.length < 2} onClick={() => { setSaved(false); setItems((rows) => rows.filter((row) => row.id !== item.id)) }}>{t.removeFee} {index + 1}</button></fieldset>)}
      <button type="button" className="btn ghost" disabled={items.length >= 100} onClick={() => { setItems((rows) => [...rows, { id: nextId, description: '', amount: '' }]); setNextId(nextId + 1); setSaved(false) }}>{t.addFee}</button>
      <p><strong>{t.total}: {Number.isSafeInteger(total) ? euro(total, lang) : '—'}</strong></p>
      <label>{t.paymentsNotes}<textarea maxLength={5000} value={form.notes} onChange={(e) => { setSaved(false); setForm({ ...form, notes: e.target.value }) }} /></label>
      <button className="btn primary" disabled={saved}>{busy ? t.attendanceSaving : t.paymentsCreate}</button>
    </fieldset></form>}
    {!loading && error !== 'load' && !invoices.length && <p>{t.paymentsEmpty}</p>}
    {!loading && invoices.map((invoice) => <article className="roster-card" key={invoice.id}><h2>{invoice.childName} · {invoice.periodLabel}</h2><p>{t.paymentsDue}: {displayDate(invoice.dueDate, lang)}</p><ul className="fee-list">{invoice.items.map((item) => <li key={item.id}><span>{item.description === 'tuition' ? t.tuition : item.description}</span><strong>{euro(item.amountCents, lang, invoice.currency)}</strong></li>)}</ul><div className="actions"><strong>{t.total}: {euro(invoice.amountCents, lang, invoice.currency)}</strong><span className={`badge ${invoice.status === 'paid' ? 'paid' : ''}`}>{invoice.status === 'paid' ? t.paymentsPaid : t.paymentsStatus}</span>{canPaid && invoice.status === 'pending' && <button className="btn ghost" disabled={busy} onClick={() => void paid(invoice.id)}>{t.paymentsMarkPaid} · {invoice.childName}</button>}</div>{invoice.notes && <p>{invoice.notes}</p>}</article>)}
  </section>
}
