import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useAuth } from './auth'
import { useI18n } from './i18n/LanguageContext'
import { localCalendarDate } from './attendance-date'
import {
  listEvents,
  createEvent,
  deleteEvent,
  submitEventRsvp,
  listChildren,
  type KindergartenEvent,
  type EventType,
  type RsvpStatus,
  type EventInput,
  type Child,
} from './api'

type CategoryFilter = 'all' | EventType

export function Events() {
  const { token, user } = useAuth()
  const { t } = useI18n()

  const [events, setEvents] = useState<KindergartenEvent[]>([])
  const [children, setChildren] = useState<Child[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [selectedType, setSelectedType] = useState<CategoryFilter>('all')

  // Staff creation form
  const [showForm, setShowForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [newEvent, setNewEvent] = useState<EventInput>(() => ({
    title: '',
    description: '',
    eventType: 'celebration',
    eventDate: localCalendarDate(),
    endDate: '',
    startTime: '10:00',
    endTime: '12:00',
    location: '',
    groupName: 'all',
    requiresRsvp: true,
    requiresPermissionSlip: false,
  }))

  // Parent RSVP modal / drawer
  const [rsvpEvent, setRsvpEvent] = useState<KindergartenEvent | null>(null)
  const [rsvpChildId, setRsvpChildId] = useState<string>('')
  const [rsvpStatus, setRsvpStatus] = useState<RsvpStatus>('attending')
  const [rsvpAdults, setRsvpAdults] = useState<number>(1)
  const [rsvpPermission, setRsvpPermission] = useState<boolean>(false)
  const [rsvpNotes, setRsvpNotes] = useState<string>('')
  const [savingRsvp, setSavingRsvp] = useState(false)
  const [rsvpError, setRsvpError] = useState('')

  const isStaff = user?.role === 'teacher' || user?.role === 'director'
  const isParent = user?.role === 'parent'
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

    async function loadData() {
      setLoading(true)
      setError('')
      try {
        const [eventsRes, childrenRes] = await Promise.all([
          listEvents(token!, undefined, controller.signal),
          listChildren(token!).catch(() => ({ children: [] })),
        ])
        if (alive.current) {
          setEvents(eventsRes.events)
          setChildren(childrenRes.children)
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

    void loadData()
    return () => {
      controller.abort()
    }
  }, [token, t.attendanceLoadError])

  function getTypeBadge(type: EventType) {
    switch (type) {
      case 'celebration':
        return { icon: '🎉', label: t.typeCelebration }
      case 'field_trip':
        return { icon: '🚌', label: t.typeFieldTrip }
      case 'conference':
        return { icon: '👥', label: t.typeConference }
      case 'holiday':
        return { icon: '🎈', label: t.typeHoliday }
      case 'workshop':
        return { icon: '🎨', label: t.typeWorkshop }
      default:
        return { icon: '📌', label: t.typeEventOther }
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!token || creating) return

    setCreating(true)
    setCreateError('')
    setFeedback('')

    try {
      const payload: EventInput = {
        title: newEvent.title.trim(),
        description: newEvent.description.trim(),
        eventType: newEvent.eventType,
        eventDate: newEvent.eventDate,
        endDate: newEvent.endDate ? newEvent.endDate : null,
        startTime: newEvent.startTime ? newEvent.startTime : null,
        endTime: newEvent.endTime ? newEvent.endTime : null,
        location: newEvent.location.trim(),
        groupName: newEvent.groupName || 'all',
        requiresRsvp: newEvent.requiresRsvp,
        requiresPermissionSlip: newEvent.requiresPermissionSlip,
      }

      const res = await createEvent(token, payload)
      if (alive.current) {
        setEvents((prev) => [res.event, ...prev])
        setShowForm(false)
        setFeedback(t.eventSaved)
        setNewEvent({
          title: '',
          description: '',
          eventType: 'celebration',
          eventDate: localCalendarDate(),
          endDate: '',
          startTime: '10:00',
          endTime: '12:00',
          location: '',
          groupName: 'all',
          requiresRsvp: true,
          requiresPermissionSlip: false,
        })
      }
    } catch {
      if (alive.current) {
        setCreateError(t.attendanceSaveError)
      }
    } finally {
      if (alive.current) setCreating(false)
    }
  }

  async function handleDelete(eventId: string) {
    if (!token) return
    try {
      await deleteEvent(token, eventId)
      if (alive.current) {
        setEvents((prev) => prev.filter((ev) => ev.id !== eventId))
        setFeedback(t.eventDeleted)
      }
    } catch {
      // quiet fallback
    }
  }

  function openRsvpModal(event: KindergartenEvent, childId?: string) {
    setRsvpEvent(event)
    setRsvpError('')

    const existingRsvp = event.rsvps?.find((r) => !childId || r.childId === childId)
    const effectiveChildId = childId || existingRsvp?.childId || children[0]?.id || ''
    setRsvpChildId(effectiveChildId)

    if (existingRsvp) {
      setRsvpStatus(existingRsvp.status)
      setRsvpAdults(existingRsvp.attendingAdults || 1)
      setRsvpPermission(Boolean(existingRsvp.permissionSigned))
      setRsvpNotes(existingRsvp.notes || '')
    } else {
      setRsvpStatus('attending')
      setRsvpAdults(1)
      setRsvpPermission(false)
      setRsvpNotes('')
    }
  }

  async function handleRsvpSubmit(e: FormEvent) {
    e.preventDefault()
    if (!token || !rsvpEvent || savingRsvp) return

    if (!rsvpChildId && children.length > 0) {
      setRsvpChildId(children[0].id)
    }

    const targetChildId = rsvpChildId || children[0]?.id
    if (!targetChildId) {
      setRsvpError('Please select a child')
      return
    }

    if (rsvpEvent.requiresPermissionSlip && rsvpStatus === 'attending' && !rsvpPermission) {
      setRsvpError(t.badgeFieldTripSlip)
      return
    }

    setSavingRsvp(true)
    setRsvpError('')

    try {
      const res = await submitEventRsvp(token, rsvpEvent.id, {
        childId: targetChildId,
        status: rsvpStatus,
        attendingAdults: rsvpAdults,
        permissionSigned: rsvpPermission,
        notes: rsvpNotes.trim(),
      })

      if (alive.current) {
        setEvents((prev) =>
          prev.map((ev) => {
            if (ev.id !== rsvpEvent.id) return ev
            const childInfo = children.find((c) => c.id === targetChildId)
            const updatedRsvp = {
              ...res.rsvp,
              childName: childInfo?.name,
            }
            const existingRsvps = ev.rsvps || []
            const filtered = existingRsvps.filter((r) => r.childId !== targetChildId)
            return {
              ...ev,
              rsvps: [...filtered, updatedRsvp],
            }
          })
        )
        setRsvpEvent(null)
        setFeedback(t.rsvpSubmitted)
      }
    } catch {
      if (alive.current) {
        setRsvpError(t.attendanceSaveError)
      }
    } finally {
      if (alive.current) setSavingRsvp(false)
    }
  }

  const filteredEvents = events.filter((ev) => {
    if (selectedType === 'all') return true
    return ev.eventType === selectedType
  })

  return (
    <section className="panel events-panel" aria-busy={loading}>
      <div className="panel-header">
        <div>
          <h1 tabIndex={-1}>{t.eventsTitle}</h1>
          <p className="subtitle">
            {isStaff ? t.eventsStaffSubtitle : t.eventsParentSubtitle}
          </p>
        </div>
        {isStaff && (
          <button
            type="button"
            className="btn primary"
            onClick={() => setShowForm((v) => !v)}
            aria-expanded={showForm}
          >
            {t.newEventBtn}
          </button>
        )}
      </div>

      {feedback && <div className="notice success-banner" role="status">✓ {feedback}</div>}
      {error && <div className="notice error-banner" role="alert">{error}</div>}

      {/* Staff Event Creation Modal / Drawer */}
      {isStaff && showForm && (
        <form className="card event-form-card" onSubmit={handleCreate}>
          <h2>{t.newEventTitle}</h2>
          {createError && <p className="form-error" role="alert">{createError}</p>}

          <div className="form-grid">
            <div className="form-field full-width">
              <label htmlFor="event-title">{t.eventTitleLabel}</label>
              <input
                id="event-title"
                type="text"
                required
                value={newEvent.title}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, title: e.target.value }))}
                placeholder={t.eventTitlePlaceholder}
              />
            </div>

            <div className="form-field">
              <label htmlFor="event-type">{t.eventTypeLabel}</label>
              <select
                id="event-type"
                value={newEvent.eventType}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, eventType: e.target.value as EventType }))}
              >
                <option value="celebration">{t.typeCelebration}</option>
                <option value="field_trip">{t.typeFieldTrip}</option>
                <option value="conference">{t.typeConference}</option>
                <option value="holiday">{t.typeHoliday}</option>
                <option value="workshop">{t.typeWorkshop}</option>
                <option value="other">{t.typeEventOther}</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="event-group">{t.targetGroup}</label>
              <select
                id="event-group"
                value={newEvent.groupName}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, groupName: e.target.value }))}
              >
                <option value="all">{t.allGroups}</option>
                <option value="Bletët / Bumblebees">Bletët / Bumblebees</option>
                <option value="Fluturat / Butterflies">Fluturat / Butterflies</option>
                <option value="Yjet / Little Stars">Yjet / Little Stars</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="event-date">{t.eventDateLabel}</label>
              <input
                id="event-date"
                type="date"
                required
                value={newEvent.eventDate}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, eventDate: e.target.value }))}
              />
            </div>

            <div className="form-field">
              <label htmlFor="event-end-date">{t.eventEndDateLabel}</label>
              <input
                id="event-end-date"
                type="date"
                value={newEvent.endDate || ''}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, endDate: e.target.value }))}
              />
            </div>

            <div className="form-field">
              <label htmlFor="event-start-time">{t.eventStartTime}</label>
              <input
                id="event-start-time"
                type="time"
                value={newEvent.startTime || ''}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, startTime: e.target.value }))}
              />
            </div>

            <div className="form-field">
              <label htmlFor="event-end-time">{t.eventEndTime}</label>
              <input
                id="event-end-time"
                type="time"
                value={newEvent.endTime || ''}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, endTime: e.target.value }))}
              />
            </div>

            <div className="form-field full-width">
              <label htmlFor="event-location">{t.eventLocation}</label>
              <input
                id="event-location"
                type="text"
                required
                value={newEvent.location}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, location: e.target.value }))}
                placeholder={t.eventLocationPlaceholder}
              />
            </div>

            <div className="form-field full-width">
              <label htmlFor="event-desc">{t.eventDescLabel}</label>
              <textarea
                id="event-desc"
                rows={3}
                required
                value={newEvent.description}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, description: e.target.value }))}
                placeholder={t.eventDescPlaceholder}
              />
            </div>

            <div className="form-field full-width checkbox-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={newEvent.requiresRsvp}
                  onChange={(e) => setNewEvent((prev) => ({ ...prev, requiresRsvp: e.target.checked }))}
                />
                {t.eventRequiresRsvp}
              </label>
            </div>

            <div className="form-field full-width checkbox-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={newEvent.requiresPermissionSlip}
                  onChange={(e) => setNewEvent((prev) => ({ ...prev, requiresPermissionSlip: e.target.checked }))}
                />
                {t.eventRequiresPermissionSlip}
              </label>
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
              {creating ? t.attendanceSaving : t.saveEvent}
            </button>
          </div>
        </form>
      )}

      {/* Category Filter Pills */}
      <div className="category-filter-bar" role="tablist" aria-label={t.filterEventType}>
        {(['all', 'celebration', 'field_trip', 'conference', 'holiday', 'workshop'] as CategoryFilter[]).map((cat) => (
          <button
            key={cat}
            type="button"
            role="tab"
            aria-selected={selectedType === cat}
            className={`filter-pill ${selectedType === cat ? 'active' : ''}`}
            onClick={() => setSelectedType(cat)}
          >
            {cat === 'all' ? t.allEventTypes : getTypeBadge(cat).label}
          </button>
        ))}
      </div>

      {loading && <p role="status">{t.loading}</p>}

      {!loading && filteredEvents.length === 0 && (
        <div className="empty-state">
          <p>{t.noEvents}</p>
        </div>
      )}

      {/* Events List */}
      <div className="events-grid">
        {filteredEvents.map((ev) => {
          const typeInfo = getTypeBadge(ev.eventType)
          const familyRsvps = ev.rsvps || []

          return (
            <article key={ev.id} className="card event-card">
              <div className="event-card-header">
                <div className="event-meta-top">
                  <span className={`badge event-type-badge ${ev.eventType}`}>
                    {typeInfo.icon} {typeInfo.label}
                  </span>
                  {ev.requiresPermissionSlip && (
                    <span className="badge warning-badge">
                      📝 {t.badgeFieldTripSlip}
                    </span>
                  )}
                  <span className="badge group-badge">
                    {ev.groupName === 'all' ? t.allGroups : ev.groupName}
                  </span>
                </div>
                {isStaff && (
                  <button
                    type="button"
                    className="btn ghost small-btn danger-text"
                    onClick={() => handleDelete(ev.id)}
                    title={t.deleteEventBtn}
                  >
                    🗑️
                  </button>
                )}
              </div>

              <h2 className="event-title">{ev.title}</h2>
              <p className="event-description">{ev.description}</p>

              <div className="event-details-row">
                <div className="detail-item">
                  <span className="detail-icon">📅</span>
                  <span className="detail-val">
                    {ev.eventDate}
                    {ev.endDate && ` → ${ev.endDate}`}
                  </span>
                </div>
                {ev.startTime && (
                  <div className="detail-item">
                    <span className="detail-icon">⏰</span>
                    <span className="detail-val">
                      {ev.startTime}
                      {ev.endTime && ` - ${ev.endTime}`}
                    </span>
                  </div>
                )}
                <div className="detail-item">
                  <span className="detail-icon">📍</span>
                  <span className="detail-val">{ev.location}</span>
                </div>
              </div>

              {/* Staff Aggregate Attendance Summary */}
              {isStaff && ev.summary && (
                <div className="event-summary-box">
                  <div className="summary-stat">
                    <span className="stat-count">{ev.summary.attendingCount}</span>
                    <span className="stat-label">{t.summaryAttending}</span>
                  </div>
                  <div className="summary-stat">
                    <span className="stat-count">{ev.summary.declinedCount}</span>
                    <span className="stat-label">{t.summaryDeclined}</span>
                  </div>
                  <div className="summary-stat">
                    <span className="stat-count">{ev.summary.tentativeCount}</span>
                    <span className="stat-label">{t.summaryTentative}</span>
                  </div>
                  {ev.summary.totalAdults > 0 && (
                    <div className="summary-stat">
                      <span className="stat-count">{ev.summary.totalAdults}</span>
                      <span className="stat-label">{t.summaryAdults}</span>
                    </div>
                  )}
                  {ev.requiresPermissionSlip && (
                    <div className="summary-stat highlight">
                      <span className="stat-count">{ev.summary.permissionSignedCount}</span>
                      <span className="stat-label">{t.summarySlipsSigned}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Parent RSVP Section */}
              {isParent && ev.requiresRsvp && (
                <div className="parent-rsvp-box">
                  <div className="rsvp-header">
                    <h4>{t.rsvpTitle}</h4>
                    <button
                      type="button"
                      className="btn secondary small-btn"
                      onClick={() => openRsvpModal(ev)}
                    >
                      {familyRsvps.length > 0 ? '✏️ Ndrysho RSVP / Edit' : `+ ${t.submitRsvp}`}
                    </button>
                  </div>

                  {familyRsvps.length > 0 ? (
                    <div className="family-rsvp-list">
                      {familyRsvps.map((r) => (
                        <div key={r.id} className="family-rsvp-item">
                          <span className="rsvp-child-name">
                            {r.childName || children.find((c) => c.id === r.childId)?.name || 'Child'}
                          </span>
                          <span className={`rsvp-status-badge ${r.status}`}>
                            {r.status === 'attending' && t.rsvpAttending}
                            {r.status === 'declined' && t.rsvpDeclined}
                            {r.status === 'tentative' && t.rsvpTentative}
                          </span>
                          {ev.requiresPermissionSlip && (
                            <span className="permission-status">
                              {r.permissionSigned ? '✓ Leja e nënshkruar' : '⚠️ Pa leje'}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rsvp-prompt">Konfirmoni praninë e fëmijës tuaj për këtë ngjarje.</p>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>

      {/* Parent RSVP Modal Dialog */}
      {rsvpEvent && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rsvp-modal-title">
          <div className="modal-content event-rsvp-modal">
            <h3 id="rsvp-modal-title">{t.rsvpTitle}</h3>
            <p className="modal-subtitle">{rsvpEvent.title}</p>
            {rsvpError && <p className="form-error" role="alert">{rsvpError}</p>}

            <form onSubmit={handleRsvpSubmit}>
              {children.length > 1 && (
                <div className="form-field">
                  <label htmlFor="rsvp-child-select">Fëmija / Child</label>
                  <select
                    id="rsvp-child-select"
                    value={rsvpChildId}
                    onChange={(e) => {
                      const cid = e.target.value
                      setRsvpChildId(cid)
                      const existing = rsvpEvent.rsvps?.find((r) => r.childId === cid)
                      if (existing) {
                        setRsvpStatus(existing.status)
                        setRsvpAdults(existing.attendingAdults || 1)
                        setRsvpPermission(Boolean(existing.permissionSigned))
                        setRsvpNotes(existing.notes || '')
                      }
                    }}
                  >
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-field">
                <label>{t.rsvpStatus}</label>
                <div className="radio-group-horizontal">
                  <label className={`radio-pill ${rsvpStatus === 'attending' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="rsvpStatus"
                      value="attending"
                      checked={rsvpStatus === 'attending'}
                      onChange={() => setRsvpStatus('attending')}
                    />
                    {t.rsvpAttending}
                  </label>
                  <label className={`radio-pill ${rsvpStatus === 'declined' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="rsvpStatus"
                      value="declined"
                      checked={rsvpStatus === 'declined'}
                      onChange={() => setRsvpStatus('declined')}
                    />
                    {t.rsvpDeclined}
                  </label>
                  <label className={`radio-pill ${rsvpStatus === 'tentative' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="rsvpStatus"
                      value="tentative"
                      checked={rsvpStatus === 'tentative'}
                      onChange={() => setRsvpStatus('tentative')}
                    />
                    {t.rsvpTentative}
                  </label>
                </div>
              </div>

              {rsvpStatus === 'attending' && (
                <div className="form-field">
                  <label htmlFor="rsvp-adults">{t.rsvpAdultsCount}</label>
                  <input
                    id="rsvp-adults"
                    type="number"
                    min="1"
                    max="6"
                    value={rsvpAdults}
                    onChange={(e) => setRsvpAdults(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </div>
              )}

              {rsvpEvent.requiresPermissionSlip && rsvpStatus === 'attending' && (
                <div className="form-field permission-slip-card">
                  <label className="checkbox-label permission-checkbox">
                    <input
                      type="checkbox"
                      checked={rsvpPermission}
                      onChange={(e) => setRsvpPermission(e.target.checked)}
                    />
                    <span>
                      <strong>{t.badgeFieldTripSlip}:</strong> {t.rsvpSignPermission}
                    </span>
                  </label>
                </div>
              )}

              <div className="form-field">
                <label htmlFor="rsvp-notes">{t.rsvpNotes}</label>
                <textarea
                  id="rsvp-notes"
                  rows={2}
                  value={rsvpNotes}
                  onChange={(e) => setRsvpNotes(e.target.value)}
                  placeholder={t.rsvpNotesPlaceholder}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setRsvpEvent(null)}
                >
                  {t.cancelAbsence}
                </button>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={savingRsvp}
                >
                  {savingRsvp ? t.attendanceSaving : t.submitRsvp}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
