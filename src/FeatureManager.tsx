/* eslint-disable react/set-state-in-effect */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import Icon, { type IconName } from './Icon'
import {
  getFeaturePermissions,
  updateFeaturePermission,
  resetFeaturePermissions,
  type FeaturePermissionMap,
  type FeatureRole,
} from './api'

type FeatureCategory = 'daily' | 'community' | 'admin'

type FeatureItem = {
  key: string
  icon: IconName
  category: FeatureCategory
  titleEn: string
  titleSq: string
  descEn: string
  descSq: string
}

const MODULES_REGISTRY: FeatureItem[] = [
  // Daily Care & Children
  {
    key: 'attendance',
    icon: 'attendance',
    category: 'daily',
    titleEn: 'Attendance Tracking',
    titleSq: 'Regjistri i Pjesëmarrjes',
    descEn: 'Mark student present/absent statuses, track morning arrivals, and daily group ratios.',
    descSq: 'Shënimi i pranisë/mungesave, mbërritjet e mëngjesit dhe raporti ditor i grupeve.',
  },
  {
    key: 'reports',
    icon: 'reports',
    category: 'daily',
    titleEn: 'Daily Child Reports',
    titleSq: 'Raportet Ditore të Fëmijëve',
    descEn: 'Mood ratings, meal intake, naps, classroom activities, and photo moments.',
    descSq: 'Vlerësimi i humorit, ushqimit, gjumit, aktiviteteve dhe fotografive ditore.',
  },
  {
    key: 'program',
    icon: 'program',
    category: 'daily',
    titleEn: 'Educational Curricula & Plans',
    titleSq: 'Programi Edukativ & Kurrikula',
    descEn: 'Weekly learning themes, structured circle activities, and pedagogical schedules.',
    descSq: 'Temat javore mësimore, aktivitetet në rreth dhe oraret pedagogjike.',
  },
  {
    key: 'meals',
    icon: 'meals',
    category: 'daily',
    titleEn: 'Weekly Food Menu & Nutrition',
    titleSq: 'Menuja Ushqimore & Ushqimi',
    descEn: 'Breakfast, lunch, and snack meal plans with allergen tracking and parent approvals.',
    descSq: 'Mëngjesi, dreka dhe zamrat ditore me kontroll të alergeneve dhe miratime prindërore.',
  },
  {
    key: 'sleep',
    icon: 'sleep',
    category: 'daily',
    titleEn: 'Nap & Rest Quality Tracker',
    titleSq: 'Ditari i Gjumit & Pushimit',
    descEn: 'Track nap durations, wake-up times, and restful sleep quality indicators.',
    descSq: 'Monitorimi i kohëzgjatjes së gjumit, orës së zgjimit dhe cilësisë së pushimit.',
  },
  {
    key: 'hygiene',
    icon: 'hygiene',
    category: 'daily',
    titleEn: 'Potty & Diaper Hygiene Tracker',
    titleSq: 'Higjiena & Trajnimi i Tualetit',
    descEn: 'Log diaper changes (wet/dirty), potty milestones, accidents, and rash creams.',
    descSq: 'Regjistrimi i ndërrimeve të pelenave, sukseseve në tualet, aksidenteve dhe kremrave.',
  },
  {
    key: 'timeline',
    icon: 'clock',
    category: 'daily',
    titleEn: 'Daily Timeline & Live Activity Feed',
    titleSq: 'Vija Kohore Ditore & Rrjedha Live',
    descEn: 'Chronological timeline of arrivals, morning health checks, sleep, hygiene, and classroom moments.',
    descSq: 'Rrjedhë kronologjike e mbërritjeve, triazhit shëndetësor, gjumit, higjienës dhe momenteve në klasë.',
  },

  // Family & Community
  {
    key: 'messages',
    icon: 'messages',
    category: 'community',
    titleEn: 'Direct Family Messaging',
    titleSq: 'Bisedat & Mesazhet me Familje',
    descEn: 'Two-way private threaded communications between kindergarten educators and parents.',
    descSq: 'Komunikim i drejtpërdrejtë dhe i sigurt mes edukatorëve dhe prindërve.',
  },
  {
    key: 'announcements',
    icon: 'announcements',
    category: 'community',
    titleEn: 'School Announcements & Broadcasts',
    titleSq: 'Njoftimet & Transmetimet e Kopshtit',
    descEn: 'Important emergency notices, school alerts, holidays, and targeted group updates.',
    descSq: 'Njoftime të rëndësishme, pushimet shkollore dhe informata zyrtare për grupet.',
  },
  {
    key: 'moments',
    icon: 'moments',
    category: 'community',
    titleEn: 'Classroom Moments & Artwork',
    titleSq: 'Momentet në Klasë & Krijimet',
    descEn: 'Joyful daily learning highlights, creative artwork photos, and group stories.',
    descSq: 'Pikat kryesore të mësimit, punëdoret kreative dhe momentet e gëzueshme në klasë.',
  },
  {
    key: 'events',
    icon: 'events',
    category: 'community',
    titleEn: 'Events, Excursions & Calendar RSVP',
    titleSq: 'Ngjarjet, Ekskursionet & Kalendari',
    descEn: 'Schedule celebrations, field trips, digital parent RSVPs, and signed permission slips.',
    descSq: 'Festat, shëtitjet, konfirmimet digjitale RSVP dhe lejet e nënshkruara të prindërve.',
  },

  // School Operations & Administration
  {
    key: 'dashboard',
    icon: 'dashboard',
    category: 'admin',
    titleEn: 'Operational Dashboard',
    titleSq: 'Paneli Kryesor Operativ',
    descEn: 'Real-time overview metrics, day cards, attendance summaries, and quick actions.',
    descSq: 'Pasqyra e përgjithshme ditore, metrikat operative dhe veprimet e shpejta.',
  },
  {
    key: 'children',
    icon: 'children',
    category: 'admin',
    titleEn: 'Student Directory & Photo Consent',
    titleSq: 'Regjistri i Fëmijëve & Pëlqimi',
    descEn: 'Student rosters, emergency parent contacts, allergies, and GDPR photo permissions.',
    descSq: 'Regjistri i fëmijëve, kontaktet e prindërve, alergjitë dhe pëlqimi për fotografi.',
  },
  {
    key: 'payments',
    icon: 'payments',
    category: 'admin',
    titleEn: 'Tuition Billing & Invoices',
    titleSq: 'Faturat & Pagesat e Tarifave',
    descEn: 'Itemized monthly kindergarten tuition, official fiscal receipts, and payment status.',
    descSq: 'Faturimi mujor i kopshtit, dëftesat zyrtare të pagesave dhe statusi i tarifave.',
  },
  {
    key: 'documents',
    icon: 'documents',
    category: 'admin',
    titleEn: 'Digital Document Hub & Contracts',
    titleSq: 'Qendra e Dokumenteve & Kontratat',
    descEn: 'Enrollment agreements, immunization records, birth certificates, and verification.',
    descSq: 'Kontratat e regjistrimit, vërtetimet e vaksinimit dhe dokumentet zyrtare.',
  },
  {
    key: 'medications',
    icon: 'medication',
    category: 'admin',
    titleEn: 'Medication Auth & Arrival Triage',
    titleSq: 'Medikamentet & Triazhi Shëndetësor',
    descEn: 'Doctor prescription authorizations, witnessed dose logs, and morning health checks.',
    descSq: 'Autorizimi i barnave mjekësore, dhënia e dëshmuar e dozave dhe triazhi i mëngjesit.',
  },
  {
    key: 'absences',
    icon: 'absences',
    category: 'admin',
    titleEn: 'Planned Absences & Sick Leave',
    titleSq: 'Njoftimet e Mungesave & Pushimet',
    descEn: 'Advance parent notices for family vacations or sickness, meal planning integration.',
    descSq: 'Njoftimi i mungesave nga prindërit për pushime apo sëmundje me arsyetime.',
  },
  {
    key: 'incidents',
    icon: 'incidents',
    category: 'admin',
    titleEn: 'Health Profile & Incident Logs',
    titleSq: 'Profili Mjekësor & Incidentet',
    descEn: 'Pediatric emergency cards, playground incident reports, and parent acknowledgments.',
    descSq: 'Kartonët e emergjencës, raportimi i lëndimeve në kopsht dhe nënshkrimi prindëror.',
  },
  {
    key: 'milestones',
    icon: 'milestones',
    category: 'admin',
    titleEn: 'Developmental Milestones (EYFS)',
    titleSq: 'Hapat e Zhvillimit & Arritjet (EYFS)',
    descEn: 'Early childhood development tracking across motor, language, social, and cognitive areas.',
    descSq: 'Monitorimi i arritjeve të hershme: komunikimi, lëvizja, shoqërizimi dhe mendimi.',
  },
  {
    key: 'staff',
    icon: 'staff',
    category: 'admin',
    titleEn: 'Staff Shifts & Room Ratios',
    titleSq: 'Orari i Stafit & Raporti i Dhomës',
    descEn: 'Educator shift scheduling, live check-ins, and legal educator-to-child ratio compliance.',
    descSq: 'Orari i punës i edukatorëve, regjistrimi i orëve dhe raporti ligjor edukatore-fëmijë.',
  },
]

