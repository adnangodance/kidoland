/* eslint-disable react/set-state-in-effect */
import { useEffect, useState } from 'react'
import {
  getTimeline,
  listChildren,
  type Child,
  type TimelineEvent,
  type TimelineResponse,
  type TimelineCategory,
} from './api'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import { localCalendarDate } from './attendance-date.js'
import ChildAvatar from './ChildAvatar'
import { SeaGodanciBadge } from './child-highlight'
import { isSeaGodanci } from './child-highlight-util'
import Icon, { type IconName } from './Icon'

const categoryColors: Record<TimelineCategory, { bg: string; text: string; border: string }> = {
  arrival: { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' },
  departure: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
  health: { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' },
  hygiene: { bg: '#fef3c7', text: '#b45309', border: '#fde68a' },
  sleep: { bg: '#f3e8ff', text: '#7e22ce', border: '#e9d5ff' },
  medication: { bg: '#ffe4e6', text: '#be123c', border: '#fecdd3' },
  moment: { bg: '#fdf4ff', text: '#a21caf', border: '#f5d0fe' },
  report: { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' },
  incident: { bg: '#fee2e2', text: '#b91c1c', border: '#fca5a5' },
}

export function DailyTimeline({ initialChildId, initialDate }: { initialChildId?: string; initialDate?: string }) {
  const { token, user } = useAuth()
  const { t } = useI18n()
  const [children, setChildren] = useState<Child[]>([])
  const [selectedChildId, setSelectedChildId] = useState<string>(initialChildId || '')
  const [date, setDate] = useState<string>(initialDate || localCalendarDate())
  const [data, setData] = useState<TimelineResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'care' | 'health' | 'story'>('all')

  // Load child roster
  useEffect(() => {
    if (!token) return
    const ac = new AbortController()
    listChildren(token)
      .then((res) => {
        setChildren(res.children)
        if (!selectedChildId && res.children.length > 0) {
          setSelectedChildId(res.children[0].id)
        }
      })
      .catch(() => {
        // roster load failure handled by empty list
      })
    return () => ac.abort()
  }, [token, selectedChildId])

  // Load timeline data
  useEffect(() => {
    if (!token || !selectedChildId) return
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    getTimeline(token, selectedChildId, date, ac.signal)
      .then((res) => {
        setData(res)
        setLoading(false)
      })
      .catch((err) => {
        if (ac.signal.aborted) return
        setError(err.message || 'Error loading timeline')
        setLoading(false)
      })
    return () => ac.abort()
  }, [token, selectedChildId, date])

  const selectedChild = children.find((c) => c.id === selectedChildId)
  const isSea = isSeaGodanci(selectedChild?.name)

  const filteredEvents = (data?.timeline || []).filter((event) => {
    if (filter === 'all') return true
    if (filter === 'care') return ['arrival', 'departure', 'hygiene', 'sleep'].includes(event.category)
    if (filter === 'health') return ['health', 'medication', 'incident'].includes(event.category)
    if (filter === 'story') return ['moment', 'report'].includes(event.category)
    return true
  })

  return (
    <section className={`panel ${data ? 'timeline-panel' : 'timeline-loading'}`} style={{ maxWidth: '100%', boxSizing: 'border-box' }}>
      <header className="panel-header">
        <div>
          <h1>{t.timelineTitle}</h1>
          <p className="panel-sub">
            {user?.role === 'parent' ? t.timelineParentSubtitle : t.timelineStaffSubtitle}
          </p>
        </div>
      </header>

      {/* Child and date selector controls */}
      <div className="filters" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {children.length > 1 && (
          <label style={{ minWidth: '180px', flex: '1 1 200px' }}>
            {t.timelineSelectChild}
            <select
              value={selectedChildId}
              onChange={(e) => setSelectedChildId(e.target.value)}
              disabled={loading}
              style={{ width: '100%' }}
            >
              {children.map((child) => (
                <option key={child.id} value={child.id}>
                  {isSeaGodanci(child.name) ? '⭐ ' : ''}
                  {child.name} · {child.groupName}
                </option>
              ))}
            </select>
          </label>
        )}

        <label style={{ minWidth: '140px', flex: '1 1 150px' }}>
          {t.attendanceDate}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={loading}
            style={{ width: '100%' }}
          />
        </label>

        <button
          type="button"
          className="btn ghost"
          onClick={() => setDate(localCalendarDate())}
          style={{ alignSelf: 'flex-end', height: '42px' }}
        >
          {t.attendanceToday}
        </button>
      </div>

      {/* Child Info Banner with Highlight */}
      {selectedChild && (
        <div
          className={`roster-card ${isSea ? 'sea-godanci-card' : ''}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            padding: '1rem',
            borderRadius: '12px',
            marginBottom: '1.25rem',
          }}
        >
          <ChildAvatar name={selectedChild.name} size={48} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              {selectedChild.name}
              <SeaGodanciBadge name={selectedChild.name} />
            </h2>
            <p style={{ margin: '0.25rem 0 0', opacity: 0.8, fontSize: '0.9rem' }}>
              {selectedChild.groupName} · {date}
            </p>
          </div>
        </div>
      )}

      {/* Summary Highlights */}
      {data && (
        <div
          className="metrics"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1.25rem',
          }}
        >
          <article className="metric-card tone-emerald">
            <div className="metric-top">
              <h2>{t.timelineTotalEvents}</h2>
              <span className="metric-icon"><Icon name="clock" size={18} /></span>
            </div>
            <strong>{data.summary.totalEvents}</strong>
          </article>

          <article className="metric-card tone-green">
            <div className="metric-top">
              <h2>{t.timelineCheckInTime}</h2>
              <span className="metric-icon"><Icon name="check" size={18} /></span>
            </div>
            <strong>{data.summary.checkInTime || '—'}</strong>
          </article>

          <article className="metric-card tone-purple">
            <div className="metric-top">
              <h2>{t.timelineNapTime}</h2>
              <span className="metric-icon"><Icon name="sleep" size={18} /></span>
            </div>
            <strong>{data.summary.napMinutes ? `${data.summary.napMinutes}m` : '—'}</strong>
          </article>

          <article className="metric-card tone-amber">
            <div className="metric-top">
              <h2>{t.timelineHygieneChanges}</h2>
              <span className="metric-icon"><Icon name="hygiene" size={18} /></span>
            </div>
            <strong>{data.summary.hygieneCount}</strong>
          </article>
        </div>
      )}

      {/* Filter Tabs */}
      <div
        className="filter-chips"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '1.25rem',
        }}
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={`btn ${filter === 'all' ? 'primary' : 'ghost'}`}
          onClick={() => setFilter('all')}
          style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
        >
          {t.timelineFilterAll}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'care'}
          className={`btn ${filter === 'care' ? 'primary' : 'ghost'}`}
          onClick={() => setFilter('care')}
          style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
        >
          {t.timelineFilterCare}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'health'}
          className={`btn ${filter === 'health' ? 'primary' : 'ghost'}`}
          onClick={() => setFilter('health')}
          style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
        >
          {t.timelineFilterHealth}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'story'}
          className={`btn ${filter === 'story' ? 'primary' : 'ghost'}`}
          onClick={() => setFilter('story')}
          style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
        >
          {t.timelineFilterStory}
        </button>
      </div>

      {/* Loading & Error States */}
      {loading && (
        <div className="dashboard-loading" role="status" style={{ padding: '2rem 1rem' }}>
          <span className="loading-dot" />
          {t.loading}
        </div>
      )}

      {error && !loading && (
        <div role="alert" className="error-state" style={{ padding: '1.5rem', textAlign: 'center' }}>
          <p>{error}</p>
          <button type="button" className="btn ghost" onClick={() => setDate(date)}>
            {t.attendanceRetry}
          </button>
        </div>
      )}

      {/* Timeline Stream */}
      {!loading && !error && filteredEvents.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', opacity: 0.75 }}>
          <Icon name="clock" size={40} />
          <p style={{ marginTop: '1rem' }}>{t.timelineEmpty}</p>
        </div>
      )}

      {!loading && !error && filteredEvents.length > 0 && (
        <ol
          className="timeline-stream"
          style={{
            position: 'relative',
            listStyle: 'none',
            padding: 0,
            margin: '0 0 1.5rem',
          }}
        >
          {filteredEvents.map((event: TimelineEvent) => {
            const colors = categoryColors[event.category] || { bg: '#f1f5f9', text: '#334155', border: '#e2e8f0' }
            return (
              <li
                key={event.id}
                className="timeline-item"
                style={{
                  display: 'flex',
                  gap: '1rem',
                  position: 'relative',
                  paddingBottom: '1.75rem',
                }}
              >
                {/* Time Indicator & Category Dot */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    minWidth: '55px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.825rem',
                      fontWeight: 700,
                      color: 'var(--text-muted, #64748b)',
                      marginBottom: '0.35rem',
                    }}
                  >
                    {event.time}
                  </span>
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      backgroundColor: colors.bg,
                      color: colors.text,
                      border: `2px solid ${colors.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name={event.icon as IconName} size={18} />
                  </div>
                </div>

                {/* Event Content Card */}
                <article
                  className={`roster-card timeline-card ${isSea ? 'sea-godanci-card' : ''}`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '1rem',
                    borderRadius: '12px',
                    margin: 0,
                  }}
                >
                  <header
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <h3
                      style={{
                        margin: 0,
                        fontSize: '1rem',
                        fontWeight: 700,
                        lineHeight: 1.3,
                        color: 'var(--text-primary, #0f172a)',
                      }}
                    >
                      {event.title}
                    </h3>
                    {event.badge && (
                      <span
                        className="badge"
                        style={{
                          backgroundColor: colors.bg,
                          color: colors.text,
                          border: `1px solid ${colors.border}`,
                          padding: '0.2rem 0.55rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        {event.badge}
                      </span>
                    )}
                  </header>

                  <p
                    style={{
                      margin: '0 0 0.5rem',
                      fontSize: '0.925rem',
                      lineHeight: 1.5,
                      color: 'var(--text-secondary, #334155)',
                      whiteSpace: 'pre-line',
                    }}
                  >
                    {event.description}
                  </p>

                  {event.imageUrl && (
                    <div style={{ marginTop: '0.75rem', maxWidth: '100%', overflow: 'hidden', borderRadius: '8px' }}>
                      <img
                        src={event.imageUrl}
                        alt={event.title}
                        style={{
                          width: '100%',
                          maxHeight: '260px',
                          objectFit: 'cover',
                          display: 'block',
                          borderRadius: '8px',
                        }}
                      />
                    </div>
                  )}

                  {event.author && (
                    <footer
                      style={{
                        marginTop: '0.5rem',
                        fontSize: '0.8rem',
                        opacity: 0.75,
                        fontStyle: 'italic',
                      }}
                    >
                      ✍️ {event.author}
                    </footer>
                  )}
                </article>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
export default DailyTimeline
