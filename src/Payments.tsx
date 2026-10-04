/* Network effects reset pending UI and invalidate generation counters on context/unmount changes. */
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  listChildren,
  listInvoices,
  createInvoice,
  markInvoicePaid,
  payInvoice,
  getInvoiceReceipt,
  type Child,
  type Invoice,
  type PaymentReceipt,
  type PaymentMethod,
} from './api'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
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

  // Online Payment state
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card')
  const [cardData, setCardData] = useState({ number: '', expiry: '', cvc: '', name: '' })
  const [payBusy, setPayBusy] = useState(false)
  const [payError, setPayError] = useState('')
  const [paySuccess, setPaySuccess] = useState('')

  // Receipt modal state
  const [receiptData, setReceiptData] = useState<PaymentReceipt | null>(null)
  const [receiptLoading, setReceiptLoading] = useState(false)

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

  function addPresetFee(description: string, amount: string) {
    setItems((rows) => {
      if (rows.length === 1 && !rows[0].description && !rows[0].amount) {
        return [{ id: rows[0].id, description, amount }]
      }
      return [...rows, { id: nextId, description, amount }]
    })
    setNextId((id) => id + 1)
    setSaved(false)
  }

  async function handlePaySubmit(e: FormEvent) {
    e.preventDefault()
    if (!token || !payingInvoice || payBusy) return
    setPayBusy(true)
    setPayError('')
    try {
      const res = await payInvoice(token, payingInvoice.id, {
        paymentMethod,
        reference: paymentMethod === 'card' ? `CARD-${cardData.number.slice(-4) || '7788'}` : undefined,
      })
      if (alive.current) {
        setInvoices((rows) => rows.map((r) => (r.id === payingInvoice.id ? res.invoice : r)))
        setPaySuccess(t.paymentSuccess)
        setTimeout(() => {
          if (alive.current) {
            setPayingInvoice(null)
            setPaySuccess('')
          }
        }, 1200)
      }
    } catch {
      if (alive.current) setPayError(t.saveError)
    } finally {
      if (alive.current) setPayBusy(false)
    }
  }

  async function openReceipt(invoiceId: string) {
    if (!token) return
    setReceiptLoading(true)
    try {
      const res = await getInvoiceReceipt(token, invoiceId)
      if (alive.current) setReceiptData(res.receipt)
    } catch {
      // quiet
    } finally {
      if (alive.current) setReceiptLoading(false)
    }
  }

  return <section className="panel">
    <h1>{t.paymentsTitle}</h1>
    <p>{t.paymentsNote}</p>
    {loading && <p role="status">{t.loading}</p>}
    {error && <p className="form-error" role="alert">{error === 'load' ? t.loadError : t.saveError}{error === 'load' && <button onClick={() => void reload()}>{t.attendanceRetry}</button>}</p>}
    {(saved || paidSaved) && <p role="status">{t.attendanceSaved}</p>}

    {/* Staff Invoice Creator */}
    {canCreate && !loading && error !== 'load' && children.length > 0 && <form className="login-form" onSubmit={create}>
      <fieldset disabled={busy}>
        <label>{t.paymentsChild}<select required value={form.childId} onChange={(e) => { setSaved(false); setForm({ ...form, childId: e.target.value }) }}>{children.map((child) => <option key={child.id} value={child.id}>{child.name} · {child.groupName}</option>)}</select></label>
        <label>{t.paymentsPeriod}<input required maxLength={200} value={form.periodLabel} onChange={(e) => { setSaved(false); setForm({ ...form, periodLabel: e.target.value }) }} /></label>
        <label>{t.paymentsDueDate}<input required type="date" value={form.dueDate} onChange={(e) => { setSaved(false); setForm({ ...form, dueDate: e.target.value }) }} /></label>

        {/* Quick fee presets */}
        <div className="fee-presets">
          <button type="button" className="btn ghost small-btn" onClick={() => addPresetFee(t.presetTuitionFee, '150.00')}>+ {t.tuition} (150€)</button>
          <button type="button" className="btn ghost small-btn" onClick={() => addPresetFee(t.presetMealsFee, '35.00')}>+ {t.reportsMeals} (35€)</button>
          <button type="button" className="btn ghost small-btn" onClick={() => addPresetFee(t.presetMaterialsFee, '15.00')}>+ Art & Books (15€)</button>
        </div>

        {items.map((item, index) => <fieldset key={item.id}><legend>{t.fee} {index + 1}</legend><label>{t.fee}<input required maxLength={200} value={item.description} onChange={(e) => { setSaved(false); setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, description: e.target.value } : row)) }} /></label><label>{t.paymentsAmountLabel}<input required type="number" min="0.01" step="0.01" value={item.amount} onChange={(e) => { setSaved(false); setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, amount: e.target.value } : row)) }} /></label><button type="button" className="btn ghost" disabled={items.length < 2} onClick={() => { setSaved(false); setItems((rows) => rows.filter((row) => row.id !== item.id)) }}>{t.removeFee} {index + 1}</button></fieldset>)}
        <button type="button" className="btn ghost" disabled={items.length >= 100} onClick={() => { setItems((rows) => [...rows, { id: nextId, description: '', amount: '' }]); setNextId(nextId + 1); setSaved(false) }}>{t.addFee}</button>
        <p><strong>{t.total}: {Number.isSafeInteger(total) ? euro(total, lang) : '—'}</strong></p>
        <label>{t.paymentsNotes}<textarea maxLength={5000} value={form.notes} onChange={(e) => { setSaved(false); setForm({ ...form, notes: e.target.value }) }} /></label>
        <button className="btn primary" disabled={saved}>{busy ? t.attendanceSaving : t.paymentsCreate}</button>
      </fieldset>
    </form>}

    {!loading && error !== 'load' && !invoices.length && <p>{t.paymentsEmpty}</p>}

    {/* Invoices List */}
    {!loading && invoices.map((invoice) => (
      <article className="roster-card" key={invoice.id}>
        <h2>{invoice.childName} · {invoice.periodLabel}</h2>
        <p>{t.paymentsDue}: {displayDate(invoice.dueDate, lang)}</p>
        <ul className="fee-list">
          {invoice.items.map((item) => (
            <li key={item.id}>
              <span>{item.description === 'tuition' ? t.tuition : item.description}</span>
              <strong>{euro(item.amountCents, lang, invoice.currency)}</strong>
            </li>
          ))}
        </ul>
        <div className="actions">
          <strong>{t.total}: {euro(invoice.amountCents, lang, invoice.currency)}</strong>
          <span className={`badge ${invoice.status === 'paid' ? 'paid' : ''}`}>
            {invoice.status === 'paid' ? t.paymentsPaid : t.paymentsStatus}
          </span>
          {canPaid && invoice.status === 'pending' && (
            <button className="btn ghost" disabled={busy} onClick={() => void paid(invoice.id)}>
              {t.paymentsMarkPaid} · {invoice.childName}
            </button>
          )}
          {user?.role === 'parent' && invoice.status === 'pending' && (
            <button type="button" className="btn primary small-btn" onClick={() => { setPayingInvoice(invoice); setPayError('') }}>
              {t.payNow}
            </button>
          )}
          {invoice.status === 'paid' && (
            <button type="button" className="btn ghost small-btn" disabled={receiptLoading} onClick={() => void openReceipt(invoice.id)}>
              {receiptLoading ? t.loading : t.viewReceipt}
            </button>
          )}
        </div>
        {invoice.notes && <p>{invoice.notes}</p>}
      </article>
    ))}

    {/* Parent Online Payment Modal */}
    {payingInvoice && (
      <div className="modal-backdrop" onClick={() => !payBusy && setPayingInvoice(null)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <h2>{t.payInvoice} · {payingInvoice.childName}</h2>
          <p className="card-subtitle">{payingInvoice.periodLabel} · <strong>{euro(payingInvoice.amountCents, lang, payingInvoice.currency)}</strong></p>

          {paySuccess && <p role="status" className="notice">{paySuccess}</p>}
          {payError && <p role="alert" className="form-error">{payError}</p>}

          <form className="login-form" onSubmit={handlePaySubmit}>
            <fieldset disabled={payBusy}>
              <div className="log-action-toggle">
                <button type="button" className={`btn ${paymentMethod === 'card' ? 'primary' : 'ghost'} small-btn`} onClick={() => setPaymentMethod('card')}>
                  💳 {t.payWithCard}
                </button>
                <button type="button" className={`btn ${paymentMethod === 'bank_transfer' ? 'primary' : 'ghost'} small-btn`} onClick={() => setPaymentMethod('bank_transfer')}>
                  🏦 {t.payWithBank}
                </button>
              </div>

              {paymentMethod === 'card' ? (
                <>
                  <label>{t.cardHolder}<input required maxLength={100} placeholder="e.g., Elira Krasniqi" value={cardData.name} onChange={(e) => setCardData({ ...cardData, name: e.target.value })} /></label>
                  <label>{t.cardNumber}<input required maxLength={19} placeholder="4532 •••• •••• 1234" value={cardData.number} onChange={(e) => setCardData({ ...cardData, number: e.target.value })} /></label>
                  <div className="card-input-row">
                    <label>{t.cardExpiry}<input required maxLength={5} placeholder="12/28" value={cardData.expiry} onChange={(e) => setCardData({ ...cardData, expiry: e.target.value })} /></label>
                    <label>{t.cardCvc}<input required maxLength={4} placeholder="123" value={cardData.cvc} onChange={(e) => setCardData({ ...cardData, cvc: e.target.value })} /></label>
                  </div>
                </>
              ) : (
                <div className="bank-instructions-box">
                  <p>{t.bankInstructions}</p>
                  <p><strong>{t.bankName}:</strong> Banka Ekonomike / NLB Banka</p>
                  <p><strong>{t.bankIban}:</strong> XK05 1501 0010 2030 4050</p>
                  <p><strong>{t.bankReference}:</strong> <code>INV-{payingInvoice.id.slice(0, 8).toUpperCase()}</code></p>
                </div>
              )}

              <div className="actions modal-actions">
                <button className="btn primary">{payBusy ? t.attendanceSaving : `${t.confirmPayment} (${euro(payingInvoice.amountCents, lang, payingInvoice.currency)})`}</button>
                <button type="button" className="btn ghost" onClick={() => setPayingInvoice(null)}>{t.cancel}</button>
              </div>
            </fieldset>
          </form>
        </div>
      </div>
    )}

    {/* Official Receipt Modal */}
    {receiptData && (
      <div className="modal-backdrop" onClick={() => setReceiptData(null)}>
        <div className="receipt-modal" onClick={(e) => e.stopPropagation()}>
          <div className="receipt-header">
            <div>
              <h3>{receiptData.kindergarten.name}</h3>
              <p className="card-subtitle">{receiptData.kindergarten.address}</p>
              <p className="card-subtitle">Tax ID: {receiptData.kindergarten.taxId} · IBAN: {receiptData.kindergarten.iban}</p>
            </div>
            <div className="receipt-stamp">PAID / PAGUAR</div>
          </div>

          <h2>{t.officialReceipt}</h2>
          <p><strong>{t.receiptNumber}:</strong> {receiptData.receiptNumber}</p>
          <p><strong>{t.billedTo}:</strong> {receiptData.invoice.parentName} ({receiptData.invoice.parentEmail})</p>
          <p><strong>{t.childName}:</strong> {receiptData.invoice.childName} ({receiptData.invoice.groupName})</p>
          <p><strong>{t.paidDate}:</strong> {receiptData.invoice.paidAt ? receiptData.invoice.paidAt.slice(0, 10) : '—'}</p>

          <table className="receipt-table">
            <thead>
              <tr>
                <th>{t.fee}</th>
                <th>{t.paymentsAmountLabel}</th>
              </tr>
            </thead>
            <tbody>
              {receiptData.invoice.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.description}</td>
                  <td><strong>{euro(item.amountCents, lang, receiptData.invoice.currency)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{t.total}</th>
                <th>{euro(receiptData.invoice.amountCents, lang, receiptData.invoice.currency)}</th>
              </tr>
            </tfoot>
          </table>

          <div className="actions receipt-actions">
            <button type="button" className="btn primary small-btn" onClick={() => window.print()}>{t.printReceipt}</button>
            <button type="button" className="btn ghost small-btn" onClick={() => setReceiptData(null)}>{t.closeReceipt}</button>
          </div>
        </div>
      </div>
    )}
  </section>
}
