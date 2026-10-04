import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import { localCalendarDate } from './attendance-date'
import {
  listStaffShifts,
  createStaffShift,
  updateShiftStatus,
  deleteStaffShift,
  type StaffShift,
  type RoomRatioStat,
  type StaffMember,
  type ShiftType,
  type ShiftStatus,
  type StaffShiftInput,
} from './api'

export function StaffShifts() {
  const { token, user } = useAuth()
  const { t } = useI18n()

  const [date, setDate] = useState(() => localCalendarDate())
  const [shifts, setShifts] = useState<StaffShift[]>([])
  const [roomRatios, setRoomRatios] = useState<RoomRatioStat[]>([])
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')

  // Shift creation form (director/teacher)
  const [showForm, setShowForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [newShift, setNewShift] = useState<StaffShiftInput>(() => ({
    staffId: '',
    shiftDate: localCalendarDate(),
    shiftType: 'morning',
    startTime: '07:30',
    endTime: '15:30',
    groupName: 'Bletët / Bumblebees',
    notes: '',
  }))

  const isDirector = user?.role === 'director'
  const isStaff = user?.role === 'teacher' || isDirector
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()

    async function loadShifts() {
      setLoading(true)
      setError('')
      try {
        const res = await listStaffShifts(token!, date, controller.signal)
        if (alive.current) {
          setShifts(res.shifts)
          setRoomRatios(res.roomRatios)
          setStaffMembers(res.staffMembers)
          setNewShift((prev) => (prev.staffId || res.staffMembers.length === 0 ? prev : { ...prev, staffId: res.staffMembers[0].id }))
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        if (alive.current) {
          setError(t.attendanceLoadError)
        }
      } finally {
        if (alive.current) setLoading(false)
      }
    }

    void loadShifts()
    return () => {
      controller.abort()
    }
  }, [token, date, t.attendanceLoadError])

  function getShiftTypeLabel(type: ShiftType) {
    switch (type) {
      case 'morning':
        return t.shiftMorning
      case 'regular':
        return t.shiftRegular
      case 'closing':
        return t.shiftClosing
      case 'substitute':
        return t.shiftSubstitute
    }
  }

  function getStatusLabel(status: ShiftStatus) {
    switch (status) {
      case 'scheduled':
        return t.statusScheduled
      case 'checked_in':
        return t.statusCheckedIn
      case 'completed':
        return t.statusCompleted
      case 'absent':
        return t.statusAbsent
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!token || creating) return

    const effectiveStaffId = newShift.staffId || staffMembers[0]?.id || ''
    if (!effectiveStaffId) return

    setCreating(true)
    setCreateError('')
    setFeedback('')

    try {
      const res = await createStaffShift(token, {
        staffId: effectiveStaffId,
        shiftDate: date,
        shiftType: newShift.shiftType,
        startTime: newShift.startTime,
        endTime: newShift.endTime,
        groupName: newShift.groupName,
        notes: newShift.notes?.trim() || undefined,
      })

      if (alive.current) {
        setShifts((prev) => [...prev, res.shift])
        setShowForm(false)
        setFeedback(t.shiftSaved)
        setNewShift((prev) => ({ ...prev, notes: '' }))

        // Refresh ratio counts
        const ref = await listStaffShifts(token, date)
        if (alive.current) setRoomRatios(ref.roomRatios)
      }
    } catch {
      if (alive.current) setCreateError(t.attendanceSaveError)
    } finally {
      if (alive.current) setCreating(false)
    }
  }

  async function handleStatusChange(shiftId: string, newStatus: ShiftStatus) {
    if (!token) return
    try {
      const res = await updateShiftStatus(token, shiftId, newStatus)
      if (alive.current) {
        setShifts((prev) => prev.map((s) => (s.id === shiftId ? res.shift : s)))
        // Refresh ratios
        const ref = await listStaffShifts(token, date)
        if (alive.current) setRoomRatios(ref.roomRatios)
      }
    } catch {
      // quiet fallback
    }
  }

  async function handleDelete(shiftId: string) {
    if (!token) return
    try {
      await deleteStaffShift(token, shiftId)
      if (alive.current) {
        setShifts((prev) => prev.filter((s) => s.id !== shiftId))
        setFeedback(t.shiftDeleted)
        // Refresh ratios
        const ref = await listStaffShifts(token, date)
        if (alive.current) setRoomRatios(ref.roomRatios)
      }
    } catch {
      // quiet fallback
    }
  }

  return (
    <section className="panel staff-shifts-panel" aria-busy={loading}>
      <div className="panel-header">
        <div>
          <h1 tabIndex={-1}>{t.staffShiftsTitle}</h1>
          <p className="subtitle">
            {isStaff ? t.staffShiftsSubtitle : t.staffParentSubtitle}
          </p>
        </div>
        {isStaff && (
          <button
            type="button"
            className="btn primary"
            onClick={() => setShowForm((v) => !v)}
            aria-expanded={showForm}
          >
            {t.scheduleShiftBtn}
          </button>
        )}
      </div>

      {feedback && <div className="notice success-banner" role="status">✓ {feedback}</div>}
      {error && <div className="notice error-banner" role="alert">{error}</div>}

      {/* Date Switcher */}
      <div className="filters">
        <label>
          {t.shiftDateLabel}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn ghost"
          onClick={() => setDate(localCalendarDate())}
        >
          {t.attendanceToday}
        </button>
      </div>

      {/* Schedule Shift Form Drawer / Modal */}
      {isStaff && showForm && (
        <form className="card shift-form-card" onSubmit={handleCreate}>
          <h2>{t.scheduleShiftTitle}</h2>
          {createError && <p className="form-error" role="alert">{createError}</p>}

          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="shift-staff">{t.selectStaffLabel}</label>
              <select
                id="shift-staff"
                required
                value={newShift.staffId}
                onChange={(e) => setNewShift((prev) => ({ ...prev, staffId: e.target.value }))}
              >
                {staffMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="shift-type">{t.shiftTypeLabel}</label>
              <select
                id="shift-type"
                value={newShift.shiftType}
                onChange={(e) => {
                  const st = e.target.value as ShiftType
                  let start = '08:30'
                  let end = '16:30'
                  if (st === 'morning') { start = '07:30'; end = '15:30' }
                  if (st === 'closing') { start = '10:00'; end = '18:00' }
                  setNewShift((prev) => ({ ...prev, shiftType: st, startTime: start, endTime: end }))
                }}
              >
                <option value="morning">{t.shiftMorning}</option>
                <option value="regular">{t.shiftRegular}</option>
                <option value="closing">{t.shiftClosing}</option>
                <option value="substitute">{t.shiftSubstitute}</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="shift-group">{t.targetGroup}</label>
              <select
                id="shift-group"
                value={newShift.groupName}
                onChange={(e) => setNewShift((prev) => ({ ...prev, groupName: e.target.value }))}
              >
                <option value="Bletët / Bumblebees">Bletët / Bumblebees</option>
                <option value="Fluturat / Butterflies">Fluturat / Butterflies</option>
                <option value="Yjet / Little Stars">Yjet / Little Stars</option>
                <option value="all">{t.allGroups}</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="shift-start">{t.shiftStartTime}</label>
              <input
                id="shift-start"
                type="time"
                required
                value={newShift.startTime}
                onChange={(e) => setNewShift((prev) => ({ ...prev, startTime: e.target.value }))}
              />
            </div>

            <div className="form-field">
              <label htmlFor="shift-end">{t.shiftEndTime}</label>
              <input
                id="shift-end"
                type="time"
                required
                value={newShift.endTime}
                onChange={(e) => setNewShift((prev) => ({ ...prev, endTime: e.target.value }))}
              />
            </div>

            <div className="form-field full-width">
              <label htmlFor="shift-notes">{t.shiftNotes}</label>
              <input
                id="shift-notes"
                type="text"
                value={newShift.notes || ''}
                onChange={(e) => setNewShift((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder={t.shiftNotesPlaceholder}
              />
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setShowForm(false)}
            >
              {t.cancelAbsence}
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={creating}
            >
              {creating ? t.attendanceSaving : t.saveShift}
            </button>
          </div>
        </form>
      )}

      {/* Live Room Ratio & Safety Compliance Monitor */}
      <section className="ratio-monitor-section">
        <h2>{t.ratioComplianceTitle}</h2>
        <div className="ratio-cards-grid">
          {roomRatios.map((ratio) => {
            const isExceeded = ratio.status === 'exceeded'
            const isWarning = ratio.status === 'warning'

            return (
              <article
                key={ratio.groupName}
                className={`card ratio-card ${ratio.status}`}
              >
                <div className="ratio-card-header">
                  <h3>{ratio.groupName}</h3>
                  <span className={`badge compliance-badge ${ratio.status}`}>
                    {isExceeded && t.badgeExceeded}
                    {isWarning && t.badgeWarning}
                    {!isExceeded && !isWarning && t.badgeOptimal}
                  </span>
                </div>

                <div className="ratio-stats-grid">
                  <div className="ratio-stat-box">
                    <span className="ratio-num">{ratio.childrenCount}</span>
                    <span className="ratio-lbl">{t.statChildrenPresent}</span>
                  </div>
                  <div className="ratio-stat-box">
                    <span className="ratio-num">{ratio.staffCount}</span>
                    <span className="ratio-lbl">{t.statStaffActive}</span>
                  </div>
                  <div className="ratio-stat-box highlight">
                    <span className="ratio-num">{ratio.currentRatioStr}</span>
                    <span className="ratio-lbl">{t.statCurrentRatio}</span>
                  </div>
                  <div className="ratio-stat-box">
                    <span className="ratio-num">1:{ratio.maxRatio}</span>
                    <span className="ratio-lbl">{t.statLegalLimit}</span>
                  </div>
                </div>

                {/* Visual Capacity & Ratio Bar */}
                <div className="ratio-progress-container" aria-hidden="true">
                  <div
                    className={`ratio-progress-bar ${ratio.status}`}
                    style={{
                      width: `${Math.min(100, (ratio.childrenCount / (Math.max(1, ratio.staffCount) * ratio.maxRatio)) * 100)}%`,
                    }}
                  />
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {/* Scheduled Shifts Feed */}
      <section className="shifts-list-section">
        <h2>{isStaff ? t.staffShiftsTitle : t.educatorsOnDuty}</h2>

        {loading && <p role="status">{t.loading}</p>}

        {!loading && shifts.length === 0 && (
          <div className="empty-state">
            <p>{t.noShiftsToday}</p>
          </div>
        )}

        <div className="shifts-grid">
          {shifts.map((s) => (
            <article key={s.id} className="card shift-card">
              <div className="shift-card-header">
                <div>
                  <h3 className="staff-name">{s.staffName}</h3>
                  <span className="badge role-badge">{s.staffRole}</span>
                </div>
                <span className={`badge shift-status-badge ${s.status}`}>
                  {getStatusLabel(s.status)}
                </span>
              </div>

              <div className="shift-meta-details">
                <div className="shift-meta-item">
                  <span className="meta-icon">⏰</span>
                  <span>{s.startTime} - {s.endTime}</span>
                </div>
                <div className="shift-meta-item">
                  <span className="meta-icon">🏢</span>
                  <span>{s.groupName === 'all' ? t.allGroups : s.groupName}</span>
                </div>
                <div className="shift-meta-item">
                  <span className="meta-icon">📋</span>
                  <span>{getShiftTypeLabel(s.shiftType)}</span>
                </div>
              </div>

              {s.notes && <p className="shift-notes">💬 {s.notes}</p>}

              {isStaff && (
                <div className="shift-actions-bar">
                  {s.status === 'scheduled' && (
                    <button
                      type="button"
                      className="btn primary small-btn"
                      onClick={() => handleStatusChange(s.id, 'checked_in')}
                    >
                      ✓ {t.btnCheckIn}
                    </button>
                  )}
                  {s.status === 'checked_in' && (
                    <button
                      type="button"
                      className="btn secondary small-btn"
                      onClick={() => handleStatusChange(s.id, 'completed')}
                    >
                      ✓ {t.btnCheckOut}
                    </button>
                  )}
                  {isDirector && (
                    <button
                      type="button"
                      className="btn ghost small-btn danger-text"
                      onClick={() => handleDelete(s.id)}
                      title={t.shiftDeleted}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}
