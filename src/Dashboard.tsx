/* Clear the previous date summary while synchronizing the selected date with the API. */
/* eslint-disable react/set-state-in-effect */
import { useEffect, useState } from 'react'
import { getDashboard, type DashboardSummary } from './api'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import { localCalendarDate, validDate } from './attendance-date.js'
import { euro } from './pilot-utils'
import ChildAvatar from './ChildAvatar'
import Icon, { type IconName } from './Icon'

type Destination = 'attendance' | 'reports' | 'payments' | 'children' | 'program' | 'announcements' | 'messages' | 'absences' | 'meals' | 'incidents' | 'moments' | 'events' | 'staff' | 'milestones'

function PlaygroundArt() {
  return <svg className="playground-art" viewBox="0 0 320 210" fill="none" aria-hidden="true" focusable="false">
    <path d="M60 143a90 90 0 0 1 180 0" stroke="#efa888" strokeWidth="22" />
    <path d="M84 143a66 66 0 0 1 132 0" stroke="#f5cc78" strokeWidth="19" />
    <path d="M106 143a44 44 0 0 1 88 0" stroke="#acc7b5" strokeWidth="18" />
    <path d="M126 143a24 24 0 0 1 48 0" stroke="#bfb0dd" strokeWidth="15" />
    <g stroke="#e9bd64" strokeWidth="4" strokeLinecap="round"><path d="M266 13v8M266 77v8M230 49h8M294 49h8M241 24l6 6M287 68l6 6M241 74l6-6M287 30l6-6" /></g>
    <circle cx="266" cy="49" r="23" fill="#f6ce78" /><path d="M258 48v2M274 48v2M259 58q7 7 14 0" stroke="#8e663f" strokeWidth="3" strokeLinecap="round" />
    <path d="M30 141c-14-1-22-17-13-28 5-7 13-8 21-5 3-20 35-24 44-3 25-4 31 28 7 36H30Z" fill="white" />
    <path d="M213 149c-12-2-16-15-10-23 5-6 12-6 17-4 4-17 28-19 36-2 22-3 27 23 8 29h-51Z" fill="white" />
    <ellipse cx="166" cy="190" rx="136" ry="9" fill="#eddfbd" />
    <g transform="rotate(-8 73 167)"><rect x="42" y="141" width="52" height="48" rx="12" fill="#d6e9e0" /><path d="M57 164v3M77 164v3M61 177q7 5 13-1" stroke="#527b69" strokeWidth="3" strokeLinecap="round" /></g>
    <g transform="rotate(7 129 164)"><rect x="104" y="137" width="51" height="52" rx="11" fill="#dbd0ec" /><path d="M118 160v3M139 160v3M123 174q6 5 12-1" stroke="#766090" strokeWidth="3" strokeLinecap="round" /></g>
    <rect x="166" y="145" width="50" height="45" rx="11" fill="#f2b39c" /><path d="M181 160v3M200 160v3M186 173q6 5 12 0" stroke="#a4533b" strokeWidth="3" strokeLinecap="round" />
    <path d="M259 183v-29M259 170c-15 0-20-7-20-14 12 0 19 4 20 14ZM260 164c1-13 8-19 18-18 0 10-6 16-18 18Z" fill="#8eaf98" />
    <g fill="#f0b9ba"><circle cx="259" cy="136" r="8" /><circle cx="247" cy="147" r="8" /><circle cx="271" cy="147" r="8" /><circle cx="259" cy="157" r="8" /></g><circle cx="259" cy="147" r="7" fill="#f8d686" />
    <path d="m29 50 4 9 10 2-8 7 1 10-9-5-9 4 2-10-7-7 10-1 6-9Z" fill="#b7cdd8" />
  </svg>
}

