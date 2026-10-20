/* eslint-disable react/set-state-in-effect */
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { AuthProvider } from './auth'
import { useAuth } from './auth-context'
import { LanguageProvider } from './i18n/LanguageContext'
import { useI18n } from './i18n/language-context'
import Attendance from './Attendance'
import Children from './Children'
import Reports from './Reports'
import Payments from './Payments'
import Dashboard from './Dashboard'
import Program from './Program'
import Announcements from './Announcements'
import Messages from './Messages'
import Absences from './Absences'
import Meals from './Meals'
import Incidents from './Incidents'
import Moments from './Moments'
import { Events } from './Events'
import { StaffShifts } from './StaffShifts'
import { Milestones } from './Milestones'
import Icon, { BrandMark, type IconName } from './Icon'
import KimiIcon from './KimiIcon'
import KimiNavigation from './KimiNavigation'
import PageFinder from './PageFinder'
import { Documents } from './Documents'
import { SleepTracker } from './SleepTracker'
import { MedicationHealth } from './MedicationHealth'
import { HygieneTracker } from './HygieneTracker'
import { DailyTimeline } from './Timeline'
import { FeatureManager } from './FeatureManager'
import { getFeaturePermissions, getSetupStatus, setupAdminRequest, registerParentRequest } from './api'
import './App.css'
import './theme.css'
import './Sidebar.css'
import './Kindergarten.css'

type View = 'home' | 'login' | 'dashboard' | 'reports' | 'payments' | 'attendance' | 'children' | 'program' | 'announcements' | 'messages' | 'absences' | 'meals' | 'incidents' | 'moments' | 'events' | 'staff' | 'milestones' | 'documents' | 'sleep' | 'medications' | 'hygiene' | 'timeline' | 'features'

const DEMO: { email: string; password: string; roleKey: 'roleParent' | 'roleTeacher' | 'roleDirector' | 'roleSuperAdmin'; name?: string }[] = [
  { email: 'admin@kidoland.demo', password: 'admin123', roleKey: 'roleSuperAdmin', name: 'Super Admin' },
  { email: 'adnan@kidoland.demo', password: 'parent123', roleKey: 'roleParent', name: 'Adnan Godanci (Parent)' },
  { email: 'parent@kidoland.demo', password: 'parent123', roleKey: 'roleParent' },
  { email: 'teacher@kidoland.demo', password: 'teacher123', roleKey: 'roleTeacher' },
  { email: 'director@kidoland.demo', password: 'director123', roleKey: 'roleDirector' },
]

const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO === 'true'

