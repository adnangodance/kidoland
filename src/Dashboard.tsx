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

export default function Dashboard({ go }: { go: (view: Destination, context?: { childId?: string; date?: string }) => void }) {
  const { user, token } = useAuth()
  const { t, lang } = useI18n()
  const [date, setDate] = useState(localCalendarDate)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
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
  const marked = summary ? summary.present + summary.absent : 0
  const attendancePercent = summary?.children ? Math.round(marked / summary.children * 100) : 0
  const reportPercent = summary?.children ? Math.round(summary.reports / summary.children * 100) : 0
  const shortcuts: { view: Destination; label: string; body: string; icon: IconName }[] = [
    { view: parent ? 'reports' : 'attendance', label: parent ? t.dashRead : t.attendanceTitle, body: parent ? t.reportsHint : t.attendanceHint, icon: parent ? 'reports' : 'attendance' },
    { view: parent ? 'attendance' : 'reports', label: parent ? t.attendanceTitle : t.dashWrite, body: parent ? t.attendanceHint : t.reportsHint, icon: parent ? 'attendance' : 'reports' },
    { view: 'payments', label: t.paymentsTitle, body: t.paymentsHint, icon: 'payments' },
  ]

  return <section className="panel dashboard-panel">
    <div className="dashboard-heading"><div><p className="page-eyebrow"><Icon name="sun" size={18} />{t.welcome}, {user.name.split(' ')[0]}</p><h1>{parent ? t.dashParent : user.role === 'teacher' ? t.dashTeacher : t.dashDirector}</h1><p className="panel-sub">{parent ? t.dashParentBody : user.role === 'teacher' ? t.dashTeacherBody : t.dashDirectorBody}</p></div><div className="dashboard-date filters"><label>{t.attendanceDate}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><button className="btn ghost" onClick={() => setDate(localCalendarDate())}>{t.attendanceToday}</button></div></div>
    <div className="dashboard-welcome"><div><span>{t.dayOverview}</span><h2>{t.careTogether}</h2><p>{t.snapshotHint}</p></div><div className="welcome-art" aria-hidden="true"><Icon name="sun" size={42} /><Icon name="leaf" size={70} /></div></div>
    <div className="section-title"><h2>{t.dailySnapshot}</h2><span>{t.snapshotHint}</span></div>
    {!validDate(date) && <p className="form-error" role="alert">{t.attendanceInvalidDate}</p>}
    {!summary && !error && validDate(date) && <div className="dashboard-loading" role="status"><span className="loading-dot" />{t.loading}</div>}
    {error && <div role="alert" className="error-state"><p>{t.loadError}</p><button className="btn ghost" onClick={() => setRetry((v) => v + 1)}>{t.attendanceRetry}</button></div>}
    {summary && <>
      <div className="metrics">{metrics.map((metric) => <article key={metric.label}><div className="metric-top"><h2>{metric.label}</h2><span className={`metric-icon tone-${metric.tone}`}><Icon name={metric.icon} size={19} /></span></div><strong>{metric.value}</strong>{metric.icon === 'payments' && <p className="metric-detail">{summary.unpaidBalances.map((balance) => euro(balance.amountCents, lang, balance.currency)).join(' · ') || '—'}</p>}</article>)}</div>
      {parent ? <><div className="section-title"><h2>{t.familyOverview}</h2></div><div className="family-grid">{summary.childSummaries.map((child) => <article className="roster-card family-card" key={child.id}><div className="card-avatar-heading"><ChildAvatar name={child.name} size={48} /><div><h2>{child.name}</h2><p className="card-subtitle">{child.groupName}</p></div></div>{child.allergies && <p className="allergy-badge"><strong>{t.allergies}:</strong> {child.allergies}</p>}<div className="family-statuses"><div><span>{t.attendanceTitle}</span><strong className={`attendance-status ${child.attendanceStatus || 'unmarked'}`}>{child.attendanceStatus === 'present' ? t.attendancePresent : child.attendanceStatus === 'absent' ? t.attendanceAbsent : t.attendanceUnmarked}</strong></div><div><span>{t.navReports}</span><strong>{child.hasReport ? t.attendanceSaved : t.reportEmpty}</strong></div><div><span>{t.permission}</span><strong>{child.photoConsent ? t.allowed : t.notAllowed}</strong></div></div><button className="btn ghost" onClick={() => go('reports', { childId: child.id, date })}>{t.dashRead}<Icon name="arrow" size={17} /></button></article>)}</div></> : <div className="summary-grid">
        <article className="summary-card"><div className="section-title"><h2>{t.attendanceOverview}</h2><Icon name="attendance" /></div><div className="progress-headline"><strong>{marked}<span> / {summary.children}</span></strong><span>{t.childrenMarked}</span></div><div className="progress-track" role="progressbar" aria-label={t.attendanceOverview} aria-valuenow={attendancePercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${attendancePercent}%` }} /></div><div className="attendance-legend"><span><i className="legend-present" />{t.attendancePresent} <strong>{summary.present}</strong></span><span><i className="legend-absent" />{t.attendanceAbsent} <strong>{summary.absent}</strong></span><span><i className="legend-unmarked" />{t.attendanceUnmarked} <strong>{summary.unmarked}</strong></span></div><button className="text-action" onClick={() => go('attendance', { date })}>{t.reviewAttendance}<Icon name="arrow" size={17} /></button></article>
        <article className="summary-card"><div className="section-title"><h2>{t.reportProgress}</h2><Icon name="reports" /></div><div className="progress-headline"><strong>{summary.reports}<span> / {summary.children}</span></strong><span>{t.reportsReady}</span></div><div className="progress-track violet" role="progressbar" aria-label={t.reportProgress} aria-valuenow={reportPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${reportPercent}%` }} /></div><p className="summary-description">{t.reportsHint}</p><button className="text-action" onClick={() => go('reports', { date })}>{t.reviewReports}<Icon name="arrow" size={17} /></button></article>
      </div>}
    </>}
    <div className="section-title"><h2>{t.quickActions}</h2></div><div className="quick-actions">{shortcuts.map((shortcut) => <button className="quick-action" aria-label={shortcut.label} key={shortcut.view} onClick={() => go(shortcut.view, { date })}><span className="quick-icon"><Icon name={shortcut.icon} size={23} /></span><span><strong>{shortcut.label}</strong><small>{shortcut.body}</small></span><Icon name="arrow" size={18} /></button>)}</div>
  </section>
}