export function FeatureManager({ onPermissionsChanged }: { onPermissionsChanged?: () => void } = {}) {
  const { token } = useAuth()
  const { t, lang } = useI18n()
  const alive = useRef(true)

  const [permissions, setPermissions] = useState<FeaturePermissionMap>({
    director: {},
    teacher: {},
    parent: {},
  })
  const [loading, setLoading] = useState(true)
  const [selectedRole, setSelectedRole] = useState<FeatureRole>('director')
  const [selectedCategory, setSelectedCategory] = useState<FeatureCategory | 'all'>('all')
  const [updatingKey, setUpdatingKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const loadPermissions = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const res = await getFeaturePermissions(token)
      if (alive.current) {
        setPermissions(res.permissions)
      }
    } catch (err: any) {
      if (alive.current) {
        setError(err.message || 'Failed to load feature permissions')
      }
    } finally {
      if (alive.current) {
        setLoading(false)
      }
    }
  }, [token])

  useEffect(() => {
    loadPermissions()
  }, [loadPermissions])

  const handleToggle = async (role: FeatureRole, featureKey: string, newEnabled: boolean) => {
    if (!token || updatingKey) return
    setUpdatingKey(`${role}-${featureKey}`)
    setError(null)
    setMessage(null)

    // Optimistic update
    setPermissions((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [featureKey]: newEnabled,
      },
    }))

    try {
      const res = await updateFeaturePermission(token, role, featureKey, newEnabled)
      if (alive.current) {
        setPermissions(res.permissions)
        setMessage(t.featureUpdatedToast)
      }
      onPermissionsChanged?.()
    } catch (err: any) {
      if (alive.current) {
        setError(err.message || 'Failed to update feature permission')
        // Revert on error
        loadPermissions()
      }
    } finally {
      if (alive.current) {
        setUpdatingKey(null)
      }
    }
  }

  const handleResetDefaults = async () => {
    if (!token) return
    if (!window.confirm('Reset all roles and modules back to factory defaults?')) return

    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const res = await resetFeaturePermissions(token)
      if (alive.current) {
        setPermissions(res.permissions)
        setMessage(t.featureResetToast)
      }
      onPermissionsChanged?.()
    } catch (err: any) {
      if (alive.current) {
        setError(err.message || 'Failed to reset feature permissions')
      }
    } finally {
      if (alive.current) {
        setLoading(false)
      }
    }
  }

  const handleEnableAllForRole = async (role: FeatureRole) => {
    if (!token) return
    setError(null)
    setMessage(null)

    for (const item of MODULES_REGISTRY) {
      await updateFeaturePermission(token, role, item.key, true)
    }
    loadPermissions()
    setMessage(t.featureUpdatedToast)
    onPermissionsChanged?.()
  }

  const getRoleActiveCount = (role: FeatureRole): number => {
    const roleMap = permissions[role] || {}
    return MODULES_REGISTRY.filter((m) => roleMap[m.key] !== false).length
  }

  const filteredModules = MODULES_REGISTRY.filter((m) => {
    if (selectedCategory === 'all') return true
    return m.category === selectedCategory
  })

  const currentRoleMap = permissions[selectedRole] || {}

  return (
    <div className="panel feature-manager-panel">
      <header className="panel-header">
        <div>
          <h1 tabIndex={-1}>{t.featureManagerTitle}</h1>
          <p className="panel-sub">{t.featureManagerSubtitle}</p>
        </div>
        <div className="panel-actions">
          <button
            type="button"
            className="btn secondary"
            onClick={handleResetDefaults}
            disabled={loading}
          >
            {t.resetDefaultsBtn}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => handleEnableAllForRole(selectedRole)}
            disabled={loading}
          >
            {t.enableAllBtn}
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="form-error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="form-success" style={{ marginBottom: '1rem' }}>
          {message}
        </div>
      )}

      {/* Module Overview Statistics */}
      <section className="features-stat-grid" aria-label="Feature Module Statistics">
        <article className="stat-card">
          <span className="stat-label">{t.statTotalFeatures}</span>
          <strong className="stat-value">{MODULES_REGISTRY.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t.statDirectorFeatures}</span>
          <strong className="stat-value stat-director">
            {getRoleActiveCount('director')} / {MODULES_REGISTRY.length}
          </strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t.statTeacherFeatures}</span>
          <strong className="stat-value stat-teacher">
            {getRoleActiveCount('teacher')} / {MODULES_REGISTRY.length}
          </strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t.statParentFeatures}</span>
          <strong className="stat-value stat-parent">
            {getRoleActiveCount('parent')} / {MODULES_REGISTRY.length}
          </strong>
        </article>
      </section>

      {/* Role Selection Tabs */}
      <div className="role-selector-bar" role="tablist" aria-label="Select Target Role">
        <button
          type="button"
          role="tab"
          aria-label={t.roleDirectorLabel}
          aria-selected={selectedRole === 'director'}
          className={`role-tab-card ${selectedRole === 'director' ? 'active' : ''}`}
          onClick={() => setSelectedRole('director')}
        >
          <div className="role-tab-icon">
            <Icon name="superadmin" size={24} />
          </div>
          <div className="role-tab-text">
            <strong>{t.roleDirectorLabel}</strong>
            <small>{getRoleActiveCount('director')} active modules</small>
          </div>
        </button>

        <button
          type="button"
          role="tab"
          aria-label={t.roleTeacherLabel}
          aria-selected={selectedRole === 'teacher'}
          className={`role-tab-card ${selectedRole === 'teacher' ? 'active' : ''}`}
          onClick={() => setSelectedRole('teacher')}
        >
          <div className="role-tab-icon">
            <Icon name="leaf" size={24} />
          </div>
          <div className="role-tab-text">
            <strong>{t.roleTeacherLabel}</strong>
            <small>{getRoleActiveCount('teacher')} active modules</small>
          </div>
        </button>

        <button
          type="button"
          role="tab"
          aria-label={t.roleParentLabel}
          aria-selected={selectedRole === 'parent'}
          className={`role-tab-card ${selectedRole === 'parent' ? 'active' : ''}`}
          onClick={() => setSelectedRole('parent')}
        >
          <div className="role-tab-icon">
            <Icon name="children" size={24} />
          </div>
          <div className="role-tab-text">
            <strong>{t.roleParentLabel}</strong>
            <small>{getRoleActiveCount('parent')} active modules</small>
          </div>
        </button>
      </div>

      {/* Category Filter Pills */}
      <div className="category-filter-bar">
        <button
          type="button"
          className={`filter-pill ${selectedCategory === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('all')}
        >
          {t.filterAllCategories}
        </button>
        <button
          type="button"
          className={`filter-pill ${selectedCategory === 'daily' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('daily')}
        >
          {t.categoryDailyCare}
        </button>
        <button
          type="button"
          className={`filter-pill ${selectedCategory === 'community' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('community')}
        >
          {t.categoryCommunity}
        </button>
        <button
          type="button"
          className={`filter-pill ${selectedCategory === 'admin' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('admin')}
        >
          {t.categoryOperations}
        </button>
      </div>

      {/* Modules List Grid */}
      <div className="modules-list-grid">
        {loading ? (
          <div className="loading-spinner" aria-busy="true">
            {t.attendanceSaving}...
          </div>
        ) : (
          filteredModules.map((item) => {
            const isEnabled = currentRoleMap[item.key] !== false
            const isUpdating = updatingKey === `${selectedRole}-${item.key}`
            const title = lang === 'sq' ? item.titleSq : item.titleEn
            const desc = lang === 'sq' ? item.descSq : item.descEn

            return (
              <article
                key={item.key}
                className={`feature-card ${isEnabled ? 'feature-enabled' : 'feature-disabled'}`}
              >
                <div className="feature-card-header">
                  <div className="feature-icon-wrapper">
                    <Icon name={item.icon} size={22} />
                  </div>
                  <div className="feature-title-block">
                    <h3 className="feature-title">{title}</h3>
                    <span className={`feature-category-badge cat-${item.category}`}>
                      {item.category === 'daily'
                        ? t.categoryDailyCare
                        : item.category === 'community'
                        ? t.categoryCommunity
                        : t.categoryOperations}
                    </span>
                  </div>
                </div>

                <p className="feature-desc">{desc}</p>

                <div className="feature-card-footer">
                  <span
                    className={`feature-status-badge ${
                      isEnabled ? 'status-active' : 'status-disabled'
                    }`}
                  >
                    {isEnabled ? t.featureEnabledBadge : t.featureDisabledBadge}
                  </span>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={isEnabled}
                    aria-label={`Toggle ${title} for ${selectedRole}`}
                    disabled={isUpdating}
                    className={`feature-toggle-switch ${isEnabled ? 'switch-on' : 'switch-off'}`}
                    onClick={() => handleToggle(selectedRole, item.key, !isEnabled)}
                  >
                    <span className="toggle-slider" />
                  </button>
                </div>
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}