function Shell() {
  const { t, toggle, lang } = useI18n()
  const { user, token, loading, logout, expired, bootError, retryBoot } = useAuth()
  const [view, setView] = useState<View>('home')
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [menuOpen, setMenuOpen] = useState(false)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1280px)').matches)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => { try { return localStorage.getItem('kidoland.sidebar-collapsed') === 'true' } catch { return false } })
  const [sidebarPeeking, setSidebarPeeking] = useState(false)
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previouslyOpen = useRef(false)
  const [searchOwner, setSearchOwner] = useState<string | null>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const [reportContext, setReportContext] = useState<{ childId?: string; date?: string }>({})
  const [enabledFeatures, setEnabledFeatures] = useState<string[] | null>(null)

  const reloadFeatures = () => {
    if (token) {
      getFeaturePermissions(token)
        .then((res) => {
          if (res.enabledFeatures) {
            setEnabledFeatures(res.enabledFeatures)
          }
        })
        .catch(() => {})
    }
  }

  useEffect(() => {
    if (!token) return
    let active = true
    getFeaturePermissions(token)
      .then((res) => {
        if (active && res.enabledFeatures) {
          setEnabledFeatures(res.enabledFeatures)
        }
      })
      .catch(() => {
        // Fallback: all enabled
      })
    return () => {
      active = false
    }
  }, [token, user?.role])

  const activeView = user?.role === 'superadmin' && (view === 'home' || view === 'login' || view === 'dashboard')
    ? 'features'
    : user && (view === 'home' || view === 'login')
    ? 'dashboard'
    : view
  const isFeatureDisabled = Boolean(
    user &&
    user.role !== 'superadmin' &&
    (activeView === 'features' || (enabledFeatures && activeView !== 'dashboard' && !enabledFeatures.includes(activeView)))
  )
  const sidebarVisible = narrow ? menuOpen : !sidebarCollapsed || sidebarPeeking
  const roleLabel = user?.role === 'parent' ? t.roleParent : user?.role === 'teacher' ? t.roleTeacher : user?.role === 'superadmin' ? t.roleSuperAdmin : t.roleDirector
  const rawNavGroups: { label: string; items: { view: View; label: string; icon: IconName }[] }[] = [
    { label: t.navDaily, items: [
      { view: 'dashboard', label: t.navDashboard, icon: 'dashboard' },
      { view: 'attendance', label: t.attendanceTitle, icon: 'attendance' },
      { view: 'reports', label: t.navReports, icon: 'reports' },
      { view: 'program', label: t.navProgram, icon: 'program' },
      { view: 'meals', label: t.navMeals, icon: 'meals' },
      { view: 'sleep', label: t.navSleepTracker, icon: 'sleep' },
      { view: 'hygiene', label: t.navHygiene, icon: 'hygiene' },
      { view: 'timeline', label: t.navTimeline, icon: 'clock' },
    ] },
    { label: t.navCommunity, items: [
      { view: 'messages', label: t.navMessages, icon: 'messages' },
      { view: 'announcements', label: t.navAnnouncements, icon: 'announcements' },
      { view: 'moments', label: t.navMoments, icon: 'moments' },
      { view: 'events', label: t.navEvents, icon: 'events' },
    ] },
    { label: t.navManagement, items: [
      { view: 'children', label: user?.role === 'parent' ? t.consentTitle : t.childrenTitle, icon: 'children' },
      { view: 'payments', label: t.navPayments, icon: 'payments' },
      { view: 'documents', label: t.navDocuments, icon: 'documents' },
      { view: 'medications', label: t.navMedications, icon: 'medication' },
      { view: 'absences', label: t.navAbsences, icon: 'absences' },
      { view: 'incidents', label: t.navIncidents, icon: 'incidents' },
      { view: 'milestones', label: t.navMilestones, icon: 'milestones' },
      { view: 'staff', label: t.navStaffShifts, icon: 'staff' },
    ] },
    ...(user?.role === 'superadmin' ? [{
      label: t.navSystemAdmin,
      items: [
        { view: 'features' as View, label: t.navFeatures, icon: 'superadmin' as IconName },
      ],
    }] : []),
  ]

  const navGroups = rawNavGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (user?.role === 'superadmin') return true
      if (item.view === 'features') return false
      if (!enabledFeatures) return true
      return enabledFeatures.includes(item.view)
    }),
  })).filter((group) => group.items.length > 0)
  const currentLabel = navGroups.flatMap((group) => group.items).find((item) => item.view === activeView)?.label

  useEffect(() => { document.documentElement.lang = lang }, [lang])
  useEffect(() => {
    if (!user) return
    const search = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOwner((owner) => owner === user.id ? null : user.id) } }
    window.addEventListener('keydown', search)
    return () => window.removeEventListener('keydown', search)
  }, [user])
  useEffect(() => { const heading = document.querySelector<HTMLElement>('main h1'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); document.querySelector('.workspace-frame')?.scrollTo({ top: 0, left: 0, behavior: 'instant' }); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }) } }, [activeView, user?.id, loading])
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1280px)')
    const resize = () => { setNarrow(query.matches); setMenuOpen(false); setSidebarPeeking(false) }
    query.addEventListener('change', resize)
    return () => query.removeEventListener('change', resize)
  }, [])
  useEffect(() => { try { localStorage.setItem('kidoland.sidebar-collapsed', String(sidebarCollapsed)) } catch { /* Navigation works without storage. */ } }, [sidebarCollapsed])
  useEffect(() => () => { if (peekTimer.current) clearTimeout(peekTimer.current) }, [])
  useLayoutEffect(() => {
    if ((previouslyOpen.current && !menuOpen) || (!sidebarVisible && document.activeElement?.closest('.sidebar'))) menuButton.current?.focus({ preventScroll: true })
    previouslyOpen.current = menuOpen
  }, [menuOpen, sidebarVisible])
  useEffect(() => {
    if (!menuOpen) return
    const current = document.querySelector<HTMLButtonElement>('.sidebar [aria-current="page"]')
    const target = current && !current.closest('[hidden]') ? current : document.querySelector<HTMLButtonElement>('.sidebar-search')
    target?.focus({ preventScroll: true })
    const close = (event: KeyboardEvent) => {
      if (document.querySelector('.page-finder[open]')) return
      if (event.key === 'Escape') { setMenuOpen(false); return }
      if (event.key === 'Tab') {
        const buttons = [...document.querySelectorAll<HTMLButtonElement>('.sidebar button:not(:disabled)')]
        const first = buttons[0], last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [menuOpen])

  if (loading) return <div className="loading" role="status"><BrandMark /><span>{t.loading}</span></div>
  const go = (v: View, context?: { childId?: string; date?: string; authMode?: 'login' | 'signup' }) => {
    setReportContext(context || {})
    if (context?.authMode) setAuthMode(context.authMode)
    else if (v === 'login') setAuthMode('login')
    setView(v)
    setMenuOpen(false)
    setSidebarPeeking(false)
  }
  const keepPeek = () => { if (peekTimer.current) clearTimeout(peekTimer.current) }
  const peek = () => { keepPeek(); if (!narrow && sidebarCollapsed) setSidebarPeeking(true) }
  const leavePeek = () => { keepPeek(); peekTimer.current = setTimeout(() => setSidebarPeeking(false), 150) }
  const toggleSidebar = () => { keepPeek(); setSidebarPeeking(false); if (narrow) setMenuOpen((open) => !open); else setSidebarCollapsed((collapsed) => !collapsed) }
  const brand = <button type="button" className="brand" onClick={() => go(user ? (user.role === 'superadmin' ? 'features' : 'dashboard') : 'home')}><span className="brand-mark"><BrandMark /></span>{t.brand}<span className="brand-dot" aria-hidden="true">.</span></button>

  return (
    <div className={`app ${user ? `workspace ${narrow || sidebarCollapsed ? 'sidebar-collapsed' : ''}` : 'public-app'}`}>
      <a className="skip-link" href="#main-content">{t.skipContent}</a>
      {user && narrow && menuOpen && <button type="button" className="sidebar-scrim" tabIndex={-1} aria-label={t.closeMenu} onClick={() => setMenuOpen(false)} />}
      {user && <aside className={`sidebar ${sidebarVisible ? 'is-open' : ''} ${!narrow && sidebarCollapsed ? 'is-floating' : ''}`} id="workspace-navigation" inert={!sidebarVisible} role={narrow && menuOpen ? 'dialog' : undefined} aria-modal={narrow && menuOpen ? true : undefined} aria-label={narrow && menuOpen ? t.navigation : undefined} onPointerEnter={keepPeek} onPointerLeave={leavePeek} onKeyDown={(event) => { if (!narrow && sidebarCollapsed && event.key === 'Escape') { setSidebarPeeking(false); menuButton.current?.focus() } }}>
        <div className="sidebar-brand">{brand}<button type="button" className="sidebar-collapse" aria-label={narrow ? t.closeMenu : t.collapseSidebar} title={narrow ? t.closeMenu : t.collapseSidebar} onClick={toggleSidebar}><KimiIcon name="sidebar" /></button></div>
        <button type="button" className="sidebar-search" title={t.searchPages} aria-label={t.searchPages} onClick={() => setSearchOwner(user.id)}><KimiIcon name="newChat" /><span>{t.searchPages}</span><kbd aria-hidden="true"><span>⌘</span><span>K</span></kbd></button>
        <KimiNavigation pages={navGroups.flatMap((group) => group.items)} activeView={activeView} onChoose={(destination) => go(destination as View)} label={t.navigation} />
        <div className="sidebar-account"><span className="user-avatar" aria-hidden="true">{user.name.trim().slice(0, 1)}</span><div><strong>{user.name}</strong><span>{roleLabel}</span></div><button type="button" className="sidebar-logout" aria-label={t.logout} title={t.logout} onClick={() => { logout(); go('home') }}><Icon name="logout" size={18} /></button></div>
      </aside>}
      <div className={user ? 'workspace-frame' : 'public-frame'} inert={Boolean(user && narrow && menuOpen)}>
      <header className="nav">
        {user ? <><button ref={menuButton} type="button" className="menu-toggle" aria-label={narrow ? menuOpen ? t.closeMenu : t.openMenu : t.expandSidebar} title={narrow ? t.openMenu : t.expandSidebar} aria-expanded={sidebarVisible} aria-controls="workspace-navigation" onPointerEnter={(event) => { if (event.pointerType === 'mouse') peek() }} onPointerLeave={leavePeek} onClick={toggleSidebar}><KimiIcon name="sidebar" /></button><div className="workspace-location"><span>{t.brand}</span><span aria-hidden="true">/</span><strong>{currentLabel}</strong></div></> : brand}
        {!user && <nav className="public-nav" aria-label={t.navigation}><button type="button" onClick={() => go('home')}>{t.navFeatures}</button></nav>}
        <div className="nav-actions">
          {user && <button type="button" className="header-search" aria-label={t.searchPages} onClick={() => setSearchOwner(user.id)}><Icon name="search" size={18} /></button>}
          <button type="button" className="lang-btn" onClick={toggle}>{lang === 'en' ? 'SQ' : 'EN'} · {t.langToggle}</button>
          {user ? <><div className="user-identity"><span className="user-avatar" aria-hidden="true">{user.name.trim().slice(0, 1)}</span><div><strong>{user.name}</strong><span>{roleLabel}</span></div></div><button type="button" className="btn ghost logout-btn" onClick={() => { logout(); go('home') }}><Icon name="logout" /><span>{t.logout}</span></button></> : <div className="landing-nav-btns"><button type="button" className="btn ghost header-login-btn" onClick={() => go('login', { authMode: 'login' })}>{t.ctaStart}</button><button type="button" className="btn primary header-signup-btn" onClick={() => go('login', { authMode: 'signup' })}>{t.ctaSignUp}<Icon name="arrow" size={17} /></button></div>}
        </div>
      </header>

      {user && searchOwner === user.id && <PageFinder key={user.id} pages={navGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })))} onDismiss={() => setSearchOwner(null)} onChoose={(destination) => { setSearchOwner(null); go(destination as View) }} />}

      <main id="main-content" key={`${user?.id || 'public'}:${token || ''}`}>
        {expired && <p role="alert" className="notice session-notice">{t.attendanceSessionExpired}</p>}
        {bootError && <section className="panel"><p role="alert">{t.loadError}</p><div className="actions"><button className="btn primary" onClick={retryBoot}>{t.attendanceRetry}</button><button className="btn ghost" onClick={logout}>{t.logout}</button></div></section>}
        {!user && !bootError && activeView !== 'home' && <Login initialMode={authMode} onSuccess={() => go('dashboard')} />}
        {!user && !bootError && activeView === 'home' && <Home onLogin={(mode) => go('login', { authMode: mode || 'login' })} />}
        {user && isFeatureDisabled && (
          <section className="panel feature-disabled-panel">
            <h1 tabIndex={-1}>{currentLabel || t.navFeatures}</h1>
            <p role="alert" className="notice">{t.featureDisabledNotice}</p>
            <div className="actions" style={{ marginTop: '1rem' }}>
              <button className="btn primary" onClick={() => go('dashboard')}>{t.navDashboard}</button>
            </div>
          </section>
        )}
        {user && !isFeatureDisabled && activeView === 'dashboard' && <Dashboard go={go} />}
        {user && !isFeatureDisabled && activeView === 'attendance' && <Attendance initialDate={reportContext.date} />}
        {user && !isFeatureDisabled && activeView === 'reports' && <Reports initialChildId={reportContext.childId} initialDate={reportContext.date} />}
        {user && !isFeatureDisabled && activeView === 'program' && <Program initialDate={reportContext.date} />}
        {user && !isFeatureDisabled && activeView === 'announcements' && <Announcements />}
        {user && !isFeatureDisabled && activeView === 'messages' && <Messages />}
        {user && !isFeatureDisabled && activeView === 'payments' && <Payments />}
        {user && !isFeatureDisabled && activeView === 'absences' && <Absences />}
        {user && !isFeatureDisabled && activeView === 'meals' && <Meals />}
        {user && !isFeatureDisabled && activeView === 'incidents' && <Incidents />}
        {user && !isFeatureDisabled && activeView === 'moments' && <Moments />}
        {user && !isFeatureDisabled && activeView === 'events' && <Events />}
        {user && !isFeatureDisabled && activeView === 'staff' && <StaffShifts />}
        {user && !isFeatureDisabled && activeView === 'milestones' && <Milestones />}
        {user && !isFeatureDisabled && activeView === 'documents' && <Documents />}
        {user && !isFeatureDisabled && activeView === 'sleep' && <SleepTracker />}
        {user && !isFeatureDisabled && activeView === 'hygiene' && <HygieneTracker />}
        {user && !isFeatureDisabled && activeView === 'medications' && <MedicationHealth />}
        {user && !isFeatureDisabled && activeView === 'timeline' && <DailyTimeline initialChildId={reportContext.childId} initialDate={reportContext.date} />}
        {user && !isFeatureDisabled && activeView === 'children' && <Children />}
        {user && activeView === 'features' && <FeatureManager onPermissionsChanged={reloadFeatures} />}
      </main>
      <footer className="footer"><span className="footer-mark" aria-hidden="true"><Icon name="leaf" size={15} /></span><p>{t.footer}</p></footer>
      </div>
    </div>
  )
}


