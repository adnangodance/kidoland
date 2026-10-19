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

const options = {
  mood: [['mood:happy', 'moodHappy'], ['mood:calm', 'moodCalm'], ['mood:tired', 'moodTired'], ['mood:upset', 'moodUpset']],
  meals: [['meals:all', 'mealsAll'], ['meals:some', 'mealsSome'], ['meals:little', 'mealsLittle']],
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
  const [customFood, setCustomFood] = useState('')
  const [selectedIntake, setSelectedIntake] = useState('')
  const [activeCourse, setActiveCourse] = useState<'breakfast' | 'lunch' | 'snack' | 'all'>(() => {
    const hour = new Date().getHours()
    if (hour < 11) return 'breakfast'
    if (hour < 14) return 'lunch'
    return 'snack'
  })
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [weeklyMeals, setWeeklyMeals] = useState<WeeklyMeal[]>([])
  const canWrite = user?.role !== 'parent'
  const selectedChild = children.find((c) => c.id === childId)
  const currentIndex = children.findIndex((c) => c.id === childId)

  useEffect(() => {
    if (!token) return
    const ac = new AbortController()
    listWeeklyMeals(token, ac.signal)
      .then((res) => {
        if (alive.current) setWeeklyMeals(res.meals)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [token])

  const activeDayOfWeek = useMemo(() => getDayOfWeek(date), [date])
  const todaysMenu = useMemo(() => {
    if (!activeDayOfWeek) return undefined
    return weeklyMeals.find((m) => m.dayOfWeek === activeDayOfWeek)
  }, [weeklyMeals, activeDayOfWeek])

  const currentDishText = useMemo(() => {
    if (!todaysMenu) return ''
    if (activeCourse === 'breakfast') return localizeDish(todaysMenu.breakfast, lang)
    if (activeCourse === 'lunch') return localizeDish(todaysMenu.lunch, lang)
    if (activeCourse === 'snack') return localizeDish(todaysMenu.morningSnack || todaysMenu.afternoonSnack, lang)
    if (activeCourse === 'all') {
      const b = localizeDish(todaysMenu.breakfast, lang)
      const l = localizeDish(todaysMenu.lunch, lang)
      return [b, l].filter(Boolean).join(', ')
    }
    return ''
  }, [todaysMenu, activeCourse, lang])

  function getCourseDish(course: 'breakfast' | 'lunch' | 'snack' | 'all') {
    if (!todaysMenu) return ''
    if (course === 'breakfast') return localizeDish(todaysMenu.breakfast, lang)
    if (course === 'lunch') return localizeDish(todaysMenu.lunch, lang)
    if (course === 'snack') return localizeDish(todaysMenu.morningSnack || todaysMenu.afternoonSnack, lang)
    if (course === 'all') {
      const b = localizeDish(todaysMenu.breakfast, lang)
      const l = localizeDish(todaysMenu.lunch, lang)
      return [b, l].filter(Boolean).join(', ')
    }
    return ''
  }

  function getCourseName(course: 'breakfast' | 'lunch' | 'snack' | 'all') {
    if (course === 'breakfast') return t.mealBreakfast
    if (course === 'lunch') return t.mealLunch
    if (course === 'snack') return t.mealSnack
    return t.mealAllMeals
  }

  function applyMealUpdate(course: 'breakfast' | 'lunch' | 'snack' | 'all', custom: string, intake: string) {
    const intakeLabels: Record<string, string> = {
      'intake:very_well': t.mealIntakeVeryWell,
      'intake:well': t.mealIntakeWell,
      'intake:some': t.mealIntakeSome,
      'intake:little': t.mealIntakeLittle,
    }
    const intakeLabel = intakeLabels[intake] || ''
    if (!intakeLabel) {
      setDraft((d) => ({ ...d, meals: '' }))
      return
    }

    const courseLabel = getCourseName(course)
    const dish = custom.trim() || getCourseDish(course)

    if (dish) {
      setDraft((d) => ({ ...d, meals: `${courseLabel}: ${dish} · ${intakeLabel}` }))
    } else {
      setDraft((d) => ({ ...d, meals: `${courseLabel} · ${intakeLabel}` }))
    }
  }

  useEffect(() => {
    if (!draft.meals) {
      setCustomFood('')
      setSelectedIntake('')
      return
    }
    if (draft.meals === 'meals:all') {
      setSelectedIntake('intake:very_well')
      return
    }
    if (draft.meals === 'meals:some') {
      setSelectedIntake('intake:some')
      return
    }
    if (draft.meals === 'meals:little') {
      setSelectedIntake('intake:little')
      return
    }
    if (draft.meals.includes(' · ')) {
      const parts = draft.meals.split(' · ')
      const foodPart = parts[0] || ''
      if (foodPart.startsWith(`${t.mealBreakfast}:`) || foodPart === t.mealBreakfast) {
        setActiveCourse('breakfast')
        const afterPrefix = foodPart.replace(`${t.mealBreakfast}:`, '').trim()
        if (afterPrefix && afterPrefix !== localizeDish(todaysMenu?.breakfast || '', lang)) {
          setCustomFood(afterPrefix)
          setShowCustomInput(true)
        }
      } else if (foodPart.startsWith(`${t.mealLunch}:`) || foodPart === t.mealLunch) {
        setActiveCourse('lunch')
        const afterPrefix = foodPart.replace(`${t.mealLunch}:`, '').trim()
        if (afterPrefix && afterPrefix !== localizeDish(todaysMenu?.lunch || '', lang)) {
          setCustomFood(afterPrefix)
          setShowCustomInput(true)
        }
      } else if (foodPart.startsWith(`${t.mealSnack}:`) || foodPart === t.mealSnack) {
        setActiveCourse('snack')
        const afterPrefix = foodPart.replace(`${t.mealSnack}:`, '').trim()
        const snackDish = localizeDish(todaysMenu?.morningSnack || todaysMenu?.afternoonSnack || '', lang)
        if (afterPrefix && afterPrefix !== snackDish) {
          setCustomFood(afterPrefix)
          setShowCustomInput(true)
        }
      } else if (foodPart.startsWith(`${t.mealAllMeals}:`) || foodPart === t.mealAllMeals) {
        setActiveCourse('all')
      } else {
        setCustomFood(foodPart)
        setShowCustomInput(true)
      }

      const intakePart = parts[1] || ''
      if (intakePart === t.mealIntakeVeryWell || intakePart.includes('Shumë') || intakePart.includes('Very') || intakePart.includes('gjithën') || intakePart.includes('All')) {
        setSelectedIntake('intake:very_well')
      } else if (intakePart === t.mealIntakeWell || intakePart.includes('Mirë') || intakePart.includes('Well') || intakePart.includes('umicën') || intakePart.includes('Most')) {
        setSelectedIntake('intake:well')
      } else if (intakePart === t.mealIntakeSome || intakePart.includes('Pak') || intakePart.includes('Some') || intakePart.includes('jysmën') || intakePart.includes('Half')) {
        setSelectedIntake('intake:some')
      } else if (intakePart === t.mealIntakeLittle || intakePart.includes('pak') || intakePart.includes('Little')) {
        setSelectedIntake('intake:little')
      }
    } else {
      setCustomFood(draft.meals)
      setShowCustomInput(true)
    }
  }, [draft.meals, t, todaysMenu, lang])

  function handleCourseSelect(course: 'breakfast' | 'lunch' | 'snack' | 'all') {
    setSaved(false)
    setActiveCourse(course)
    if (selectedIntake) {
      applyMealUpdate(course, customFood, selectedIntake)
    }
  }

  function handleIntakeSelect(intakeKey: string) {
    setSaved(false)
    const nextIntake = selectedIntake === intakeKey ? '' : intakeKey
    setSelectedIntake(nextIntake)
    if (!nextIntake) {
      setDraft((d) => ({ ...d, meals: '' }))
      return
    }
    applyMealUpdate(activeCourse, customFood, nextIntake)
  }

  function handleCustomFoodChange(text: string) {
    setSaved(false)
    setCustomFood(text)
    if (selectedIntake) {
      applyMealUpdate(activeCourse, text, selectedIntake)
    }
  }

  function handleTagClick(tag: string) {
    setSaved(false)
    const next = customFood ? `${customFood}, ${tag}` : tag
    setCustomFood(next)
    if (selectedIntake) {
      applyMealUpdate(activeCourse, next, selectedIntake)
    }
  }

  function clearMeals() {
    setSaved(false)
    setCustomFood('')
    setSelectedIntake('')
    setShowCustomInput(false)
    setDraft((d) => ({ ...d, meals: '' }))
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
    setShowCustomInput(false)
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
  return <section className="panel reports-panel"><h1>{t.reportsTitle}</h1><p className="panel-sub">{t.reportsDescription}</p>
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

            {/* Card 2: Unified Meal Composer (Brightwheel & Famly pattern) */}
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
                    {lang === 'sq' ? 'Zgjidhni vaktin dhe sa hëngri fëmija (me 2 prekje të shpejta)' : 'Select meal course and portion eaten (in 2 quick taps)'}
                  </span>
                </div>
              </div>

              {/* Course Tabs: Breakfast / Lunch / Snack / All */}
              <div className="meal-course-tabs" role="tablist" aria-label={t.reportsMeals}>
                {(['breakfast', 'lunch', 'snack', 'all'] as const).map((courseKey) => {
                  const isCurrent = activeCourse === courseKey
                  const courseIcons = { breakfast: '🥣', lunch: '🍲', snack: '🍎', all: '🍽️' }
                  const courseLabels = {
                    breakfast: t.mealBreakfast,
                    lunch: t.mealLunch,
                    snack: t.mealSnack,
                    all: t.mealAllMeals,
                  }
                  return (
                    <button
                      key={courseKey}
                      type="button"
                      role="tab"
                      aria-selected={isCurrent}
                      className={`meal-course-tab ${isCurrent ? 'is-active' : ''}`}
                      onClick={() => handleCourseSelect(courseKey)}
                    >
                      <span className="course-tab-icon">{courseIcons[courseKey]}</span>
                      <span className="course-tab-name">{courseLabels[courseKey]}</span>
                    </button>
                  )
                })}
              </div>

              {/* Today's served dish badge & editor */}
              <div className="course-menu-card">
                {currentDishText || customFood ? (
                  <div className="course-menu-content">
                    <div className="course-menu-lead">
                      <span className="course-menu-badge">
                        📋 {todaysMenu && !customFood ? t.todaysMenuServed : (lang === 'sq' ? 'Ushqimi i përzgjedhur' : 'Selected food')}:
                      </span>
                      {!showCustomInput ? (
                        <button
                          type="button"
                          className="btn-link-edit"
                          onClick={() => setShowCustomInput(true)}
                        >
                          ✏️ {t.customMealToggle}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-link-edit"
                          onClick={() => {
                            setCustomFood('')
                            setShowCustomInput(false)
                            if (selectedIntake) {
                              applyMealUpdate(activeCourse, '', selectedIntake)
                            }
                          }}
                        >
                          ✕ {lang === 'sq' ? 'Kthe te menuja' : 'Use menu'}
                        </button>
                      )}
                    </div>

                    {!showCustomInput ? (
                      <div className="served-dish-display">
                        <span className="served-dish-icon">
                          {activeCourse === 'breakfast' ? '🥣' : activeCourse === 'lunch' ? '🍲' : activeCourse === 'snack' ? '🍎' : '🍽️'}
                        </span>
                        <span className="served-dish-title">
                          {customFood || currentDishText}
                        </span>
                      </div>
                    ) : (
                      <div className="custom-dish-box">
                        <input
                          type="text"
                          className="custom-dish-input"
                          placeholder={t.mealCustomFoodPlaceholder}
                          value={customFood}
                          onChange={(e) => handleCustomFoodChange(e.target.value)}
                          aria-label={t.presetMealsCustom}
                        />
                        <div className="custom-tags-row">
                          <span className="custom-tags-label">{lang === 'sq' ? 'Sugjerime të shpejta:' : 'Quick tags:'}</span>
                          {[
                            { label: t.mealDishSoup, icon: '🥗' },
                            { label: t.mealDishMain, icon: '🍝' },
                            { label: t.mealDishBread, icon: '🥪' },
                            { label: t.mealDishFruit, icon: '🍌' },
                          ].map((tag) => (
                            <button
                              key={tag.label}
                              type="button"
                              className="quick-tag-chip"
                              onClick={() => handleTagClick(tag.label)}
                            >
                              <span>{tag.icon}</span> {tag.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="course-no-menu-content">
                    <input
                      type="text"
                      className="custom-dish-input"
                      placeholder={t.mealCustomFoodPlaceholder}
                      value={customFood}
                      onChange={(e) => handleCustomFoodChange(e.target.value)}
                      aria-label={t.presetMealsCustom}
                    />
                  </div>
                )}
              </div>

              {/* Portion scale selector (2nd tap) */}
              <div className="portion-scale-section">
                <span className="portion-scale-heading">
                  {t.portionLabel}
                </span>
                <div className="portion-scale-grid" role="group" aria-label={t.portionLabel}>
                  {[
                    { key: 'intake:very_well', label: t.mealIntakeVeryWell, pct: '100%', icon: '🌟', tone: 'great' },
                    { key: 'intake:well', label: t.mealIntakeWell, pct: '75%', icon: '👍', tone: 'good' },
                    { key: 'intake:some', label: t.mealIntakeSome, pct: '50%', icon: '🤏', tone: 'moderate' },
                    { key: 'intake:little', label: t.mealIntakeLittle, pct: '<25%', icon: '⚠️', tone: 'little' },
                  ].map((item) => {
                    const isSelected = selectedIntake === item.key
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`portion-card-btn ${item.tone} ${isSelected ? 'active' : ''}`}
                        aria-pressed={isSelected}
                        onClick={() => handleIntakeSelect(item.key)}
                      >
                        <div className="portion-card-top">
                          <span className="portion-card-icon">{item.icon}</span>
                          <span className="portion-card-pct">{item.pct}</span>
                        </div>
                        <div className="portion-card-bottom">
                          <span className="portion-radio-ring" aria-hidden="true" />
                          <span className="portion-card-name">{item.label}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Active selection preview bar */}
              {draft.meals && (
                <div className="meal-preview-bar">
                  <div className="meal-preview-text">
                    <span className="preview-indicator">✓</span>
                    <span><strong>{t.reportsMeals}:</strong> {translated(draft.meals)}</span>
                  </div>
                  <button
                    type="button"
                    className="clear-meal-btn"
                    onClick={clearMeals}
                    title={t.clearMealSelection}
                  >
                    ✕ {t.clearMealSelection}
                  </button>
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
          <div className="story-content"><h3>{t[({ mood: 'reportsMood', meals: 'reportsMeals', nap: 'reportsNap', activities: 'reportsActivities' } as const)[field]]}<span aria-hidden="true">{fieldIcons[field]}</span></h3><p>{translated(report[field])}</p></div>
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
