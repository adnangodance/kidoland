import { useEffect, useState, type FormEvent } from 'react'
import { listChildren, listReports, saveReport, type Child, type Report } from './api'
import { AuthProvider, useAuth } from './auth'
import { LanguageProvider, useI18n } from './i18n/LanguageContext'
import './App.css'

type View = 'home' | 'login' | 'dashboard' | 'reports' | 'payments'

const DEMO = [
  { email: 'parent@kidoland.demo', password: 'parent123', roleKey: 'roleParent' as const },
  { email: 'teacher@kidoland.demo', password: 'teacher123', roleKey: 'roleTeacher' as const },
  { email: 'director@kidoland.demo', password: 'director123', roleKey: 'roleDirector' as const },
]

function Shell() {
  const { t, toggle, lang } = useI18n()
  const { user, loading, logout } = useAuth()
  const [view, setView] = useState<View>('home')

  if (loading) {
    return <div className="loading">…</div>
  }

  const go = (v: View) => setView(v)

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
              <button type="button" onClick={() => go('dashboard')}>
                {t.navDashboard}
              </button>
              <button type="button" onClick={() => go('reports')}>
                {t.navReports}
              </button>
              <button type="button" onClick={() => go('payments')}>
                {t.navPayments}
              </button>
            </>
          )}
        </nav>
        <div className="nav-actions">
          <button type="button" className="lang-btn" onClick={toggle}>
            {lang === 'en' ? 'SQ' : 'EN'} · {t.langToggle}
          </button>
          {user ? (
            <button type="button" className="btn ghost" onClick={logout}>
              {t.logout}
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={() => go('login')}>
              {t.ctaStart}
            </button>
          )}
        </div>
      </header>

      {view === 'home' && !user && <Home onLogin={() => go('login')} />}
      {view === 'login' && !user && <Login onSuccess={() => go('dashboard')} />}
      {user && view === 'dashboard' && <Dashboard />}
      {user && view === 'reports' && <Reports />}
      {user && view === 'payments' && <Payments />}
      {user && view === 'home' && <Dashboard />}
      {user && view === 'login' && <Dashboard />}

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
          <h1>{t.heroTitle}</h1>
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
            <em>JWT</em>
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
    setBusy(true)
    setError(false)
    const err = await login(email, password)
    setBusy(false)
    if (err) setError(true)
    else onSuccess()
  }

  return (
    <section className="panel login-panel">
      <h1>{t.loginTitle}</h1>
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
        {error && <p className="form-error">{t.loginError}</p>}
        <button type="submit" className="btn primary" disabled={busy}>
          {t.loginSubmit}
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

function Dashboard() {
  const { t } = useI18n()
  const { user } = useAuth()
  if (!user) return null
  const title =
    user.role === 'parent'
      ? t.dashParent
      : user.role === 'teacher'
        ? t.dashTeacher
        : t.dashDirector
  const body =
    user.role === 'parent'
      ? t.dashParentBody
      : user.role === 'teacher'
        ? t.dashTeacherBody
        : t.dashDirectorBody
  const roleLabel =
    user.role === 'parent'
      ? t.roleParent
      : user.role === 'teacher'
        ? t.roleTeacher
        : t.roleDirector
  return (
    <section className="panel">
      <p className="eyebrow">
        {t.welcome}, {user.name}
      </p>
      <h1>{title}</h1>
      <p className="panel-sub">
        {roleLabel} · {user.email}
      </p>
      <p>{body}</p>
    </section>
  )
}

function Reports() {
  const { t } = useI18n()
  const { user, token } = useAuth()
  const [children, setChildren] = useState<Child[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    childId: '',
    reportDate: new Date().toISOString().slice(0, 10),
    mood: '',
    meals: '',
    nap: '',
    activities: '',
    note: '',
  })
  const canWrite = user?.role === 'teacher' || user?.role === 'director'

  async function reload() {
    if (!token) return
    try {
      const [c, r] = await Promise.all([listChildren(token), listReports(token)])
      setChildren(c.children)
      setReports(r.reports)
      setForm((f) => ({
        ...f,
        childId: f.childId || c.children[0]?.id || '',
      }))
      setError('')
    } catch {
      setError('api')
    }
  }

  useEffect(() => {
    void reload()
  }, [token])

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!token) return
    try {
      await saveReport(token, form)
      await reload()
      setForm((f) => ({
        ...f,
        mood: '',
        meals: '',
        nap: '',
        activities: '',
        note: '',
      }))
    } catch {
      setError('save')
    }
  }

  return (
    <section className="panel">
      <h1>{t.reportsTitle}</h1>
      {error && <p className="form-error">{t.loginError}</p>}
      {canWrite && (
        <form className="login-form" onSubmit={onSave}>
          <label>
            Child
            <select
              value={form.childId}
              onChange={(e) => setForm({ ...form, childId: e.target.value })}
              required
            >
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.groupName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              value={form.reportDate}
              onChange={(e) => setForm({ ...form, reportDate: e.target.value })}
              required
            />
          </label>
          <label>
            {t.reportsMood}
            <input
              value={form.mood}
              onChange={(e) => setForm({ ...form, mood: e.target.value })}
              required
            />
          </label>
          <label>
            {t.reportsMeals}
            <input
              value={form.meals}
              onChange={(e) => setForm({ ...form, meals: e.target.value })}
              required
            />
          </label>
          <label>
            {t.reportsNap}
            <input
              value={form.nap}
              onChange={(e) => setForm({ ...form, nap: e.target.value })}
              required
            />
          </label>
          <label>
            {t.reportsActivities}
            <input
              value={form.activities}
              onChange={(e) => setForm({ ...form, activities: e.target.value })}
              required
            />
          </label>
          <label>
            {t.reportsNote}
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              required
              rows={3}
            />
          </label>
          <button type="submit" className="btn primary">
            Save report
          </button>
        </form>
      )}
      <div className="report-list">
        {reports.length === 0 && <p className="hint">No reports yet.</p>}
        {reports.map((r) => (
          <article key={r.id} className="note" style={{ marginTop: '1rem' }}>
            <h4>
              {r.childName} · {r.reportDate}
            </h4>
            <p className="panel-sub">
              {r.groupName} · {r.teacherName}
            </p>
            <div className="report-grid">
              <div>
                <h4>{t.reportsMood}</h4>
                <p>{r.mood}</p>
              </div>
              <div>
                <h4>{t.reportsMeals}</h4>
                <p>{r.meals}</p>
              </div>
              <div>
                <h4>{t.reportsNap}</h4>
                <p>{r.nap}</p>
              </div>
              <div>
                <h4>{t.reportsActivities}</h4>
                <p>{r.activities}</p>
              </div>
            </div>
            <p>
              <strong>{t.reportsNote}:</strong> {r.note}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}

function Payments() {
  const { t } = useI18n()
  return (
    <section className="panel">
      <h1>{t.paymentsTitle}</h1>
      <div className="invoice">
        <div>
          <h3>{t.paymentsInvoice}</h3>
          <p>{t.paymentsDue}</p>
        </div>
        <div className="invoice-right">
          <strong>{t.paymentsAmount}</strong>
          <span className="badge">{t.paymentsStatus}</span>
        </div>
      </div>
      <button type="button" className="btn primary">
        {t.paymentsPay}
      </button>
      <p className="hint">{t.paymentsNote}</p>
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