export default function Dashboard({ go }: { go: (view: Destination, context?: { childId?: string; date?: string }) => void }) {
  const { user, token } = useAuth()
  const { t, lang } = useI18n()
  const [date, setDate] = useState(localCalendarDate)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [search, setSearch] = useState('')
  useEffect(() => {
    let cancelled = false
    setSummary(null); setError(false)
    if (token && validDate(date)) void getDashboard(token, date).then((data) => { if (!cancelled) setSummary(data.summary) }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [token, date, retry])
  if (!user) return null
  const parent = user.role === 'parent'
  const metrics: { label: string; value: string | number; icon: IconName; tone: string }[] = summary ? [
    { label: t.dashChildren, value: summary.children, icon: 'children', tone: 'green' },
    { label: t.attendancePresent, value: summary.present, icon: 'check', tone: 'green' },
    { label: t.attendanceAbsent, value: summary.absent, icon: 'absences', tone: 'rose' },
    { label: t.attendanceUnmarked, value: summary.unmarked, icon: 'clock', tone: 'amber' },
    { label: t.dashReports, value: `${summary.reports} / ${summary.children}`, icon: 'reports', tone: 'violet' },
    { label: t.dashUnpaid, value: summary.unpaidInvoices, icon: 'payments', tone: 'amber' },
  ] : []
  const shortcuts: { view: Destination; label: string; body: string; icon: IconName }[] = [
    { view: parent ? 'reports' : 'attendance', label: parent ? t.dashRead : t.attendanceTitle, body: parent ? t.reportsHint : t.attendanceHint, icon: parent ? 'reports' : 'attendance' },
    { view: parent ? 'attendance' : 'reports', label: parent ? t.attendanceTitle : t.dashWrite, body: parent ? t.attendanceHint : t.reportsHint, icon: parent ? 'attendance' : 'reports' },
    { view: 'payments', label: t.paymentsTitle, body: t.paymentsHint, icon: 'payments' },
  ]
  const children = summary?.childSummaries.filter((child) => `${child.name} ${child.groupName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) || []
  const statusLabel = (status: string | null) => status === 'present' ? t.attendancePresent : status === 'absent' ? t.attendanceAbsent : t.attendanceUnmarked
  const tasks: { view: Destination; label: string; count: number; detail: string; icon: IconName }[] = summary ? [
    { view: 'attendance', label: t.recordAttendance, count: summary.unmarked, detail: t.childrenToMark, icon: 'attendance' },
    { view: 'reports', label: t.finishReports, count: Math.max(0, summary.children - summary.reports), detail: t.reportsToWrite, icon: 'reports' },
    { view: 'payments', label: t.reviewInvoices, count: summary.unpaidInvoices, detail: t.dashUnpaid, icon: 'payments' },
  ] : []

  return <section className="panel dashboard-panel">
    <div className="dashboard-heading">
      <div className="welcome-copy"><p className="page-eyebrow"><Icon name="sun" size={17} />{parent ? t.dashParent : user.role === 'teacher' ? t.dashTeacher : t.dashDirector}</p><h1>{t.welcome}, {user.name.split(' ')[0]}!</h1><p className="panel-sub">{parent ? t.dashParentBody : user.role === 'teacher' ? t.dashTeacherBody : t.dashDirectorBody}</p></div>
      <span className="welcome-message">{t.careTogether}</span>
      <div className="welcome-side"><PlaygroundArt />
      <div className="dashboard-date filters"><label>{t.attendanceDate}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><button className="btn ghost" onClick={() => setDate(localCalendarDate())}>{t.attendanceToday}</button></div></div>
    </div>
    <div className="overview-caption"><span><Icon name="dashboard" size={16} />{t.dailySnapshot}</span><small>{t.snapshotHint}</small></div>
    {!validDate(date) && <p className="form-error" role="alert">{t.attendanceInvalidDate}</p>}
    {!summary && !error && validDate(date) && <div className="dashboard-loading" role="status"><span className="loading-dot" />{t.loading}</div>}
    {error && <div role="alert" className="error-state"><p>{t.loadError}</p><button className="btn ghost" onClick={() => setRetry((v) => v + 1)}>{t.attendanceRetry}</button></div>}
    {summary && <>
      <div className="metrics">{metrics.map((metric) => <article className={`metric-card tone-${metric.tone}`} key={metric.label}><div className="metric-top"><h2>{metric.label}</h2><span className="metric-icon"><Icon name={metric.icon} size={20} /></span></div><strong>{metric.value}</strong>{metric.icon === 'payments' && <p className="metric-detail">{summary.unpaidBalances.map((balance) => euro(balance.amountCents, lang, balance.currency)).join(' · ') || '—'}</p>}</article>)}</div>
      {parent ? <>
        <div className="section-title"><h2>{t.familyOverview}</h2><span>{date}</span></div>
        <div className="family-grid">{summary.childSummaries.map((child) => <article className="roster-card family-card" key={child.id}>
          <div className="card-avatar-heading"><ChildAvatar name={child.name} size={44} /><div><h2>{child.name}</h2><p className="card-subtitle">{child.groupName}</p></div><Icon name="leaf" size={22} /></div>
          {child.allergies && <p className="allergy-badge"><span aria-hidden="true">⚠️ </span><strong>{t.allergies}:</strong> {child.allergies}</p>}
          <div className="family-statuses"><div><span>{t.attendanceTitle}</span><strong className={`attendance-status ${child.attendanceStatus || 'unmarked'}`}>{statusLabel(child.attendanceStatus)}</strong></div><div><span>{t.navReports}</span><strong className={child.hasReport ? 'record-ready' : 'record-waiting'}>{child.hasReport ? t.reportReady : t.reportEmpty}</strong></div><div><span>{t.permission}</span><strong>{child.photoConsent ? t.allowed : t.notAllowed}</strong></div></div>
          <button className="btn ghost" onClick={() => go('reports', { childId: child.id, date })}>{t.dashRead}<Icon name="arrow" size={16} /></button>
        </article>)}</div>
      </> : <div className="dashboard-work-grid">
        <section className="work-section">
          <div className="section-title"><h2>{t.nextUp}</h2><span>{t.selectedDay}</span></div>
          <div className="task-list">{tasks.map((task) => <button type="button" className="task-row" key={task.view} onClick={() => go(task.view, { date })}>
            <span className={`task-symbol ${task.count === 0 ? 'is-complete' : ''}`}><Icon name={task.count === 0 ? 'check' : task.icon} size={18} /></span><span className="task-copy"><strong>{task.label}</strong><small>{task.count ? `${task.count} · ${task.detail}` : t.upToDate}</small></span><span className={`task-count ${task.count === 0 ? 'is-complete' : ''}`}>{task.count}</span><Icon name="arrow" size={16} />
          </button>)}</div>
        </section>
        <section className="work-section day-note">
          <div className="section-title"><h2>{t.dayReadiness}</h2><Icon name="check" size={17} /></div>
          {[{ label: t.attendanceTitle, count: summary.present + summary.absent, total: summary.children }, { label: t.navReports, count: summary.reports, total: summary.children }].map((item) => <div className="readiness-item" key={item.label}><div><span>{item.label}</span><strong>{item.count} / {item.total}</strong></div><div className="progress-track" role="progressbar" aria-label={item.label} aria-valuenow={item.total ? Math.round(item.count / item.total * 100) : 0} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${item.total ? item.count / item.total * 100 : 0}%` }} /></div></div>)}
          <button type="button" className="text-action" onClick={() => go('program', { date })}><Icon name="program" size={16} />{t.navProgram}<Icon name="arrow" size={16} /></button>
        </section>
      </div>}
      {!parent && <section className="day-register">
        <div className="section-title"><h2>{t.childrenToday}<span className="section-count">{summary.children}</span></h2><label className="search-field"><Icon name="search" size={17} /><input type="search" aria-label={t.searchChildren} placeholder={t.searchChildren} value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
        <div className="day-children-grid">{children.map((child) => <article className="day-child-card" key={child.id}>
          <div className="register-child"><ChildAvatar name={child.name} size={48} /><div><h3>{child.name}</h3><small>{child.groupName}</small></div></div>
          {child.allergies && <p className="allergy-badge"><span aria-hidden="true">⚠️ </span><strong>{t.allergies}:</strong> {child.allergies}</p>}
          <div className="day-child-status"><div><span>{t.attendanceTitle}</span><span className={`attendance-status ${child.attendanceStatus || 'unmarked'}`}>{statusLabel(child.attendanceStatus)}</span></div><div><span>{t.navReports}</span><span className={child.hasReport ? 'record-ready' : 'record-waiting'}><Icon name={child.hasReport ? 'check' : 'clock'} size={14} />{child.hasReport ? t.reportReady : t.notWritten}</span></div></div>
          <button type="button" className="row-action" aria-label={`${child.hasReport ? t.dashRead : t.dashWrite} · ${child.name}`} onClick={() => go('reports', { childId: child.id, date })}>{child.hasReport ? t.dashRead : t.dashWrite}<Icon name="arrow" size={16} /></button>
        </article>)}</div>
        {!children.length && <div className="empty-hint"><p>{summary.children ? t.noSearchResults : t.attendanceEmpty}</p>{summary.children > 0 && <button className="btn ghost" onClick={() => setSearch('')}>{t.clearSearch}</button>}</div>}
      </section>}
    </>}
    <div className="section-title"><h2>{t.quickActions}</h2></div><div className="quick-actions">{shortcuts.map((shortcut) => <button className="quick-action" aria-label={shortcut.label} key={shortcut.view} onClick={() => go(shortcut.view, { date })}><span className="quick-icon"><Icon name={shortcut.icon} size={21} /></span><span><strong>{shortcut.label}</strong><small>{shortcut.body}</small></span><Icon name="arrow" size={17} /></button>)}</div>
  </section>
}
