/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { listChildren, listPrograms, saveProgram, type Child, type DailyProgram } from './api'
import { useAuth } from './auth'
import { useI18n } from './i18n/LanguageContext'
import { localCalendarDate, validDate } from './attendance-date.js'
import { displayDate, useAlive } from './pilot-utils'

const TEMPLATE_SQ = {
  theme: 'Eksplorimi i Natyrës dhe Kafshëve',
  activities: '09:00 Rrethi i mëngjesit, këngë dhe përshëndetje\n10:00 Veprimtari kreative: Pikturim me gishta dhe modelim me plastelinë\n11:00 Lojëra aktive në oborr & ajër të pastër\n14:30 Lexim përrallash dhe pushim i qetë\n15:30 Lojëra të lira në qendrat e interesit',
  mealsMenu: 'Mëngjesi: Qull tërshëre me mollë dhe kanellë\nDreka: Supë me perime të freskëta, mish pule dhe oriz\nZemra: Biskota integrale dhe fruta stine',
  notes: 'Ju lutem sillni rroba komode rezervë dhe shishe uji me emër.',
}

const TEMPLATE_EN = {
  theme: 'Nature & Animal Exploration',
  activities: '09:00 Morning circle, welcome songs & sharing\n10:00 Creative arts: Finger painting & playdough modeling\n11:00 Active outdoor garden play & fresh air\n14:30 Story reading & calming quiet time\n15:30 Free play in learning stations',
  mealsMenu: 'Breakfast: Oatmeal with fresh apples & cinnamon\nLunch: Fresh vegetable soup, roasted chicken & rice\nSnack: Whole grain biscuits & seasonal fruits',
  notes: 'Please bring a spare set of comfortable clothes and a labeled water bottle.',
}

