/* Network effects reset pending UI and invalidate generation counters on context/unmount changes. */
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { listChildren, listReports, saveReport, saveBatchReports, listWeeklyMeals, type Child, type Report, type WeeklyMeal, type DayOfWeek } from './api'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import { localCalendarDate, validDate } from './attendance-date.js'
import { displayDate, useAlive } from './pilot-utils'
import ChildAvatar from './ChildAvatar'
import { SeaGodanciBadge } from './child-highlight'
import { isSeaGodanci } from './child-highlight-util'

import Icon from './Icon'

const DAYS_MAP: Record<number, DayOfWeek> = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
}

function getDayOfWeek(dateStr: string): DayOfWeek | null {
  if (!validDate(dateStr)) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const day = dt.getDay()
  return DAYS_MAP[day] || null
}

function localizeDish(dishText: string, currentLang: string): string {
  if (!dishText) return ''
  if (dishText.includes(' / ')) {
    const parts = dishText.split(' / ')
    return currentLang === 'sq' ? parts[0].trim() : parts[1]?.trim() || parts[0].trim()
  }
  return dishText.trim()
}

function getMenuSummary(menu: WeeklyMeal | undefined, currentLang: string): string {
  if (!menu) return ''
  const parts: string[] = []
  const isSq = currentLang === 'sq'
  if (menu.breakfast) {
    const label = isSq ? 'Mëngjesi' : 'Breakfast'
    parts.push(`${label}: ${localizeDish(menu.breakfast, currentLang)}`)
  }
  if (menu.lunch) {
    const label = isSq ? 'Dreka' : 'Lunch'
    parts.push(`${label}: ${localizeDish(menu.lunch, currentLang)}`)
  }
  const snack = menu.morningSnack || menu.afternoonSnack
  if (snack) {
    const label = isSq ? 'Zamra' : 'Snack'
    parts.push(`${label}: ${localizeDish(snack, currentLang)}`)
  }
  return parts.join(' · ')
}

function getMealRatingDetails(code: string, currentLang: string) {
  const isSq = currentLang === 'sq'
  switch (code) {
    case 'meals:very_well':
      return {
        label: isSq ? 'Shumë mirë' : 'Very well',
        icon: '🌟',
        headline: isSq
          ? 'Hëngri shumë mirë dhe me oreks të gjithë ushqimin e ditës.'
          : 'Ate very well with great appetite, finished all meals.',
      }
    case 'meals:all':
      return {
        label: isSq ? 'Mirë' : 'Well',
        icon: '👍',
        headline: isSq
          ? 'Hëngri mirë të gjithë racionin e shërbyer.'
          : 'Ate well and finished the served portions.',
      }
    case 'meals:some':
      return {
        label: isSq ? 'Pak' : 'Some',
        icon: '🤏',
        headline: isSq
          ? 'Hëngri një pjesë të ushqimit sot.'
          : 'Ate some of the meal today.',
      }
    case 'meals:little':
      return {
        label: isSq ? 'Shumë pak' : 'Little',
        icon: '⚠️',
        headline: isSq
          ? 'Hëngri shumë pak sot, do të ndiqet me vëmendje.'
          : 'Ate very little today, will monitor closely.',
      }
    default:
      return null
  }
}

function buildMealNoteText(code: string, menu: WeeklyMeal | undefined, currentLang: string): string {
  const rating = getMealRatingDetails(code, currentLang)
  if (!rating) return ''
  const isSq = currentLang === 'sq'
  const menuSummary = getMenuSummary(menu, currentLang)
  const menuPart = menuSummary ? ` (${isSq ? 'Menuja e ditës' : "Today's menu"}: ${menuSummary})` : ''
  return `🍽️ ${rating.headline}${menuPart}`
}

