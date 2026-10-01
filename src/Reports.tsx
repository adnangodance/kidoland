/* Network effects reset pending UI and invalidate generation counters on context/unmount changes. */
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { listChildren, listReports, saveReport, type Child, type Report } from './api'
import { useAuth } from './auth'
import { useI18n } from './i18n/LanguageContext'
import { localCalendarDate, validDate } from './attendance-date.js'
import { displayDate, useAlive } from './pilot-utils'

const options = {
  mood: [['mood:happy', 'moodHappy'], ['mood:calm', 'moodCalm'], ['mood:tired', 'moodTired'], ['mood:upset', 'moodUpset']],
  meals: [['meals:all', 'mealsAll'], ['meals:some', 'mealsSome'], ['meals:little', 'mealsLittle']],
  nap: [['nap:none', 'napNone'], ['nap:short', 'napShort'], ['nap:long', 'napLong']],
  activities: [['activity:outdoor', 'activityOutdoor'], ['activity:art', 'activityArt'], ['activity:stories', 'activityStories'], ['activity:music', 'activityMusic'], ['activity:free', 'activityFree']],
} as const
const empty = { mood: '', meals: '', nap: '', activities: '', note: '' }
export default function Reports({ initialChildId, initialDate }: { initialChildId?: string; initialDate?: string }) {
  const { token, user } = useAuth()
  const { t, lang } = useI18n()
  const alive = useAlive()
  const generation = useRef(0)
  const [children, setChildren] = useState<Child[]>([])
  const [childId, setChildId] = useState(initialChildId || '')
  const [date, setDate] = useState(() => initialDate || localCalendarDate())
  const [draft, setDraft] = useState(empty)
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [rosterReady, setRosterReady] = useState(false)
  const [rosterError, setRosterError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const canWrite = user?.role !== 'parent'
  useEffect(() => {
    let cancelled = false
    setRosterReady(false); setRosterError(false)
    if (token) void listChildren(token).then(({ children: rows }) => { if (!cancelled) { setChildren(rows); setChildId((id) => rows.some((c) => c.id === id) ? id : rows[0]?.id || ''); setRosterReady(true) } }).catch(() => { if (!cancelled) { setRosterError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [token, retry])
  useEffect(() => {
    const version = ++generation.current
    setReports([]); setDraft(empty); setError(''); setSaved(false)
    if (!rosterReady || !token) return
    if (!validDate(date)) { setLoading(false); return }
    setLoading(true)
    void listReports(token, childId || undefined, date).then(({ reports: rows }) => {
      if (!alive.current || version !== generation.current) return
      setReports(rows)
      if (rows[0] && childId) { const { mood, meals, nap, activities, note } = rows[0]; setDraft({ mood, meals, nap, activities, note }) }
    }).catch(() => { if (alive.current && version === generation.current) setError('load') }).finally(() => { if (alive.current && version === generation.current) setLoading(false) })
    return () => { generation.current++ }
  }, [token, childId, date, rosterReady])
  function changeContext(nextChild: string, nextDate: string) {
    generation.current++
    setReports([]); setDraft(empty); setSaved(false); setError(''); setLoading(true)
    setChildId(nextChild); setDate(nextDate)
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!token || busy || loading || !validDate(date)) return
    const version = generation.current
    setBusy(true); setSaved(false); setError('')
    try {
      const { report } = await saveReport(token, { ...draft, childId, reportDate: date })
      if (alive.current && version === generation.current) { setReports([report]); setSaved(true) }
    } catch { if (alive.current && version === generation.current) setError('save') }
    finally { if (alive.current) setBusy(false) }
  }
  function translated(value: string) {
    const all = Object.values(options).flat()
    const legacy: Record<string, string> = { 'Happy & playful': t.reportsMoodVal, 'Breakfast ✓ · Lunch ✓ · Snack ✓': t.reportsMealsVal, '1h 20m': t.reportsNapVal, 'Outdoor play, painting, story time': t.reportsActivitiesVal }
    if (legacy[value]) return legacy[value]
    const tokens = value.split('|')
    if (!tokens.every((code) => all.some(([id]) => id === code))) return value
    return tokens.map((code) => { const option = all.find(([id]) => id === code)!; return t[option[1]] }).join(' · ')

  }
  return <section className="panel"><h1>{t.reportsTitle}</h1>
    <div className="filters"><label>{t.paymentsChild}<select disabled={busy || !rosterReady} value={childId} onChange={(e) => changeContext(e.target.value, date)}>{children.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.groupName}</option>)}</select></label>
    <label>{t.attendanceDate}<input type="date" disabled={busy} value={date} onChange={(e) => changeContext(childId, e.target.value)} /></label><button className="btn ghost" disabled={busy} onClick={() => { if (date !== localCalendarDate()) changeContext(childId, localCalendarDate()) }}>{t.attendanceToday}</button></div>
    {!validDate(date) && <p role="alert">{t.attendanceInvalidDate}</p>}
    {loading && <p role="status">{t.loading}</p>}
    {(rosterError || error) && <p className="form-error" role="alert">{error === 'save' ? t.saveError : t.loadError}{error !== 'save' && <button onClick={() => setRetry((v) => v + 1)}>{t.attendanceRetry}</button>}</p>}
    {saved && <p role="status">{t.attendanceSaved}</p>}
    {rosterReady && !children.length && <p>{t.attendanceEmpty}</p>}
    {canWrite && childId && !loading && !rosterError && error !== 'load' && validDate(date) && <form className="login-form" onSubmit={save}>
      {reports.length > 0 && <p>{t.reportCorrection}</p>}
      <fieldset disabled={busy}>
        {(['mood', 'meals', 'nap'] as const).map((field) => <label key={field}>{t[({ mood: 'reportsMood', meals: 'reportsMeals', nap: 'reportsNap' } as const)[field]]}<select required value={draft[field]} onChange={(e) => { setSaved(false); setDraft({ ...draft, [field]: e.target.value }) }}><option value="">{t.choose}</option>{draft[field] && !options[field].some(([code]) => code === draft[field]) && <option value={draft[field]}>{translated(draft[field])}</option>}{options[field].map(([code, key]) => <option key={code} value={code}>{t[key]}</option>)}</select></label>)}
        <fieldset><legend>{t.reportsActivities}</legend>
          {draft.activities && draft.activities.split('|').some((code) => !options.activities.some(([id]) => id === code))
            ? <><label>{t.reportsActivities}<input value={draft.activities} onChange={(e) => { setSaved(false); setDraft({ ...draft, activities: e.target.value }) }} /></label><button type="button" className="btn ghost" onClick={() => { setSaved(false); setDraft({ ...draft, activities: '' }) }}>{t.useChecklist}</button></>
            : options.activities.map(([code, key]) => <label className="choice" key={code}><input type="checkbox" checked={draft.activities.split('|').includes(code)} onChange={(e) => { const chosen = draft.activities.split('|').filter(Boolean); setSaved(false); setDraft({ ...draft, activities: e.target.checked ? [...chosen, code].join('|') : chosen.filter((v) => v !== code).join('|') }) }} />{t[key]}</label>)}
        </fieldset>
        <label>{t.reportsNote}<textarea rows={3} maxLength={5000} value={draft.note} onChange={(e) => { setSaved(false); setDraft({ ...draft, note: e.target.value }) }} /></label>
        <button className="btn primary" disabled={!draft.activities}>{busy ? t.attendanceSaving : t.reportSave}</button>
      </fieldset>
    </form>}
    {!loading && !rosterError && error !== 'load' && validDate(date) && reports.length === 0 && <p>{t.reportEmpty}</p>}
    {!loading && reports.map((report) => <article className="roster-card" key={report.id}><h2>{report.childName} · {displayDate(report.reportDate, lang)}</h2><p>{report.groupName} · {report.teacherName}</p><div className="report-grid">{(['mood', 'meals', 'nap', 'activities'] as const).map((field) => <div key={field}><h3>{t[({ mood: 'reportsMood', meals: 'reportsMeals', nap: 'reportsNap', activities: 'reportsActivities' } as const)[field]]}</h3><p>{translated(report[field])}</p></div>)}</div>{report.note && <p><strong>{t.reportsNote}:</strong> {report.note}</p>}</article>)}
  </section>
}