export default function Program({ initialDate }: { initialDate?: string }) {
  const { token, user } = useAuth()
  const { t, lang } = useI18n()
  const alive = useAlive()
  const loads = useRef(0)

  const [children, setChildren] = useState<Child[]>([])
  const [date, setDate] = useState(() => initialDate || localCalendarDate())
  const [selectedGroup, setSelectedGroup] = useState('')
  const [programs, setPrograms] = useState<DailyProgram[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const [theme, setTheme] = useState('')
  const [activities, setActivities] = useState('')
  const [mealsMenu, setMealsMenu] = useState('')
  const [notes, setNotes] = useState('')

  const canEdit = user?.role === 'teacher' || user?.role === 'director'

  // Load children to know available groups
  useEffect(() => {
    let cancelled = false
    if (!token) return
    void listChildren(token).then(({ children: rows }) => {
      if (cancelled) return
      setChildren(rows)
      if (rows.length > 0) {
        setSelectedGroup((prev) => (prev ? prev : rows[0]?.groupName || ''))
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [token])

  // Get unique group names
  const availableGroups = Array.from(new Set(children.map((c) => c.groupName).filter(Boolean)))

  // Load programs when date, token or retry changes
  async function loadData() {
    if (!token || !validDate(date)) {
      setLoading(false)
      return
    }
    const version = ++loads.current
    setLoading(true)
    setError('')
    try {
      const data = await listPrograms(token, date, canEdit ? undefined : selectedGroup)
      if (alive.current && version === loads.current) {
        setPrograms(data.programs)
        // If editing a specific group, fill draft from existing program if present
        const currentProg = data.programs.find((p) => p.groupName === selectedGroup)
        if (currentProg) {
          setTheme(currentProg.theme)
          setActivities(currentProg.activities)
          setMealsMenu(currentProg.mealsMenu)
          setNotes(currentProg.notes || '')
        } else {
          setTheme('')
          setActivities('')
          setMealsMenu('')
          setNotes('')
        }
      }
    } catch {
      if (alive.current && version === loads.current) setError('load')
    } finally {
      if (alive.current && version === loads.current) setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    return () => { loads.current++ }
  }, [token, date, selectedGroup, canEdit])

  function applyTemplate() {
    const tmpl = lang === 'sq' ? TEMPLATE_SQ : TEMPLATE_EN
    setTheme(tmpl.theme)
    setActivities(tmpl.activities)
    setMealsMenu(tmpl.mealsMenu)
    setNotes(tmpl.notes)
    setSaved(false)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!token || busy || !selectedGroup || !validDate(date)) return
    if (!theme.trim() || !activities.trim() || !mealsMenu.trim()) {
      setError('save')
      return
    }
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const { program } = await saveProgram(token, {
        groupName: selectedGroup,
        programDate: date,
        theme: theme.trim(),
        activities: activities.trim(),
        mealsMenu: mealsMenu.trim(),
        notes: notes.trim(),
      })
      if (alive.current) {
        setPrograms((prev) => {
          const others = prev.filter((p) => !(p.groupName === program.groupName && p.programDate === program.programDate))
          return [program, ...others]
        })
        setSaved(true)
      }
    } catch {
      if (alive.current) setError('save')
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const activeProgram = programs.find((p) => p.groupName === selectedGroup)

  return (
    <section className="panel">
      <h1>{t.programTitle}</h1>
      <p>{canEdit ? t.programStaffDescription : t.programParentDescription}</p>

      <div className="filters">
        <label>
          {t.attendanceDate}
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              setSaved(false)
            }}
          />
        </label>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setDate(localCalendarDate())
            setSaved(false)
          }}
        >
          {t.attendanceToday}
        </button>

        {availableGroups.length > 0 && (
          <label>
            {t.programGroup}
            <select
              value={selectedGroup}
              onChange={(e) => {
                setSelectedGroup(e.target.value)
                setSaved(false)
              }}
            >
              {availableGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!validDate(date) && <p role="alert">{t.attendanceInvalidDate}</p>}
      {loading && <p role="status">{t.loading}</p>}
      {error === 'load' && (
        <p role="alert" className="form-error">
          {t.loadError}{' '}
          <button type="button" onClick={() => void loadData()}>
            {t.attendanceRetry}
          </button>
        </p>
      )}

      {/* Staff Editor Form */}
      {canEdit && (
        <form className="login-form program-form" onSubmit={handleSave}>
          <div className="actions" style={{ justifyContent: 'space-between', margin: '0 0 0.5rem' }}>
            <span style={{ fontWeight: 600 }}>{selectedGroup ? `✏️ ${selectedGroup} · ${displayDate(date, lang)}` : ''}</span>
            <button type="button" className="btn ghost" onClick={applyTemplate}>
              💡 {t.programQuickTemplate}
            </button>
          </div>

          <label>
            🎨 {t.programTheme}
            <input
              type="text"
              required
              maxLength={300}
              placeholder={t.programThemePlaceholder}
              value={theme}
              onChange={(e) => {
                setTheme(e.target.value)
                setSaved(false)
              }}
            />
          </label>

          <label>
            ⏱️ {t.programActivities}
            <textarea
              required
              rows={4}
              maxLength={5000}
              placeholder={t.programActivitiesPlaceholder}
              value={activities}
              onChange={(e) => {
                setActivities(e.target.value)
                setSaved(false)
              }}
            />
          </label>

          <label>
            🍎 {t.programMealsMenu}
            <textarea
              required
              rows={3}
              maxLength={5000}
              placeholder={t.programMealsMenuPlaceholder}
              value={mealsMenu}
              onChange={(e) => {
                setMealsMenu(e.target.value)
                setSaved(false)
              }}
            />
          </label>

          <label>
            📢 {t.programNotes}
            <textarea
              rows={2}
              maxLength={5000}
              placeholder={t.programNotesPlaceholder}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                setSaved(false)
              }}
            />
          </label>

          {error === 'save' && <p role="alert" className="form-error">{t.saveError}</p>}
          {saved && <p role="status" className="attendance-feedback">✓ {t.programSaved}</p>}

          <button type="submit" className="btn primary" disabled={busy || !selectedGroup}>
            {busy ? t.attendanceSaving : t.programSave}
          </button>
        </form>
      )}

      {/* Program Bulletin Card (Viewable by Parents and Staff) */}
      {!loading && activeProgram && (
        <article className="roster-card program-card">
          <div className="program-header">
            <h2>🎈 {activeProgram.groupName}</h2>
            <span className="program-date-tag">{displayDate(activeProgram.programDate, lang)}</span>
          </div>

          <div className="program-theme-banner">
            <h3>🎨 {t.programTheme}:</h3>
            <p className="theme-text">{activeProgram.theme}</p>
          </div>

          <div className="program-sections-grid">
            <div className="program-block">
              <h3>⏱️ {t.programActivities}</h3>
              <div className="pre-text">{activeProgram.activities}</div>
            </div>

            <div className="program-block">
              <h3>🍎 {t.programMealsMenu}</h3>
              <div className="pre-text">{activeProgram.mealsMenu}</div>
            </div>
          </div>

          {activeProgram.notes && (
            <div className="program-notes-block">
              <h3>📢 {t.programNotes}</h3>
              <p>{activeProgram.notes}</p>
            </div>
          )}

          {activeProgram.createdByName && (
            <p className="program-author">
              <small>✍️ {activeProgram.createdByName}</small>
            </p>
          )}
        </article>
      )}

      {!loading && !activeProgram && !canEdit && (
        <p className="hint" style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          🧸 {t.programEmpty}
        </p>
      )}
    </section>
  )
}
