/* eslint-disable react/set-state-in-effect */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import { localCalendarDate } from './attendance-date.js'
import {
  listChildren,
  getChildMilestones,
  recordChildMilestone,
  resetChildMilestone,
  type Child,
  type ChildMilestonesResponse,
  type ChildMilestoneItem,
  type MilestoneStatus,
} from './api'

const DOMAIN_ICONS: Record<string, string> = {
  all: '🌟',
  language: '🗣️',
  cognitive: '🧩',
  motor: '🏃',
  social_emotional: '🤝',
  creative: '🎨',
}

export function Milestones() {
  const { token, user } = useAuth()
  const { t, lang } = useI18n()
  const alive = useRef(true)

  const [children, setChildren] = useState<Child[]>([])
  const [selectedChildId, setSelectedChildId] = useState<string>('')
  const [selectedDomain, setSelectedDomain] = useState<string>('all')
  const [data, setData] = useState<ChildMilestonesResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // Observation edit modal state
  const [editingMilestone, setEditingMilestone] = useState<ChildMilestoneItem | null>(null)
  const [editStatus, setEditStatus] = useState<MilestoneStatus>('achieved')
  const [editDate, setEditDate] = useState<string>(() => localCalendarDate())
  const [editNotes, setEditNotes] = useState<string>('')
  const [saving, setSaving] = useState<boolean>(false)

  const isStaff = user?.role === 'teacher' || user?.role === 'director'

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Load children roster
  useEffect(() => {
    if (!token) return
    let active = true

    async function fetchChildren() {
      try {
        const res = await listChildren(token!)
        if (active && res.children.length > 0) {
          setChildren(res.children)
          setSelectedChildId((prev) => prev || res.children[0].id)
        }
      } catch {
        if (active) setError(t.loadError)
      }
    }

    void fetchChildren()
    return () => {
      active = false
    }
  }, [token, t.loadError])

  // Load milestones for selected child
  const loadMilestones = useCallback(async (childId: string) => {
    if (!token || !childId) return
    setLoading(true)
    setError(null)
    try {
      const res = await getChildMilestones(token, childId)
      if (alive.current) {
        setData(res)
      }
    } catch {
      if (alive.current) {
        setError(t.loadError)
      }
    } finally {
      if (alive.current) {
        setLoading(false)
      }
    }
  }, [token, t.loadError])

  useEffect(() => {
    if (selectedChildId) {
      void loadMilestones(selectedChildId)
    }
  }, [selectedChildId, loadMilestones])

  const openEditor = (item: ChildMilestoneItem) => {
    setEditingMilestone(item)
    setEditStatus(item.status || 'achieved')
    setEditDate(item.observedDate || localCalendarDate())
    setEditNotes(item.notes || '')
    setMessage(null)
  }

  const closeEditor = () => {
    setEditingMilestone(null)
    setEditNotes('')
  }

  const handleSaveObservation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !editingMilestone || !selectedChildId) return
    setSaving(true)
    setError(null)
    try {
      await recordChildMilestone(token, selectedChildId, {
        milestoneId: editingMilestone.milestoneId,
        status: editStatus,
        observedDate: editDate,
        notes: editNotes.trim(),
      })
      if (alive.current) {
        setMessage(t.milestoneSaved)
        closeEditor()
      }
      await loadMilestones(selectedChildId)
    } catch {
      if (alive.current) {
        setError(t.saveError)
      }
    } finally {
      if (alive.current) {
        setSaving(false)
      }
    }
  }

  const handleReset = async (milestoneId: string) => {
    if (!token || !selectedChildId) return
    setLoading(true)
    try {
      await resetChildMilestone(token, selectedChildId, milestoneId)
      if (alive.current) {
        setMessage(t.milestoneReset)
      }
      await loadMilestones(selectedChildId)
    } catch {
      if (alive.current) {
        setError(t.loadError)
      }
    } finally {
      if (alive.current) {
        setLoading(false)
      }
    }
  }

  const getDomainLabel = (domainKey: string) => {
    switch (domainKey) {
      case 'language': return t.domainLanguage
      case 'cognitive': return t.domainCognitive
      case 'motor': return t.domainMotor
      case 'social_emotional': return t.domainSocialEmotional
      case 'creative': return t.domainCreative
      default: return t.domainAll
    }
  }

  const filteredItems = (data?.items || []).filter((item) => {
    if (selectedDomain === 'all') return true
    return item.domain === selectedDomain
  })

  return (
    <div className="milestones-panel">
      <div className="panel-header-row">
        <div>
          <h1 tabIndex={-1}>{t.milestonesTitle}</h1>
          <p className="panel-subtitle">
            {isStaff ? t.milestonesSubtitle : t.milestonesParentSubtitle}
          </p>
        </div>
        <button
          type="button"
          className="btn-print"
          onClick={() => window.print()}
          aria-label={t.printProgressReport}
        >
          🖨️ {t.printProgressReport}
        </button>
      </div>

      {/* Child selector if multiple children are available */}
      {children.length > 1 && (
        <div className="child-selector-bar">
          <label htmlFor="select-child-assessed" className="field-label">
            {t.selectChildToAssess}:
          </label>
          <select
            id="select-child-assessed"
            value={selectedChildId}
            onChange={(e) => setSelectedChildId(e.target.value)}
            className="input-select"
          >
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.groupName})
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice success">{message}</div>}

      {loading && !data ? (
        <div className="loading-state">{t.loading}</div>
      ) : data ? (
        <>
          {/* Progress Overview Summary */}
          <div className="milestones-summary-card">
            <div className="summary-main-stat">
              <span className="summary-title">{t.overallProgress}</span>
              <div className="summary-percentage">
                <span className="big-percent">{data.summary.overallProgressPercent}%</span>
                <span className="summary-count">
                  {data.summary.recordedCount} / {data.summary.totalMilestones} {t.statusAchieved.toLowerCase()}
                </span>
              </div>
              <div
                className="progress-bar-bg"
                role="progressbar"
                aria-valuenow={data.summary.overallProgressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="progress-bar-fill"
                  style={{ width: `${Math.min(100, Math.max(4, data.summary.overallProgressPercent))}%` }}
                />
              </div>
            </div>

            <div className="status-breakdown-chips">
              <span className="chip chip-mastered">
                ★ {data.summary.masteredCount} {t.statusMastered}
              </span>
              <span className="chip chip-achieved">
                ✓ {data.summary.achievedCount} {t.statusAchieved}
              </span>
              <span className="chip chip-emerging">
                ⏳ {data.summary.emergingCount} {t.statusEmerging}
              </span>
            </div>
          </div>

          {/* Domain Breakdown Cards */}
          <div className="domains-overview-grid">
            {Object.entries(data.domainStats).map(([domainKey, stats]) => (
              <div
                key={domainKey}
                className={`domain-mini-card ${selectedDomain === domainKey ? 'active' : ''}`}
                onClick={() => setSelectedDomain(selectedDomain === domainKey ? 'all' : domainKey)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setSelectedDomain(selectedDomain === domainKey ? 'all' : domainKey)
                  }
                }}
              >
                <div className="domain-mini-header">
                  <span className="domain-icon">{DOMAIN_ICONS[domainKey] || '🌱'}</span>
                  <span className="domain-mini-name">{getDomainLabel(domainKey)}</span>
                </div>
                <div className="domain-mini-percent">{stats.percent}%</div>
                <div className="mini-progress-bg">
                  <div
                    className="mini-progress-fill"
                    style={{ width: `${Math.min(100, Math.max(4, stats.percent))}%` }}
                  />
                </div>
                <span className="domain-mini-counts">
                  {stats.achieved + stats.mastered}/{stats.total} {t.statusAchieved}
                </span>
              </div>
            ))}
          </div>

          {/* Domain Filter Tabs */}
          <div className="domain-filter-tabs" role="tablist">
            {(['all', 'language', 'cognitive', 'motor', 'social_emotional', 'creative'] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={selectedDomain === d}
                className={`tab-btn ${selectedDomain === d ? 'active' : ''}`}
                onClick={() => setSelectedDomain(d)}
              >
                <span className="tab-icon">{DOMAIN_ICONS[d]}</span> {getDomainLabel(d)}
              </button>
            ))}
          </div>

          {/* Milestones List */}
          <div className="milestones-list">
            {filteredItems.length === 0 ? (
              <p className="empty-notice">{t.noMilestonesFound}</p>
            ) : (
              filteredItems.map((item) => {
                const title = lang === 'sq' ? item.titleSq : item.titleEn
                const desc = lang === 'sq' ? item.descriptionSq : item.descriptionEn

                return (
                  <article key={item.milestoneId} className={`milestone-card status-${item.status || 'none'}`}>
                    <div className="milestone-card-header">
                      <div className="milestone-title-group">
                        <span className="milestone-domain-badge">
                          {DOMAIN_ICONS[item.domain]} {getDomainLabel(item.domain)}
                        </span>
                        <h3>{title}</h3>
                      </div>
                      <div className="milestone-status-indicator">
                        {item.status === 'mastered' && (
                          <span className="status-badge badge-mastered">★ {t.badgeMastered}</span>
                        )}
                        {item.status === 'achieved' && (
                          <span className="status-badge badge-achieved">✓ {t.badgeAchieved}</span>
                        )}
                        {item.status === 'emerging' && (
                          <span className="status-badge badge-emerging">⏳ {t.badgeEmerging}</span>
                        )}
                        {!item.status && (
                          <span className="status-badge badge-none">○ {t.statusNotObserved}</span>
                        )}
                      </div>
                    </div>

                    <p className="milestone-description">{desc}</p>

                    {/* Teacher Notes & Observation Details */}
                    {item.status && (
                      <div className="observation-details-box">
                        <div className="observation-meta">
                          <span>📅 {t.observedDateLabel}: <strong>{item.observedDate}</strong></span>
                          {item.evaluatedByName && (
                            <span>👩‍🏫 {t.evaluatedBy}: <strong>{item.evaluatedByName}</strong></span>
                          )}
                        </div>
                        {item.notes && (
                          <p className="observation-notes">
                            💬 "{item.notes}"
                          </p>
                        )}
                      </div>
                    )}

                    {/* Action buttons for staff */}
                    {isStaff && (
                      <div className="milestone-actions">
                        <button
                          type="button"
                          className="btn-assess"
                          onClick={() => openEditor(item)}
                        >
                          {item.status ? t.updateObservationBtn : t.recordObservationBtn}
                        </button>
                        {item.status && (
                          <button
                            type="button"
                            className="btn-reset"
                            onClick={() => handleReset(item.milestoneId)}
                          >
                            {t.resetObservationBtn}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                )
              })
            )}
          </div>
        </>
      ) : null}

      {/* Observation Modal */}
      {editingMilestone && (
        <div className="modal-backdrop" onClick={closeEditor}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="modal-milestone-title"
          >
            <div className="modal-header">
              <h2 id="modal-milestone-title">
                {lang === 'sq' ? editingMilestone.titleSq : editingMilestone.titleEn}
              </h2>
              <button
                type="button"
                className="btn-close"
                onClick={closeEditor}
                aria-label={t.cancel}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveObservation} className="milestone-form">
              <div className="form-group">
                <label className="field-label">{t.statusAchieved} / Status:</label>
                <div className="status-radio-group">
                  <label className={`radio-pill ${editStatus === 'emerging' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="milestoneStatus"
                      value="emerging"
                      checked={editStatus === 'emerging'}
                      onChange={() => setEditStatus('emerging')}
                    />
                    ⏳ {t.statusEmerging}
                  </label>
                  <label className={`radio-pill ${editStatus === 'achieved' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="milestoneStatus"
                      value="achieved"
                      checked={editStatus === 'achieved'}
                      onChange={() => setEditStatus('achieved')}
                    />
                    ✓ {t.statusAchieved}
                  </label>
                  <label className={`radio-pill ${editStatus === 'mastered' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="milestoneStatus"
                      value="mastered"
                      checked={editStatus === 'mastered'}
                      onChange={() => setEditStatus('mastered')}
                    />
                    ★ {t.statusMastered}
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="edit-obs-date" className="field-label">
                  {t.observedDateLabel}:
                </label>
                <input
                  id="edit-obs-date"
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="input-text"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="edit-obs-notes" className="field-label">
                  {t.notesLabel}:
                </label>
                <textarea
                  id="edit-obs-notes"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder={t.notesPlaceholder}
                  rows={4}
                  className="input-textarea"
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeEditor}
                  disabled={saving}
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={saving}
                >
                  {saving ? t.loading : t.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
export default Milestones
