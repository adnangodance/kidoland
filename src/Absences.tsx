/* Manage absence notices and display absence list for parents and staff */
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState, type FormEvent } from 'react'
import {
  listAbsenceNotices,
  createAbsenceNotice,
  deleteAbsenceNotice,
  listChildren,
  type AbsenceNotice,
  type AbsenceInput,
  type AbsenceReason,
  type Child,
} from './api'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import { localCalendarDate, validDate } from './attendance-date'
import { displayDate, useAlive } from './pilot-utils'
import ChildAvatar from './ChildAvatar'

const reasons: { value: AbsenceReason; labelKey: 'reasonSick' | 'reasonVacation' | 'reasonAppointment' | 'reasonOther'; icon: string }[] = [
  { value: 'sick', labelKey: 'reasonSick', icon: '🤒' },
  { value: 'vacation', labelKey: 'reasonVacation', icon: '🏖️' },
  { value: 'appointment', labelKey: 'reasonAppointment', icon: '🩺' },
  { value: 'other', labelKey: 'reasonOther', icon: '📝' },
]

export default function Absences() {
  const { token, user } = useAuth()
  const { t, lang } = useI18n()
  const alive = useAlive()

  const [notices, setNotices] = useState<AbsenceNotice[]>([])
  const [children, setChildren] = useState<Child[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  // Filter for staff
  const [filterDate, setFilterDate] = useState(() => localCalendarDate())

  // Create absence form state
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState<AbsenceInput>({
    childId: '',
    startDate: localCalendarDate(),
    endDate: localCalendarDate(),
    reasonType: 'sick',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [feedback, setFeedback] = useState('')

  const isStaff = user?.role === 'teacher' || user?.role === 'director'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)

    const dateFilter = isStaff && validDate(filterDate) ? filterDate : undefined

    Promise.all([
      listAbsenceNotices(token || '', { date: dateFilter }),
      listChildren(token || ''),
    ])
      .then(([nRes, cRes]) => {
        if (!cancelled && alive.current) {
          setNotices(nRes.notices)
          setChildren(cRes.children)
          if (cRes.children.length > 0 && !draft.childId) {
            setDraft((d) => ({ ...d, childId: cRes.children[0].id }))
          }
        }
      })
      .catch(() => {
        if (!cancelled && alive.current) setError(true)
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token, retry, filterDate, isStaff])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!token || saving) return
    if (!draft.childId || !validDate(draft.startDate) || !validDate(draft.endDate)) {
      setSaveError(t.attendanceInvalidDate)
      return
    }
    if (draft.startDate > draft.endDate) {
      setSaveError(t.dateRangeError)
      return
    }

    setSaving(true)
    setSaveError('')
    setFeedback('')

    try {
      const res = await createAbsenceNotice(token, draft)
      if (alive.current) {
        setNotices((prev) => [res.notice, ...prev.filter((n) => n.id !== res.notice.id)])
        setShowForm(false)
        setFeedback(t.absenceReported)
        setDraft({
          childId: children[0]?.id || '',
          startDate: localCalendarDate(),
          endDate: localCalendarDate(),
          reasonType: 'sick',
          notes: '',
        })
      }
    } catch {
      if (alive.current) setSaveError(t.saveError)
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!token || saving) return
    setSaving(true)
    setSaveError('')
    try {
      await deleteAbsenceNotice(token, id)
      if (alive.current) {
        setNotices((prev) => prev.filter((n) => n.id !== id))
        setFeedback(t.absenceCancelled)
      }
    } catch {
      if (alive.current) setSaveError(t.saveError)
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  const reasonLabel = (reason: AbsenceReason) => {
    const item = reasons.find((r) => r.value === reason)
    return item ? `${item.icon} ${t[item.labelKey]}` : reason
  }

  return (
    <section className="panel absences-panel">
      <h1>{t.absencesTitle}</h1>
      <p>{isStaff ? t.absencesStaffDescription : t.absencesParentDescription}</p>

      {/* Staff Date Filter */}
      {isStaff && (
        <div className="filters">
          <label>
            {t.attendanceDate}
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setFilterDate(localCalendarDate())}
          >
            {t.attendanceToday}
          </button>
        </div>
      )}

      {/* Parent Create Absence Button */}
      {!isStaff && (
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={() => {
              setShowForm(!showForm)
              setSaveError('')
              setFeedback('')
            }}
          >
            {showForm ? t.cancel : `+ ${t.reportAbsence}`}
          </button>
        </div>
      )}

      {feedback && <p role="status" className="notice">{feedback}</p>}
      {saveError && <p role="alert" className="form-error">{saveError}</p>}
      {error && (
        <p role="alert" className="form-error">
          {t.loadError}{' '}
          <button type="button" onClick={() => setRetry((r) => r + 1)}>
            {t.attendanceRetry}
          </button>
        </p>
      )}

      {/* Report Absence Form */}
      {showForm && (
        <form className="login-form absence-form" onSubmit={handleSubmit}>
          <fieldset disabled={saving}>
            <h2>{t.reportAbsence}</h2>

            {children.length > 1 && (
              <label>
                {t.paymentsChild}
                <select
                  required
                  value={draft.childId}
                  onChange={(e) => setDraft({ ...draft, childId: e.target.value })}
                >
                  {children.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.groupName})
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label>
              {t.absenceReason}
              <select
                value={draft.reasonType}
                onChange={(e) => setDraft({ ...draft, reasonType: e.target.value as AbsenceReason })}
              >
                {reasons.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.icon} {t[r.labelKey]}
                  </option>
                ))}
              </select>
            </label>

            <div className="absence-dates-row">
              <label>
                {t.absenceStartDate}
                <input
                  type="date"
                  required
                  value={draft.startDate}
                  onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                />
              </label>
              <label>
                {t.absenceEndDate}
                <input
                  type="date"
                  required
                  value={draft.endDate}
                  onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                />
              </label>
            </div>

            <label>
              {t.absenceNotes}
              <textarea
                maxLength={1000}
                placeholder={t.absenceNotesPlaceholder}
                value={draft.notes || ''}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </label>

            <div className="actions">
              <button className="btn primary">
                {saving ? t.attendanceSaving : t.reportAbsence}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowForm(false)}
              >
                {t.cancel}
              </button>
            </div>
          </fieldset>
        </form>
      )}

      {loading && <p role="status">{t.loading}</p>}

      {!loading && !error && notices.length === 0 && (
        <p className="empty-hint">{t.noAbsences}</p>
      )}

      {/* Notices List */}
      {!loading && (
        <div className="absence-list">
          {notices.map((n) => (
            <article key={n.id} className="roster-card absence-card">
              <div className="card-avatar-heading">
                <ChildAvatar name={n.childName} size={42} />
                <div>
                  <h2>{n.childName}</h2>
                  <p className="card-subtitle">{n.groupName} · {t.postedBy}: {n.parentName}</p>
                </div>
              </div>

              <div className="absence-meta">
                <span className={`badge absence-badge ${n.reasonType}`}>
                  {reasonLabel(n.reasonType)}
                </span>
                <span className="absence-dates">
                  📅 {displayDate(n.startDate, lang)} — {displayDate(n.endDate, lang)}
                </span>
              </div>

              {n.notes && <p className="absence-notes">💬 {n.notes}</p>}

              {!isStaff && (
                <div className="actions" style={{ marginTop: '0.75rem' }}>
                  <button
                    type="button"
                    className="btn ghost small-btn"
                    disabled={saving}
                    onClick={() => void handleDelete(n.id)}
                  >
                    {t.cancelAbsence}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
