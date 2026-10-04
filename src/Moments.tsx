/* Classroom Moments & Learning Activity Timeline with Photo Consent Filtering */
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState, type FormEvent } from 'react'
import {
  listMoments,
  createMoment,
  toggleMomentReaction,
  deleteMoment,
  listChildren,
  type ClassroomMoment,
  type MomentInput,
  type LearningArea,
  type Child,
} from './api'
import { useAuth } from './auth'
import { useI18n } from './i18n/LanguageContext'
import { localCalendarDate } from './attendance-date'
import { displayDate, useAlive } from './pilot-utils'
import ChildAvatar from './ChildAvatar'

const learningAreas: { value: LearningArea; labelKey: keyof typeof import('./i18n/translations').translations['en']; icon: string }[] = [
  { value: 'art', labelKey: 'areaArt', icon: '🎨' },
  { value: 'stem', labelKey: 'areaStem', icon: '🔬' },
  { value: 'motor', labelKey: 'areaMotor', icon: '🏃' },
  { value: 'music', labelKey: 'areaMusic', icon: '🎵' },
  { value: 'story', labelKey: 'areaStory', icon: '📖' },
  { value: 'outdoor', labelKey: 'areaOutdoor', icon: '🌿' },
  { value: 'other', labelKey: 'areaOther', icon: '🌟' },
]

