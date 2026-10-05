/* eslint-disable react/set-state-in-effect */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import { localCalendarDate } from './attendance-date.js'
import {
  listChildren,
  listSleepLogs,
  createSleepLog,
  updateSleepLog,
  deleteSleepLog,
  type Child,
  type ChildSleepLog,
  type SleepQuality,
  type SleepSummaryStats,
} from './api'

const QUALITY_ICONS: Record<SleepQuality, string> = {
  restful: '🌙',
  light: '☁️',
  restless: '🌧️',
  refused_nap: '🚫',
}

function formatDuration(minutes: number | null): string {
  if (minutes == null) return '—'
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours === 0) return `${remainingMinutes}m`
  if (remainingMinutes === 0) return `${hours}h`
  return `${hours}h ${remainingMinutes}m`
}

function getCurrentTimeHHMM(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

export function SleepTracker() {
  const { token, user } = useAuth()
  const { t } = useI18n()
  const alive = useRef(true)

  const [date, setDate] = useState<string>(() => localCalendarDate())
  const [children, setChildren] = useState<Child[]>([])
  const [logs, setLogs] = useState<ChildSleepLog[]>([])
  const [summary, setSummary] = useState<SleepSummaryStats>({
    totalLogs: 0,
    totalSleepMinutes: 0,
    activeNappingCount: 0,
    restfulCount: 0,
    lightCount: 0,
    restlessCount: 0,
    refusedCount: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // Filters
  const [selectedChildId, setSelectedChildId] = useState<string>('')
  const [selectedQuality, setSelectedQuality] = useState<string>('')

  // Modal State for Create / Edit
  const [showModal, setShowModal] = useState(false)
  const [editingLogId, setEditingLogId] = useState<string | null>(null)
  const [formChildId, setFormChildId] = useState<string>('')
  const [formStartTime, setFormStartTime] = useState<string>('12:30')
  const [formEndTime, setFormEndTime] = useState<string>('14:30')
  const [formIsCurrentlySleeping, setFormIsCurrentlySleeping] = useState<boolean>(false)
  const [formQuality, setFormQuality] = useState<SleepQuality>('restful')
  const [formNotes, setFormNotes] = useState<string>('')
  const [submitting, setSubmitting] = useState<boolean>(false)

  // Quick Wakeup Modal
  const [wakeUpLog, setWakeUpLog] = useState<ChildSleepLog | null>(null)
  const [wakeUpTime, setWakeUpTime] = useState<string>(getCurrentTimeHHMM)
  const [wakeUpQuality, setWakeUpQuality] = useState<SleepQuality>('restful')
  const [wakeUpNotes, setWakeUpNotes] = useState<string>('')

  const isStaff = user?.role === 'teacher' || user?.role === 'director'
  const isParent = user?.role === 'parent'

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Load roster
  useEffect(() => {
    if (!token) return
    let active = true

    listChildren(token)
      .then((res) => {
        if (!active) return
        setChildren(res.children)
        if (res.children.length > 0) {
          setFormChildId((current) => current || res.children[0].id)
        }
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [token])

  // Fetch sleep logs for selected date
  const loadLogs = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)

    try {
      const res = await listSleepLogs(token, {
        date,
        childId: selectedChildId || undefined,
      })
      if (!alive.current) return
      setLogs(res.logs)
      setSummary(res.summary)
    } catch {
      if (!alive.current) return
      setError(t.loadError)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [token, date, selectedChildId, t.loadError])

  useEffect(() => {
    void loadLogs()
  }, [loadLogs])

  const handleOpenCreateModal = () => {
    setEditingLogId(null)
    setFormStartTime(getCurrentTimeHHMM())
    setFormEndTime('')
    setFormIsCurrentlySleeping(true)
    setFormQuality('restful')
    setFormNotes('')
    if (children.length > 0) {
      setFormChildId(children[0].id)
    }
    setShowModal(true)
  }

  const handleOpenEditModal = (log: ChildSleepLog) => {
    setEditingLogId(log.id)
    setFormChildId(log.childId)
    setFormStartTime(log.startTime)
    setFormEndTime(log.endTime || '')
    setFormIsCurrentlySleeping(log.endTime == null)
    setFormQuality(log.quality)
    setFormNotes(log.notes || '')
    setShowModal(true)
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return

    setSubmitting(true)
    setError(null)
    setMessage(null)

    try {
      if (editingLogId) {
        await updateSleepLog(token, editingLogId, {
          startTime: formStartTime,
          endTime: formIsCurrentlySleeping ? null : formEndTime || null,
          quality: formQuality,
          notes: formNotes,
        })
        setMessage(t.sleepLogUpdated)
      } else {
        await createSleepLog(token, {
          childId: formChildId,
          logDate: date,
          startTime: formStartTime,
          endTime: formIsCurrentlySleeping ? null : formEndTime || null,
          quality: formQuality,
          notes: formNotes,
        })
        setMessage(t.sleepLogCreated)
      }
      setShowModal(false)
      await loadLogs()
    } catch {
      setError(t.saveError)
    } finally {
      setSubmitting(false)
    }
  }

  const handleWakeUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !wakeUpLog) return

    setSubmitting(true)
    setError(null)
    setMessage(null)

    try {
      await updateSleepLog(token, wakeUpLog.id, {
        endTime: wakeUpTime,
        quality: wakeUpQuality,
        notes: wakeUpNotes ? `${wakeUpLog.notes ? wakeUpLog.notes + ' · ' : ''}${wakeUpNotes}` : wakeUpLog.notes || '',
      })
      setMessage(t.wakeUpSuccess)
      setWakeUpLog(null)
      await loadLogs()
    } catch {
      setError(t.saveError)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!token) return
    try {
      await deleteSleepLog(token, id)
      setMessage(t.sleepLogDeleted)
      await loadLogs()
    } catch {
      setError(t.saveError)
    }
  }

  const getQualityLabel = (quality: SleepQuality) => {
    switch (quality) {
      case 'restful':
        return t.qualityRestful
      case 'light':
        return t.qualityLight
      case 'restless':
        return t.qualityRestless
      case 'refused_nap':
        return t.qualityRefused
    }
  }

  const filteredLogs = logs.filter((log) => {
    if (selectedQuality && log.quality !== selectedQuality) return false
    return true
  })

  const activeSleepingLogs = logs.filter((log) => log.endTime == null)

  return (
    <section className="panel sleep-panel">
      <div className="panel-header-row">
        <div>
          <h1 tabIndex={-1}>{t.sleepTrackerTitle}</h1>
          <p className="panel-subtitle">
            {isParent ? t.sleepParentSubtitle : t.sleepTrackerSubtitle}
          </p>
        </div>
        {isStaff && (
          <button
            type="button"
            className="btn primary"
            onClick={handleOpenCreateModal}
          >
            {t.logNapBtn}
          </button>
        )}
      </div>

      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice success">{message}</div>}

      {/* Date & Filter Controls */}
      <div className="sleep-filter-bar">
        <div className="filter-group">
          <label htmlFor="sleep-date-input">{t.attendanceDate}:</label>
          <input
            id="sleep-date-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input-text"
          />
        </div>

        {children.length > 1 && (
          <div className="filter-group">
            <label htmlFor="filter-sleep-child">{t.paymentsChild}:</label>
            <select
              id="filter-sleep-child"
              value={selectedChildId}
              onChange={(e) => setSelectedChildId(e.target.value)}
              className="input-select"
            >
              <option value="">{t.domainAll}</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.groupName})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="filter-group">
          <label htmlFor="filter-sleep-quality">{t.napQualityLabel}:</label>
          <select
            id="filter-sleep-quality"
            value={selectedQuality}
            onChange={(e) => setSelectedQuality(e.target.value)}
            className="input-select"
          >
            <option value="">{t.filterAllQualities}</option>
            <option value="restful">{t.qualityRestful}</option>
            <option value="light">{t.qualityLight}</option>
            <option value="restless">{t.qualityRestless}</option>
            <option value="refused_nap">{t.qualityRefused}</option>
          </select>
        </div>
      </div>

      {/* Live Summary Metrics */}
      <div className="sleep-summary-grid">
        <div className="sleep-summary-card total-time">
          <span className="summary-icon">⏳</span>
          <div className="summary-info">
            <span className="summary-label">{t.statTotalNapTime}</span>
            <strong className="summary-value">{formatDuration(summary.totalSleepMinutes)}</strong>
          </div>
        </div>

        <div className="sleep-summary-card active-nappers">
          <span className="summary-icon">💤</span>
          <div className="summary-info">
            <span className="summary-label">{t.statNappingNow}</span>
            <strong className="summary-value">{summary.activeNappingCount}</strong>
          </div>
        </div>

        <div className="sleep-summary-card restful-count">
          <span className="summary-icon">🌙</span>
          <div className="summary-info">
            <span className="summary-label">{t.statRestfulNaps}</span>
            <strong className="summary-value">{summary.restfulCount}</strong>
          </div>
        </div>

        <div className="sleep-summary-card restless-count">
          <span className="summary-icon">🌧️</span>
          <div className="summary-info">
            <span className="summary-label">{t.statRestlessNaps}</span>
            <strong className="summary-value">{summary.restlessCount}</strong>
          </div>
        </div>
      </div>

      {/* Real-time Room Active Nappers Card (Staff Only) */}
      {isStaff && activeSleepingLogs.length > 0 && (
        <div className="active-room-section">
          <h2>💤 {t.roomNapActiveCount} ({activeSleepingLogs.length})</h2>
          <div className="active-napper-grid">
            {activeSleepingLogs.map((log) => (
              <div key={log.id} className="active-napper-card">
                <div className="active-napper-header">
                  <span className="pulsing-sleep-icon">💤</span>
                  <div>
                    <strong className="napper-child-name">{log.childName}</strong>
                    <span className="napper-group-name">{log.groupName}</span>
                  </div>
                </div>
                <div className="napper-time-badge">
                  {t.napStartTime}: <strong>{log.startTime}</strong>
                </div>
                {log.notes && <p className="napper-notes">"{log.notes}"</p>}
                <button
                  type="button"
                  className="btn primary btn-wake-up"
                  onClick={() => {
                    setWakeUpLog(log)
                    setWakeUpTime(getCurrentTimeHHMM())
                    setWakeUpQuality(log.quality)
                    setWakeUpNotes('')
                  }}
                >
                  ⏰ {t.wakeUpBtn}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sleep Logs List */}
      {loading ? (
        <div className="loading-state">{t.loading}</div>
      ) : filteredLogs.length === 0 ? (
        <p className="empty-notice">{t.noSleepLogsFound}</p>
      ) : (
        <div className="sleep-logs-list">
          {filteredLogs.map((log) => {
            const isCurrentlySleeping = log.endTime == null

            return (
              <article key={log.id} className={`sleep-card status-${log.quality} ${isCurrentlySleeping ? 'is-sleeping' : ''}`}>
                <div className="sleep-card-header">
                  <div className="sleep-header-main">
                    <span className="sleep-icon-badge">{QUALITY_ICONS[log.quality]}</span>
                    <div>
                      <h3 className="sleep-child-title">👶 {log.childName}</h3>
                      <span className="sleep-group-subtitle">{log.groupName}</span>
                    </div>
                  </div>

                  <div className="sleep-status-chips">
                    {isCurrentlySleeping ? (
                      <span className="badge badge-sleeping">💤 {t.napCurrentlySleeping}</span>
                    ) : (
                      <span className={`badge badge-${log.quality}`}>
                        {QUALITY_ICONS[log.quality]} {getQualityLabel(log.quality)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="sleep-times-grid">
                  <div className="time-tile">
                    <span className="time-label">{t.napStartTime}</span>
                    <strong className="time-val">{log.startTime}</strong>
                  </div>

                  <div className="time-tile">
                    <span className="time-label">{t.napEndTime}</span>
                    <strong className="time-val">{log.endTime || '—'}</strong>
                  </div>

                  <div className="time-tile highlight">
                    <span className="time-label">{t.napDuration}</span>
                    <strong className="time-val">{formatDuration(log.durationMinutes)}</strong>
                  </div>
                </div>

                {log.notes && <p className="sleep-notes">"{log.notes}"</p>}

                <div className="sleep-card-footer">
                  <span className="sleep-recorder-info">
                    ✍️ {t.evaluatedBy}: {log.recordedByName}
                  </span>

                  {isStaff && (
                    <div className="sleep-actions-row">
                      {isCurrentlySleeping && (
                        <button
                          type="button"
                          className="btn-quick-wake"
                          onClick={() => {
                            setWakeUpLog(log)
                            setWakeUpTime(getCurrentTimeHHMM())
                            setWakeUpQuality(log.quality)
                            setWakeUpNotes('')
                          }}
                        >
                          ⏰ {t.wakeUpBtn}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-edit-sleep"
                        onClick={() => handleOpenEditModal(log)}
                        aria-label={t.editNapBtn}
                      >
                        ✏️ {t.editNapBtn}
                      </button>
                      <button
                        type="button"
                        className="btn-delete-sleep"
                        onClick={() => handleDelete(log.id)}
                        aria-label={t.deleteNapBtn}
                      >
                        🗑️
                      </button>
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="modal-sleep-title"
          >
            <div className="modal-header">
              <h2 id="modal-sleep-title">
                {editingLogId ? t.editNapBtn : t.logNapBtn}
              </h2>
              <button
                type="button"
                className="btn-close"
                onClick={() => setShowModal(false)}
                aria-label={t.cancel}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="sleep-form">
              {!editingLogId && children.length > 0 && (
                <div className="form-group">
                  <label htmlFor="form-sleep-child" className="field-label">
                    {t.paymentsChild}:
                  </label>
                  <select
                    id="form-sleep-child"
                    value={formChildId}
                    onChange={(e) => setFormChildId(e.target.value)}
                    className="input-select"
                    required
                  >
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.groupName})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="form-start-time" className="field-label">
                    {t.napStartTime}:
                  </label>
                  <input
                    id="form-start-time"
                    type="time"
                    value={formStartTime}
                    onChange={(e) => setFormStartTime(e.target.value)}
                    className="input-text"
                    required
                  />
                </div>

                {!formIsCurrentlySleeping && (
                  <div className="form-group">
                    <label htmlFor="form-end-time" className="field-label">
                      {t.napEndTime}:
                    </label>
                    <input
                      id="form-end-time"
                      type="time"
                      value={formEndTime}
                      onChange={(e) => setFormEndTime(e.target.value)}
                      className="input-text"
                      required
                    />
                  </div>
                )}
              </div>

              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formIsCurrentlySleeping}
                    onChange={(e) => setFormIsCurrentlySleeping(e.target.checked)}
                  />
                  <span>💤 {t.napCurrentlySleeping}</span>
                </label>
              </div>

              <div className="form-group">
                <label htmlFor="form-sleep-quality" className="field-label">
                  {t.napQualityLabel}:
                </label>
                <select
                  id="form-sleep-quality"
                  value={formQuality}
                  onChange={(e) => setFormQuality(e.target.value as SleepQuality)}
                  className="input-select"
                  required
                >
                  <option value="restful">🌙 {t.qualityRestful}</option>
                  <option value="light">☁️ {t.qualityLight}</option>
                  <option value="restless">🌧️ {t.qualityRestless}</option>
                  <option value="refused_nap">🚫 {t.qualityRefused}</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="form-sleep-notes" className="field-label">
                  {t.docNotesLabel}:
                </label>
                <textarea
                  id="form-sleep-notes"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder={t.napNotesPlaceholder}
                  rows={3}
                  className="input-textarea"
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setShowModal(false)}
                  disabled={submitting}
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={submitting}
                >
                  {submitting ? t.loading : t.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Wake Up Modal */}
      {wakeUpLog && (
        <div className="modal-backdrop" onClick={() => setWakeUpLog(null)}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="modal-wakeup-title"
          >
            <div className="modal-header">
              <h2 id="modal-wakeup-title">
                ⏰ {t.wakeUpBtn} — {wakeUpLog.childName}
              </h2>
              <button
                type="button"
                className="btn-close"
                onClick={() => setWakeUpLog(null)}
                aria-label={t.cancel}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleWakeUpSubmit} className="sleep-form">
              <p className="wake-summary-hint">
                {t.napStartTime}: <strong>{wakeUpLog.startTime}</strong>
              </p>

              <div className="form-group">
                <label htmlFor="modal-wakeup-time" className="field-label">
                  {t.napEndTime}:
                </label>
                <input
                  id="modal-wakeup-time"
                  type="time"
                  value={wakeUpTime}
                  onChange={(e) => setWakeUpTime(e.target.value)}
                  className="input-text"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="modal-wakeup-quality" className="field-label">
                  {t.napQualityLabel}:
                </label>
                <select
                  id="modal-wakeup-quality"
                  value={wakeUpQuality}
                  onChange={(e) => setWakeUpQuality(e.target.value as SleepQuality)}
                  className="input-select"
                  required
                >
                  <option value="restful">🌙 {t.qualityRestful}</option>
                  <option value="light">☁️ {t.qualityLight}</option>
                  <option value="restless">🌧️ {t.qualityRestless}</option>
                  <option value="refused_nap">🚫 {t.qualityRefused}</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="modal-wakeup-notes" className="field-label">
                  {t.docNotesLabel}:
                </label>
                <textarea
                  id="modal-wakeup-notes"
                  value={wakeUpNotes}
                  onChange={(e) => setWakeUpNotes(e.target.value)}
                  placeholder={t.napNotesPlaceholder}
                  rows={2}
                  className="input-textarea"
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setWakeUpLog(null)}
                  disabled={submitting}
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={submitting}
                >
                  {submitting ? t.loading : t.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}

export default SleepTracker
