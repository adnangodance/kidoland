/* Display and manage kindergarten monthly food menu and allergen alerts */
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState, type FormEvent } from 'react'
import {
  listWeeklyMeals,
  updateWeeklyMeal,
  copyMonthlyMeals,
  listChildren,
  type WeeklyMeal,
  type MealInput,
  type DayOfWeek,
  type Child,
} from './api'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import { useAlive } from './pilot-utils'

const DAYS: { key: DayOfWeek; labelKey: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' }[] = [
  { key: 'monday', labelKey: 'monday' },
  { key: 'tuesday', labelKey: 'tuesday' },
  { key: 'wednesday', labelKey: 'wednesday' },
  { key: 'thursday', labelKey: 'thursday' },
  { key: 'friday', labelKey: 'friday' },
]

function formatMonthName(monthStr: string, lang: 'en' | 'sq'): string {
  const [y, m] = monthStr.split('-')
  const monthIdx = Number(m) - 1
  const sqMonths = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor']
  const enMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const name = lang === 'sq' ? sqMonths[monthIdx] || m : enMonths[monthIdx] || m
  return `${name} ${y}`
}

function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number)
  const date = new Date(y, m - 1 + delta, 1)
  const newY = date.getFullYear()
  const newM = String(date.getMonth() + 1).padStart(2, '0')
  return `${newY}-${newM}`
}

