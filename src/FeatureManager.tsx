/* eslint-disable react/set-state-in-effect */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './auth-context'
import { useI18n } from './i18n/language-context'
import Icon, { type IconName } from './Icon'
import {
  getFeaturePermissions,
  updateFeaturePermission,
  resetFeaturePermissions,
  listStaff,
  listParents,
  createStaff,
  createParent,
  resetUserPassword,
  downloadDatabaseBackup,
  restoreDatabaseBackup,
  type FeaturePermissionMap,
  type FeatureRole,
  type User,
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
  const { token, user } = useAuth()
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

  const [activeTab, setActiveTab] = useState<'modules' | 'accounts' | 'backups'>('modules')
  const [backupBusy, setBackupBusy] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [selectedBackupFile, setSelectedBackupFile] = useState<File | null>(null)
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [restoreStatus, setRestoreStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createRole, setCreateRole] = useState<'teacher' | 'director' | 'parent' | 'superadmin'>('teacher')
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createSuccess, setCreateSuccess] = useState<string | null>(null)

  const [users, setUsers] = useState<User[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'director' | 'teacher' | 'parent' | 'superadmin'>('all')
  const [userSearch, setUserSearch] = useState('')
  const [resetTarget, setResetTarget] = useState<User | null>(null)
  const [newPasswordVal, setNewPasswordVal] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

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

  const loadUsers = useCallback(async () => {
    if (!token) return
    setLoadingUsers(true)
    try {
      const [staffRes, parentsRes] = await Promise.all([
        listStaff(token).catch(() => ({ staff: [] })),
        listParents(token).catch(() => ({ parents: [] })),
      ])
      if (alive.current) {
        setUsers([...staffRes.staff, ...parentsRes.parents])
      }
    } catch {
      // ignore
    } finally {
      if (alive.current) {
        setLoadingUsers(false)
      }
    }
  }, [token])

  useEffect(() => {
    loadPermissions()
    loadUsers()
  }, [loadPermissions, loadUsers])

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || createBusy) return
    setCreateBusy(true)
    setCreateError(null)
    setCreateSuccess(null)
    try {
      if (createRole === 'parent') {
        await createParent(token, {
          name: createName.trim(),
          email: createEmail.trim(),
          password: createPassword,
        })
      } else {
        await createStaff(token, {
          name: createName.trim(),
          email: createEmail.trim(),
          password: createPassword,
          role: createRole,
        })
      }
      if (alive.current) {
        setCreateSuccess(`${t.accountCreatedSuccess} (${createEmail.trim()})`)
        setCreateName('')
        setCreateEmail('')
        setCreatePassword('')
        loadUsers()
        setTimeout(() => {
          if (alive.current) {
            setShowCreateModal(false)
            setCreateSuccess(null)
          }
        }, 1500)
      }
    } catch (err: any) {
      if (alive.current) {
        if (err?.status === 409 || String(err?.message || '').includes('email_exists') || String(err?.error || '').includes('email_exists')) {
          setCreateError(t.emailExists)
        } else if (err?.status === 400) {
          setCreateError(
            createRole === 'parent'
              ? (lang === 'sq' ? 'Fjalëkalimi i prindit duhet të ketë të paktën 10 karaktere.' : 'Parent password must be at least 10 characters.')
              : (lang === 'sq' ? 'Ju lutem kontrolloni formatin e email-it dhe fjalëkalimin.' : 'Please check email format and password.')
          )
        } else {
          setCreateError(err.message || t.saveError)
        }
      }
    } finally {
      if (alive.current) {
        setCreateBusy(false)
      }
    }
  }

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !resetTarget || resetBusy) return
    setResetBusy(true)
    setResetError(null)
    try {
      await resetUserPassword(token, resetTarget.id, newPasswordVal)
      if (alive.current) {
        setMessage(t.staffResetSuccess)
        setResetTarget(null)
        setNewPasswordVal('')
        setTimeout(() => {
          if (alive.current) setMessage(null)
        }, 4000)
      }
    } catch (err: any) {
      if (alive.current) {
        setResetError(err.message || 'Failed to reset password')
      }
    } finally {
      if (alive.current) {
        setResetBusy(false)
      }
    }
  }

  const handleDownloadBackup = async () => {
    if (!token || backupBusy) return
    setBackupBusy(true)
    setError(null)
    setMessage(null)
    try {
      await downloadDatabaseBackup(token)
      if (alive.current) {
        setMessage(lang === 'sq' ? 'Kopja rezervë u shkarkua me sukses!' : 'Backup downloaded successfully!')
      }
    } catch {
      if (alive.current) {
        setError(lang === 'sq' ? 'Dështoi shkarkimi i kopjes rezervë.' : 'Failed to download backup.')
      }
    } finally {
      if (alive.current) setBackupBusy(false)
    }
  }

  const handleRestoreSubmit = async () => {
    if (!token || !selectedBackupFile || restoreBusy) return
    setRestoreBusy(true)
    setRestoreStatus(null)
    setShowRestoreConfirm(false)
    try {
      await restoreDatabaseBackup(token, selectedBackupFile)
      if (alive.current) {
        setRestoreStatus({ type: 'success', text: t.restoreSuccess })
        setSelectedBackupFile(null)
        setTimeout(() => {
          window.location.reload()
        }, 1500)
      }
    } catch {
      if (alive.current) {
        setRestoreStatus({ type: 'error', text: t.restoreError })
      }
    } finally {
      if (alive.current) setRestoreBusy(false)
    }
  }

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

  const filteredUsers = users.filter((u) => {
    if (userRoleFilter !== 'all' && u.role !== userRoleFilter) return false
    if (userSearch.trim()) {
      const q = userSearch.toLowerCase()
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="panel feature-manager-panel">
      <header className="panel-header">
        <div>
          <h1 tabIndex={-1}>{activeTab === 'modules' ? t.featureManagerTitle : t.usersDirectoryTitle}</h1>
          <p className="panel-sub">{activeTab === 'modules' ? t.featureManagerSubtitle : t.staffDirectoryTitle}</p>
        </div>
        <div className="panel-actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setCreateError(null)
              setCreateSuccess(null)
              setShowCreateModal(true)
            }}
          >
            + {t.createAccountBtn}
          </button>
          {activeTab === 'modules' && (
            <>
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
            </>
          )}
        </div>
      </header>

      {/* Primary Tab Navigation */}
      <div style={{ display: 'flex', gap: '8px', margin: '14px 0 20px', borderBottom: '1px solid var(--kd-line)' }}>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'modules' ? 'active' : ''}`}
          onClick={() => setActiveTab('modules')}
          style={{ padding: '8px 16px', borderRadius: '6px 6px 0 0', cursor: 'pointer' }}
        >
          {t.tabModules}
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'accounts' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('accounts')
            loadUsers()
          }}
          style={{ padding: '8px 16px', borderRadius: '6px 6px 0 0', cursor: 'pointer' }}
        >
          {t.tabAccounts} {users.length > 0 ? `(${users.length})` : ''}
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'backups' ? 'active' : ''}`}
          onClick={() => setActiveTab('backups')}
          style={{ padding: '8px 16px', borderRadius: '6px 6px 0 0', cursor: 'pointer' }}
        >
          {t.backupTitle}
        </button>
      </div>

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

      {activeTab === 'accounts' ? (
        <section className="accounts-management-section">
          <div className="filters" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`filter-btn ${userRoleFilter === 'all' ? 'active' : ''}`}
                onClick={() => setUserRoleFilter('all')}
              >
                {t.filterAllRoles}
              </button>
              <button
                type="button"
                className={`filter-btn ${userRoleFilter === 'director' ? 'active' : ''}`}
                onClick={() => setUserRoleFilter('director')}
              >
                {t.roleDirector}
              </button>
              <button
                type="button"
                className={`filter-btn ${userRoleFilter === 'teacher' ? 'active' : ''}`}
                onClick={() => setUserRoleFilter('teacher')}
              >
                {t.roleTeacher}
              </button>
              <button
                type="button"
                className={`filter-btn ${userRoleFilter === 'parent' ? 'active' : ''}`}
                onClick={() => setUserRoleFilter('parent')}
              >
                {t.roleParent}
              </button>
              <button
                type="button"
                className={`filter-btn ${userRoleFilter === 'superadmin' ? 'active' : ''}`}
                onClick={() => setUserRoleFilter('superadmin')}
              >
                {t.roleSuperAdmin}
              </button>
            </div>
            <input
              type="search"
              aria-label={t.searchPages}
              placeholder={`${t.searchPages}...`}
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              style={{ maxWidth: '280px', width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {loadingUsers ? (
            <div className="loading-spinner" aria-busy="true">{t.attendanceSaving}...</div>
          ) : filteredUsers.length === 0 ? (
            <p className="empty-notice">{t.noUsersFound}</p>
          ) : (
            <div className="shifts-grid" style={{ marginTop: '12px' }}>
              {filteredUsers.map((u) => (
                <article key={u.id} className="card shift-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '16px' }}>{u.name}</h3>
                      <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--kd-muted)' }}>{u.email}</p>
                    </div>
                    <span className={`badge role-badge ${u.role}`} style={{ textTransform: 'capitalize' }}>
                      {u.role === 'director' ? t.roleDirector : u.role === 'teacher' ? t.roleTeacher : u.role === 'superadmin' ? t.roleSuperAdmin : t.roleParent}
                    </span>
                  </div>
                  <div style={{ marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid var(--kd-line)' }}>
                    <button
                      type="button"
                      className="btn ghost small-btn"
                      onClick={() => {
                        setResetTarget(u)
                        setNewPasswordVal('')
                        setResetError(null)
                      }}
                    >
                      🔑 {t.changePasswordBtn}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : activeTab === 'backups' ? (
        <section className="backups-management-section" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="notice" style={{ background: 'var(--kd-surface-alt, #f7faf5)', border: '1px solid var(--kd-border, #e2ead6)', padding: '16px', borderRadius: '12px', boxSizing: 'border-box', width: '100%', maxWidth: '100%' }}>
            <h3 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px' }}>
              <Icon name="documents" size={20} />
              {t.backupTitle}
            </h3>
            <p style={{ margin: 0, color: 'var(--kd-muted)', fontSize: '13px', lineHeight: '1.5' }}>
              {t.backupSubtitle}
            </p>
          </div>

          {restoreStatus && (
            <div
              className={`notice ${restoreStatus.type === 'success' ? 'success-banner' : 'error-banner'}`}
              role={restoreStatus.type === 'error' ? 'alert' : 'status'}
              style={{ margin: 0 }}
            >
              {restoreStatus.type === 'success' ? '✓ ' : '⚠ '}
              {restoreStatus.text}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {/* Download Backup Card */}
            <div className="panel" style={{ margin: 0, padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '16px', boxSizing: 'border-box' }}>
              <div>
                <h4 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px' }}>
                  <Icon name="arrow" size={18} />
                  {lang === 'sq' ? 'Eksporto Kopjen Rezervë' : 'Export Full Backup'}
                </h4>
                <p style={{ margin: 0, color: 'var(--kd-muted)', fontSize: '13px', lineHeight: '1.45' }}>
                  {lang === 'sq'
                    ? 'Shkarkoni menjëherë një skedar të plotë .sqlite në kompjuterin tuaj. Përmban të gjithë nxënësit, stafin, prindërit, prezencën, ushqimin dhe faturat.'
                    : 'Download an immediate .sqlite snapshot to your computer containing all students, staff, parents, attendance, meals, and invoices.'}
                </p>
              </div>
              <button
                type="button"
                className="btn primary"
                disabled={backupBusy}
                onClick={handleDownloadBackup}
                style={{ width: '100%', boxSizing: 'border-box', justifyContent: 'center' }}
              >
                {backupBusy ? t.backupInProgress : t.downloadBackupBtn}
              </button>
            </div>

            {/* Restore Card */}
            <div className="panel" style={{ margin: 0, padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '16px', boxSizing: 'border-box' }}>
              <div>
                <h4 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px' }}>
                  <Icon name="clock" size={18} />
                  {lang === 'sq' ? 'Rikthe nga Skedari' : 'Restore from Backup'}
                </h4>
                <p style={{ margin: 0, color: 'var(--kd-muted)', fontSize: '13px', lineHeight: '1.45' }}>
                  {lang === 'sq'
                    ? 'Ngarkoni një skedar .sqlite të shkarkuar më parë për të rikthyer të gjithë sistemin në atë pikë kohore.'
                    : 'Upload a previously downloaded .sqlite file to restore all kindergarten records back to that point in time.'}
                </p>
                <div style={{ marginTop: '12px' }}>
                  <input
                    type="file"
                    accept=".sqlite,application/x-sqlite3,application/octet-stream"
                    disabled={restoreBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null
                      setSelectedBackupFile(file)
                      setRestoreStatus(null)
                    }}
                    style={{ width: '100%', boxSizing: 'border-box', maxWidth: '100%', fontSize: '12px' }}
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn secondary"
                disabled={!selectedBackupFile || restoreBusy}
                onClick={() => setShowRestoreConfirm(true)}
                style={{ width: '100%', boxSizing: 'border-box', justifyContent: 'center' }}
              >
                {restoreBusy ? t.restoreInProgress : t.restoreBackupBtn}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
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
        </>
      )}

      {/* Create Account Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px', width: '100%', boxSizing: 'border-box' }}>
            <div className="modal-header">
              <h2>{t.createAccountModalTitle}</h2>
              <button type="button" className="btn-close" aria-label={t.cancel} onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            {createError && <div className="notice error-banner" role="alert" style={{ margin: '12px 0' }}>{createError}</div>}
            {createSuccess && <div className="notice success-banner" role="status" style={{ margin: '12px 0' }}>✓ {createSuccess}</div>}
            <form onSubmit={handleCreateAccount} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
              <div className="form-field">
                <label htmlFor="modal-create-role"><strong>{t.accountRoleLabel}</strong></label>
                <select
                  id="modal-create-role"
                  value={createRole}
                  onChange={(e) => setCreateRole(e.target.value as 'teacher' | 'director' | 'parent' | 'superadmin')}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                >
                  <option value="teacher">{t.roleTeacher} (Edukator)</option>
                  <option value="director">{t.roleDirector} (Drejtor)</option>
                  <option value="parent">{t.roleParent} (Prind)</option>
                  {user?.role === 'superadmin' && <option value="superadmin">{t.roleSuperAdmin} (Super Admin)</option>}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="modal-create-name"><strong>{t.staffMemberName}</strong></label>
                <input
                  id="modal-create-name"
                  type="text"
                  required
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Valbona Krasniqi"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div className="form-field">
                <label htmlFor="modal-create-email"><strong>{t.staffMemberEmail}</strong></label>
                <input
                  id="modal-create-email"
                  type="email"
                  required
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="user@kidoland.al"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div className="form-field">
                <label htmlFor="modal-create-pwd"><strong>{t.staffMemberPassword}</strong></label>
                <input
                  id="modal-create-pwd"
                  type="password"
                  required
                  minLength={createRole === 'parent' ? 10 : 6}
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder={createRole === 'parent' ? (lang === 'sq' ? 'Minimum 10 karaktere' : 'Min 10 characters') : (lang === 'sq' ? 'Minimum 6 karaktere' : 'Min 6 characters')}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
                <small style={{ color: 'var(--kd-muted)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                  {createRole === 'parent'
                    ? (lang === 'sq' ? '🔒 Llogaria e prindit kërkon të paktën 10 karaktere për siguri.' : '🔒 Parent accounts require at least 10 characters for security.')
                    : (lang === 'sq' ? '🔒 Kërkohen të paktën 6 karaktere.' : '🔒 Requires at least 6 characters.')}
                </small>
              </div>
              <div className="modal-actions" style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
                <button type="submit" className="btn primary" disabled={createBusy}>
                  {createBusy ? t.attendanceSaving : t.staffCreateSubmit}
                </button>
                <button type="button" className="btn ghost" onClick={() => setShowCreateModal(false)}>
                  {t.cancel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {resetTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setResetTarget(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px', width: '100%', boxSizing: 'border-box' }}>
            <div className="modal-header">
              <h2>{t.staffResetModalTitle}</h2>
              <button type="button" className="btn-close" aria-label={t.cancel} onClick={() => setResetTarget(null)}>✕</button>
            </div>
            <p style={{ margin: '8px 0 16px', color: 'var(--kd-muted)' }}>
              {resetTarget.name} ({resetTarget.email})
            </p>
            {resetError && <div className="notice error-banner" role="alert" style={{ marginBottom: '12px' }}>{resetError}</div>}
            <form onSubmit={handleResetPasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="form-field">
                <label htmlFor="modal-reset-new-pwd"><strong>{t.newPassword}</strong></label>
                <input
                  id="modal-reset-new-pwd"
                  type="password"
                  required
                  minLength={6}
                  value={newPasswordVal}
                  onChange={(e) => setNewPasswordVal(e.target.value)}
                  placeholder="Min 6 characters"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div className="modal-actions" style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button type="submit" className="btn primary" disabled={resetBusy}>
                  {resetBusy ? t.attendanceSaving : t.changePasswordBtn}
                </button>
                <button type="button" className="btn ghost" onClick={() => setResetTarget(null)}>
                  {t.cancel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Database Restore Confirmation Modal */}
      {showRestoreConfirm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowRestoreConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px', width: '100%', boxSizing: 'border-box' }}>
            <div className="modal-header">
              <h2>{t.restoreConfirmTitle}</h2>
              <button type="button" className="btn-close" aria-label={t.cancel} onClick={() => setShowRestoreConfirm(false)}>✕</button>
            </div>
            <div style={{ margin: '14px 0', color: 'var(--kd-text)', fontSize: '13px', lineHeight: '1.5' }}>
              <div className="notice error-banner" style={{ margin: '0 0 12px' }}>
                ⚠ {t.restoreConfirmText}
              </div>
              {selectedBackupFile && (
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--kd-muted)' }}>
                  {lang === 'sq' ? 'Skedari i përzgjedhur:' : 'Selected file:'}{' '}
                  <strong>{selectedBackupFile.name}</strong> ({(selectedBackupFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
            <div className="modal-actions" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button type="button" className="btn ghost" onClick={() => setShowRestoreConfirm(false)} disabled={restoreBusy}>
                {t.cancel}
              </button>
              <button
                type="button"
                className="btn primary"
                style={{ background: '#c53030', borderColor: '#c53030', color: '#fff' }}
                onClick={handleRestoreSubmit}
                disabled={restoreBusy}
              >
                {restoreBusy ? t.restoreInProgress : t.restoreConfirmAction}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