function Home({ onLogin }: { onLogin: (mode?: 'login' | 'signup') => void }) {
  const { t } = useI18n()
  return <>
    <section className="hero">
      <div className="hero-copy">
        <div className="hero-badge">
          <img src="/brand/mascot-yellow-star.png" alt="" className="hero-badge-icon" />
          <span>{t.brandCaption}</span>
        </div>
        <h1 tabIndex={-1}>{t.heroTitle}</h1>
        <p className="lead">{t.heroSub}</p>
        <div className="hero-cta">
          <button type="button" className="btn primary hero-signup-btn" onClick={() => onLogin('signup')}>{t.ctaSignUp}<Icon name="arrow" /></button>
          <button type="button" className="btn ghost hero-login-btn" onClick={() => onLogin('login')}>{t.ctaStart}</button>
          <span className="hero-language"><Icon name="check" size={16} />{t.featureLang}</span>
        </div>
        <div className="hero-perks">
          <span><Icon name="check" size={14} />{t.badgeAttendanceRate}</span>
          <span><Icon name="check" size={14} />{t.badgeDailyReport}</span>
        </div>
        <p className="hero-footnote">{t.careTogether}</p>
      </div>
      <div className="hero-showcase">
        <div className="hero-image-wrap">
          <img src="/brand/hero-child-boy.png" alt="Happy child at Kiddo Land" className="hero-main-img" />
          <div className="hero-floating-stat">
            <img src="/brand/mascot-orange-wink.png" alt="" className="floating-stat-avatar" />
            <div>
              <strong>{t.attendancePresent} · 98%</strong>
              <small>{t.brandCaption}</small>
            </div>
          </div>
          <div className="hero-floating-report">
            <div className="floating-report-header">
              <span className="sample-avatar sample-avatar-0">AK</span>
              <div>
                <strong>Arta Krasniqi</strong>
                <small>{t.reportsMoodVal}</small>
              </div>
              <span className="floating-report-check"><Icon name="check" size={12} /></span>
            </div>
            <div className="floating-report-note">
              <p>"{t.reportsNoteVal}"</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* Brand Identity Pillars Gallery */}
    <section className="landing-section brand-pillars-section">
      <div className="section-heading">
        <p className="eyebrow">{t.littleMoments}</p>
        <h2>{t.brandPillarsHeading}</h2>
        <p className="section-sub">{t.brandPillarsSub}</p>
      </div>
      <div className="brand-pillars-grid">
        <article className="brand-pillar-card pillar-coral">
          <div className="pillar-media">
            <img src="/brand/card-kids-crafts.png" alt={t.brandCardMemoriesTitle} />
            <img src="/brand/mascot-orange-wink.png" alt="" className="pillar-mascot" />
          </div>
          <div className="pillar-body">
            <h3>{t.brandCardMemoriesTitle}</h3>
            <p>{t.brandCardMemoriesSub}</p>
          </div>
        </article>
        <article className="brand-pillar-card pillar-green">
          <div className="pillar-media">
            <img src="/brand/card-green-imagination.png" alt={t.brandCardImaginationTitle} />
            <img src="/brand/mascot-green-curious.png" alt="" className="pillar-mascot" />
          </div>
          <div className="pillar-body">
            <h3>{t.brandCardImaginationTitle}</h3>
            <p>{t.brandCardImaginationSub}</p>
          </div>
        </article>
        <article className="brand-pillar-card pillar-purple">
          <div className="pillar-media">
            <img src="/brand/card-purple-joy.png" alt={t.brandCardJoyTitle} />
            <img src="/brand/mascot-purple-calm.png" alt="" className="pillar-mascot" />
          </div>
          <div className="pillar-body">
            <h3>{t.brandCardJoyTitle}</h3>
            <p>{t.brandCardJoySub}</p>
          </div>
        </article>
        <article className="brand-pillar-card pillar-blue">
          <div className="pillar-media">
            <img src="/brand/card-blue-bright.png" alt={t.brandCardBrightTitle} />
            <img src="/brand/mascot-blue-love.png" alt="" className="pillar-mascot" />
          </div>
          <div className="pillar-body">
            <h3>{t.brandCardBrightTitle}</h3>
            <p>{t.brandCardBrightSub}</p>
          </div>
        </article>
      </div>
    </section>

    {/* Live Workspace Preview */}
    <section className="landing-section preview-section">
      <div className="section-heading">
        <p className="eyebrow">{t.exampleWorkspace}</p>
        <h2>{t.dayOverview}</h2>
      </div>
      <WorkspacePreview />
    </section>

    {/* Everyday Features Grid */}
    <section className="landing-section">
      <div className="section-heading">
        <p className="eyebrow">{t.everyDayTitle}</p>
        <h2>{t.everyDayBody}</h2>
      </div>
      <div className="features">
        {([
          { title: t.featureReports, body: t.featureReportsBody, icon: 'reports', colorClass: 'feature-red' },
          { title: t.featurePayments, body: t.featurePaymentsBody, icon: 'payments', colorClass: 'feature-orange' },
          { title: t.featureLang, body: t.featureLangBody, icon: 'messages', colorClass: 'feature-purple' },
          { title: t.featureSafety, body: t.featureSafetyBody, icon: 'incidents', colorClass: 'feature-blue' }
        ] as const).map((feature) => (
          <article key={feature.title} className={feature.colorClass}>
            <span className="feature-icon"><Icon name={feature.icon} size={23} /></span>
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </article>
        ))}
      </div>
    </section>

    {/* Roles Section */}
    <section className="roles">
      <article className="role-parents">
        <div className="role-icon-wrap"><Icon name="children" size={28} /></div>
        <h2>{t.forParents}</h2>
        <p>{t.forParentsBody}</p>
      </article>
      <article className="role-staff">
        <div className="role-icon-wrap"><Icon name="leaf" size={28} /></div>
        <h2>{t.forStaff}</h2>
        <p>{t.forStaffBody}</p>
      </article>
    </section>

    {/* Invitation CTA */}
    <section className="landing-invitation">
      <div className="landing-invitation-content">
        <img src="/brand/mascot-yellow-star.png" alt="" className="invitation-mascot" />
        <div>
          <h2>{t.careTogether}</h2>
          <p>{t.loginIntro}</p>
        </div>
      </div>
      <div className="landing-invitation-actions">
        <button type="button" className="btn primary" onClick={() => onLogin('signup')}>{t.ctaSignUp}<Icon name="arrow" /></button>
        <button type="button" className="btn ghost" onClick={() => onLogin('login')}>{t.ctaStart}</button>
      </div>
    </section>
  </>
}

