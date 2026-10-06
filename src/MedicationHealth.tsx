/* eslint-disable react/set-state-in-effect */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import { localCalendarDate } from './attendance-date.js'
import {
  listChildren,
  listMedications,
  createMedication,
  updateMedication,
  listMedicationLogs,
  administerMedication,
  listHealthChecks,
  createHealthCheck,
  type Child,
  type ChildMedication,
  type MedicationLog,
  type DailyHealthCheck,
  type MedicationStorage,
  type MedicationStatus,
  type ChildReaction,
  type MedicationSummaryStats,
  type HealthCheckSummaryStats,
} from './api'

const STORAGE_ICONS: Record<MedicationStorage, string> = {
  room_temperature: '🌡️',
  refrigerated: '❄️',
  locked_box: '🔒',
}

const REACTION_ICONS: Record<ChildReaction, string> = {
  normal: '✅',
  drowsy: '🥱',
  refused: '🙅',
  adverse: '⚠️',
}

const COMMON_SYMPTOMS = [
  'fever',
  'cough',
  'rash',
  'runny_nose',
  'vomiting',
  'fatigue',
] as const

export function MedicationHealth() {
  const { token, user } = useAuth()
  const { t } = useI18n()
  const alive = useRef(true)

  const [activeTab, setActiveTab] = useState<'medications' | 'triage'>('medications')
  const [date, setDate] = useState<string>(() => localCalendarDate())
  const [children, setChildren] = useState<Child[]>([])

  // Medications state
  const [medications, setMedications] = useState<ChildMedication[]>([])
  const [medSummary, setMedSummary] = useState<MedicationSummaryStats>({
    total: 0,
    active: 0,
    completed: 0,
    cancelled: 0,
  })
  const [selectedChildId, setSelectedChildId] = useState<string>('')
  const [selectedMedStatus, setSelectedMedStatus] = useState<string>('all')

  // Health checks state
  const [healthChecks, setHealthChecks] = useState<DailyHealthCheck[]>([])
  const [healthSummary, setHealthSummary] = useState<HealthCheckSummaryStats>({
    total: 0,
    passed: 0,
    flagged: 0,
    averageTemp: 36.6,
  })

  // General state
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // Authorize Medication Modal
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authChildId, setAuthChildId] = useState<string>('')
  const [authMedName, setAuthMedName] = useState<string>('')
  const [authDosage, setAuthDosage] = useState<string>('')
  const [authFrequency, setAuthFrequency] = useState<string>('')
  const [authInstructions, setAuthInstructions] = useState<string>('')
  const [authStorage, setAuthStorage] = useState<MedicationStorage>('room_temperature')
  const [authDoctor, setAuthDoctor] = useState<string>('')
  const [authRx, setAuthRx] = useState<string>('')
  const [authStartDate, setAuthStartDate] = useState<string>(() => localCalendarDate())
  const [authEndDate, setAuthEndDate] = useState<string>(() => {
    const end = new Date(Date.now() + 7 * 86400000)
    return localCalendarDate(end)
  })

  // Administer Dose Modal
  const [administerMed, setAdministerMed] = useState<ChildMedication | null>(null)
  const [adminDosage, setAdminDosage] = useState<string>('')
  const [adminReaction, setAdminReaction] = useState<ChildReaction>('normal')
  const [adminWitness, setAdminWitness] = useState<string>('')
  const [adminNotes, setAdminNotes] = useState<string>('')

  // View Logs Modal
  const [logsMed, setLogsMed] = useState<ChildMedication | null>(null)
  const [currentLogs, setCurrentLogs] = useState<MedicationLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  // Record Triage Modal
  const [showTriageModal, setShowTriageModal] = useState(false)
  const [triageChildId, setTriageChildId] = useState<string>('')
  const [triageDate, setTriageDate] = useState<string>(() => localCalendarDate())
  const [triageTime, setTriageTime] = useState<string>(() => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  })
  const [triageTemp, setTriageTemp] = useState<number>(36.6)
  const [triageSymptoms, setTriageSymptoms] = useState<string[]>([])
  const [triagePassed, setTriagePassed] = useState<boolean>(true)
  const [triageNotes, setTriageNotes] = useState<string>('')

  const [submitting, setSubmitting] = useState(false)

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
          setAuthChildId((prev) => prev || res.children[0].id)
          setTriageChildId((prev) => prev || res.children[0].id)
        }
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : t.loadError)
      })

    return () => {
      active = false
    }
  }, [token, t.loadError])

  // Load Medications
  const loadMedications = useCallback(async () => {
    if (!token) return
    try {
      setLoading(true)
      const options: { childId?: string; status?: MedicationStatus } = {}
      if (selectedChildId) options.childId = selectedChildId
      if (selectedMedStatus !== 'all') options.status = selectedMedStatus as MedicationStatus

      const res = await listMedications(token, options)
      if (alive.current) {
        setMedications(res.medications)
        setMedSummary(res.summary)
      }
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : t.loadError)
      }
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [token, selectedChildId, selectedMedStatus, t.loadError])

  // Load Health Checks
  const loadHealthChecks = useCallback(async () => {
    if (!token) return
    try {
      setLoading(true)
      const options: { date?: string; childId?: string } = {}
      if (date) options.date = date
      if (selectedChildId) options.childId = selectedChildId

      const res = await listHealthChecks(token, options)
      if (alive.current) {
        setHealthChecks(res.checks)
        setHealthSummary(res.summary)
      }
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : t.loadError)
      }
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [token, date, selectedChildId, t.loadError])

  useEffect(() => {
    loadMedications()
    loadHealthChecks()
  }, [loadMedications, loadHealthChecks])

  // Open Log History Modal
  const handleOpenLogs = async (med: ChildMedication) => {
    if (!token) return
    setLogsMed(med)
    setLogsLoading(true)
    try {
      const res = await listMedicationLogs(token, med.id)
      if (alive.current) {
        setCurrentLogs(res.logs)
      }
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : t.loadError)
      }
    } finally {
      if (alive.current) setLogsLoading(false)
    }
  }

  // Authorize medication submit
  const handleAuthorizeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !authChildId || !authMedName.trim() || !authDosage.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      await createMedication(token, {
        childId: authChildId,
        medicationName: authMedName.trim(),
        dosage: authDosage.trim(),
        frequencySchedule: authFrequency.trim() || 'Daily',
        instructions: authInstructions.trim(),
        storageType: authStorage,
        doctorName: authDoctor.trim() || 'Pediatrician',
        prescriptionNumber: authRx.trim() || undefined,
        startDate: authStartDate,
        endDate: authEndDate,
      })
      setShowAuthModal(false)
      setMessage(t.medicationAuthorizedSuccess)
      setAuthMedName('')
      setAuthDosage('')
      setAuthFrequency('')
      setAuthInstructions('')
      setAuthDoctor('')
      setAuthRx('')
      loadMedications()
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loadError)
    } finally {
      setSubmitting(false)
    }
  }

  // Administer dose submit
  const handleAdministerSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !administerMed || !adminDosage.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      await administerMedication(token, administerMed.id, {
        dosageGiven: adminDosage.trim(),
        reaction: adminReaction,
        witnessBy: adminWitness || null,
        notes: adminNotes.trim() || undefined,
      })
      setAdministerMed(null)
      setMessage(t.doseAdministeredSuccess)
      setAdminNotes('')
      loadMedications()
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loadError)
    } finally {
      setSubmitting(false)
    }
  }

  // Update med status
  const handleUpdateStatus = async (med: ChildMedication, newStatus: MedicationStatus) => {
    if (!token) return
    try {
      await updateMedication(token, med.id, { status: newStatus })
      setMessage(t.medicationStatusUpdated)
      loadMedications()
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loadError)
    }
  }

  // Record Triage submit
  const handleTriageSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !triageChildId || !triageDate || !triageTime) return

    setSubmitting(true)
    setError(null)
    try {
      await createHealthCheck(token, {
        childId: triageChildId,
        checkDate: triageDate,
        checkTime: triageTime,
        temperatureCelsius: triageTemp,
        symptoms: triageSymptoms,
        passedTriage: triagePassed,
        notes: triageNotes.trim() || undefined,
      })
      setShowTriageModal(false)
      setMessage(t.triageSavedSuccess)
      setTriageNotes('')
      setTriageSymptoms([])
      loadHealthChecks()
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loadError)
    } finally {
      setSubmitting(false)
    }
  }

  const toggleSymptom = (symptom: string) => {
    setTriageSymptoms((prev) =>
      prev.includes(symptom) ? prev.filter((s) => s !== symptom) : [...prev, symptom],
    )
  }

  return (
    <section className="panel medication-panel">
      <div className="panel-header-row">
        <div>
          <h1 tabIndex={-1}>{t.medicationsTitle}</h1>
          <p className="panel-subtitle">
            {isParent ? t.medicationsParentSubtitle : t.medicationsSubtitle}
          </p>
        </div>
        <div className="panel-actions">
          {activeTab === 'medications' && (
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setAuthChildId(children[0]?.id || '')
                setShowAuthModal(true)
              }}
            >
              {t.authorizeMedicationBtn}
            </button>
          )}

          {activeTab === 'triage' && isStaff && (
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setTriageChildId(children[0]?.id || '')
                setTriageDate(date)
                setShowTriageModal(true)
              }}
            >
              {t.recordTriageBtn}
            </button>
          )}
        </div>
      </div>

      {/* Tabs Row */}
      <div className="med-tab-row" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'medications'}
          className={`med-tab-btn ${activeTab === 'medications' ? 'active' : ''}`}
          onClick={() => setActiveTab('medications')}
        >
          💊 {t.tabMedications} ({medSummary.active})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'triage'}
          className={`med-tab-btn ${activeTab === 'triage' ? 'active' : ''}`}
          onClick={() => setActiveTab('triage')}
        >
          🩺 {t.tabTriage} ({healthSummary.total})
        </button>
      </div>

      {/* Metrics Section */}
      <div className="med-summary-grid">
        <div className="med-summary-card total">
          <span className="med-stat-icon">💊</span>
          <div>
            <strong>{medSummary.active}</strong>
            <span>{t.statActiveMedications}</span>
          </div>
        </div>

        <div className="med-summary-card total">
          <span className="med-stat-icon">📋</span>
          <div>
            <strong>{medSummary.total}</strong>
            <span>{t.statTotalMedAuthorizations}</span>
          </div>
        </div>

        <div className="med-summary-card triage">
          <span className="med-stat-icon">🩺</span>
          <div>
            <strong>{healthSummary.total}</strong>
            <span>{t.statTodayTriage}</span>
          </div>
        </div>

        <div className="med-summary-card passed">
          <span className="med-stat-icon">✅</span>
          <div>
            <strong>{healthSummary.passed}</strong>
            <span>{t.statPassedTriage}</span>
          </div>
        </div>

        <div className="med-summary-card flagged">
          <span className="med-stat-icon">⚠️</span>
          <div>
            <strong>{healthSummary.flagged}</strong>
            <span>{t.statFlaggedTriage}</span>
          </div>
        </div>

        <div className="med-summary-card temp">
          <span className="med-stat-icon">🌡️</span>
          <div>
            <strong>{healthSummary.averageTemp}°C</strong>
            <span>{t.statAverageTemp}</span>
          </div>
        </div>
      </div>

      {/* Notifications / Alerts */}
      {message && (
        <div className="notice success" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}

      {/* Filter Bar */}
      <div className="med-filter-bar">
        <div className="filter-group">
          <label htmlFor="filter-child">{t.paymentsChild}:</label>
          <select
            id="filter-child"
            value={selectedChildId}
            onChange={(e) => setSelectedChildId(e.target.value)}
            className="input-select"
          >
            <option value="">{t.allStatuses}</option>
            {children.map((child) => (
              <option key={child.id} value={child.id}>
                {child.name} ({child.groupName})
              </option>
            ))}
          </select>
        </div>

        {activeTab === 'medications' && (
          <div className="filter-group">
            <label htmlFor="filter-status">{t.filterAllMedStatuses}:</label>
            <select
              id="filter-status"
              value={selectedMedStatus}
              onChange={(e) => setSelectedMedStatus(e.target.value)}
              className="input-select"
            >
              <option value="all">{t.filterAllMedStatuses}</option>
              <option value="active">{t.statusActiveMed}</option>
              <option value="completed">{t.statusCompletedMed}</option>
              <option value="cancelled">{t.statusCancelledMed}</option>
            </select>
          </div>
        )}

        {activeTab === 'triage' && (
          <div className="filter-group">
            <label htmlFor="filter-date">{t.attendanceDate}:</label>
            <input
              id="filter-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input-text"
            />
          </div>
        )}
      </div>

      {/* TAB CONTENT 1: MEDICATIONS */}
      {activeTab === 'medications' && (
        <div className="medications-container">
          {loading && medications.length === 0 ? (
            <p className="loading-state">{t.loading}</p>
          ) : medications.length === 0 ? (
            <div className="empty-notice">
              <p>{t.noMedicationsFound}</p>
            </div>
          ) : (
            <div className="medications-grid">
              {medications.map((med) => (
                <div key={med.id} className="med-card">
                  <div className="med-card-header">
                    <div className="med-child-info">
                      <h3 className="med-child-name">{med.childName}</h3>
                      <span className="group-badge">{med.groupName}</span>
                    </div>
                    <span className={`status-badge status-${med.status}`}>
                      {med.status === 'active'
                        ? t.statusActiveMed
                        : med.status === 'completed'
                        ? t.statusCompletedMed
                        : t.statusCancelledMed}
                    </span>
                  </div>

                  <div className="med-details">
                    <div className="med-name-row">
                      <strong className="med-title">{med.medicationName}</strong>
                      <span className="dosage-pill">{med.dosage}</span>
                    </div>

                    <p className="med-schedule">
                      <strong>{t.frequencyLabel}:</strong> {med.frequencySchedule}
                    </p>

                    {med.instructions && (
                      <p className="med-instructions">
                        <strong>{t.instructionsLabel}:</strong> {med.instructions}
                      </p>
                    )}

                    <div className="med-meta-grid">
                      <div>
                        <strong>{t.storageLabel}:</strong>{' '}
                        <span>
                          {STORAGE_ICONS[med.storageType]}{' '}
                          {med.storageType === 'room_temperature'
                            ? t.storageRoomTemp
                            : med.storageType === 'refrigerated'
                            ? t.storageRefrigerated
                            : t.storageLockedBox}
                        </span>
                      </div>
                      <div>
                        <strong>{t.doctorNameLabel}:</strong> {med.doctorName}
                        {med.prescriptionNumber && ` (${med.prescriptionNumber})`}
                      </div>
                      <div>
                        <strong>{t.dateRange}:</strong> {med.startDate} ~ {med.endDate}
                      </div>
                      <div>
                        <strong>{t.authorizedBy}:</strong> {med.authorizedByName}
                      </div>
                    </div>

                    {med.lastAdministeredAt && (
                      <div className="last-administered-note">
                        🕒 Last dose: {new Date(med.lastAdministeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({med.logsCount} total doses)
                      </div>
                    )}
                  </div>

                  <div className="med-card-actions">
                    {isStaff && med.status === 'active' && (
                      <button
                        type="button"
                        className="btn primary administer-btn"
                        onClick={() => {
                          setAdministerMed(med)
                          setAdminDosage(med.dosage)
                          setAdminReaction('normal')
                          setAdminWitness('u-director')
                          setAdminNotes('')
                        }}
                      >
                        {t.administerDoseBtn}
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn ghost view-logs-btn"
                      onClick={() => handleOpenLogs(med)}
                    >
                      {t.viewMedLogsBtn} ({med.logsCount})
                    </button>

                    {med.status === 'active' && (
                      <>
                        <button
                          type="button"
                          className="btn ghost status-toggle-btn"
                          onClick={() => handleUpdateStatus(med, 'completed')}
                        >
                          {t.markCompletedBtn}
                        </button>
                        <button
                          type="button"
                          className="btn ghost status-toggle-btn danger"
                          onClick={() => handleUpdateStatus(med, 'cancelled')}
                        >
                          {t.markCancelledBtn}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT 2: MORNING HEALTH TRIAGE */}
      {activeTab === 'triage' && (
        <div className="triage-container">
          {loading && healthChecks.length === 0 ? (
            <p className="loading-state">{t.loading}</p>
          ) : healthChecks.length === 0 ? (
            <div className="empty-notice">
              <p>{t.noTriageRecordsFound}</p>
            </div>
          ) : (
            <div className="triage-grid">
              {healthChecks.map((check) => {
                const isFever = check.temperatureCelsius >= 37.5
                return (
                  <div key={check.id} className="triage-card">
                    <div className="triage-card-header">
                      <div className="triage-child-info">
                        <h3 className="triage-child-name">{check.childName}</h3>
                        <span className="group-badge">{check.groupName}</span>
                      </div>
                      <span
                        className={`triage-badge ${
                          check.passedTriage ? 'passed' : 'flagged'
                        }`}
                      >
                        {check.passedTriage ? `✓ ${t.triagePassedLabel}` : `⚠️ ${t.triageFlaggedLabel}`}
                      </span>
                    </div>

                    <div className="triage-body">
                      <div className="triage-metric-row">
                        <div className="triage-metric">
                          <span className="label">{t.triageCheckTime}:</span>
                          <span className="value">⏰ {check.checkTime}</span>
                        </div>
                        <div className="triage-metric">
                          <span className="label">{t.triageTemp}:</span>
                          <span className={`temp-value ${isFever ? 'fever' : 'normal'}`}>
                            🌡️ {check.temperatureCelsius}°C
                          </span>
                        </div>
                      </div>

                      <div className="symptoms-section">
                        <strong>{t.triageSymptoms}:</strong>
                        {check.symptoms.length === 0 ? (
                          <span className="no-symptoms"> {t.noSymptomsRecorded}</span>
                        ) : (
                          <div className="symptoms-tags">
                            {check.symptoms.map((s) => (
                              <span key={s} className="symptom-tag">
                                {s === 'fever'
                                  ? t.symptomFever
                                  : s === 'cough'
                                  ? t.symptomCough
                                  : s === 'rash'
                                  ? t.symptomRash
                                  : s === 'runny_nose'
                                  ? t.symptomRunnyNose
                                  : s === 'vomiting'
                                  ? t.symptomVomiting
                                  : s === 'fatigue'
                                  ? t.symptomFatigue
                                  : s}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {check.notes && (
                        <p className="triage-notes">
                          <strong>{t.instructionsLabel}:</strong> {check.notes}
                        </p>
                      )}

                      <div className="triage-inspector">
                        <small>
                          Inspector: {check.checkedByName} · {check.checkDate}
                        </small>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: AUTHORIZE MEDICATION */}
      {showAuthModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-auth-title">
          <div className="modal-content">
            <h2 id="modal-auth-title">{t.authMedModalTitle}</h2>
            <form onSubmit={handleAuthorizeSubmit} className="modal-form">
              <div className="form-group">
                <label htmlFor="auth-child">{t.paymentsChild} *</label>
                <select
                  id="auth-child"
                  value={authChildId}
                  onChange={(e) => setAuthChildId(e.target.value)}
                  required
                  className="input-select"
                >
                  {children.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.groupName})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="auth-med-name">{t.medicationNameLabel} *</label>
                <input
                  id="auth-med-name"
                  type="text"
                  value={authMedName}
                  onChange={(e) => setAuthMedName(e.target.value)}
                  placeholder="e.g. Amoxicillin, Salbutamol, Cetirizine"
                  required
                  className="input-text"
                />
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="auth-dosage">{t.dosageLabel} *</label>
                  <input
                    id="auth-dosage"
                    type="text"
                    value={authDosage}
                    onChange={(e) => setAuthDosage(e.target.value)}
                    placeholder="e.g. 5 ml, 1 tablet, 2 puffs"
                    required
                    className="input-text"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="auth-storage">{t.storageLabel} *</label>
                  <select
                    id="auth-storage"
                    value={authStorage}
                    onChange={(e) => setAuthStorage(e.target.value as MedicationStorage)}
                    className="input-select"
                  >
                    <option value="room_temperature">🌡️ {t.storageRoomTemp}</option>
                    <option value="refrigerated">❄️ {t.storageRefrigerated}</option>
                    <option value="locked_box">🔒 {t.storageLockedBox}</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="auth-frequency">{t.frequencyLabel} *</label>
                <input
                  id="auth-frequency"
                  type="text"
                  value={authFrequency}
                  onChange={(e) => setAuthFrequency(e.target.value)}
                  placeholder="e.g. Daily at 12:00, Twice daily, As needed"
                  required
                  className="input-text"
                />
              </div>

              <div className="form-group">
                <label htmlFor="auth-instructions">{t.instructionsLabel}</label>
                <textarea
                  id="auth-instructions"
                  value={authInstructions}
                  onChange={(e) => setAuthInstructions(e.target.value)}
                  placeholder="e.g. Give after lunch with food or water..."
                  rows={2}
                  className="input-text"
                />
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="auth-doctor">{t.doctorNameLabel} *</label>
                  <input
                    id="auth-doctor"
                    type="text"
                    value={authDoctor}
                    onChange={(e) => setAuthDoctor(e.target.value)}
                    placeholder="e.g. Dr. Valon Berisha"
                    required
                    className="input-text"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="auth-rx">{t.prescriptionNoLabel}</label>
                  <input
                    id="auth-rx"
                    type="text"
                    value={authRx}
                    onChange={(e) => setAuthRx(e.target.value)}
                    placeholder="e.g. RX-2026-9481"
                    className="input-text"
                  />
                </div>
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="auth-start-date">{t.medStartDate} *</label>
                  <input
                    id="auth-start-date"
                    type="date"
                    value={authStartDate}
                    onChange={(e) => setAuthStartDate(e.target.value)}
                    required
                    className="input-text"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="auth-end-date">{t.medEndDate} *</label>
                  <input
                    id="auth-end-date"
                    type="date"
                    value={authEndDate}
                    onChange={(e) => setAuthEndDate(e.target.value)}
                    required
                    className="input-text"
                  />
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setShowAuthModal(false)}
                >
                  {t.cancelAbsence}
                </button>
                <button type="submit" className="btn primary" disabled={submitting}>
                  {submitting ? t.loading : t.authorizeMedicationBtn}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADMINISTER DOSE */}
      {administerMed && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-admin-title">
          <div className="modal-content">
            <h2 id="modal-admin-title">{t.logMedModalTitle}</h2>
            <div className="med-admin-summary">
              <strong>{administerMed.childName}</strong> — {administerMed.medicationName} ({administerMed.dosage})
            </div>

            <form onSubmit={handleAdministerSubmit} className="modal-form">
              <div className="form-group">
                <label htmlFor="admin-dosage">{t.dosageGivenLabel} *</label>
                <input
                  id="admin-dosage"
                  type="text"
                  value={adminDosage}
                  onChange={(e) => setAdminDosage(e.target.value)}
                  required
                  className="input-text"
                />
              </div>

              <div className="form-group">
                <label htmlFor="admin-reaction">{t.reactionLabel} *</label>
                <select
                  id="admin-reaction"
                  value={adminReaction}
                  onChange={(e) => setAdminReaction(e.target.value as ChildReaction)}
                  className="input-select"
                >
                  <option value="normal">{REACTION_ICONS.normal} {t.reactionNormal}</option>
                  <option value="drowsy">{REACTION_ICONS.drowsy} {t.reactionDrowsy}</option>
                  <option value="refused">{REACTION_ICONS.refused} {t.reactionRefused}</option>
                  <option value="adverse">{REACTION_ICONS.adverse} {t.reactionAdverse}</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="admin-witness">{t.witnessStaffLabel}</label>
                <select
                  id="admin-witness"
                  value={adminWitness}
                  onChange={(e) => setAdminWitness(e.target.value)}
                  className="input-select"
                >
                  <option value="">{t.witnessOptional}</option>
                  <option value="u-director">Drejtor / Director</option>
                  <option value="u-teacher">Edukator / Teacher</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="admin-notes">{t.paymentsNotes}</label>
                <textarea
                  id="admin-notes"
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="e.g. Taken smoothly with juice, child feeling cheerful..."
                  rows={2}
                  className="input-text"
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setAdministerMed(null)}
                >
                  {t.cancelAbsence}
                </button>
                <button type="submit" className="btn primary" disabled={submitting}>
                  {submitting ? t.loading : t.administerDoseBtn}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: VIEW MEDICATION LOGS */}
      {logsMed && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-logs-title">
          <div className="modal-content modal-large">
            <h2 id="modal-logs-title">
              {t.tabMedicationLogs}: {logsMed.medicationName} ({logsMed.childName})
            </h2>

            {logsLoading ? (
              <p className="loading-state">{t.loading}</p>
            ) : currentLogs.length === 0 ? (
              <div className="empty-notice">
                <p>{t.noMedLogsFound}</p>
              </div>
            ) : (
              <div className="med-logs-table-container">
                <table className="med-logs-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Dose</th>
                      <th>Reaction</th>
                      <th>Administered By</th>
                      <th>Witness</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{new Date(log.administeredAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td><strong>{log.dosageGiven}</strong></td>
                        <td>
                          {REACTION_ICONS[log.reaction]}{' '}
                          {log.reaction === 'normal'
                            ? t.reactionNormal
                            : log.reaction === 'drowsy'
                            ? t.reactionDrowsy
                            : log.reaction === 'refused'
                            ? t.reactionRefused
                            : t.reactionAdverse}
                        </td>
                        <td>{log.administeredByName}</td>
                        <td>{log.witnessByName || '—'}</td>
                        <td>{log.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setLogsMed(null)}
              >
                {t.closeReceipt}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: RECORD MORNING HEALTH TRIAGE */}
      {showTriageModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-triage-title">
          <div className="modal-content">
            <h2 id="modal-triage-title">{t.triageModalTitle}</h2>
            <form onSubmit={handleTriageSubmit} className="modal-form">
              <div className="form-group">
                <label htmlFor="triage-child">{t.paymentsChild} *</label>
                <select
                  id="triage-child"
                  value={triageChildId}
                  onChange={(e) => setTriageChildId(e.target.value)}
                  required
                  className="input-select"
                >
                  {children.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.groupName})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="triage-date">{t.attendanceDate} *</label>
                  <input
                    id="triage-date"
                    type="date"
                    value={triageDate}
                    onChange={(e) => setTriageDate(e.target.value)}
                    required
                    className="input-text"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="triage-time">{t.triageCheckTime} *</label>
                  <input
                    id="triage-time"
                    type="time"
                    value={triageTime}
                    onChange={(e) => setTriageTime(e.target.value)}
                    required
                    className="input-text"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="triage-temp">{t.triageTemp} *</label>
                <input
                  id="triage-temp"
                  type="number"
                  step="0.1"
                  min="34.0"
                  max="42.0"
                  value={triageTemp}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value)
                    setTriageTemp(isNaN(val) ? 36.6 : val)
                    if (val >= 37.5) {
                      setTriagePassed(false)
                      if (!triageSymptoms.includes('fever')) {
                        setTriageSymptoms((prev) => [...prev, 'fever'])
                      }
                    }
                  }}
                  required
                  className="input-text"
                />
              </div>

              <div className="form-group">
                <label>{t.triageSymptoms}:</label>
                <div className="symptoms-checkbox-grid">
                  {COMMON_SYMPTOMS.map((s) => (
                    <label key={s} className="symptom-checkbox-item">
                      <input
                        type="checkbox"
                        checked={triageSymptoms.includes(s)}
                        onChange={() => toggleSymptom(s)}
                      />
                      <span>
                        {s === 'fever'
                          ? t.symptomFever
                          : s === 'cough'
                          ? t.symptomCough
                          : s === 'rash'
                          ? t.symptomRash
                          : s === 'runny_nose'
                          ? t.symptomRunnyNose
                          : s === 'vomiting'
                          ? t.symptomVomiting
                          : t.symptomFatigue}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="triage-passed-select">{t.triageResult} *</label>
                <select
                  id="triage-passed-select"
                  value={triagePassed ? '1' : '0'}
                  onChange={(e) => setTriagePassed(e.target.value === '1')}
                  className="input-select"
                >
                  <option value="1">✅ {t.triagePassedLabel}</option>
                  <option value="0">⚠️ {t.triageFlaggedLabel}</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="triage-notes">{t.paymentsNotes}</label>
                <textarea
                  id="triage-notes"
                  value={triageNotes}
                  onChange={(e) => setTriageNotes(e.target.value)}
                  placeholder="e.g. Mild clear runny nose, good energy and happy arrival..."
                  rows={2}
                  className="input-text"
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setShowTriageModal(false)}
                >
                  {t.cancelAbsence}
                </button>
                <button type="submit" className="btn primary" disabled={submitting}>
                  {submitting ? t.loading : t.recordTriageBtn}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
