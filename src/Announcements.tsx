/* Manage announcements and display notice board for staff and parents */
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState, type FormEvent } from 'react'
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  listChildren,
  type Announcement,
  type AnnouncementInput,
  type AnnouncementPriority,
} from './api'
import { useAuth } from './auth'
import { useI18n } from './i18n/LanguageContext'
import { displayDate, useAlive } from './pilot-utils'

const initialDraft: AnnouncementInput = {
  title: '',
  content: '',
  priority: 'normal',
  targetGroup: 'all',
  eventDate: '',
}

export default function Announcements() {
  const { token, user } = useAuth()
  const { t, lang } = useI18n()
  const alive = useAlive()

  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState<AnnouncementInput>(initialDraft)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [actionFeedback, setActionFeedback] = useState('')

  const canPost = user?.role === 'director' || user?.role === 'teacher'
  const isDirector = user?.role === 'director'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setActionFeedback('')

    if (!token) return

    Promise.all([
      listAnnouncements(token),
      listChildren(token).catch(() => ({ children: [] })),
    ])
      .then(([annRes, childRes]) => {
        if (!cancelled && alive.current) {
          setAnnouncements(annRes.announcements)
          const uniqueGroups = Array.from(new Set(childRes.children.map((c) => c.groupName))).filter(Boolean)
          setGroups(uniqueGroups)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled && alive.current) {
          setError(true)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [token, retry])

  function applyPreset(type: 'meeting' | 'trip' | 'holiday') {
    if (type === 'meeting') {
      setDraft({
        title: lang === 'sq' ? 'Mbledhje e Përgjithshme me Prindër' : 'School-wide Parent-Teacher Meeting',
        content:
          lang === 'sq'
            ? 'Të nderuar prindër,\nJu mirëpresim në takimin e këtij muaji për të ndarë ecurinë e fëmijëve dhe aktivitetet që do të pasojnë. Pjesëmarrja juaj ka vlerë të madhe për ne.'
            : 'Dear parents,\nYou are warmly invited to this month’s meeting to discuss learning progress and upcoming school events. We look forward to seeing you.',
        priority: 'important',
        targetGroup: 'all',
        eventDate: '',
      })
    } else if (type === 'trip') {
      setDraft({
        title: lang === 'sq' ? 'Ekskursion Edukativ & Lojë në Natyrë' : 'Educational Field Trip to Nature Park',
        content:
          lang === 'sq'
            ? 'Të dashur prindër,\nKëtë javë po organizojmë një shëtitje në parkun natyror! Ju lutemi përgatisni fëmijët me veshje të rehatshme, kapele dielli dhe një shishe uji me emër.'
            : 'Dear families,\nWe are organizing a morning field trip to the nature park! Please ensure your child wears comfortable sneakers and brings a labeled water bottle.',
        priority: 'normal',
        targetGroup: groups[0] || 'all',
        eventDate: '',
      })
    } else if (type === 'holiday') {
      setDraft({
        title: lang === 'sq' ? 'Njoftim për Ditë Pushimi Zyrtar' : 'Kindergarten Holiday Closure Notice',
        content:
          lang === 'sq'
            ? 'Ju njoftojmë se kopshti do të jetë i mbyllur për shkak të festës zyrtare. Mësimi dhe kujdesi rregullt rifillojnë ditën pasuese.'
            : 'Please note that the kindergarten will be closed in observance of the upcoming official holiday. Regular daycare and programs resume the following day.',
        priority: 'urgent',
        targetGroup: 'all',
        eventDate: '',
      })
    }
    setShowForm(true)
    setSaveError('')
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!token || saving || !draft.title.trim() || !draft.content.trim()) return

    setSaving(true)
    setSaveError('')
    setActionFeedback('')

    try {
      const res = await createAnnouncement(token, {
        ...draft,
        eventDate: draft.eventDate ? draft.eventDate : null,
      })
      if (alive.current) {
        setAnnouncements((prev) => [res.announcement, ...prev])
        setDraft(initialDraft)
        setShowForm(false)
        setActionFeedback(t.programSaved)
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
    setActionFeedback('')
    try {
      await deleteAnnouncement(token, id)
      if (alive.current) {
        setAnnouncements((prev) => prev.filter((a) => a.id !== id))
        setActionFeedback(t.deleteSuccess)
      }
    } catch {
      if (alive.current) setSaveError(t.loadError)
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  return (
    <section className="panel">
      <h1>{t.announcementsTitle}</h1>
      <p>{canPost ? t.announcementsStaffDescription : t.announcementsParentDescription}</p>

      {actionFeedback && <p role="status" className="attendance-feedback">✓ {actionFeedback}</p>}
      {error && (
        <p role="alert" className="form-error">
          {t.loadError} <button onClick={() => setRetry((v) => v + 1)}>{t.attendanceRetry}</button>
        </p>
      )}

      {canPost && (
        <div className="announcement-actions-bar">
          <button
            className="btn primary"
            type="button"
            disabled={saving}
            onClick={() => {
              setShowForm((v) => !v)
              setSaveError('')
            }}
          >
            {showForm ? t.cancel : `+ ${t.newAnnouncement}`}
          </button>
          {!showForm && (
            <div className="template-chips" role="group" aria-label="Presets">
              <span className="template-label">📌 {t.programQuickTemplate}:</span>
              <button className="demo-chip" type="button" onClick={() => applyPreset('meeting')}>{t.presetMeeting}</button>
              <button className="demo-chip" type="button" onClick={() => applyPreset('trip')}>{t.presetTrip}</button>
              <button className="demo-chip" type="button" onClick={() => applyPreset('holiday')}>{t.presetHoliday}</button>
            </div>
          )}
        </div>
      )}

      {canPost && showForm && (
        <form className="login-form announcement-form" onSubmit={handleCreate}>
          <h2>{t.newAnnouncement}</h2>
          <fieldset disabled={saving}>
            <label>
              {t.announcementTitleLabel}
              <input
                required
                maxLength={200}
                placeholder={t.announcementTitlePlaceholder}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>

            <div className="filters" style={{ margin: 0 }}>
              <label>
                {t.announcementPriority}
                <select
                  value={draft.priority}
                  onChange={(e) => setDraft({ ...draft, priority: e.target.value as AnnouncementPriority })}
                >
                  <option value="normal">{t.priorityNormal}</option>
                  <option value="important">⭐ {t.priorityImportant}</option>
                  <option value="urgent">🚨 {t.priorityUrgent}</option>
                </select>
              </label>

              <label>
                {t.announcementTarget}
                <select
                  value={draft.targetGroup}
                  onChange={(e) => setDraft({ ...draft, targetGroup: e.target.value })}
                >
                  <option value="all">{t.targetAll}</option>
                  {groups.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                {t.announcementEventDate}
                <input
                  type="date"
                  value={draft.eventDate || ''}
                  onChange={(e) => setDraft({ ...draft, eventDate: e.target.value })}
                />
              </label>
            </div>

            <label>
              {t.announcementContentLabel}
              <textarea
                required
                rows={4}
                maxLength={5000}
                placeholder={t.announcementContentPlaceholder}
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              />
            </label>

            {saveError && <p role="alert" className="form-error">{saveError}</p>}

            <div className="actions">
              <button className="btn primary" disabled={saving || !draft.title.trim() || !draft.content.trim()}>
                {saving ? t.attendanceSaving : t.postAnnouncement}
              </button>
              <button type="button" className="btn ghost" disabled={saving} onClick={() => setShowForm(false)}>
                {t.cancel}
              </button>
            </div>
          </fieldset>
        </form>
      )}

      {loading && <p role="status">{t.loading}</p>}

      {!loading && !error && announcements.length === 0 && <p>{t.noAnnouncements}</p>}

      {!loading && (
        <div className="announcements-feed">
          {announcements.map((ann) => {
            const canDelete = isDirector || (user?.role === 'teacher' && ann.createdBy === user?.id)
            return (
              <article
                key={ann.id}
                className={`roster-card announcement-card priority-${ann.priority}`}
              >
                <div className="announcement-header">
                  <div className="announcement-meta-top">
                    <span className={`priority-badge priority-${ann.priority}`}>
                      {ann.priority === 'urgent' && '🚨 '}
                      {ann.priority === 'important' && '⭐ '}
                      {ann.priority === 'urgent'
                        ? t.priorityUrgent
                        : ann.priority === 'important'
                        ? t.priorityImportant
                        : t.priorityNormal}
                    </span>
                    <span className="group-tag">
                      👥 {ann.targetGroup === 'all' ? t.targetAll : ann.targetGroup}
                    </span>
                    {ann.eventDate && (
                      <span className="event-tag">
                        📅 {t.eventOn}: {displayDate(ann.eventDate, lang)}
                      </span>
                    )}
                  </div>
                  <h2>{ann.title}</h2>
                </div>

                <div className="announcement-body">
                  <p className="pre-text">{ann.content}</p>
                </div>

                <div className="announcement-footer">
                  <p className="card-subtitle">
                    {t.postedBy}: <strong>{ann.authorName}</strong> · {displayDate(ann.createdAt.slice(0, 10), lang)}
                  </p>
                  {canDelete && (
                    <button
                      type="button"
                      className="btn ghost small-btn"
                      disabled={saving}
                      onClick={() => void handleDelete(ann.id)}
                    >
                      🗑️ {t.deleteAnnouncement}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
