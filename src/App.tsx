import { useEffect, useRef, useState, type FormEvent } from 'react'
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
import './App.css'
import './theme.css'

type View = 'home' | 'login' | 'dashboard' | 'reports' | 'payments' | 'attendance' | 'children' | 'program' | 'announcements' | 'messages' | 'absences' | 'meals' | 'incidents' | 'moments' | 'events' | 'staff' | 'milestones'

const DEMO = [
  { email: 'parent@kidoland.demo', password: 'parent123', roleKey: 'roleParent' as const },
  { email: 'teacher@kidoland.demo', password: 'teacher123', roleKey: 'roleTeacher' as const },
  { email: 'director@kidoland.demo', password: 'director123', roleKey: 'roleDirector' as const },
]

function Shell() {
  const { t, toggle, lang } = useI18n()
  const { user, token, loading, logout, expired, bootError, retryBoot } = useAuth()
  const [view, setView] = useState<View>('home')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const [reportContext, setReportContext] = useState<{ childId?: string; date?: string }>({})
  const activeView = user && (view === 'home' || view === 'login') ? 'dashboard' : view
  const roleLabel = user?.role === 'parent' ? t.roleParent : user?.role === 'teacher' ? t.roleTeacher : t.roleDirector
  const navGroups: { label: string; items: { view: View; label: string; icon: IconName }[] }[] = [
    { label: t.navDaily, items: [
      { view: 'dashboard', label: t.navDashboard, icon: 'dashboard' },
      { view: 'attendance', label: t.attendanceTitle, icon: 'attendance' },
      { view: 'reports', label: t.navReports, icon: 'reports' },
      { view: 'program', label: t.navProgram, icon: 'program' },
      { view: 'meals', label: t.navMeals, icon: 'meals' },
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
      { view: 'absences', label: t.navAbsences, icon: 'absences' },
      { view: 'incidents', label: t.navIncidents, icon: 'incidents' },
      { view: 'milestones', label: t.navMilestones, icon: 'milestones' },
      { view: 'staff', label: t.navStaffShifts, icon: 'staff' },
    ] },
  ]
  const currentLabel = navGroups.flatMap((group) => group.items).find((item) => item.view === activeView)?.label

  useEffect(() => { document.documentElement.lang = lang }, [lang])
  useEffect(() => { const heading = document.querySelector<HTMLElement>('main h1'); if (heading) { heading.tabIndex = -1; heading.focus() } }, [activeView, user?.id, loading])
  useEffect(() => {
    if (!menuOpen) return
    document.querySelector<HTMLButtonElement>('.sidebar [aria-current="page"]')?.focus({ preventScroll: true })
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus() } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [menuOpen])

  if (loading) return <div className="loading" role="status"><BrandMark /><span>{t.loading}</span></div>
  const go = (v: View, context?: { childId?: string; date?: string }) => { setReportContext(context || {}); setView(v); setMenuOpen(false); if (menuOpen) menuButton.current?.focus() }
  const brand = <button type="button" className="brand" onClick={() => go(user ? 'dashboard' : 'home')}><span className="brand-mark"><BrandMark /></span>{t.brand}<span className="brand-dot" aria-hidden="true">.</span></button>

  return (
    <div className={`app ${user ? 'workspace' : 'public-app'}`}>
      <a className="skip-link" href="#main-content">{t.skipContent}</a>
      {user && <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`} id="workspace-navigation">
        <div className="sidebar-brand">{brand}<span className="brand-caption">{t.brandCaption}</span></div>
        <nav className="nav-links" aria-label={t.navigation}>
          {navGroups.map((group) => <div className="nav-group" key={group.label}><p className="nav-group-label">{group.label}</p>{group.items.map((item) => <button type="button" key={item.view} data-view={item.view} aria-current={activeView === item.view ? 'page' : undefined} onClick={() => go(item.view)}><Icon name={item.icon} /><span>{item.label}</span>{activeView === item.view && <span className="active-dot" aria-hidden="true" />}</button>)}</div>)}
        </nav>
        <div className="sidebar-note"><Icon name="leaf" /><div><strong>{t.careTogether}</strong><p>{t.sidebarNote}</p></div></div>
      </aside>}
      <header className="nav">
        {user ? <><button ref={menuButton} type="button" className="menu-toggle" aria-label={menuOpen ? t.closeMenu : t.openMenu} aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen((open) => !open)}><Icon name={menuOpen ? 'close' : 'menu'} /></button><div className="workspace-location"><span>{t.brand}</span><span aria-hidden="true">/</span><strong>{currentLabel}</strong></div></> : brand}
        {!user && <nav className="public-nav" aria-label={t.navigation}><button type="button" onClick={() => go('home')}>{t.navFeatures}</button></nav>}
        <div className="nav-actions">
          <button type="button" className="lang-btn" onClick={toggle}>{lang === 'en' ? 'SQ' : 'EN'} · {t.langToggle}</button>
          {user ? <><div className="user-identity"><span className="user-avatar" aria-hidden="true">{user.name.trim().slice(0, 1)}</span><div><strong>{user.name}</strong><span>{roleLabel}</span></div></div><button type="button" className="btn ghost logout-btn" onClick={() => { logout(); go('home') }}><Icon name="logout" /><span>{t.logout}</span></button></> : <button type="button" className="btn primary" onClick={() => go('login')}>{t.ctaStart}<Icon name="arrow" size={17} /></button>}
        </div>
      </header>

      <main id="main-content" key={`${user?.id || 'public'}:${token || ''}`}>
        {expired && <p role="alert" className="notice session-notice">{t.attendanceSessionExpired}</p>}
        {bootError && <section className="panel"><p role="alert">{t.loadError}</p><div className="actions"><button className="btn primary" onClick={retryBoot}>{t.attendanceRetry}</button><button className="btn ghost" onClick={logout}>{t.logout}</button></div></section>}
        {!user && !bootError && activeView !== 'home' && <Login onSuccess={() => go('dashboard')} />}
        {!user && !bootError && activeView === 'home' && <Home onLogin={() => go('login')} />}
        {user && activeView === 'dashboard' && <Dashboard go={go} />}
        {user && activeView === 'attendance' && <Attendance initialDate={reportContext.date} />}
        {user && activeView === 'reports' && <Reports initialChildId={reportContext.childId} initialDate={reportContext.date} />}
        {user && activeView === 'program' && <Program initialDate={reportContext.date} />}
        {user && activeView === 'announcements' && <Announcements />}
        {user && activeView === 'messages' && <Messages />}
        {user && activeView === 'payments' && <Payments />}
        {user && activeView === 'absences' && <Absences />}
        {user && activeView === 'meals' && <Meals />}
        {user && activeView === 'incidents' && <Incidents />}
        {user && activeView === 'moments' && <Moments />}
        {user && activeView === 'events' && <Events />}
        {user && activeView === 'staff' && <StaffShifts />}
        {user && activeView === 'milestones' && <Milestones />}
        {user && activeView === 'children' && <Children />}
      </main>
      <footer className="footer"><span className="footer-mark" aria-hidden="true"><Icon name="leaf" size={15} /></span><p>{t.footer}</p></footer>
    </div>
  )
}

function GardenArt() {
  return <svg className="garden-art" viewBox="0 0 480 380" fill="none" aria-hidden="true" focusable="false">
    <circle cx="255" cy="165" r="140" fill="#e2ead6" /><circle cx="320" cy="100" r="46" fill="#f1ca75" />
    <path d="M55 340c45-130 146-150 233-94 45-68 117-60 158 94H55Z" fill="#cadbbd" />
    <path d="M90 343c60-72 170-61 273 0H90Z" fill="#9bb78f" />
    <path d="M160 313V166M161 229c-54 2-73-28-67-62 42 0 70 19 67 62ZM161 204c0-53 37-76 81-71 0 42-30 74-81 71Z" fill="#53765b" />
    <path d="M371 316V231M371 270c-32 0-44-18-41-40 26 0 44 15 41 40ZM371 251c-1-33 23-47 50-43 0 26-19 45-50 43Z" fill="#658366" />
    <path d="M284 344v-56" stroke="#53765b" strokeWidth="6" />
    <circle cx="282" cy="270" r="17" fill="#de9075" /><circle cx="263" cy="288" r="17" fill="#de9075" /><circle cx="299" cy="288" r="17" fill="#de9075" /><circle cx="282" cy="303" r="17" fill="#de9075" /><circle cx="282" cy="287" r="12" fill="#fae6ac" />
    <path d="m79 90 5-12 5 12 12 5-12 5-5 12-5-12-12-5 12-5ZM397 144l3-8 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="#b38b47" />
    <path d="M248 69c5-8 12-8 17 0 5-8 12-8 17 0" stroke="#69816a" strokeWidth="3" strokeLinecap="round" />
  </svg>
}

function Home({ onLogin }: { onLogin: () => void }) {
  const { t } = useI18n()
  return <>
    <section className="hero">
      <div className="hero-copy"><p className="eyebrow"><Icon name="sun" size={17} />{t.brandCaption}</p><h1 tabIndex={-1}>{t.heroTitle}</h1><p className="lead">{t.heroSub}</p><div className="hero-cta"><button type="button" className="btn primary" onClick={onLogin}>{t.ctaStart}<Icon name="arrow" /></button><span className="hero-language"><Icon name="check" size={16} />{t.featureLang}</span></div><p className="hero-footnote">{t.careTogether}</p></div>
      <div className="hero-visual"><GardenArt /><div className="preview-report"><span className="preview-label">{t.exampleReport}</span><div className="card-avatar-heading"><span className="preview-avatar" aria-hidden="true">AK</span><div><strong>Arta Krasniqi</strong><p>{t.reportsMoodVal}</p></div><span className="preview-check"><Icon name="check" /></span></div><div className="preview-details"><span><Icon name="meals" size={17} />{t.mealsAll}</span><span><Icon name="clock" size={17} />{t.napShort}</span></div></div><div className="preview-bubble"><Icon name="leaf" /><span>{t.littleMoments}</span></div></div>
    </section>
    <section className="landing-section"><div className="section-heading"><p className="eyebrow">{t.everyDayTitle}</p><h2>{t.everyDayBody}</h2></div><div className="features">{([{ title: t.featureReports, body: t.featureReportsBody, icon: 'reports' }, { title: t.featurePayments, body: t.featurePaymentsBody, icon: 'payments' }, { title: t.featureLang, body: t.featureLangBody, icon: 'messages' }, { title: t.featureSafety, body: t.featureSafetyBody, icon: 'incidents' }] as const).map((feature) => <article key={feature.title}><span className="feature-icon"><Icon name={feature.icon} size={23} /></span><h3>{feature.title}</h3><p>{feature.body}</p></article>)}</div></section>
    <section className="roles"><article><Icon name="children" size={28} /><h2>{t.forParents}</h2><p>{t.forParentsBody}</p></article><article><Icon name="leaf" size={28} /><h2>{t.forStaff}</h2><p>{t.forStaffBody}</p></article></section>
    <section className="landing-invitation"><div><h2>{t.careTogether}</h2><p>{t.loginIntro}</p></div><button className="btn primary" onClick={onLogin}>{t.ctaStart}<Icon name="arrow" /></button></section>
  </>
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useI18n()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

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

  return (
    <section className="login-layout"><aside className="login-story"><BrandMark /><p className="eyebrow">{t.brandCaption}</p><h2>{t.careTogether}</h2><p>{t.loginIntro}</p><GardenArt /></aside><div className="panel login-panel">
      <span className="login-symbol"><Icon name="leaf" size={25} /></span><h1 tabIndex={-1}>{t.loginTitle}</h1><p className="panel-sub">{t.loginDescription}</p>
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
          <span className="password-field"><input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={busy}
          /><button type="button" className="password-toggle" aria-label={showPassword ? t.hidePassword : t.showPassword} aria-pressed={showPassword} onClick={() => setShowPassword((shown) => !shown)}><Icon name="eye" /></button></span>
        </label>
        {error && <p role="alert" className="form-error">{t.loginError}</p>}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? t.attendanceSaving : t.loginSubmit}
        </button>
      </form>
      <p className="hint">{t.loginHint}</p>
      <div className="demo-accounts">
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
            <Icon name={d.roleKey === 'roleParent' ? 'children' : d.roleKey === 'roleTeacher' ? 'leaf' : 'dashboard'} /><span><strong>{t[d.roleKey]}</strong><small>{d.email}</small></span><Icon name="arrow" size={16} />
          </button>
        ))}
      </div>
    </div></section>
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
