import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { listAttendance, listChildren, saveAttendance, type AttendanceEntry, type AttendanceStatus, type Child } from './api'
import { createAttendanceRequests } from './attendance-requests'
import { localCalendarDate, validDate } from './attendance-date'
import { useAuth } from './auth'
import { useI18n } from './i18n/LanguageContext'

type Attempt = { childId: string; status: AttendanceStatus }
type Roster = { context: string; children: Child[]; entries: AttendanceEntry[]; state: 'ready' | 'loading' | 'error'; sessionExpired?: boolean }

export default function Attendance({ initialDate }: { initialDate?: string }) {
  const { token, user } = useAuth()
  const { t } = useI18n()
  const [date, setDate] = useState(() => initialDate || localCalendarDate())
  const [retry, setRetry] = useState(0)
  const context = JSON.stringify([token, user?.id, date])
  const [requests] = useState(createAttendanceRequests)
  useLayoutEffect(() => { requests.invalidate() }, [context, requests])
  const saving = useRef(false)
  const [roster, setRoster] = useState<Roster>({ context: '', children: [], entries: [], state: 'loading' })
  const [pending, setPending] = useState<Attempt | null>(null)
  const [failed, setFailed] = useState<(Attempt & { sessionExpired: boolean }) | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const dateValid = validDate(date)
  const canMark = user?.role === 'teacher' || user?.role === 'director'

  useEffect(() => { heading.current?.focus() }, [])

  useEffect(() => {
    const current = requests.begin()
    let cancelled = false
    if (!token || !dateValid) return
    void Promise.all([listChildren(token), listAttendance(token, date)]).then(([children, entries]) => {
      if (cancelled || !current()) return
      setRoster({ context, children: children.children, entries: entries.attendance, state: 'ready' })
    }).catch((error: unknown) => {
      if (cancelled || !current()) return
      setRoster({ context, children: [], entries: [], state: 'error', sessionExpired: error instanceof Error && error.message === 'unauthorized' })
    })
    return () => { cancelled = true; requests.invalidate() }
  }, [context, token, date, dateValid, retry, requests])

  function selectDate(value: string) {
    if (saving.current || value === date) return
    requests.invalidate()
    saving.current = false
    setPending(null)
    setFailed(null)
    setSaved(null)
    setRoster({ context: '', children: [], entries: [], state: 'loading' })
    setDate(value)
  }

  async function mark(attempt: Attempt) {
    if (!token || !canMark || !dateValid || saving.current || roster.context !== context || roster.state !== 'ready') return
    const current = requests.begin()
    saving.current = true
    setPending(attempt)
    setFailed(null)
    setSaved(null)
    try {
      const { attendance } = await saveAttendance(token, {
        childId: attempt.childId, status: attempt.status, attendanceDate: date,
      })
      if (!current()) return
      setRoster((previous) => ({ ...previous, entries: [...previous.entries.filter((entry) => entry.childId !== attempt.childId), attendance] }))
      setSaved(attempt.childId)
    } catch (error) {
      if (!current()) return
      setFailed({ ...attempt, sessionExpired: error instanceof Error && error.message === 'unauthorized' })
    } finally {
      if (current()) {
        saving.current = false
        setPending(null)
      }
    }
  }

  const currentRoster = roster.context === context ? roster : null
  const ready = dateValid && currentRoster?.state === 'ready'
  const entries = new Map(currentRoster?.entries.map((entry) => [entry.childId, entry]))
  const statusLabel = (status?: AttendanceStatus) => status === 'present' ? t.attendancePresent : status === 'absent' ? t.attendanceAbsent : t.attendanceUnmarked

  return (
    <section className="panel attendance-panel">
      <h1 ref={heading} tabIndex={-1}>{t.attendanceTitle}</h1>
      <p className="panel-sub">{canMark ? t.attendanceStaffDescription : t.attendanceParentDescription}</p>
      <div className="attendance-date">
        <label htmlFor="attendance-date">{t.attendanceDate}</label>
        <input id="attendance-date" type="date" min="0001-01-01" max="9999-12-31" value={date}
          disabled={pending !== null}
          aria-invalid={!dateValid} aria-describedby={!dateValid ? 'attendance-date-error' : undefined}
          onChange={(event) => selectDate(event.target.value)} />
        <button className="btn ghost" type="button" disabled={pending !== null} onClick={() => selectDate(localCalendarDate())}>{t.attendanceToday}</button>
      </div>
      {!dateValid && <p id="attendance-date-error" className="form-error" role="alert">{t.attendanceInvalidDate}</p>}
      {dateValid && (!currentRoster || currentRoster.state === 'loading') && <p role="status">{t.attendanceLoading}</p>}
      {dateValid && currentRoster?.state === 'error' && <div className="attendance-error" role="alert">
        <p className="form-error">{currentRoster.sessionExpired ? t.attendanceSessionExpired : t.attendanceLoadError}</p>
        <button type="button" className="btn ghost" onClick={() => { setRoster({ context, children: [], entries: [], state: 'loading' }); setRetry((value) => value + 1) }}>{t.attendanceRetry}</button>
      </div>}
      {ready && currentRoster.children.length === 0 && <p>{t.attendanceEmpty}</p>}
      {ready && <ul className="attendance-roster">
        {currentRoster.children.map((child) => {
          const status = entries.get(child.id)?.status
          return <li key={child.id} className="attendance-row">
            <div className="attendance-identity"><h2>{child.name}</h2><p>{t.attendanceGroup}: {child.groupName}</p></div>
            <p className={`attendance-status ${status ?? 'unmarked'}`}>{statusLabel(status)}</p>
            {canMark && <div className="attendance-controls">
              {(['present', 'absent'] as const).map((choice) => <button key={choice} type="button"
                className="btn ghost" aria-pressed={status === choice} aria-label={`${statusLabel(choice)} · ${child.name}`}
                disabled={pending !== null} onClick={() => void mark({ childId: child.id, status: choice })}>{statusLabel(choice)}</button>)}
            </div>}
            <div className="attendance-feedback" role="status">
              {pending?.childId === child.id && `${t.attendanceSaving} ${statusLabel(pending.status)}`}
              {saved === child.id && t.attendanceSaved}
            </div>
            {failed?.childId === child.id && <div className="attendance-error" role="alert">
              <p className="form-error">{failed.sessionExpired ? t.attendanceSessionExpired : t.attendanceSaveError}</p>
              <button type="button" className="btn ghost" disabled={pending !== null} onClick={() => void mark(failed)}>{t.attendanceRetry}</button>
            </div>}
          </li>
        })}
      </ul>}
    </section>
  )
}
