/* Display and manage kindergarten weekly food menu and allergen alerts */
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState, type FormEvent } from 'react'
import {
  listWeeklyMeals,
  updateWeeklyMeal,
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

export default function Meals() {
  const { token, user } = useAuth()
  const { t } = useI18n()
  const alive = useAlive()

  const [meals, setMeals] = useState<WeeklyMeal[]>([])
  const [children, setChildren] = useState<Child[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  const [activeDay, setActiveDay] = useState<DayOfWeek>('monday')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<MealInput>({
    dayOfWeek: 'monday',
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

  const canEdit = user?.role === 'teacher' || user?.role === 'director'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)

    Promise.all([
      listWeeklyMeals(token || ''),
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
  }, [token, retry])

  function selectDay(day: DayOfWeek) {
    setActiveDay(day)
    setEditing(false)
    setSaveError('')
    setFeedback('')
    const currentMeal = meals.find((m) => m.dayOfWeek === day)
    if (currentMeal) {
      setDraft({
        dayOfWeek: currentMeal.dayOfWeek,
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
        breakfast: '',
        morningSnack: '',
        lunch: '',
        afternoonSnack: '',
        allergens: '',
        notes: '',
      })
    }
  }

  function applyPreset(type: 'mediterranean' | 'vegetarian') {
    if (type === 'mediterranean') {
      setDraft((d) => ({
        ...d,
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
      const res = await updateWeeklyMeal(token, draft)
      if (alive.current) {
        setMeals((prev) => [...prev.filter((m) => m.dayOfWeek !== res.meal.dayOfWeek), res.meal])
        setEditing(false)
        setFeedback(t.mealSaved)
      }
    } catch {
      if (alive.current) setSaveError(t.saveError)
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  const selectedMeal = meals.find((m) => m.dayOfWeek === activeDay)

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
      {!loading && !editing && selectedMeal && (
        <article className="roster-card meal-day-card">
          <div className="meal-card-header">
            <h2>{t[DAYS.find((d) => d.key === activeDay)!.labelKey]}</h2>
            {canEdit && (
              <button
                type="button"
                className="btn ghost small-btn"
                onClick={() => setEditing(true)}
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
              <p>{selectedMeal.breakfast}</p>
            </div>

            <div className="meal-item">
              <h3>🍎 {t.morningSnack}</h3>
              <p>{selectedMeal.morningSnack}</p>
            </div>

            <div className="meal-item">
              <h3>🍲 {t.lunch}</h3>
              <p>{selectedMeal.lunch}</p>
            </div>

            <div className="meal-item">
              <h3>🍪 {t.afternoonSnack}</h3>
              <p>{selectedMeal.afternoonSnack}</p>
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

      {/* Staff Meal Editor */}
      {!loading && editing && canEdit && (
        <form className="login-form meal-form" onSubmit={handleSave}>
          <fieldset disabled={saving}>
            <h2>{t.editMeal} · {t[DAYS.find((d) => d.key === activeDay)!.labelKey]}</h2>

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
                required
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
                required
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
