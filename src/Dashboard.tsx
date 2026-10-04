/* Clear the previous date summary while synchronizing the selected date with the API. */
/* eslint-disable react/set-state-in-effect */
import { useEffect, useState } from 'react'
import { getDashboard, type DashboardSummary } from './api'
import { useAuth } from './auth'
import { useI18n } from './i18n/LanguageContext'
import { localCalendarDate, validDate } from './attendance-date.js'
import { euro } from './pilot-utils'
import ChildAvatar from './ChildAvatar'
export default function Dashboard({ go }: { go: (view: 'attendance' | 'reports' | 'payments' | 'children' | 'program' | 'announcements' | 'messages' | 'absences' | 'meals' | 'incidents' | 'moments', context?: { childId?: string; date?: string }) => void }) {
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
  return <section className="panel"><p>{t.welcome}, {user.name}</p><h1>{user.role === 'parent' ? t.dashParent : user.role === 'teacher' ? t.dashTeacher : t.dashDirector}</h1><p>{user.role === 'parent' ? t.dashParentBody : user.role === 'teacher' ? t.dashTeacherBody : t.dashDirectorBody}</p>
    <div className="filters"><label>{t.attendanceDate}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><button className="btn ghost" onClick={() => setDate(localCalendarDate())}>{t.attendanceToday}</button></div>
    {!validDate(date) && <p role="alert">{t.attendanceInvalidDate}</p>}
    {!summary && !error && validDate(date) && <p role="status">{t.loading}</p>}
    {error && <p role="alert" className="form-error">{t.loadError}<button onClick={() => setRetry((v) => v + 1)}>{t.attendanceRetry}</button></p>}
    {summary && <><div className="metrics">{[[t.dashChildren, summary.children, '👶'], [t.attendancePresent, summary.present, '✅'], [t.attendanceAbsent, summary.absent, '🏠'], [t.attendanceUnmarked, summary.unmarked, '⏳'], [t.dashReports, `${summary.reports} / ${summary.children}`, '📝'], [t.dashUnpaid, `${summary.unpaidInvoices} · ${summary.unpaidBalances.map((balance) => euro(balance.amountCents, lang, balance.currency)).join(' · ')}`, '💶']].map(([label, value, icon]) => <article key={label}><h2><span className="metric-icon" aria-hidden="true">{icon}</span> {label}</h2><strong>{value}</strong></article>)}</div>
      {user.role === 'parent' && summary.childSummaries.map((child) => <article className="roster-card" key={child.id}><div className="card-avatar-heading"><ChildAvatar name={child.name} size={42} /><div><h2>{child.name}</h2><p className="card-subtitle">{child.groupName}</p></div></div>{child.allergies && <p className="allergy-badge">⚠️ <strong>{t.allergies}:</strong> {child.allergies}</p>}<p>{t.attendanceTitle}: {child.attendanceStatus === 'present' ? t.attendancePresent : child.attendanceStatus === 'absent' ? t.attendanceAbsent : t.attendanceUnmarked}</p><p>{t.navReports}: {child.hasReport ? t.attendanceSaved : t.reportEmpty}</p><p>{t.permission}: {child.photoConsent ? t.allowed : t.notAllowed}</p><button className="btn ghost" onClick={() => go('reports', { childId: child.id, date })}>{t.dashRead}</button></article>)}
    </>}
    <div className="actions"><button className="btn primary" onClick={() => go(user.role === 'parent' ? 'reports' : 'attendance', { date })}>{user.role === 'parent' ? t.dashRead : t.attendanceTitle}</button><button className="btn ghost" onClick={() => go(user.role === 'parent' ? 'attendance' : 'reports', { date })}>{user.role === 'parent' ? t.attendanceTitle : t.dashWrite}</button><button className="btn ghost" onClick={() => go('program', { date })}>{t.navProgram}</button><button className="btn ghost" onClick={() => go('announcements')}>{t.navAnnouncements}</button><button className="btn ghost" onClick={() => go('absences')}>{t.navAbsences}</button><button className="btn ghost" onClick={() => go('meals')}>{t.navMeals}</button><button className="btn ghost" onClick={() => go('incidents')}>{t.navIncidents}</button><button className="btn ghost" onClick={() => go('moments')}>{t.navMoments}</button><button className="btn ghost" onClick={() => go('messages')}>{t.navMessages}</button><button className="btn ghost" onClick={() => go('payments')}>{t.paymentsTitle}</button><button className="btn ghost" onClick={() => go('children')}>{user.role === 'parent' ? t.consentTitle : t.childrenTitle}</button></div>
  </section>
}