const options = {
  mood: [['mood:happy', 'moodHappy'], ['mood:calm', 'moodCalm'], ['mood:tired', 'moodTired'], ['mood:upset', 'moodUpset']],
  meals: [
    ['meals:very_well', 'mealsVeryWell'],
    ['meals:all', 'mealsAll'],
    ['meals:some', 'mealsSome'],
    ['meals:little', 'mealsLittle'],
  ],
  nap: [['nap:none', 'napNone'], ['nap:short', 'napShort'], ['nap:long', 'napLong']],
  activities: [['activity:outdoor', 'activityOutdoor'], ['activity:art', 'activityArt'], ['activity:stories', 'activityStories'], ['activity:music', 'activityMusic'], ['activity:free', 'activityFree']],
} as const
const fieldIcons = { mood: '😊', meals: '🍎', nap: '😴', activities: '🎨' } as const
const empty = { mood: '', meals: '', nap: '', activities: '', note: '', imageUrl: '' }
export default function Reports({ initialChildId, initialDate }: { initialChildId?: string; initialDate?: string }) {
  const { token, user } = useAuth()
  const { t, lang } = useI18n()
  const alive = useAlive()
  const generation = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
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
  const [imageError, setImageError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [batchSaved, setBatchSaved] = useState(false)
  const [noteInserted, setNoteInserted] = useState(false)
  const [weeklyMeals, setWeeklyMeals] = useState<WeeklyMeal[]>([])
  const canWrite = user?.role !== 'parent'
  const selectedChild = children.find((c) => c.id === childId)
  const currentIndex = children.findIndex((c) => c.id === childId)

  useEffect(() => {
    if (!token) return
    const ac = new AbortController()
    const month = date ? date.slice(0, 7) : undefined
    listWeeklyMeals(token, month, undefined, ac.signal)
      .then((res) => {
        if (alive.current) setWeeklyMeals(res.meals)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [token, date])

  const activeDayOfWeek = useMemo(() => getDayOfWeek(date), [date])
  const todaysMenu = useMemo(() => {
    if (!activeDayOfWeek) return undefined
    return weeklyMeals.find((m) => m.dayOfWeek === activeDayOfWeek)
  }, [weeklyMeals, activeDayOfWeek])

  const mealRating = useMemo(() => {
    if (!draft.meals) return null
    return getMealRatingDetails(draft.meals, lang)
  }, [draft.meals, lang])

  function handleMealSelect(code: string) {
    setSaved(false)
    const nextVal = draft.meals === code ? '' : code
    setDraft((prev) => {
      const updated = { ...prev, meals: nextVal }
      if (nextVal) {
        const generatedNote = buildMealNoteText(nextVal, todaysMenu, lang)
        if (!prev.note.trim()) {
          updated.note = generatedNote
        } else {
          const lines = prev.note.split('\n')
          const filtered = lines.filter(
            (l) =>
              !l.startsWith('🍽️') &&
              !l.includes(t.todaysMenuNotePrefix) &&
              !l.includes('Menuja e ditës') &&
              !l.includes("Today's menu"),
          )
          if (lines.length !== filtered.length) {
            updated.note = [...filtered, generatedNote].join('\n').trim()
          }
        }
      }
      return updated
    })
  }

  function insertMealCommentIntoNote() {
    if (!draft.meals) return
    const noteText = buildMealNoteText(draft.meals, todaysMenu, lang)
    if (!noteText) return
    setSaved(false)
    setDraft((prev) => {
      if (!prev.note.trim()) {
        return { ...prev, note: noteText }
      }
      const lines = prev.note.split('\n')
      const filtered = lines.filter(
        (l) =>
          !l.startsWith('🍽️') &&
          !l.includes(t.todaysMenuNotePrefix) &&
          !l.includes('Menuja e ditës') &&
          !l.includes("Today's menu"),
      )
      return { ...prev, note: [...filtered, noteText].join('\n').trim() }
    })
    setNoteInserted(true)
    setTimeout(() => setNoteInserted(false), 2500)
  }

  function goToNextChild() {
    if (currentIndex >= 0 && currentIndex < children.length - 1) {
      changeContext(children[currentIndex + 1].id, date)
    }
  }

  function goToPreviousChild() {
    if (currentIndex > 0) {
      changeContext(children[currentIndex - 1].id, date)
    }
  }
  useEffect(() => {
    let cancelled = false
    setRosterReady(false); setRosterError(false)
    if (token) void listChildren(token).then(({ children: rows }) => { if (!cancelled) { setChildren(rows); setChildId((id) => rows.some((c) => c.id === id) ? id : rows[0]?.id || ''); setRosterReady(true) } }).catch(() => { if (!cancelled) { setRosterError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [token, retry])
  useEffect(() => {
    const version = ++generation.current
    setReports([]); setDraft(empty); setError(''); setImageError(''); setSaved(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!rosterReady || !token) return
    if (!validDate(date)) { setLoading(false); return }
    setLoading(true)
    void listReports(token, childId || undefined, date).then(({ reports: rows }) => {
      if (!alive.current || version !== generation.current) return
      setReports(rows)
      if (rows[0] && childId) { const { mood, meals, nap, activities, note, imageUrl } = rows[0]; setDraft({ mood, meals, nap, activities, note, imageUrl: imageUrl || '' }) }
    }).catch(() => { if (alive.current && version === generation.current) setError('load') }).finally(() => { if (alive.current && version === generation.current) setLoading(false) })
    return () => { generation.current++ }
  }, [token, childId, date, rosterReady])
  function changeContext(nextChild: string, nextDate: string) {
    generation.current++
    setReports([]); setDraft(empty); setSaved(false); setError(''); setImageError(''); setLoading(true)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setChildId(nextChild); setDate(nextDate)
  }
  function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setImageError(t.imageInvalid)
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageError(t.imageTooLarge)
      return
    }
    setImageError('')
    const reader = new FileReader()
    reader.onload = () => {
      setSaved(false)
      setDraft((d) => ({ ...d, imageUrl: reader.result as string }))
    }
    reader.readAsDataURL(file)
  }
  function removeImage() {
    setSaved(false)
    setDraft((d) => ({ ...d, imageUrl: '' }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!token || busy || loading || !validDate(date)) return
    const version = generation.current
    setBusy(true); setSaved(false); setError(''); setImageError('')
    try {
      const { report } = await saveReport(token, { ...draft, childId, reportDate: date })
      if (alive.current && version === generation.current) {
        setReports([report])
        setSaved(true)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    } catch { if (alive.current && version === generation.current) setError('save') }
    finally { if (alive.current) setBusy(false) }
  }
  async function batchApply() {
    if (!token || busy || loading || !validDate(date) || !selectedChild) return
    const groupChildren = children.filter((c) => c.groupName === selectedChild.groupName)
    if (!groupChildren.length) return
    setBusy(true); setSaved(false); setBatchSaved(false); setError(''); setImageError('')
    try {
      await saveBatchReports(token, {
        childIds: groupChildren.map((c) => c.id),
        reportDate: date,
        mood: draft.mood,
        meals: draft.meals,
        nap: draft.nap,
        activities: draft.activities,
        note: draft.note,
      })
      if (alive.current) {
        setBatchSaved(true)
        const { reports: rows } = await listReports(token, childId, date)
        if (alive.current) setReports(rows)
      }
    } catch {
      if (alive.current) setError('save')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  function translated(value: string) {
    const all = Object.values(options).flat()
    const legacy: Record<string, string> = { 'Happy & playful': t.reportsMoodVal, 'Breakfast ✓ · Lunch ✓ · Snack ✓': t.reportsMealsVal, '1h 20m': t.reportsNapVal, 'Outdoor play, painting, story time': t.reportsActivitiesVal }
    if (legacy[value]) return legacy[value]
    const tokens = value.split('|')
    if (!tokens.every((code) => all.some(([id]) => id === code))) return value
    return tokens.map((code) => { const option = all.find(([id]) => id === code)!; return t[option[1]] }).join(' · ')
  }

  return <section className="panel reports-panel" style={{ maxWidth: '100%', boxSizing: 'border-box' }}><h1>{t.reportsTitle}</h1><p className="panel-sub">{t.reportsDescription}</p>
    <div className="filters"><label>{t.paymentsChild}<select disabled={busy || !rosterReady} value={childId} onChange={(e) => changeContext(e.target.value, date)}>{children.map((c) => <option key={c.id} value={c.id}>{isSeaGodanci(c.name) ? '⭐ ' : ''}{c.name} · {c.groupName}</option>)}</select></label>
    <label>{t.attendanceDate}<input type="date" disabled={busy} value={date} onChange={(e) => changeContext(childId, e.target.value)} /></label><button className="btn ghost" disabled={busy} onClick={() => { if (date !== localCalendarDate()) changeContext(childId, localCalendarDate()) }}>{t.attendanceToday}</button></div>
    {rosterReady && children.length > 1 && (
      <div className="child-carousel-wrap">
        <div className="child-carousel-bar">
          <div className="current-child-indicator">
            <ChildAvatar name={selectedChild?.name || ''} size={28} />
            <div className="child-indicator-meta">
              <strong>{selectedChild?.name} {isSeaGodanci(selectedChild?.name || '') ? '⭐' : ''}</strong>
              <small>{selectedChild?.groupName} · #{currentIndex + 1} / {children.length}</small>
            </div>
          </div>
          <div className="carousel-nav-btns">
            <button type="button" className="btn ghost small-btn" disabled={busy || currentIndex <= 0} onClick={goToPreviousChild} aria-label={t.prevChild}>
              ← {t.prevChild}
            </button>
            <button type="button" className="btn ghost small-btn" disabled={busy || currentIndex >= children.length - 1} onClick={goToNextChild} aria-label={t.nextChild}>
              {t.nextChild} →
            </button>
          </div>
        </div>
      </div>
    )}
    {selectedChild?.allergies && <div className="allergy-alert" role="status">⚠️ <strong>{t.allergies}:</strong> {selectedChild.allergies}</div>}
    {!validDate(date) && <p role="alert">{t.attendanceInvalidDate}</p>}
    {loading && <p role="status">{t.loading}</p>}
    {(rosterError || error) && <p className="form-error" role="alert">{error === 'save' ? t.saveError : t.loadError}{error !== 'save' && <button onClick={() => setRetry((v) => v + 1)}>{t.attendanceRetry}</button>}</p>}
    {saved && <p role="status">{t.attendanceSaved}</p>}
    {batchSaved && <p role="status" className="attendance-feedback">✓ {t.batchSuccess}</p>}
    {rosterReady && !children.length && <p>{t.attendanceEmpty}</p>}
    {canWrite && childId && !loading && !rosterError && error !== 'load' && validDate(date) && <form className="login-form report-form" onSubmit={save}>
      <h2 className="form-section-title">{t.reportDetails}</h2>
      {reports.length > 0 && <p>{t.reportCorrection}</p>}
      <fieldset disabled={busy}>
        <div className="editor-section report-daily-care-section">
          <div className="section-header-compact">
            <h3><span>01</span>{t.reportBasics}</h3>
            <span className="section-subtitle-tag">{lang === 'sq' ? 'Kujdesi ditor' : 'Daily care'}</span>
          </div>

          {/* Accessible hidden selects for test parity and form submission */}
          <div className="report-basics-hidden" aria-hidden="true">
            {(['mood', 'meals', 'nap'] as const).map((field) => (
              <label key={field}>
                {t[({ mood: 'reportsMood', meals: 'reportsMeals', nap: 'reportsNap' } as const)[field]]}
                <select
                  required
                  value={draft[field]}
                  onChange={(e) => {
                    setSaved(false)
                    setDraft((prev) => ({ ...prev, [field]: e.target.value }))
                  }}
                >
                  <option key="" value="">{t.choose}</option>
                  {draft[field] && !options[field].some(([code]) => code === draft[field]) && (
                    <option key="__custom__" value={draft[field]}>{translated(draft[field])}</option>
                  )}
                  {options[field].map(([code, key]) => (
                    <option key={code} value={code}>{t[key]}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="daily-care-cards-stack">
            {/* Card 1: Mood */}
            <div className="daily-care-card mood-care-card">
              <div className="care-card-header">
                <span className="care-card-icon" aria-hidden="true">😊</span>
                <div className="care-card-title-group">
                  <strong className="care-card-title">{t.reportsMood}</strong>
                  <span className="care-card-subtitle">{lang === 'sq' ? 'Si ndihet fëmija sot?' : 'How is the child feeling today?'}</span>
                </div>
              </div>
              <div className="care-choice-grid mood-grid" role="group" aria-label={t.reportsMood}>
                {options.mood.map(([code, key]) => {
                  const isSelected = draft.mood === code
                  const emojis: Record<string, string> = { 'mood:happy': '😊', 'mood:calm': '😌', 'mood:tired': '🥱', 'mood:upset': '😢' }
                  return (
                    <button
                      key={code}
                      type="button"
                      className={`care-choice-btn mood-btn ${isSelected ? 'active' : ''}`}
                      aria-pressed={isSelected}
                      onClick={() => { setSaved(false); setDraft((prev) => ({ ...prev, mood: code })) }}
                    >
                      <span className="choice-indicator" aria-hidden="true" />
                      <span className="care-btn-emoji">{emojis[code]}</span>
                      <span className="care-btn-label">{t[key]}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Card 2: Meals (Fast 1-tap rating with live menu comment) */}
            <div className="daily-care-card meal-care-card">
              <div className="care-card-header">
                <span className="care-card-icon" aria-hidden="true">🍽️</span>
                <div className="care-card-title-group">
                  <div className="care-card-title-row">
                    <strong className="care-card-title">{t.reportsMeals}</strong>
                    {todaysMenu && (
                      <span className="menu-active-pill" title={t.connectedToMenu}>
                        ✓ {t.connectedToMenu}
                      </span>
                    )}
                  </div>
                  <span className="care-card-subtitle">
                    {lang === 'sq' ? 'Sa hëngri fëmija sot?' : 'How well did the child eat today?'}
                  </span>
                </div>
              </div>

              {/* Quick 1-tap Meal Choices */}
              <div className="care-choice-grid meal-choice-grid" role="group" aria-label={t.reportsMeals}>
                {options.meals.map(([code, key]) => {
                  const isSelected = draft.meals === code
                  const mealEmojis: Record<string, string> = {
                    'meals:very_well': '🌟',
                    'meals:all': '👍',
                    'meals:some': '🤏',
                    'meals:little': '⚠️',
                  }
                  const mealButtonLabels: Record<string, string> = {
                    'meals:very_well': t.mealIntakeVeryWell,
                    'meals:all': t.mealIntakeWell,
                    'meals:some': t.mealIntakeSome,
                    'meals:little': t.mealIntakeLittle,
                  }
                  return (
                    <button
                      key={code}
                      type="button"
                      className={`care-choice-btn meal-btn ${isSelected ? 'active' : ''}`}
                      aria-pressed={isSelected}
                      onClick={() => handleMealSelect(code)}
                    >
                      <span className="choice-indicator" aria-hidden="true" />
                      <span className="care-btn-emoji">{mealEmojis[code] || '🍽️'}</span>
                      <span className="care-btn-label">{mealButtonLabels[code] || t[key]}</span>
                    </button>
                  )
                })}
              </div>

              {/* Legacy or custom meal text if present */}
              {draft.meals && !options.meals.some(([code]) => code === draft.meals) && (
                <div className="custom-meal-badge-row">
                  <span className="custom-meal-pill">📝 {translated(draft.meals)}</span>
                  <button
                    type="button"
                    className="btn ghost small-btn"
                    onClick={() => {
                      setSaved(false)
                      setDraft((prev) => ({ ...prev, meals: '' }))
                    }}
                    title={t.clearMealSelection}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Live Menu Comment Box: shows what the child ate based on today's menu */}
              {draft.meals && mealRating && (
                <div className="meal-menu-comment-box" role="region" aria-label={t.mealCommentTitle}>
                  <div className="meal-comment-badge-row">
                    <div className="meal-comment-header-left">
                      <span className="meal-comment-icon">💬</span>
                      <strong className="meal-comment-title">{t.mealCommentTitle}</strong>
                    </div>
                    <button
                      type="button"
                      className={`btn-insert-note ${noteInserted ? 'is-inserted' : ''}`}
                      onClick={insertMealCommentIntoNote}
                      title={t.mealInsertIntoNote}
                    >
                      {noteInserted ? `✓ ${t.mealInsertedFeedback}` : `📝 ${t.mealInsertIntoNote}`}
                    </button>
                  </div>

                  <div className="meal-comment-main-line">
                    <span className="meal-comment-rating-tag">{mealRating.icon} {mealRating.label}</span>
                    <p className="meal-comment-headline">{mealRating.headline}</p>
                  </div>

                  {todaysMenu ? (
                    <div className="meal-comment-menu-details">
                      <span className="meal-comment-menu-label">📋 {t.todaysMenuNotePrefix}:</span>
                      <div className="meal-comment-dishes-chips">
                        {todaysMenu.breakfast && (
                          <span className="meal-dish-chip">
                            🥣 <strong>{t.mealBreakfast}:</strong> {localizeDish(todaysMenu.breakfast, lang)}
                          </span>
                        )}
                        {todaysMenu.lunch && (
                          <span className="meal-dish-chip">
                            🍲 <strong>{t.mealLunch}:</strong> {localizeDish(todaysMenu.lunch, lang)}
                          </span>
                        )}
                        {(todaysMenu.morningSnack || todaysMenu.afternoonSnack) && (
                          <span className="meal-dish-chip">
                            🍎 <strong>{t.mealSnack}:</strong> {localizeDish(todaysMenu.morningSnack || todaysMenu.afternoonSnack, lang)}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="meal-no-menu-hint">
                      ℹ️ {lang === 'sq' ? 'Nuk ka menu të regjistruar për sot te Menytë.' : 'No menu registered for today in Meals.'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Card 3: Nap */}
            <div className="daily-care-card nap-care-card">
              <div className="care-card-header">
                <span className="care-card-icon" aria-hidden="true">😴</span>
                <div className="care-card-title-group">
                  <strong className="care-card-title">{t.reportsNap}</strong>
                  <span className="care-card-subtitle">{lang === 'sq' ? 'Kohëzgjatja e pushimit ose gjumit' : 'Rest and nap duration today'}</span>
                </div>
              </div>
              <div className="care-choice-grid nap-grid" role="group" aria-label={t.reportsNap}>
                {options.nap.map(([code, key]) => {
                  const isSelected = draft.nap === code
                  const emojis: Record<string, string> = { 'nap:none': '⛔', 'nap:short': '⏱️', 'nap:long': '💤' }
                  return (
                    <button
                      key={code}
                      type="button"
                      className={`care-choice-btn nap-btn ${isSelected ? 'active' : ''}`}
                      aria-pressed={isSelected}
                      onClick={() => { setSaved(false); setDraft((prev) => ({ ...prev, nap: code })) }}
                    >
                      <span className="choice-indicator" aria-hidden="true" />
                      <span className="care-btn-emoji">{emojis[code]}</span>
                      <span className="care-btn-label">{t[key]}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <fieldset className="report-activities editor-section"><legend><span>02</span>{t.reportActivitiesTitle}</legend>
          {draft.activities && draft.activities.split('|').some((code) => !options.activities.some(([id]) => id === code))
            ? <><label>{t.reportsActivities}<input value={draft.activities} onChange={(e) => { setSaved(false); setDraft({ ...draft, activities: e.target.value }) }} /></label><button type="button" className="btn ghost" onClick={() => { setSaved(false); setDraft({ ...draft, activities: '' }) }}>{t.useChecklist}</button></>
            : <div className="activities-chip-grid">{options.activities.map(([code, key]) => {
                const activityIcons: Record<string, string> = { 'activity:outdoor': '🏃', 'activity:art': '🎨', 'activity:stories': '📖', 'activity:music': '🎵', 'activity:free': '🧩' }
                const isChecked = draft.activities.split('|').includes(code)
                return (
                  <label className={`choice activity-card-choice ${isChecked ? 'is-active' : ''}`} key={code}>
                    <input type="checkbox" checked={isChecked} onChange={(e) => { const chosen = draft.activities.split('|').filter(Boolean); setSaved(false); setDraft({ ...draft, activities: e.target.checked ? [...chosen, code].join('|') : chosen.filter((v) => v !== code).join('|') }) }} />
                    <span className="activity-icon">{activityIcons[code] || '⭐'}</span>
                    <span className="activity-text">{t[key]}</span>
                  </label>
                )
              })}</div>}
        </fieldset>
        <div className="editor-section"><h3><span>03</span>{t.reportNoteTitle}</h3><label>{t.reportsNote}<textarea rows={4} maxLength={5000} value={draft.note} onChange={(e) => { setSaved(false); setDraft({ ...draft, note: e.target.value }) }} /></label></div>
        <div className="editor-section"><h3><span>04</span>{t.reportPhotoTitle}</h3>
        <label>{t.reportPhoto}<input ref={fileInputRef} type="file" accept="image/*" disabled={busy} onChange={handleImage} /></label>
        {imageError && <p className="form-error" role="alert">{imageError}</p>}
        {draft.imageUrl && <div className="report-image-preview"><img src={draft.imageUrl} alt={t.reportPhoto} /><button type="button" className="btn ghost" disabled={busy} onClick={removeImage}>{t.removeImage}</button></div>}
        {selectedChild && <p className="hint">{t.permission}: <strong>{selectedChild.photoConsent ? t.allowed : t.notAllowed}</strong>{!selectedChild.photoConsent && ` — ${t.imageConsentNotice}`}</p>}
        </div><div className="actions editor-actions">
          <button className="btn primary" disabled={!draft.activities}>{busy ? t.attendanceSaving : t.reportSave}</button>
          <button type="button" className="btn ghost" disabled={!draft.activities || busy || !selectedChild?.groupName} onClick={() => void batchApply()}>{t.batchApplyToGroup}</button>
        </div>
      </fieldset>
    </form>}
    {!loading && !rosterError && error !== 'load' && validDate(date) && reports.length === 0 && <p>{t.reportEmpty}</p>}
    {!loading && reports.map((report) => <article className={`roster-card report-story-card ${isSeaGodanci(report.childName) ? 'sea-godanci-card' : ''}`} key={report.id}>
      <div className="card-avatar-heading"><ChildAvatar name={report.childName} size={52} /><div><h2>{report.childName} <SeaGodanciBadge name={report.childName} /></h2><p className="card-subtitle">{displayDate(report.reportDate, lang)} · {report.groupName}</p></div><span className="report-day-mark" aria-hidden="true"><Icon name="sun" size={24} /></span></div>
      {report.allergies && <p className="allergy-badge">⚠️ <strong>{t.allergies}:</strong> {report.allergies}</p>}
      <div className="report-story">
        {(['mood', 'meals', 'nap', 'activities'] as const).map((field) => <div className={`report-story-entry story-${field}`} key={field}>
          <span className="story-marker" aria-hidden="true">{fieldIcons[field]}</span>
          <div className="story-content">
            <h3>{t[({ mood: 'reportsMood', meals: 'reportsMeals', nap: 'reportsNap', activities: 'reportsActivities' } as const)[field]]}<span aria-hidden="true">{fieldIcons[field]}</span></h3>
            <p>{translated(report[field])}</p>
            {field === 'meals' && todaysMenu && (
              <div className="story-meal-menu-hint">
                <span className="story-menu-prefix">📋 {t.todaysMenuNotePrefix}:</span>
                <span className="story-menu-text">{getMenuSummary(todaysMenu, lang)}</span>
              </div>
            )}
          </div>
        </div>)}
        {(report.note || report.imageUrl) && <div className="report-story-entry story-moment">
          <span className="story-marker" aria-hidden="true"><Icon name="moments" size={18} /></span>
          <div className="story-content"><h3>{report.note ? t.reportNoteTitle : t.reportPhotoTitle}<Icon name="moments" size={20} /></h3>
            {report.note && <p className="story-note">{report.note}</p>}
            {report.imageUrl && <div className="report-photo"><img src={report.imageUrl} alt={`${report.childName} · ${displayDate(report.reportDate, lang)}`} /></div>}
          </div>
        </div>}
      </div>
      <p className="report-author"><Icon name="leaf" size={16} /><span>{t.roleTeacher}: <strong>{report.teacherName}</strong></span></p>
    </article>)}
  </section>
}