function getCurrentMonth(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export default function Meals() {
  const { token, user } = useAuth()
  const { t, lang } = useI18n()
  const alive = useAlive()

  const [currentMonthStr] = useState(getCurrentMonth)
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getCurrentMonth())
  const [selectedWeek, setSelectedWeek] = useState<number>(0)

  const [meals, setMeals] = useState<WeeklyMeal[]>([])
  const [children, setChildren] = useState<Child[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  const [activeDay, setActiveDay] = useState<DayOfWeek>('monday')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<MealInput>({
    dayOfWeek: 'monday',
    month: currentMonthStr,
    weekNumber: 0,
    breakfast: '',
    morningSnack: '',
    lunch: '',
    afternoonSnack: '',
    allergens: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [feedback, setFeedback] = useState('')

  const canEdit = user?.role === 'teacher' || user?.role === 'director' || user?.role === 'superadmin'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)

    Promise.all([
      listWeeklyMeals(token || '', selectedMonth, selectedWeek),
      user?.role === 'parent' ? listChildren(token || '') : Promise.resolve({ children: [] }),
    ])
      .then(([mRes, cRes]) => {
        if (!cancelled && alive.current) {
          setMeals(mRes.meals)
          setChildren(cRes.children)
          const currentMeal = mRes.meals.find((m) => m.dayOfWeek === activeDay)
          if (currentMeal) {
            setDraft({
              dayOfWeek: currentMeal.dayOfWeek,
              month: selectedMonth,
              weekNumber: selectedWeek,
              breakfast: currentMeal.breakfast,
              morningSnack: currentMeal.morningSnack,
              lunch: currentMeal.lunch,
              afternoonSnack: currentMeal.afternoonSnack,
              allergens: currentMeal.allergens,
              notes: currentMeal.notes,
            })
          }
        }
      })
      .catch(() => {
        if (!cancelled && alive.current) setError(true)
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token, selectedMonth, selectedWeek, retry])

  function selectDay(day: DayOfWeek) {
    setActiveDay(day)
    setEditing(false)
    setSaveError('')
    setFeedback('')
    const currentMeal = meals.find((m) => m.dayOfWeek === day)
    if (currentMeal) {
      setDraft({
        dayOfWeek: currentMeal.dayOfWeek,
        month: selectedMonth,
        weekNumber: selectedWeek,
        breakfast: currentMeal.breakfast,
        morningSnack: currentMeal.morningSnack,
        lunch: currentMeal.lunch,
        afternoonSnack: currentMeal.afternoonSnack,
        allergens: currentMeal.allergens,
        notes: currentMeal.notes,
      })
    } else {
      setDraft({
        dayOfWeek: day,
        month: selectedMonth,
        weekNumber: selectedWeek,
        breakfast: '',
        morningSnack: '',
        lunch: '',
        afternoonSnack: '',
        allergens: '',
        notes: '',
      })
    }
  }

  function startEditing() {
    setSaveError('')
    setFeedback('')
    const currentMeal = meals.find((m) => m.dayOfWeek === activeDay)
    setDraft({
      dayOfWeek: activeDay,
      month: selectedMonth,
      weekNumber: selectedWeek,
      breakfast: currentMeal?.breakfast || '',
      morningSnack: currentMeal?.morningSnack || '',
      lunch: currentMeal?.lunch || '',
      afternoonSnack: currentMeal?.afternoonSnack || '',
      allergens: currentMeal?.allergens || '',
      notes: currentMeal?.notes || '',
    })
    setEditing(true)
  }

  function applyPreset(type: 'mediterranean' | 'vegetarian') {
    if (type === 'mediterranean') {
      setDraft((d) => ({
        ...d,
        month: selectedMonth,
        weekNumber: selectedWeek,
        breakfast: 'Qull tërshëre me mollë dhe mjaltë / Oatmeal with organic apples & honey',
        morningSnack: 'Dardha dhe mandarina të freskëta / Seasonal pears & mandarins',
        lunch: 'Supë peshku/pule, fileto e pjekur me oriz dhe sallatë / Baked fillet with herb rice & green salad',
        afternoonSnack: 'Keku me karotë shtëpie dhe çaj mali / Homemade carrot cake & herbal mountain tea',
        allergens: 'Lactose, Gluten',
        notes: 'Menu mesdhetare e pasur me Omega-3 / Mediterranean balanced nutrition',
      }))
    } else {
      setDraft((d) => ({
        ...d,
        month: selectedMonth,
        weekNumber: selectedWeek,
        breakfast: 'Vezë të ziera fshati, djathë dhe bukë e thekur / Farm-fresh boiled eggs, cheese & toast',
        morningSnack: 'Feta molle dhe karota të prera / Fresh crisp apple & carrot sticks',
        lunch: 'Gjellë tradicionale me thjerrëza fshati dhe perime / Hearty country lentil & vegetable stew',
        afternoonSnack: 'Jogurt natyral me boronica / Natural yogurt with wild blueberries',
        allergens: 'Eggs / Vezë, Lactose',
        notes: 'Dita me proteina bimore / Plant-based vegetarian protein day',
      }))
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!token || saving) return
    setSaving(true)
    setSaveError('')
    setFeedback('')

    try {
      const res = await updateWeeklyMeal(token, {
        ...draft,
        month: selectedMonth,
        weekNumber: selectedWeek,
      })
      if (alive.current) {
        setMeals((prev) => [...prev.filter((m) => m.dayOfWeek !== res.meal.dayOfWeek), res.meal])
        setDraft({
          dayOfWeek: res.meal.dayOfWeek,
          month: selectedMonth,
          weekNumber: selectedWeek,
          breakfast: res.meal.breakfast || '',
          morningSnack: res.meal.morningSnack || '',
          lunch: res.meal.lunch || '',
          afternoonSnack: res.meal.afternoonSnack || '',
          allergens: res.meal.allergens || '',
          notes: res.meal.notes || '',
        })
        setEditing(false)
        setFeedback(t.mealSaved)
      }
    } catch {
      if (alive.current) setSaveError(t.saveError)
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  async function handleCopyPrevMonth() {
    if (!token || saving) return
    const prevMonth = shiftMonth(selectedMonth, -1)
    setSaving(true)
    setSaveError('')
    setFeedback('')
    try {
      await copyMonthlyMeals(token, prevMonth, selectedMonth)
      setFeedback(t.copyMonthSuccess)
      const res = await listWeeklyMeals(token, selectedMonth, selectedWeek)
      if (alive.current) {
        setMeals(res.meals)
        const currentMeal = res.meals.find((m) => m.dayOfWeek === activeDay)
        if (currentMeal) {
          setDraft({
            dayOfWeek: currentMeal.dayOfWeek,
            month: selectedMonth,
            weekNumber: selectedWeek,
            breakfast: currentMeal.breakfast,
            morningSnack: currentMeal.morningSnack,
            lunch: currentMeal.lunch,
            afternoonSnack: currentMeal.afternoonSnack,
            allergens: currentMeal.allergens,
            notes: currentMeal.notes,
          })
        }
      }
    } catch {
      if (alive.current) setSaveError(t.saveError)
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  const selectedMeal = meals.find((m) => m.dayOfWeek === activeDay)
  const hasMealContent = Boolean(selectedMeal && (selectedMeal.breakfast?.trim() || selectedMeal.lunch?.trim()))

  // Allergen detection for parent's linked children
  const childAllergies = children
    .map((c) => c.allergies?.trim())
    .filter(Boolean)
    .join('; ')

  const hasAllergenWarning =
    Boolean(childAllergies) &&
    Boolean(selectedMeal?.allergens) &&
    childAllergies.toLowerCase().split(/[,\s;/]+/).some((word) => word.length > 3 && selectedMeal!.allergens.toLowerCase().includes(word))

  return (
    <section className="panel meals-panel">
      <h1>{t.mealsTitle}</h1>
      <p>{t.mealsSubtitle}</p>

      {/* Monthly Navigation Header */}
      <div className="card meal-month-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', padding: '12px 16px', margin: '14px 0', borderRadius: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn ghost small-btn"
            aria-label={t.prevMonthBtn}
            onClick={() => setSelectedMonth((m) => shiftMonth(m, -1))}
          >
            ◀
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <strong style={{ fontSize: '16px' }}>📅 {formatMonthName(selectedMonth, lang)}</strong>
            {selectedMonth === currentMonthStr && (
              <span className="badge role-badge" style={{ fontSize: '11px' }}>{t.currentMonthBadge}</span>
            )}
          </div>
          <button
            type="button"
            className="btn ghost small-btn"
            aria-label={t.nextMonthBtn}
            onClick={() => setSelectedMonth((m) => shiftMonth(m, 1))}
          >
            ▶
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type="month"
            aria-label={t.menuMonthLabel}
            value={selectedMonth}
            onChange={(e) => e.target.value && setSelectedMonth(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--kd-line)', fontSize: '13px', boxSizing: 'border-box' }}
          />
          {canEdit && (
            <button
              type="button"
              className="btn secondary small-btn"
              onClick={handleCopyPrevMonth}
              disabled={saving}
              title={`${t.copyFromPrevMonth} (${formatMonthName(shiftMonth(selectedMonth, -1), lang)})`}
            >
              {t.copyFromPrevMonth}
            </button>
          )}
        </div>
      </div>

      {/* Week in Month Selector */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <button
          type="button"
          className={`filter-btn ${selectedWeek === 0 ? 'active' : ''}`}
          onClick={() => setSelectedWeek(0)}
        >
          {t.allWeeks}
        </button>
        {[1, 2, 3, 4].map((wk) => (
          <button
            key={wk}
            type="button"
            className={`filter-btn ${selectedWeek === wk ? 'active' : ''}`}
            onClick={() => setSelectedWeek(wk)}
          >
            {t.menuWeekLabel} {wk}
          </button>
        ))}
      </div>

      {/* Weekday Switcher Tabs */}
      <div className="meal-tabs">
        {DAYS.map((d) => (
          <button
            key={d.key}
            type="button"
            className={`btn small-btn ${activeDay === d.key ? 'primary' : 'ghost'}`}
            onClick={() => selectDay(d.key)}
          >
            {t[d.labelKey]}
          </button>
        ))}
      </div>

      {feedback && <p role="status" className="notice">{feedback}</p>}
      {saveError && <p role="alert" className="form-error">{saveError}</p>}
      {error && (
        <p role="alert" className="form-error">
          {t.loadError}{' '}
          <button type="button" onClick={() => setRetry((r) => r + 1)}>
            {t.attendanceRetry}
          </button>
        </p>
      )}

      {loading && <p role="status">{t.loading}</p>}

      {/* View Selected Day Menu */}
      {!loading && !editing && hasMealContent && selectedMeal && (
        <article className="roster-card meal-day-card">
          <div className="meal-card-header">
            <h2>{t[DAYS.find((d) => d.key === activeDay)!.labelKey]}</h2>
            {canEdit && (
              <button
                type="button"
                className="btn ghost small-btn"
                onClick={startEditing}
              >
                ✏️ {t.editMeal}
              </button>
            )}
          </div>

          {/* Child Allergen Alert */}
          {user?.role === 'parent' && children.length > 0 && (
            <div className={`meal-allergen-alert ${hasAllergenWarning ? 'warning' : 'safe'}`}>
              {hasAllergenWarning ? (
                <p>⚠️ <strong>{t.allergenWarning}:</strong> {childAllergies}</p>
              ) : (
                <p>✅ <strong>{t.allergenSafe}</strong></p>
              )}
            </div>
          )}

          <div className="meal-grid">
            <div className="meal-item">
              <h3>🥣 {t.breakfast}</h3>
              <p>{selectedMeal.breakfast || '—'}</p>
            </div>

            <div className="meal-item">
              <h3>🍎 {t.morningSnack}</h3>
              <p>{selectedMeal.morningSnack || '—'}</p>
            </div>

            <div className="meal-item">
              <h3>🍲 {t.lunch}</h3>
              <p>{selectedMeal.lunch || '—'}</p>
            </div>

            <div className="meal-item">
              <h3>🍪 {t.afternoonSnack}</h3>
              <p>{selectedMeal.afternoonSnack || '—'}</p>
            </div>
          </div>

          {selectedMeal.allergens && (
            <p className="meal-allergens-row">
              <strong>⚠️ {t.allergens}:</strong> {selectedMeal.allergens}
            </p>
          )}

          {selectedMeal.notes && (
            <p className="meal-notes-row">
              💬 <em>{t.chefsNote}:</em> {selectedMeal.notes}
            </p>
          )}
        </article>
      )}

      {/* Empty State when no meal registered for this day */}
      {!loading && !editing && !hasMealContent && (
        <article className="roster-card meal-day-card meal-empty-card" style={{ padding: '36px 24px', textAlign: 'center' }}>
          <div className="meal-card-header" style={{ justifyContent: 'center', marginBottom: '14px' }}>
            <h2>{t[DAYS.find((d) => d.key === activeDay)!.labelKey]}</h2>
          </div>
          <p style={{ fontSize: '15px', color: 'var(--kd-muted)', margin: '0 auto 20px auto', maxWidth: '420px' }}>
            🍽️ {t.noMealForDay}
          </p>
          {canEdit && (
            <button
              type="button"
              className="btn primary"
              onClick={startEditing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', margin: '0 auto' }}
            >
              + {t.addMeal}
            </button>
          )}
        </article>
      )}

      {/* Staff Meal Editor */}
      {!loading && editing && canEdit && (
        <form className="login-form meal-form" onSubmit={handleSave}>
          <fieldset disabled={saving}>
            <h2>{hasMealContent ? t.editMeal : t.addMeal} · {t[DAYS.find((d) => d.key === activeDay)!.labelKey]}</h2>

            <div className="meal-presets">
              <button
                type="button"
                className="btn ghost small-btn"
                onClick={() => applyPreset('mediterranean')}
              >
                🥗 {t.presetMediterranean}
              </button>
              <button
                type="button"
                className="btn ghost small-btn"
                onClick={() => applyPreset('vegetarian')}
              >
                🍲 {t.presetVegetarian}
              </button>
            </div>

            <label>
              {t.breakfast}
              <input
                required
                maxLength={500}
                value={draft.breakfast}
                onChange={(e) => setDraft({ ...draft, breakfast: e.target.value })}
              />
            </label>

            <label>
              {t.morningSnack}
              <input
                maxLength={500}
                value={draft.morningSnack}
                onChange={(e) => setDraft({ ...draft, morningSnack: e.target.value })}
              />
            </label>

            <label>
              {t.lunch}
              <input
                required
                maxLength={500}
                value={draft.lunch}
                onChange={(e) => setDraft({ ...draft, lunch: e.target.value })}
              />
            </label>

            <label>
              {t.afternoonSnack}
              <input
                maxLength={500}
                value={draft.afternoonSnack}
                onChange={(e) => setDraft({ ...draft, afternoonSnack: e.target.value })}
              />
            </label>

            <label>
              {t.allergens}
              <input
                maxLength={300}
                placeholder="e.g., Gluten, Lactose / Qumësht, Eggs / Vezë"
                value={draft.allergens || ''}
                onChange={(e) => setDraft({ ...draft, allergens: e.target.value })}
              />
            </label>

            <label>
              {t.chefsNote}
              <textarea
                maxLength={1000}
                placeholder="Këshilla ushqyese ose përbërësit e freskët lokalë..."
                value={draft.notes || ''}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </label>

            <div className="actions">
              <button className="btn primary">
                {saving ? t.attendanceSaving : t.saveMeal}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setEditing(false)}
              >
                {t.cancel}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  )
}