export default function Moments() {
  const { token, user } = useAuth()
  const { t, lang } = useI18n()
  const alive = useAlive()

  const [moments, setMoments] = useState<ClassroomMoment[]>([])
  const [children, setChildren] = useState<Child[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  // Filters
  const [selectedArea, setSelectedArea] = useState<string>('')
  const [selectedGroup, setSelectedGroup] = useState<string>('')

  // Create Moment Form State
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState<MomentInput>({
    title: '',
    groupName: '',
    learningArea: 'art',
    momentDate: localCalendarDate(),
    description: '',
    imageUrl: '',
    taggedChildren: [],
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [feedback, setFeedback] = useState('')

  const isStaff = user?.role === 'teacher' || user?.role === 'director'

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    setError(false)

    Promise.all([
      listMoments(token, {
        area: selectedArea || undefined,
        groupName: selectedGroup || undefined,
      }),
      listChildren(token),
    ]).then(([mRes, cRes]) => {
      if (!cancelled && alive.current) {
        setMoments(mRes.moments)
        setChildren(cRes.children)
        if (cRes.children.length > 0 && !draft.groupName) {
          setDraft((d) => ({ ...d, groupName: cRes.children[0].groupName }))
        }
      }
    }).catch(() => {
      if (!cancelled && alive.current) setError(true)
    }).finally(() => {
      if (!cancelled && alive.current) setLoading(false)
    })

    return () => { cancelled = true }
  }, [token, retry, selectedArea, selectedGroup])

  const availableGroups = Array.from(new Set(children.map((c) => c.groupName))).filter(Boolean)

  async function handleCreateMoment(e: FormEvent) {
    e.preventDefault()
    if (!token || saving) return
    if (!draft.title.trim() || !draft.description.trim()) {
      setSaveError('Please provide a title and description.')
      return
    }

    setSaving(true)
    setSaveError('')
    setFeedback('')

    try {
      const res = await createMoment(token, {
        ...draft,
        imageUrl: draft.imageUrl?.trim() || null,
      })
      if (alive.current) {
        setMoments((prev) => [res.moment, ...prev])
        setShowForm(false)
        setDraft({
          title: '',
          groupName: availableGroups[0] || 'all',
          learningArea: 'art',
          momentDate: localCalendarDate(),
          description: '',
          imageUrl: '',
          taggedChildren: [],
        })
        setFeedback(t.momentSaved)
        setTimeout(() => { if (alive.current) setFeedback('') }, 4000)
      }
    } catch {
      if (alive.current) setSaveError(t.attendanceSaveError)
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  async function handleToggleReaction(momentId: string) {
    if (!token) return

    // Optimistic UI update
    setMoments((prev) => prev.map((m) => {
      if (m.id !== momentId) return m
      const nextReacted = !m.userReacted
      return {
        ...m,
        userReacted: nextReacted,
        reactionCount: nextReacted ? m.reactionCount + 1 : Math.max(0, m.reactionCount - 1),
      }
    }))

    try {
      const res = await toggleMomentReaction(token, momentId)
      if (alive.current) {
        setMoments((prev) => prev.map((m) => {
          if (m.id !== momentId) return m
          return {
            ...m,
            userReacted: res.reacted,
            reactionCount: res.reactionCount,
          }
        }))
      }
    } catch {
      // Revert if error
      setRetry((r) => r + 1)
    }
  }

  async function handleDeleteMoment(momentId: string) {
    if (!token) return
    try {
      await deleteMoment(token, momentId)
      if (alive.current) {
        setMoments((prev) => prev.filter((m) => m.id !== momentId))
        setFeedback(t.momentDeleted)
        setTimeout(() => { if (alive.current) setFeedback('') }, 4000)
      }
    } catch {
      // quiet fallback
    }
  }

  function toggleTaggedChild(childId: string) {
    setDraft((prev) => {
      const current = prev.taggedChildren || []
      const exists = current.includes(childId)
      return {
        ...prev,
        taggedChildren: exists ? current.filter((id) => id !== childId) : [...current, childId],
      }
    })
  }

  function getAreaLabel(area: LearningArea) {
    const found = learningAreas.find((a) => a.value === area)
    return found ? { icon: found.icon, label: t[found.labelKey] as string } : { icon: '🌟', label: t.areaOther }
  }

  return (
    <section className="panel moments-panel" aria-busy={loading}>
      <div className="panel-header">
        <div>
          <h1 tabIndex={-1}>{t.momentsTitle}</h1>
          <p className="subtitle">
            {isStaff ? t.momentsStaffSubtitle : t.momentsParentSubtitle}
          </p>
        </div>
        {isStaff && (
          <button
            type="button"
            className="btn primary"
            onClick={() => setShowForm((v) => !v)}
            aria-expanded={showForm}
          >
            {t.newMomentBtn}
          </button>
        )}
      </div>

      {feedback && <div className="notice success-banner" role="status">✓ {feedback}</div>}
      {error && (
        <div role="alert" className="notice error-banner">
          <p>{t.loadError}</p>
          <button type="button" className="btn primary" onClick={() => setRetry((r) => r + 1)}>
            {t.attendanceRetry}
          </button>
        </div>
      )}

      {/* Filter by Learning Area */}
      <div className="learning-area-filters" role="tablist" aria-label={t.filterArea}>
        <button
          type="button"
          className={`pill-btn ${selectedArea === '' ? 'active' : ''}`}
          onClick={() => setSelectedArea('')}
        >
          🌈 {t.allAreas}
        </button>
        {learningAreas.map((area) => (
          <button
            key={area.value}
            type="button"
            className={`pill-btn ${selectedArea === area.value ? 'active' : ''}`}
            onClick={() => setSelectedArea(area.value === selectedArea ? '' : area.value)}
          >
            {area.icon} {t[area.labelKey] as string}
          </button>
        ))}
        {isStaff && availableGroups.length > 1 && (
          <select
            className="pill-btn"
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            aria-label={t.targetGroup}
          >
            <option value="">{t.allGroups}</option>
            {availableGroups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        )}
      </div>

      {/* Staff Create Moment Form */}
      {isStaff && showForm && (
        <form onSubmit={handleCreateMoment} className="card-form moment-create-card">
          <h3>{t.newMomentTitle}</h3>
          {saveError && <p role="alert" className="error-text">{saveError}</p>}

          <div className="form-grid">
            <label className="form-full">
              <span>{t.momentTitleLabel}</span>
              <input
                required
                maxLength={200}
                placeholder={t.momentTitlePlaceholder}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>

            <label>
              <span>{t.learningArea}</span>
              <select
                value={draft.learningArea}
                onChange={(e) => setDraft({ ...draft, learningArea: e.target.value as LearningArea })}
              >
                {learningAreas.map((a) => (
                  <option key={a.value} value={a.value}>{a.icon} {t[a.labelKey] as string}</option>
                ))}
              </select>
            </label>

            <label>
              <span>{t.targetGroup}</span>
              <select
                value={draft.groupName}
                onChange={(e) => setDraft({ ...draft, groupName: e.target.value })}
              >
                <option value="all">{t.allGroups}</option>
                {availableGroups.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </label>

            <label>
              <span>{t.momentDate}</span>
              <input
                type="date"
                required
                value={draft.momentDate}
                onChange={(e) => setDraft({ ...draft, momentDate: e.target.value })}
              />
            </label>

            <label className="form-full">
              <span>{t.momentImage}</span>
              <input
                type="url"
                placeholder={t.momentImagePlaceholder}
                value={draft.imageUrl || ''}
                onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
              />
            </label>
          </div>

          <label className="form-full">
            <span>{t.momentDescription}</span>
            <textarea
              required
              rows={3}
              maxLength={2000}
              placeholder={t.momentDescPlaceholder}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>

          {/* Tag Participating Children with Photo Consent Check */}
          {children.length > 0 && (
            <div className="tag-children-section">
              <span className="field-title">{t.tagChildren}:</span>
              <div className="tag-children-list">
                {children.map((child) => {
                  const isChecked = draft.taggedChildren?.includes(child.id)
                  return (
                    <label
                      key={child.id}
                      className={`child-tag-checkbox ${isChecked ? 'selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleTaggedChild(child.id)}
                      />
                      <ChildAvatar name={child.name} size={24} />
                      <span className="child-tag-name">{child.name}</span>
                      <span className={`consent-dot ${child.photoConsent ? 'consent-yes' : 'consent-no'}`} title={child.photoConsent ? t.privacyVerified : t.privacyPending}>
                        {child.photoConsent ? '✓' : '⚠️'}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? t.attendanceSaving : t.saveMoment}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setShowForm(false)}
            >
              {t.cancel}
            </button>
          </div>
        </form>
      )}

      {/* Classroom Moments Feed */}
      <div className="moments-feed">
        {moments.length === 0 ? (
          <div className="empty-state-card">
            <span className="empty-emoji">🌈</span>
            <p>{t.noMoments}</p>
          </div>
        ) : (
          <div className="moments-grid">
            {moments.map((m) => {
              const areaInfo = getAreaLabel(m.learningArea)

              return (
                <article key={m.id} className="moment-card">
                  <div className="moment-card-header">
                    <div className="moment-meta-tags">
                      <span className={`badge area-badge area-${m.learningArea}`}>
                        {areaInfo.icon} {areaInfo.label}
                      </span>
                      <span className="badge group-badge">{m.groupName === 'all' ? t.allGroups : m.groupName}</span>
                    </div>
                    <span className="moment-date">📅 {displayDate(m.momentDate, lang)}</span>
                  </div>

                  <h3 className="moment-title">{m.title}</h3>

                  {m.imageUrl && (
                    <div className="moment-photo-wrap">
                      <img
                        src={m.imageUrl}
                        alt={m.title}
                        className="moment-photo"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLElement).style.display = 'none' }}
                      />
                    </div>
                  )}

                  <p className="moment-desc">{m.description}</p>

                  {/* Tagged Children with Photo Consent Status */}
                  {m.taggedChildrenDetails && m.taggedChildrenDetails.length > 0 && (
                    <div className="moment-tagged-row">
                      <span className="tagged-label">👥 {t.tagChildren}:</span>
                      <div className="tagged-badges">
                        {m.taggedChildrenDetails.map((child) => (
                          <span
                            key={child.id}
                            className={`tagged-child-pill ${child.photoConsent ? 'consent-granted' : 'consent-missing'}`}
                            title={child.photoConsent ? t.privacyVerified : t.privacyPending}
                          >
                            <ChildAvatar name={child.name} size={18} />
                            {child.name}
                            <span className="consent-indicator">
                              {child.photoConsent ? '✓' : '⚠️'}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="moment-card-footer">
                    <span className="moment-author">
                      ✍️ {m.createdByName} ({m.createdByRole})
                    </span>

                    <div className="moment-actions">
                      <button
                        type="button"
                        className={`reaction-btn ${m.userReacted ? 'reacted' : ''}`}
                        onClick={() => handleToggleReaction(m.id)}
                        aria-label={t.reactHeart}
                      >
                        <span className="heart-icon">{m.userReacted ? '❤️' : '🤍'}</span>
                        <span className="reaction-label">{t.reactHeart}</span>
                        {m.reactionCount > 0 && (
                          <span className="reaction-count">({m.reactionCount})</span>
                        )}
                      </button>

                      {isStaff && (
                        <button
                          type="button"
                          className="btn ghost small-btn delete-btn"
                          onClick={() => handleDeleteMoment(m.id)}
                          aria-label={t.deleteMomentBtn}
                        >
                          🗑️
                        </button>
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
