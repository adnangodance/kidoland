/* eslint-disable react/set-state-in-effect */
import { useEffect, useState, useRef } from 'react'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import Icon from './Icon'
import { getChildProfile, type ChildProfileResponse } from './api'
import { isSeaGodanci } from './child-highlight-util'
import { SeaGodanciBadge } from './child-highlight'

interface ChildProfileModalProps {
  childId: string
  onClose: () => void
  onNavigateToTimeline?: (childId: string) => void
  onNavigateToAttendance?: () => void
  onNavigateToReport?: (childId: string) => void
}

export default function ChildProfileModal({
  childId,
  onClose,
  onNavigateToTimeline,
  onNavigateToAttendance,
  onNavigateToReport,
}: ChildProfileModalProps) {
  const { token } = useAuth()
  const { t, lang } = useI18n()
  const [data, setData] = useState<ChildProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    if (token && childId) {
      getChildProfile(childId, token, controller.signal)
        .then((res) => {
          if (active) {
            setData(res)
            setLoading(false)
          }
        })
        .catch((err) => {
          if (active && err.name !== 'AbortError') {
            setError(err.message || t.loadError)
            setLoading(false)
          }
        })
    }

    return () => {
      active = false
      controller.abort()
    }
  }, [childId, token, t.loadError])

  // Accessible Escape key and focus handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    modalRef.current?.focus()
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const isSpecial = data?.child.isSpecial || isSeaGodanci(data?.child.name)

  return (
    <div
      className="child-profile-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="child-profile-heading"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`child-profile-modal ${isSpecial ? 'child-profile-vip' : ''}`}
        ref={modalRef}
        tabIndex={-1}
      >
        <header className="child-profile-header">
          <div className="child-profile-header-info">
            <div className={`child-profile-avatar ${isSpecial ? 'avatar-vip' : ''}`}>
              {isSpecial ? '⭐' : (data?.child.name.slice(0, 1) || '👶')}
            </div>
            <div>
              <div className="child-profile-title-row">
                <h2 id="child-profile-heading">{data?.child.name || t.loading}</h2>
                {isSpecial && <SeaGodanciBadge name={data?.child.name} />}
              </div>
              <p className="child-profile-meta">
                <span className="child-profile-group">{data?.child.groupName}</span>
                {data?.child.photoConsent && (
                  <span className="child-profile-tag tag-consent">📷 {t.consentTitle}</span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn ghost child-profile-close"
            onClick={onClose}
            aria-label={t.closeProfileBtn}
            title={t.closeProfileBtn}
          >
            ✕
          </button>
        </header>

        {loading && (
          <div className="child-profile-loading" role="status">
            <span>{t.loading}</span>
          </div>
        )}

        {error && (
          <div className="child-profile-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (token && childId) {
                  setLoading(true)
                  setError(null)
                  getChildProfile(childId, token)
                    .then(setData)
                    .catch((err) => setError(err.message || t.loadError))
                    .finally(() => setLoading(false))
                }
              }}
            >
              {t.attendanceRetry}
            </button>
          </div>
        )}

        {data && !loading && (
          <div className="child-profile-content">
            {/* VIP Golden Spotlight Banner */}
            {isSpecial && (
              <div className="child-profile-vip-banner">
                <div className="vip-banner-content">
                  <span className="vip-crown" aria-hidden="true">👑</span>
                  <div>
                    <strong>{t.vipSpotlightBadge}</strong>
                    <p>
                      {lang === 'sq'
                        ? 'Fëmijë i nderuar në Kidoland · Familja Godanci me përkujdesje dhe vëmendje të nivelit më të lartë.'
                        : 'Honored child at Kidoland · The Godanci family with top-tier care and dedicated educator attention.'}
                    </p>
                  </div>
                </div>
                {data.parent && (
                  <div className="vip-parent-actions">
                    <a href={`tel:${data.parent.phone}`} className="btn-vip-call">
                      📞 {t.quickCallParent} ({data.parent.phone})
                    </a>
                    <a href={`mailto:${data.parent.email}`} className="btn-vip-email">
                      ✉️ {data.parent.email}
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Quick Metrics Bar */}
            <div className="child-profile-stats-row">
              <div className="child-profile-stat-box stat-streak">
                <span className="stat-icon" aria-hidden="true">🔥</span>
                <span className="stat-number">{data.attendance.streak}</span>
                <span className="stat-label">{t.streakCountLabel}</span>
              </div>
              <div className="child-profile-stat-box stat-present">
                <span className="stat-icon" aria-hidden="true">✅</span>
                <span className="stat-number">{data.attendance.totalPresent}</span>
                <span className="stat-label">{t.totalDaysPresent}</span>
              </div>
              <div className="child-profile-stat-box stat-milestones">
                <span className="stat-icon" aria-hidden="true">🏆</span>
                <span className="stat-number">{data.milestones.masteredCount}</span>
                <span className="stat-label">{t.milestonesMastered}</span>
              </div>
            </div>

            <div className="child-profile-grid">
              {/* 1. Family & Guardians */}
              <section className="profile-section-card">
                <h3><Icon name="children" size={18} /> {t.familyGuardiansTitle}</h3>
                {data.parent ? (
                  <div className="profile-parent-details">
                    <div className="parent-row">
                      <span className="label-dim">{t.parentContactLabel}:</span>
                      <strong>{data.parent.name}</strong>
                    </div>
                    <div className="parent-row">
                      <span className="label-dim">{t.emailLabel}:</span>
                      <a href={`mailto:${data.parent.email}`}>{data.parent.email}</a>
                    </div>
                    <div className="parent-row">
                      <span className="label-dim">{t.phoneLabel}:</span>
                      <a href={`tel:${data.parent.phone}`}><strong>{data.parent.phone}</strong></a>
                    </div>
                  </div>
                ) : (
                  <p className="dim-notice">{t.noParents}</p>
                )}

                <div className="profile-pickups-sub">
                  <h4>{t.pickupsTitle}</h4>
                  {data.pickups.length > 0 ? (
                    <ul className="profile-pickups-list">
                      {data.pickups.map((p) => (
                        <li key={p.id} className="pickup-item">
                          <div>
                            <strong>{p.name}</strong>
                            <span className="pickup-rel">({p.relationship})</span>
                            {p.isEmergency && (
                              <span className="emergency-pill">🚨 {t.emergencyBadge}</span>
                            )}
                          </div>
                          <a href={`tel:${p.phone}`} className="pickup-phone">{p.phone}</a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dim-notice">{t.noPickupsListed}</p>
                  )}
                </div>
              </section>

              {/* 2. Health & Safety Profile */}
              <section className="profile-section-card">
                <h3><Icon name="medication" size={18} /> {t.healthSafetyTitle}</h3>
                <div className="profile-health-summary">
                  <div className="health-field">
                    <span className="label-dim">{t.allergiesBadge}:</span>
                    {data.child.allergies ? (
                      <span className="allergies-pill alert-active">⚠️ {data.child.allergies}</span>
                    ) : (
                      <span className="allergies-pill safe-none">✓ {t.noAllergies}</span>
                    )}
                  </div>

                  {data.medical && (
                    <>
                      {data.medical.pediatricianName && (
                        <div className="health-field">
                          <span className="label-dim">{t.pediatricianTitle}:</span>
                          <span>{data.medical.pediatricianName} ({data.medical.pediatricianPhone})</span>
                        </div>
                      )}
                      {data.medical.bloodType && (
                        <div className="health-field">
                          <span className="label-dim">{t.bloodTypeTitle}:</span>
                          <span className="blood-pill">{data.medical.bloodType}</span>
                        </div>
                      )}
                      {data.medical.notes && (
                        <p className="medical-notes-quote">"{data.medical.notes}"</p>
                      )}
                    </>
                  )}

                  <div className="active-meds-sub">
                    <h4>{t.activeMedicationsTitle}</h4>
                    {data.activeMedications.length > 0 ? (
                      <ul className="active-meds-list">
                        {data.activeMedications.map((m) => (
                          <li key={m.id} className="med-item">
                            <strong>{m.medicationName}</strong>
                            <span>{m.dosage} · {m.frequencySchedule}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="dim-notice">{t.noActiveMedications}</p>
                    )}
                  </div>
                </div>
              </section>

              {/* 3. Attendance Streak & Recent History */}
              <section className="profile-section-card">
                <h3><Icon name="attendance" size={18} /> {t.attendanceStreakTitle}</h3>
                <div className="attendance-history-dots">
                  {data.attendance.history.length > 0 ? (
                    data.attendance.history.map((h, i) => (
                      <div
                        key={i}
                        className={`history-day-bubble ${h.status === 'present' ? 'bubble-present' : 'bubble-absent'}`}
                        title={`${h.date}: ${h.status}`}
                      >
                        <span className="bubble-date">{h.date.slice(5)}</span>
                        <span className="bubble-status">{h.status === 'present' ? '✓' : '✕'}</span>
                      </div>
                    ))
                  ) : (
                    <p className="dim-notice">{t.noSearchResults}</p>
                  )}
                </div>
              </section>

              {/* 4. Developmental Milestones Progress */}
              <section className="profile-section-card">
                <h3><Icon name="milestones" size={18} /> {t.milestonesSummaryTitle}</h3>
                <div className="milestone-badges-row">
                  <span className="milestone-badge badge-mastered">
                    🏆 {t.milestonesMastered}: <strong>{data.milestones.masteredCount}</strong>
                  </span>
                  <span className="milestone-badge badge-achieved">
                    ⭐ {t.milestonesAchieved}: <strong>{data.milestones.achievedCount}</strong>
                  </span>
                  <span className="milestone-badge badge-emerging">
                    🌱 {t.milestonesEmerging}: <strong>{data.milestones.emergingCount}</strong>
                  </span>
                </div>
                {data.milestones.sampleMastered.length > 0 && (
                  <ul className="sample-mastered-list">
                    {data.milestones.sampleMastered.map((m, idx) => (
                      <li key={idx}>
                        <span className="check-star">⭐</span>
                        <span>{lang === 'sq' ? m.titleSq : m.titleEn}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* 5. Recent Reports Preview */}
            {data.recentReports.length > 0 && (
              <section className="profile-reports-section">
                <h3><Icon name="reports" size={18} /> {t.recentReportsTitle}</h3>
                <div className="profile-reports-cards">
                  {data.recentReports.map((r) => (
                    <article key={r.id} className="recent-report-card">
                      <div className="report-card-head">
                        <strong>📅 {r.date}</strong>
                        <span className="report-mood-pill">{r.mood}</span>
                      </div>
                      <p className="report-meals-nap">
                        <span>🍽️ {r.meals}</span>
                        <span>😴 {r.nap}</span>
                      </p>
                      {r.note && <p className="report-note-preview">"{r.note}"</p>}
                      {r.photoUrl && (
                        <div className="report-photo-thumb">
                          <img src={r.photoUrl} alt="Report moment" />
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {/* Action Buttons */}
            <div className="child-profile-actions">
              {onNavigateToTimeline && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    onClose()
                    onNavigateToTimeline(data.child.id)
                  }}
                >
                  <Icon name="clock" size={16} /> {t.openFullTimeline}
                </button>
              )}
              {onNavigateToReport && (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    onClose()
                    onNavigateToReport(data.child.id)
                  }}
                >
                  <Icon name="reports" size={16} /> {t.reportsTitle}
                </button>
              )}
              {onNavigateToAttendance && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    onClose()
                    onNavigateToAttendance()
                  }}
                >
                  <Icon name="attendance" size={16} /> {t.recordAttendanceShortcut}
                </button>
              )}
              <button type="button" className="btn ghost" onClick={onClose}>
                {t.closeProfileBtn}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
