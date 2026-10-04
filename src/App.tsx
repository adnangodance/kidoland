import { useEffect, useState, type FormEvent } from 'react'
import { AuthProvider, useAuth } from './auth'
import { LanguageProvider, useI18n } from './i18n/LanguageContext'
import Attendance from './Attendance'
import Children from './Children'
import Reports from './Reports'
import Payments from './Payments'
import Dashboard from './Dashboard'
import Program from './Program'
import Announcements from './Announcements'
import './App.css'

type View = 'home' | 'login' | 'dashboard' | 'reports' | 'payments' | 'attendance' | 'children' | 'program' | 'announcements'

const DEMO = [
  { email: 'parent@kidoland.demo', password: 'parent123', roleKey: 'roleParent' as const },
  { email: 'teacher@kidoland.demo', password: 'teacher123', roleKey: 'roleTeacher' as const },
  { email: 'director@kidoland.demo', password: 'director123', roleKey: 'roleDirector' as const },
]

function Shell() {
  const { t, toggle, lang } = useI18n()
  const { user, token, loading, logout, expired, bootError, retryBoot } = useAuth()
  const [view, setView] = useState<View>('home')
  const [reportContext, setReportContext] = useState<{ childId?: string; date?: string }>({})
  const activeView = user && (view === 'home' || view === 'login') ? 'dashboard' : view

  useEffect(() => { document.documentElement.lang = lang }, [lang])
  useEffect(() => { const heading = document.querySelector<HTMLElement>('main h1'); if (heading) { heading.tabIndex = -1; heading.focus() } }, [activeView, user?.id, loading])

  if (loading) {
    return <div className="loading" role="status">{t.loading}</div>
  }

  const go = (v: View, context?: { childId?: string; date?: string }) => { setReportContext(context || {}); setView(v) }

  return (
    <div className="app">
      <header className="nav">
        <button type="button" className="brand" onClick={() => go(user ? 'dashboard' : 'home')}>
          <span className="brand-mark" aria-hidden>
            🧸
          </span>
          {t.brand}
        </button>
        <nav className="nav-links">
          {!user && (
            <button type="button" onClick={() => go('home')}>
              {t.navFeatures}
            </button>
          )}
          {user && (
            <>
              <button type="button" aria-current={activeView === 'dashboard' ? 'page' : undefined} onClick={() => go('dashboard')}>
                {t.navDashboard}
              </button>
              <button type="button" aria-current={activeView === 'attendance' ? 'page' : undefined} onClick={() => go('attendance')}>
                {t.attendanceTitle}
              </button>
              <button type="button" aria-current={activeView === 'reports' ? 'page' : undefined} onClick={() => go('reports')}>
                {t.navReports}
              </button>
              <button type="button" aria-current={activeView === 'program' ? 'page' : undefined} onClick={() => go('program')}>
                {t.navProgram}
              </button>
              <button type="button" aria-current={activeView === 'announcements' ? 'page' : undefined} onClick={() => go('announcements')}>
                {t.navAnnouncements}
              </button>
              <button type="button" aria-current={activeView === 'payments' ? 'page' : undefined} onClick={() => go('payments')}>
                {t.navPayments}
              </button>
              <button type="button" aria-current={activeView === 'children' ? 'page' : undefined} onClick={() => go('children')}>
                {user.role === 'parent' ? t.consentTitle : t.childrenTitle}
              </button>
            </>
          )}
        </nav>
        <div className="nav-actions">
          <button type="button" className="lang-btn" onClick={toggle}>
            {lang === 'en' ? 'SQ' : 'EN'} · {t.langToggle}
          </button>
          {user ? (
            <button type="button" className="btn ghost" onClick={() => { logout(); go('home') }}>
              {t.logout}
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={() => go('login')}>
              {t.ctaStart}
            </button>
          )}
        </div>
      </header>

      <main key={`${user?.id || 'public'}:${token || ''}`}>
      {expired && <p role="alert" className="notice">{t.attendanceSessionExpired}</p>}
      {bootError && <section className="panel"><p role="alert">{t.loadError}</p><button className="btn primary" onClick={retryBoot}>{t.attendanceRetry}</button><button className="btn ghost" onClick={logout}>{t.logout}</button></section>}
      {!user && !bootError && activeView !== 'home' && <Login onSuccess={() => go('dashboard')} />}
      {!user && !bootError && activeView === 'home' && <Home onLogin={() => go('login')} />}
      {user && activeView === 'dashboard' && <Dashboard go={go} />}
      {user && activeView === 'attendance' && <Attendance initialDate={reportContext.date} />}
      {user && activeView === 'reports' && <Reports initialChildId={reportContext.childId} initialDate={reportContext.date} />}
      {user && activeView === 'program' && <Program initialDate={reportContext.date} />}
      {user && activeView === 'announcements' && <Announcements />}
      {user && activeView === 'payments' && <Payments />}
      {user && activeView === 'children' && <Children />}
      </main>

      <footer className="footer">
        <p>{t.footer}</p>
      </footer>
    </div>
  )
}

function Home({ onLogin }: { onLogin: () => void }) {
  const { t } = useI18n()
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{t.tagline}</p>
          <h1 tabIndex={-1}>{t.heroTitle}</h1>
          <p className="lead">{t.heroSub}</p>
          <div className="hero-cta">
            <button type="button" className="btn primary" onClick={onLogin}>
              {t.ctaStart}
            </button>
          </div>
        </div>
        <div className="hero-card" aria-hidden>
          <div className="mini-report">
            <strong>Arta</strong>
            <span>😊 · 🍎 · 💤</span>
          </div>
          <div className="mini-pay">
            <span>€180</span>
            <em>{t.paymentsStatus}</em>
          </div>
        </div>
      </section>
      <section className="roles">
        <article>
          <h2>{t.forParents}</h2>
          <p>{t.forParentsBody}</p>
        </article>
        <article>
          <h2>{t.forStaff}</h2>
          <p>{t.forStaffBody}</p>
        </article>
      </section>
      <section className="features">
        <article>
          <h3>{t.featureReports}</h3>
          <p>{t.featureReportsBody}</p>
        </article>
        <article>
          <h3>{t.featurePayments}</h3>
          <p>{t.featurePaymentsBody}</p>
        </article>
        <article>
          <h3>{t.featureLang}</h3>
          <p>{t.featureLangBody}</p>
        </article>
        <article>
          <h3>{t.featureSafety}</h3>
          <p>{t.featureSafetyBody}</p>
        </article>
      </section>
    </>
  )
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useI18n()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

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
    <section className="panel login-panel">
      <h1 tabIndex={-1}>{t.loginTitle}</h1>
      <form className="login-form" onSubmit={onSubmit}>
        <label>
          {t.loginEmail}
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          {t.loginPassword}
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
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
            onClick={() => {
              setEmail(d.email)
              setPassword(d.password)
            }}
          >
            {t[d.roleKey]} · {d.email}
          </button>
        ))}
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