function WorkspacePreview() {
  const { t } = useI18n()
  return <div className="product-preview" aria-label={t.exampleWorkspace}>
    <div className="product-preview-bar"><span className="preview-window-dots" aria-hidden="true"><i /><i /><i /></span><span>{t.exampleWorkspace}</span><Icon name="incidents" size={14} /></div>
    <div className="product-preview-body"><aside><div className="preview-brand"><BrandMark />{t.brand}</div>{([{ icon: 'dashboard', label: t.navDashboard }, { icon: 'attendance', label: t.attendanceTitle }, { icon: 'reports', label: t.navReports }, { icon: 'messages', label: t.navMessages }, { icon: 'payments', label: t.navPayments }] as const).map((page, index) => <div className={index === 0 ? 'selected' : ''} key={page.icon}><Icon name={page.icon} size={15} />{page.label}</div>)}</aside>
    <div className="preview-workspace"><p className="preview-greeting"><Icon name="sun" size={16} />{t.dayOverview}</p><h2>{t.careTogether}</h2><div className="preview-metrics">{[{ label: t.dashChildren, value: '3' }, { label: t.attendancePresent, value: '2' }, { label: t.dashReports, value: '2 / 3' }].map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}</div><h3>{t.childrenToday}</h3><div className="preview-register">{['Arta Krasniqi', 'Luan Berisha', 'Era Gashi'].map((name, index) => <div key={name}><span className={`sample-avatar sample-avatar-${index}`}>{name.split(' ').map((part) => part[0]).join('')}</span><strong>{name}</strong><span className={`attendance-status ${index === 2 ? 'unmarked' : 'present'}`}>{index === 2 ? t.attendanceUnmarked : t.attendancePresent}</span><Icon name={index === 2 ? 'clock' : 'check'} size={15} /></div>)}</div></div></div>
  </div>
}

