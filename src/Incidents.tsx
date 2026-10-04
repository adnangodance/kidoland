/* Health, Emergency Medical Profile, and Incident & Injury ("Ouch") Log */
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState, type FormEvent } from 'react'
import {
  listChildren,
  getMedicalProfile,
  updateMedicalProfile,
  listIncidents,
  createIncident,
  acknowledgeIncident,
  type Child,
  type ChildMedicalProfile,
  type MedicalProfileInput,
  type IncidentReport,
  type IncidentInput,
  type IncidentType,
  type IncidentLocation,
  type IncidentFirstAid,
} from './api'
import { useAuth } from './auth'
import { useI18n } from './i18n/LanguageContext'
import { localCalendarDate } from './attendance-date'
import { displayDate, useAlive } from './pilot-utils'
import ChildAvatar from './ChildAvatar'

export default function Incidents() {
  const { token, user } = useAuth()
  const { t, lang } = useI18n()
  const alive = useAlive()

  const [children, setChildren] = useState<Child[]>([])
  const [selectedChildId, setSelectedChildId] = useState('')
  const [medicalProfile, setMedicalProfile] = useState<ChildMedicalProfile | null>(null)
  const [incidents, setIncidents] = useState<IncidentReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  // Medical Profile Edit State
  const [editingMedical, setEditingMedical] = useState(false)
  const [medDraft, setMedDraft] = useState<MedicalProfileInput>({
    pediatricianName: '',
    pediatricianPhone: '',
    bloodType: '',
    chronicConditions: '',
    emergencyMedications: '',
    notes: '',
  })
  const [medSaving, setMedSaving] = useState(false)
  const [medFeedback, setMedFeedback] = useState('')

  // Incident Form State
  const [showIncidentForm, setShowIncidentForm] = useState(false)
  const [incDraft, setIncDraft] = useState<IncidentInput>({
    childId: '',
    incidentDate: localCalendarDate(),
    incidentTime: '10:30',
    type: 'scrape',
    location: 'playground',
    firstAid: 'cleaned_bandaged',
    description: '',
    actionTaken: '',
    parentNotified: true,
  })
  const [incSaving, setIncSaving] = useState(false)
  const [incError, setIncError] = useState('')
  const [incFeedback, setIncFeedback] = useState('')

  // Incident Acknowledgment
  const [ackBusyId, setAckBusyId] = useState<string | null>(null)

  const isStaff = user?.role === 'teacher' || user?.role === 'director'

  // Initial load
  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    setError(false)

    Promise.all([
      listChildren(token),
      listIncidents(token),
    ]).then(([cRes, iRes]) => {
      if (!cancelled && alive.current) {
        setChildren(cRes.children)
        setIncidents(iRes.incidents)
        if (cRes.children.length > 0 && !selectedChildId) {
          setSelectedChildId(cRes.children[0].id)
          setIncDraft((d) => ({ ...d, childId: cRes.children[0].id }))
        }
      }
    }).catch(() => {
      if (!cancelled && alive.current) setError(true)
    }).finally(() => {
      if (!cancelled && alive.current) setLoading(false)
    })

    return () => { cancelled = true }
  }, [token, retry])

  // Load medical profile for selected child
  useEffect(() => {
    if (!token || !selectedChildId) return
    let cancelled = false

    getMedicalProfile(token, selectedChildId).then((res) => {
      if (!cancelled && alive.current) {
        setMedicalProfile(res.medicalProfile)
        if (res.medicalProfile) {
          setMedDraft({
            pediatricianName: res.medicalProfile.pediatricianName || '',
            pediatricianPhone: res.medicalProfile.pediatricianPhone || '',
            bloodType: res.medicalProfile.bloodType || '',
            chronicConditions: res.medicalProfile.chronicConditions || '',
            emergencyMedications: res.medicalProfile.emergencyMedications || '',
            notes: res.medicalProfile.notes || '',
          })
        } else {
          setMedDraft({
            pediatricianName: '',
            pediatricianPhone: '',
            bloodType: '',
            chronicConditions: '',
            emergencyMedications: '',
            notes: '',
          })
        }
      }
    }).catch(() => {
      // quiet fallback
    })

    return () => { cancelled = true }
  }, [token, selectedChildId])

  async function handleSaveMedical(e: FormEvent) {
    e.preventDefault()
    if (!token || !selectedChildId || medSaving) return
    setMedSaving(true)
    setMedFeedback('')

    try {
      const res = await updateMedicalProfile(token, selectedChildId, medDraft)
      if (alive.current) {
        setMedicalProfile(res.medicalProfile)
        setEditingMedical(false)
        setMedFeedback(t.medicalSaved)
        setTimeout(() => { if (alive.current) setMedFeedback('') }, 4000)
      }
    } catch {
      // ignore
    } finally {
      if (alive.current) setMedSaving(false)
    }
  }

  async function handleSaveIncident(e: FormEvent) {
    e.preventDefault()
    if (!token || incSaving) return
    if (!incDraft.description.trim() || !incDraft.actionTaken.trim()) {
      setIncError('Please fill in description and first aid action.')
      return
    }

    setIncSaving(true)
    setIncError('')
    setIncFeedback('')

    try {
      const res = await createIncident(token, incDraft)
      if (alive.current) {
        setIncidents((prev) => [res.incident, ...prev])
        setShowIncidentForm(false)
        setIncDraft({
          childId: selectedChildId || (children[0]?.id ?? ''),
          incidentDate: localCalendarDate(),
          incidentTime: '10:30',
          type: 'scrape',
          location: 'playground',
          firstAid: 'cleaned_bandaged',
          description: '',
          actionTaken: '',
          parentNotified: true,
        })
        setIncFeedback(t.incidentSaved)
        setTimeout(() => { if (alive.current) setIncFeedback('') }, 4000)
      }
    } catch {
      if (alive.current) setIncError(t.attendanceSaveError)
    } finally {
      if (alive.current) setIncSaving(false)
    }
  }

  async function handleAcknowledge(incidentId: string) {
    if (!token || ackBusyId) return
    setAckBusyId(incidentId)

    try {
      const res = await acknowledgeIncident(token, incidentId)
      if (alive.current) {
        setIncidents((prev) => prev.map((inc) => inc.id === incidentId ? res.incident : inc))
      }
    } catch {
      // quiet fallback
    } finally {
      if (alive.current) setAckBusyId(null)
    }
  }

  const selectedChild = children.find((c) => c.id === selectedChildId)
  const displayedIncidents = user?.role === 'parent'
    ? incidents.filter((i) => i.childId === selectedChildId)
    : (selectedChildId ? incidents.filter((i) => i.childId === selectedChildId) : incidents)

  function getTypeBadge(type: IncidentType) {
    switch (type) {
      case 'scrape': return { icon: '🩹', label: t.typeScrape }
      case 'bump': return { icon: '🤕', label: t.typeBump }
      case 'bruise': return { icon: '🟣', label: t.typeBruise }
      case 'cut': return { icon: '✂️', label: t.typeCut }
      case 'bite': return { icon: '🦷', label: t.typeBite }
      case 'fever': return { icon: '🌡️', label: t.typeFever }
      default: return { icon: '📋', label: t.typeOther }
    }
  }

  function getFirstAidBadge(aid: IncidentFirstAid) {
    switch (aid) {
      case 'ice_pack': return { icon: '🧊', label: t.aidIcePack }
      case 'cleaned_bandaged': return { icon: '🩹', label: t.aidCleanedBandaged }
      case 'temperature_taken': return { icon: '🌡️', label: t.aidTemperatureTaken }
      case 'rest': return { icon: '🛋️', label: t.aidRest }
      case 'doctor_called': return { icon: '🚑', label: t.aidDoctorCalled }
      default: return { icon: '✓', label: t.aidNone }
    }
  }

  return (
    <section className="panel incidents-panel" aria-busy={loading}>
      <div className="panel-header">
        <div>
          <h1 tabIndex={-1}>{t.incidentsTitle}</h1>
          <p className="subtitle">
            {isStaff ? t.incidentsStaffSubtitle : t.incidentsParentSubtitle}
          </p>
        </div>
        {isStaff && (
          <button
            type="button"
            className="btn primary"
            onClick={() => setShowIncidentForm((v) => !v)}
            aria-expanded={showIncidentForm}
          >
            {t.logIncidentBtn}
          </button>
        )}
      </div>

      {incFeedback && <div className="notice success-banner" role="status">✓ {incFeedback}</div>}
      {medFeedback && <div className="notice success-banner" role="status">✓ {medFeedback}</div>}
      {error && (
        <div role="alert" className="notice error-banner">
          <p>{t.loadError}</p>
          <button type="button" className="btn primary" onClick={() => setRetry((r) => r + 1)}>
            {t.attendanceRetry}
          </button>
        </div>
      )}

      {/* Child Selector Pills */}
      {children.length > 0 && (
        <div className="child-selector-bar" role="tablist" aria-label={t.paymentsChild}>
          {!isStaff && <span className="selector-label">{t.paymentsChild}:</span>}
          {isStaff && (
            <button
              type="button"
              className={`pill-btn ${selectedChildId === '' ? 'active' : ''}`}
              onClick={() => setSelectedChildId('')}
            >
              🌟 {t.filterAll}
            </button>
          )}
          {children.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`pill-btn ${selectedChildId === c.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedChildId(c.id)
                setIncDraft((d) => ({ ...d, childId: c.id }))
              }}
              role="tab"
              aria-selected={selectedChildId === c.id}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Staff Log New Incident Form */}
      {isStaff && showIncidentForm && (
        <form onSubmit={handleSaveIncident} className="card-form incident-create-card">
          <h3>{t.newIncidentTitle}</h3>
          {incError && <p role="alert" className="error-text">{incError}</p>}
          <div className="form-grid">
            <label>
              <span>{t.paymentsChild}</span>
              <select
                required
                value={incDraft.childId}
                onChange={(e) => setIncDraft({ ...incDraft, childId: e.target.value })}
              >
                {children.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.groupName})</option>
                ))}
              </select>
            </label>

            <label>
              <span>{t.incidentDate}</span>
              <input
                type="date"
                required
                value={incDraft.incidentDate}
                onChange={(e) => setIncDraft({ ...incDraft, incidentDate: e.target.value })}
              />
            </label>

            <label>
              <span>{t.incidentTime}</span>
              <input
                type="time"
                required
                value={incDraft.incidentTime}
                onChange={(e) => setIncDraft({ ...incDraft, incidentTime: e.target.value })}
              />
            </label>

            <label>
              <span>{t.incidentType}</span>
              <select
                value={incDraft.type}
                onChange={(e) => setIncDraft({ ...incDraft, type: e.target.value as IncidentType })}
              >
                <option value="scrape">{t.typeScrape}</option>
                <option value="bump">{t.typeBump}</option>
                <option value="bruise">{t.typeBruise}</option>
                <option value="cut">{t.typeCut}</option>
                <option value="bite">{t.typeBite}</option>
                <option value="fever">{t.typeFever}</option>
                <option value="other">{t.typeOther}</option>
              </select>
            </label>

            <label>
              <span>{t.incidentLocation}</span>
              <select
                value={incDraft.location}
                onChange={(e) => setIncDraft({ ...incDraft, location: e.target.value as IncidentLocation })}
              >
                <option value="playground">{t.locPlayground}</option>
                <option value="classroom">{t.locClassroom}</option>
                <option value="cafeteria">{t.locCafeteria}</option>
                <option value="nap_room">{t.locNapRoom}</option>
                <option value="bathroom">{t.locBathroom}</option>
                <option value="other">{t.locOther}</option>
              </select>
            </label>

            <label>
              <span>{t.firstAidApplied}</span>
              <select
                value={incDraft.firstAid}
                onChange={(e) => setIncDraft({ ...incDraft, firstAid: e.target.value as IncidentFirstAid })}
              >
                <option value="cleaned_bandaged">{t.aidCleanedBandaged}</option>
                <option value="ice_pack">{t.aidIcePack}</option>
                <option value="temperature_taken">{t.aidTemperatureTaken}</option>
                <option value="rest">{t.aidRest}</option>
                <option value="doctor_called">{t.aidDoctorCalled}</option>
                <option value="none">{t.aidNone}</option>
              </select>
            </label>
          </div>

          <label className="form-full">
            <span>{t.incidentDescription}</span>
            <textarea
              required
              rows={2}
              maxLength={500}
              placeholder={t.incidentDescriptionPlaceholder}
              value={incDraft.description}
              onChange={(e) => setIncDraft({ ...incDraft, description: e.target.value })}
            />
          </label>

          <label className="form-full">
            <span>{t.incidentActionTaken}</span>
            <textarea
              required
              rows={2}
              maxLength={500}
              placeholder={t.incidentActionTakenPlaceholder}
              value={incDraft.actionTaken}
              onChange={(e) => setIncDraft({ ...incDraft, actionTaken: e.target.value })}
            />
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={incDraft.parentNotified}
              onChange={(e) => setIncDraft({ ...incDraft, parentNotified: e.target.checked })}
            />
            <span>{t.incidentParentNotified}</span>
          </label>

          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={incSaving}>
              {incSaving ? t.attendanceSaving : t.saveIncident}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setShowIncidentForm(false)}
            >
              {t.cancel}
            </button>
          </div>
        </form>
      )}

      {/* Selected Child Emergency Medical Profile Card */}
      {selectedChild && (
        <article className="medical-profile-card">
          <div className="medical-profile-header">
            <div className="medical-profile-title">
              <span className="medical-cross-icon">🩺</span>
              <div>
                <h3>{t.medicalProfile}: {selectedChild.name}</h3>
                <p className="subtitle">{selectedChild.groupName} {selectedChild.allergies && `· ⚠️ ${selectedChild.allergies}`}</p>
              </div>
            </div>
            <button
              type="button"
              className="btn ghost small-btn"
              onClick={() => setEditingMedical((v) => !v)}
            >
              ✏️ {editingMedical ? t.cancel : t.editMedical}
            </button>
          </div>

          {editingMedical ? (
            <form onSubmit={handleSaveMedical} className="medical-edit-form">
              <div className="form-grid">
                <label>
                  <span>{t.pediatrician}</span>
                  <input
                    maxLength={100}
                    placeholder="Dr. Valbona Kelmendi"
                    value={medDraft.pediatricianName}
                    onChange={(e) => setMedDraft({ ...medDraft, pediatricianName: e.target.value })}
                  />
                </label>
                <label>
                  <span>{t.pediatricianPhone}</span>
                  <input
                    maxLength={50}
                    placeholder="+383 44 112 233"
                    value={medDraft.pediatricianPhone}
                    onChange={(e) => setMedDraft({ ...medDraft, pediatricianPhone: e.target.value })}
                  />
                </label>
                <label>
                  <span>{t.bloodType}</span>
                  <select
                    value={medDraft.bloodType}
                    onChange={(e) => setMedDraft({ ...medDraft, bloodType: e.target.value })}
                  >
                    <option value="">--</option>
                    <option value="A+">A+</option>
                    <option value="A-">A-</option>
                    <option value="B+">B+</option>
                    <option value="B-">B-</option>
                    <option value="AB+">AB+</option>
                    <option value="AB-">AB-</option>
                    <option value="O+">O+</option>
                    <option value="O-">O-</option>
                  </select>
                </label>
                <label>
                  <span>{t.emergencyMedications}</span>
                  <input
                    maxLength={300}
                    placeholder="Ventolin inhaler / EpiPen"
                    value={medDraft.emergencyMedications}
                    onChange={(e) => setMedDraft({ ...medDraft, emergencyMedications: e.target.value })}
                  />
                </label>
              </div>
              <label className="form-full">
                <span>{t.chronicConditions}</span>
                <input
                  maxLength={300}
                  placeholder="Asthma / Dust sensitivity"
                  value={medDraft.chronicConditions}
                  onChange={(e) => setMedDraft({ ...medDraft, chronicConditions: e.target.value })}
                />
              </label>
              <label className="form-full">
                <span>{t.medicalNotes}</span>
                <textarea
                  rows={2}
                  maxLength={500}
                  placeholder="Routine checkups / care guidance"
                  value={medDraft.notes}
                  onChange={(e) => setMedDraft({ ...medDraft, notes: e.target.value })}
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn primary" disabled={medSaving}>
                  {medSaving ? t.attendanceSaving : t.saveMedical}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setEditingMedical(false)}
                >
                  {t.cancel}
                </button>
              </div>
            </form>
          ) : (
            <div className="medical-profile-details">
              <div className="med-grid">
                <div className="med-item">
                  <span className="med-label">{t.pediatrician}:</span>
                  <strong>{medicalProfile?.pediatricianName || '—'}</strong>
                  {medicalProfile?.pediatricianPhone && (
                    <a href={`tel:${medicalProfile.pediatricianPhone}`} className="tel-link">
                      📞 {medicalProfile.pediatricianPhone}
                    </a>
                  )}
                </div>
                <div className="med-item">
                  <span className="med-label">{t.bloodType}:</span>
                  <span className="badge blood-badge">{medicalProfile?.bloodType || '—'}</span>
                </div>
                <div className="med-item">
                  <span className="med-label">{t.emergencyMedications}:</span>
                  {medicalProfile?.emergencyMedications ? (
                    <span className="badge emergency-med-badge">⚠️ {medicalProfile.emergencyMedications}</span>
                  ) : (
                    <span>—</span>
                  )}
                </div>
                <div className="med-item">
                  <span className="med-label">{t.chronicConditions}:</span>
                  <span>{medicalProfile?.chronicConditions || '—'}</span>
                </div>
              </div>
              {medicalProfile?.notes && (
                <div className="med-notes">
                  <span className="med-label">{t.medicalNotes}:</span>
                  <p>{medicalProfile.notes}</p>
                </div>
              )}
            </div>
          )}
        </article>
      )}

      {/* Incident Reports Feed */}
      <div className="incidents-feed">
        <div className="feed-header">
          <h3>📋 {t.incidentHistory}</h3>
          <span className="incident-count">({displayedIncidents.length})</span>
        </div>

        {displayedIncidents.length === 0 ? (
          <div className="empty-state-card">
            <span className="empty-emoji">🌟</span>
            <p>{t.noIncidents}</p>
          </div>
        ) : (
          <div className="incidents-list">
            {displayedIncidents.map((inc) => {
              const typeBadge = getTypeBadge(inc.type)
              const aidBadge = getFirstAidBadge(inc.firstAid)
              const isAcknowledged = Boolean(inc.parentAcknowledgedAt)

              return (
                <article key={inc.id} className="incident-card">
                  <div className="incident-card-top">
                    <div className="incident-child-info">
                      <ChildAvatar name={inc.childName} size={36} />
                      <div>
                        <strong>{inc.childName}</strong>
                        <span className="incident-meta-time">
                          📅 {displayDate(inc.incidentDate, lang)} · ⏰ {inc.incidentTime}
                        </span>
                      </div>
                    </div>
                    <div className="incident-tags">
                      <span className={`badge incident-type-badge type-${inc.type}`}>
                        {typeBadge.icon} {typeBadge.label}
                      </span>
                    </div>
                  </div>

                  <div className="incident-body">
                    <div className="incident-field">
                      <span className="field-title">{t.incidentDescription}:</span>
                      <p className="field-desc">{inc.description}</p>
                    </div>

                    <div className="incident-field">
                      <span className="field-title">{t.firstAidApplied}:</span>
                      <div className="aid-pill">
                        <span>{aidBadge.icon} <strong>{aidBadge.label}</strong></span>
                        <p className="action-text">{inc.actionTaken}</p>
                      </div>
                    </div>
                  </div>

                  <div className="incident-footer">
                    <div className="incident-reporter-info">
                      <span>📍 {inc.location}</span>
                      <span>✍️ {inc.reporterName} ({inc.reporterRole})</span>
                      {inc.parentNotified && <span className="tag-notified">📞 {t.incidentParentNotified}</span>}
                    </div>

                    <div className="incident-ack-section">
                      {isAcknowledged ? (
                        <span className="ack-status acknowledged">
                          {t.acknowledgedByParent} {inc.parentAcknowledgedAt?.slice(0, 10)}
                        </span>
                      ) : (
                        user?.role === 'parent' ? (
                          <button
                            type="button"
                            className="btn primary small-btn ack-btn"
                            disabled={ackBusyId === inc.id}
                            onClick={() => handleAcknowledge(inc.id)}
                          >
                            {ackBusyId === inc.id ? t.attendanceSaving : `✍️ ${t.signAcknowledge}`}
                          </button>
                        ) : (
                          <span className="ack-status pending">
                            ⏳ {t.pendingParentAck}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
