/* eslint-disable react/set-state-in-effect */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import { localCalendarDate } from './attendance-date.js'
import {
  listChildren,
  listHygieneLogs,
  createHygieneLog,
  updateHygieneLog,
  deleteHygieneLog,
  type Child,
  type ChildHygieneLog,
  type HygieneEntryType,
  type DiaperType,
  type PottyResult,
  type HygieneSummaryStats,
} from './api'

function getCurrentTimeHHMM(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

export function HygieneTracker() {
  const { token, user } = useAuth()
  const { t } = useI18n()
  const alive = useRef(true)

  const [date, setDate] = useState<string>(() => localCalendarDate())
  const [children, setChildren] = useState<Child[]>([])
  const [logs, setLogs] = useState<ChildHygieneLog[]>([])
  const [summary, setSummary] = useState<HygieneSummaryStats>({
    total: 0,
    wetCount: 0,
    dirtyCount: 0,
    pottySuccessCount: 0,
    accidentsCount: 0,
    creamCount: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // Filters
  const [selectedChildId, setSelectedChildId] = useState<string>('')
  const [selectedType, setSelectedType] = useState<HygieneEntryType | 'all'>('all')

  // Modal State
  const [showModal, setShowModal] = useState(false)
  const [editingLogId, setEditingLogId] = useState<string | null>(null)
  const [modalEntryType, setModalEntryType] = useState<HygieneEntryType>('diaper')
  const [formChildId, setFormChildId] = useState<string>('')
  const [formTime, setFormTime] = useState<string>(getCurrentTimeHHMM)
  const [formDiaperType, setFormDiaperType] = useState<DiaperType>('wet')
  const [formPottyResult, setFormPottyResult] = useState<PottyResult>('success_pee')
  const [formCreamApplied, setFormCreamApplied] = useState<boolean>(false)
  const [formNotes, setFormNotes] = useState<string>('')
  const [submitting, setSubmitting] = useState<boolean>(false)

  const isStaff = user?.role === 'teacher' || user?.role === 'director'

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
        if (res.children.length > 0 && !formChildId) {
          setFormChildId(res.children[0].id)
        }
      })
      .catch((err) => {
        if (active) setError(err.message || 'Error loading children')
      })

    return () => {
      active = false
    }
  }, [token, formChildId])

  // Fetch hygiene logs
  const fetchLogs = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)

    try {
      const typeParam = selectedType === 'all' ? undefined : selectedType
      const childParam = selectedChildId || undefined
      const res = await listHygieneLogs(token, {
        date,
        childId: childParam,
        type: typeParam,
      })

      if (alive.current) {
        setLogs(res.logs)
        setSummary(res.summary)
      }
    } catch (err: any) {
      if (alive.current) {
        setError(err.message || 'Error loading hygiene logs')
      }
    } finally {
      if (alive.current) {
        setLoading(false)
      }
    }
  }, [token, date, selectedChildId, selectedType])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const openCreateModal = (entryType: HygieneEntryType) => {
    setEditingLogId(null)
    setModalEntryType(entryType)
    setFormTime(getCurrentTimeHHMM())
    setFormDiaperType('wet')
    setFormPottyResult('success_pee')
    setFormCreamApplied(false)
    setFormNotes('')
    if (children.length > 0) {
      setFormChildId(selectedChildId || children[0].id)
    }
    setShowModal(true)
  }

  const openEditModal = (log: ChildHygieneLog) => {
    setEditingLogId(log.id)
    setModalEntryType(log.entryType)
    setFormChildId(log.childId)
    setFormTime(log.logTime)
    setFormDiaperType(log.diaperType || 'wet')
    setFormPottyResult(log.pottyResult || 'success_pee')
    setFormCreamApplied(log.creamApplied)
    setFormNotes(log.notes || '')
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || submitting) return

    setSubmitting(true)
    setError(null)
    setMessage(null)

    try {
      if (editingLogId) {
        await updateHygieneLog(token, editingLogId, {
          logTime: formTime,
          entryType: modalEntryType,
          diaperType: modalEntryType === 'diaper' ? formDiaperType : null,
          pottyResult: modalEntryType === 'potty' ? formPottyResult : null,
          creamApplied: modalEntryType === 'diaper' ? formCreamApplied : false,
          notes: formNotes,
        })
        setMessage(t.hygieneLogUpdated)
      } else {
        await createHygieneLog(token, {
          childId: formChildId,
          logDate: date,
          logTime: formTime,
          entryType: modalEntryType,
          diaperType: modalEntryType === 'diaper' ? formDiaperType : null,
          pottyResult: modalEntryType === 'potty' ? formPottyResult : null,
          creamApplied: modalEntryType === 'diaper' ? formCreamApplied : false,
          notes: formNotes,
        })
        setMessage(t.hygieneLogCreated)
      }
      setShowModal(false)
      fetchLogs()
    } catch (err: any) {
      setError(err.message || 'Operation failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!token) return
    if (!window.confirm('Are you sure you want to delete this hygiene record?')) return

    try {
      await deleteHygieneLog(token, id)
      setMessage(t.hygieneLogDeleted)
      fetchLogs()
    } catch (err: any) {
      setError(err.message || 'Delete failed')
    }
  }

  const getDiaperLabel = (type: DiaperType | null) => {
    if (!type) return ''
    switch (type) {
      case 'wet':
        return t.diaperWet
      case 'dirty':
        return t.diaperDirty
      case 'both':
        return t.diaperBoth
      case 'dry':
        return t.diaperDry
    }
  }

  const getPottyLabel = (result: PottyResult | null) => {
    if (!result) return ''
    switch (result) {
      case 'success_pee':
        return t.pottySuccessPee
      case 'success_bm':
        return t.pottySuccessBm
      case 'success_both':
        return t.pottySuccessBoth
      case 'tried_dry':
        return t.pottyTriedDry
      case 'accident':
        return t.pottyAccident
    }
  }

  return (
    <div className="panel hygiene-panel">
      <header className="panel-header">
        <div>
          <h1 tabIndex={-1}>{t.hygieneTitle}</h1>
          <p className="panel-sub">
            {isStaff ? t.hygieneStaffSubtitle : t.hygieneParentSubtitle}
          </p>
        </div>
        {isStaff && (
          <div className="panel-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => openCreateModal('diaper')}
            >
              {t.logDiaperBtn}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => openCreateModal('potty')}
            >
              {t.logPottyBtn}
            </button>
          </div>
        )}
      </header>

      {error && (
        <div role="alert" className="form-error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="form-success" style={{ marginBottom: '1rem' }}>
          {message}
        </div>
      )}

      {/* Summary Metrics */}
      <section className="hygiene-summary-grid" aria-label="Hygiene Summary Statistics">
        <article className="stat-card">
          <span className="stat-label">{t.statTotalHygiene}</span>
          <strong className="stat-value">{summary.total}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t.statWetDiapers}</span>
          <strong className="stat-value stat-wet">{summary.wetCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t.statDirtyDiapers}</span>
          <strong className="stat-value stat-dirty">{summary.dirtyCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t.statPottySuccess}</span>
          <strong className="stat-value stat-success">{summary.pottySuccessCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t.statAccidents}</span>
          <strong className="stat-value stat-accident">{summary.accidentsCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t.statCreamApplied}</span>
          <strong className="stat-value stat-cream">{summary.creamCount}</strong>
        </article>
      </section>

      {/* Filter and Tab Bar */}
      <div className="hygiene-filter-bar">
        <div className="hygiene-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={selectedType === 'all'}
            className={`tab-btn ${selectedType === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedType('all')}
          >
            {t.tabAllHygiene}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={selectedType === 'diaper'}
            className={`tab-btn ${selectedType === 'diaper' ? 'active' : ''}`}
            onClick={() => setSelectedType('diaper')}
          >
            {t.tabDiapersOnly}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={selectedType === 'potty'}
            className={`tab-btn ${selectedType === 'potty' ? 'active' : ''}`}
            onClick={() => setSelectedType('potty')}
          >
            {t.tabPottyOnly}
          </button>
        </div>

        <div className="filter-controls">
          <label className="filter-group">
            <span className="filter-label">{t.momentDate}</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="filter-input"
            />
          </label>

          {isStaff && (
            <label className="filter-group">
              <span className="filter-label">{t.paymentsChild}</span>
              <select
                value={selectedChildId}
                onChange={(e) => setSelectedChildId(e.target.value)}
                className="filter-input"
              >
                <option value="">{t.allGroups}</option>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.groupName})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {/* Logs Timeline */}
      <div className="hygiene-logs-container">
        {loading ? (
          <div className="loading-spinner" aria-busy="true">
            {t.attendanceSaving}...
          </div>
        ) : logs.length === 0 ? (
          <p className="empty-state">{t.noHygieneLogs}</p>
        ) : (
          <div className="hygiene-cards-grid">
            {logs.map((log) => (
              <article key={log.id} className={`hygiene-card hygiene-${log.entryType}`}>
                <div className="hygiene-card-header">
                  <div>
                    <h3 className="child-name">{log.childName}</h3>
                    <span className="child-group">{log.groupName}</span>
                  </div>
                  <div className="time-and-type">
                    <span className="time-badge">{log.logTime}</span>
                    <span className={`entry-badge badge-${log.entryType}`}>
                      {log.entryType === 'diaper' ? t.entryDiaper : t.entryPotty}
                    </span>
                  </div>
                </div>

                <div className="hygiene-card-content">
                  {log.entryType === 'diaper' && (
                    <div className="status-row">
                      <span className={`status-pill pill-${log.diaperType}`}>
                        {getDiaperLabel(log.diaperType)}
                      </span>
                      {log.creamApplied && (
                        <span className="cream-pill" title={t.creamAppliedLabel}>
                          {t.creamYes}
                        </span>
                      )}
                    </div>
                  )}

                  {log.entryType === 'potty' && (
                    <div className="status-row">
                      <span className={`status-pill pill-${log.pottyResult}`}>
                        {getPottyLabel(log.pottyResult)}
                      </span>
                    </div>
                  )}

                  {log.notes && (
                    <p className="hygiene-notes">
                      <em>&ldquo;{log.notes}&rdquo;</em>
                    </p>
                  )}
                </div>

                <div className="hygiene-card-footer">
                  <small className="recorded-by">
                    {t.recordedByLabel}: {log.recordedByName}
                  </small>
                  {isStaff && (
                    <div className="card-actions">
                      <button
                        type="button"
                        className="btn text-btn edit-btn"
                        onClick={() => openEditModal(log)}
                      >
                        {t.editHygieneBtn}
                      </button>
                      <button
                        type="button"
                        className="btn text-btn delete-btn"
                        onClick={() => handleDelete(log.id)}
                      >
                        {t.deleteHygieneBtn}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Modal Dialog */}
      {showModal && (
        <div className="modal-backdrop" role="presentation">
          <dialog
            open
            className="dialog-box"
            aria-labelledby="hygiene-modal-title"
          >
            <div className="dialog-header">
              <h2 id="hygiene-modal-title">
                {editingLogId
                  ? t.editHygieneBtn
                  : modalEntryType === 'diaper'
                  ? t.logDiaperBtn
                  : t.logPottyBtn}
              </h2>
              <button
                type="button"
                className="close-btn"
                aria-label="Close"
                onClick={() => setShowModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="dialog-form">
              {!editingLogId && (
                <label className="form-field">
                  <span>{t.entryTypeLabel}</span>
                  <select
                    value={modalEntryType}
                    onChange={(e) => setModalEntryType(e.target.value as HygieneEntryType)}
                  >
                    <option value="diaper">{t.entryDiaper}</option>
                    <option value="potty">{t.entryPotty}</option>
                  </select>
                </label>
              )}

              {!editingLogId && (
                <label className="form-field">
                  <span>{t.paymentsChild}</span>
                  <select
                    value={formChildId}
                    onChange={(e) => setFormChildId(e.target.value)}
                    required
                  >
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.groupName})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="form-field">
                <span>{t.hygieneTimeLabel}</span>
                <input
                  type="time"
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                  required
                />
              </label>

              {modalEntryType === 'diaper' && (
                <>
                  <label className="form-field">
                    <span>{t.diaperStatusLabel}</span>
                    <select
                      value={formDiaperType}
                      onChange={(e) => setFormDiaperType(e.target.value as DiaperType)}
                      required
                    >
                      <option value="wet">{t.diaperWet}</option>
                      <option value="dirty">{t.diaperDirty}</option>
                      <option value="both">{t.diaperBoth}</option>
                      <option value="dry">{t.diaperDry}</option>
                    </select>
                  </label>

                  <label className="form-checkbox-label">
                    <input
                      type="checkbox"
                      checked={formCreamApplied}
                      onChange={(e) => setFormCreamApplied(e.target.checked)}
                    />
                    <span>{t.creamAppliedLabel}</span>
                  </label>
                </>
              )}

              {modalEntryType === 'potty' && (
                <label className="form-field">
                  <span>{t.pottyResultLabel}</span>
                  <select
                    value={formPottyResult}
                    onChange={(e) => setFormPottyResult(e.target.value as PottyResult)}
                    required
                  >
                    <option value="success_pee">{t.pottySuccessPee}</option>
                    <option value="success_bm">{t.pottySuccessBm}</option>
                    <option value="success_both">{t.pottySuccessBoth}</option>
                    <option value="tried_dry">{t.pottyTriedDry}</option>
                    <option value="accident">{t.pottyAccident}</option>
                  </select>
                </label>
              )}

              <label className="form-field">
                <span>{t.hygieneNotesLabel}</span>
                <textarea
                  rows={3}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder={t.hygieneNotesPlaceholder}
                />
              </label>

              <div className="dialog-actions">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setShowModal(false)}
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={submitting}
                >
                  {submitting ? t.attendanceSaving : t.save}
                </button>
              </div>
            </form>
          </dialog>
        </div>
      )}
    </div>
  )
}