function Login({ onSuccess, initialMode = 'login' }: { onSuccess: () => void; initialMode?: 'login' | 'signup' }) {
  const { t } = useI18n()
  const { login, setSession } = useAuth()
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode)

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const [signupName, setSignupName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [signupError, setSignupError] = useState<string | null>(null)
  const [signupBusy, setSignupBusy] = useState(false)

  const [needsSetup, setNeedsSetup] = useState(false)
  const [setupName, setSetupName] = useState('')
  const [setupEmail, setSetupEmail] = useState('')
  const [setupPassword, setSetupPassword] = useState('')
  const [setupError, setSetupError] = useState(false)
  const [setupBusy, setSetupBusy] = useState(false)

  useEffect(() => {
    let active = true
    getSetupStatus()
      .then((res) => {
        if (active && res.needsSetup) {
          setNeedsSetup(true)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  async function onSetupSubmit(e: FormEvent) {
    e.preventDefault()
    if (setupBusy) return
    setSetupBusy(true)
    setSetupError(false)
    try {
      const res = await setupAdminRequest(setupName, setupEmail, setupPassword)
      setSession(res.token, res.user)
      onSuccess()
    } catch {
      setSetupError(true)
    } finally {
      setSetupBusy(false)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(false)
    const err = await login(email, password)
    setBusy(false)
    if (err) setError(true)
    else onSuccess()
  }

  async function onSignupSubmit(e: FormEvent) {
    e.preventDefault()
    if (signupBusy) return
    setSignupBusy(true)
    setSignupError(null)
    try {
      const res = await registerParentRequest(signupName, signupEmail, signupPassword)
      setSession(res.token, res.user)
      onSuccess()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 409) {
        setSignupError(t.signupEmailExists)
      } else {
        setSignupError(t.signupError)
      }
    } finally {
      setSignupBusy(false)
    }
  }

  if (needsSetup) {
    return (
      <section className="login-layout">
        <aside className="login-story">
          <div className="login-story-brand">
            <img src="/brand/logo-purple.png" alt="Kiddo Land" className="login-story-logo" />
          </div>
          <p className="eyebrow"><Icon name="sun" size={17} />{t.brandCaption}</p>
          <h2>{t.setupAdminTitle}</h2>
          <p>{t.setupAdminDescription}</p>
          <div className="login-story-illustration">
            <img src="/brand/brand-illustration-rainbow.png" alt="" className="login-story-art" />
          </div>
        </aside>
        <div className="panel login-panel">
          <span className="login-symbol"><Icon name="superadmin" size={25} /></span>
          <h1 tabIndex={-1}>{t.setupAdminTitle}</h1>
          <p className="panel-sub">{t.setupAdminDescription}</p>
          <form className="login-form" onSubmit={onSetupSubmit}>
            <label>
              {t.setupAdminName}
              <input
                type="text"
                disabled={setupBusy}
                autoComplete="name"
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                required
                minLength={2}
                placeholder="e.g. Adnan Godanci"
              />
            </label>
            <label>
              {t.loginEmail}
              <input
                type="email"
                disabled={setupBusy}
                autoComplete="email"
                value={setupEmail}
                onChange={(e) => setSetupEmail(e.target.value)}
                required
                placeholder="admin@example.com"
              />
            </label>
            <label>
              {t.loginPassword}
              <span className="password-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={setupBusy}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showPassword ? t.hidePassword : t.showPassword}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((shown) => !shown)}
                >
                  <Icon name="eye" />
                </button>
              </span>
            </label>
            {setupError && <p role="alert" className="form-error">{t.setupAdminError}</p>}
            <button type="submit" className="btn primary" disabled={setupBusy}>
              {setupBusy ? t.attendanceSaving : t.setupAdminSubmit}
            </button>
          </form>
        </div>
      </section>
    )
  }

  return (
    <section className="login-layout">
      <aside className="login-story">
        <div className="login-story-brand">
          <img src="/brand/logo-purple.png" alt="Kiddo Land" className="login-story-logo" />
        </div>
        <p className="eyebrow">{t.brandCaption}</p>
        <h2>{mode === 'signup' ? t.signupTitle : t.careTogether}</h2>
        <p>{mode === 'signup' ? t.signupDescription : t.loginIntro}</p>
        <div className="login-story-illustration">
          <img src="/brand/brand-illustration-rainbow.png" alt="" className="login-story-art" />
        </div>
      </aside>
      <div className="panel login-panel">
        <div className="auth-mode-toggle" role="tablist" aria-label={`${t.authTabLogin} / ${t.authTabSignup}`}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab-btn ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(false); setSignupError(null) }}
          >
            {t.authTabLogin}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={`auth-tab-btn ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => { setMode('signup'); setError(false); setSignupError(null) }}
          >
            {t.authTabSignup}
          </button>
        </div>

        <span className="login-symbol"><Icon name={mode === 'signup' ? 'children' : 'leaf'} size={25} /></span>
        <h1 tabIndex={-1}>{mode === 'signup' ? t.signupTitle : t.loginTitle}</h1>
        <p className="panel-sub">{mode === 'signup' ? t.signupDescription : t.loginDescription}</p>

        {mode === 'login' ? (
          <>
            <form className="login-form" onSubmit={onSubmit}>
              <label>
                {t.loginEmail}
                <input
                  type="email"
                  disabled={busy}
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label>
                {t.loginPassword}
                <span className="password-field">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={showPassword ? t.hidePassword : t.showPassword}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((shown) => !shown)}
                  >
                    <Icon name="eye" />
                  </button>
                </span>
              </label>
              {error && <p role="alert" className="form-error">{t.loginError}</p>}
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? t.attendanceSaving : t.loginSubmit}
              </button>
            </form>

            <div className="auth-switch" style={{ marginTop: '16px', textAlign: 'center', fontSize: '13.5px', color: 'var(--kd-muted)' }}>
              <span>{t.dontHaveAccount} </span>
              <button
                type="button"
                className="link-button"
                onClick={() => { setMode('signup'); setError(false); setSignupError(null) }}
                style={{ background: 'none', border: 'none', padding: '0', color: 'var(--kd-primary, #1a5c45)', fontWeight: 650, cursor: 'pointer', textDecoration: 'underline', minHeight: '40px', display: 'inline-flex', alignItems: 'center' }}
              >
                {t.switchToSignup}
              </button>
            </div>

            {SHOW_DEMO && (
              <div className="demo-accounts">
                <p className="hint">{t.loginHint}</p>
                {DEMO.map((d) => (
                  <button
                    key={d.email}
                    type="button"
                    className="demo-chip"
                    disabled={busy}
                    onClick={() => {
                      setEmail(d.email)
                      setPassword(d.password)
                    }}
                  >
                    <Icon name={d.roleKey === 'roleParent' ? 'children' : d.roleKey === 'roleTeacher' ? 'leaf' : d.roleKey === 'roleSuperAdmin' ? 'superadmin' : 'dashboard'} />
                    <span><strong>{d.name || t[d.roleKey]}</strong><small>{d.email}</small></span>
                    <Icon name="arrow" size={16} />
                  </button>
                ))}
              </div>
            )}
            <div className="login-help-card" style={{ marginTop: '20px', padding: '14px 16px', borderRadius: '10px', background: 'var(--kd-surface-alt, #f7faf5)', border: '1px solid var(--kd-border, #e2ead6)', fontSize: '13px', color: 'var(--kd-muted, #556b5b)', lineHeight: '1.45', boxSizing: 'border-box', width: '100%', maxWidth: '100%' }}>
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--kd-text, #26382b)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Icon name="children" size={16} />
                {t.parentAccessNotice}
              </p>
              <p style={{ margin: '6px 0 0', fontSize: '12px' }}>{t.parentAccessContact}</p>
            </div>
          </>
        ) : (
          <>
            <form className="login-form" onSubmit={onSignupSubmit}>
              <label>
                {t.signupFullName}
                <input
                  type="text"
                  disabled={signupBusy}
                  autoComplete="name"
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  required
                  minLength={2}
                  placeholder={t.signupFullNamePlaceholder}
                />
              </label>
              <label>
                {t.signupEmail}
                <input
                  type="email"
                  disabled={signupBusy}
                  autoComplete="email"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  required
                  placeholder="parent@example.com"
                />
              </label>
              <label>
                {t.signupPassword}
                <span className="password-field">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    required
                    minLength={6}
                    disabled={signupBusy}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={showPassword ? t.hidePassword : t.showPassword}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((shown) => !shown)}
                  >
                    <Icon name="eye" />
                  </button>
                </span>
              </label>
              {signupError && <p role="alert" className="form-error">{signupError}</p>}
              <button type="submit" className="btn primary" disabled={signupBusy}>
                {signupBusy ? t.attendanceSaving : t.signupSubmit}
              </button>
            </form>

            <div className="auth-switch" style={{ marginTop: '16px', textAlign: 'center', fontSize: '13.5px', color: 'var(--kd-muted)' }}>
              <span>{t.alreadyHaveAccount} </span>
              <button
                type="button"
                className="link-button"
                onClick={() => { setMode('login'); setError(false); setSignupError(null) }}
                style={{ background: 'none', border: 'none', padding: '0', color: 'var(--kd-primary, #1a5c45)', fontWeight: 650, cursor: 'pointer', textDecoration: 'underline', minHeight: '40px', display: 'inline-flex', alignItems: 'center' }}
              >
                {t.switchToLogin}
              </button>
            </div>

            <div className="login-help-card" style={{ marginTop: '20px', padding: '14px 16px', borderRadius: '10px', background: 'var(--kd-surface-alt, #f7faf5)', border: '1px solid var(--kd-border, #e2ead6)', fontSize: '13px', color: 'var(--kd-muted, #556b5b)', lineHeight: '1.45', boxSizing: 'border-box', width: '100%', maxWidth: '100%' }}>
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--kd-text, #26382b)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Icon name="children" size={16} />
                {t.parentSignupNotice}
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </LanguageProvider>
  )
}
