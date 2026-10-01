import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { db, type DbUser } from './db.js'
import { requireAuth, signToken, type AuthUser } from './auth.js'

export const app = express()

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())
app.use((error: { type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_body' })
  next(error)
})

function authed(req: express.Request): AuthUser {
  return (req as express.Request & { user: AuthUser }).user
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'kidoland-api' })
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

app.post('/api/auth/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body' })
  }
  const { email, password } = parsed.data
  const row = db
    .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
    .get(email) as DbUser | undefined
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' })
  }
  const user: AuthUser = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
  }
  res.json({ token: signToken(user), user })
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: authed(req) })
})

app.get('/api/children', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role === 'parent') {
    const rows = db
      .prepare(
        'SELECT id, name, group_name AS groupName, parent_user_id AS parentUserId, photo_consent AS photoConsent FROM children WHERE parent_user_id = ? ORDER BY name',
      )
      .all(user.id)
    return res.json({ children: rows.map((row) => ({ ...(row as object), photoConsent: Boolean((row as { photoConsent: number }).photoConsent) })) })
  }
  const rows = db
    .prepare(
      'SELECT id, name, group_name AS groupName, parent_user_id AS parentUserId, photo_consent AS photoConsent FROM children ORDER BY name',
    )
    .all()
  res.json({ children: rows.map((row) => ({ ...(row as object), photoConsent: Boolean((row as { photoConsent: number }).photoConsent) })) })
})

// Round-trip validation rejects impossible dates rather than normalizing them.
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  if (value.startsWith('0000')) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
})

const attendanceQuery = z.object({
  date: calendarDate,
  childId: z.string().trim().min(1).optional(),
}).strict()

const attendanceBody = z.object({
  childId: z.string().trim().min(1),
  attendanceDate: calendarDate,
  status: z.enum(['present', 'absent']),
}).strict()

const attendanceSelect = `
  SELECT a.id, a.child_id AS childId, c.name AS childName, c.group_name AS groupName,
         a.attendance_date AS attendanceDate, a.status,
         a.marked_by AS markedBy, a.updated_at AS updatedAt
  FROM attendance a JOIN children c ON c.id = a.child_id
`

app.get('/api/attendance', requireAuth, (req, res) => {
  const parsed = attendanceQuery.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_query' })
  const user = authed(req)
  let sql = `${attendanceSelect} WHERE a.attendance_date = ?`
  const params = [parsed.data.date]
  if (user.role === 'parent') {
    sql += ' AND c.parent_user_id = ?'
    params.push(user.id)
  }
  if (parsed.data.childId) {
    sql += ' AND a.child_id = ?'
    params.push(parsed.data.childId)
  }
  sql += ' ORDER BY c.name, c.id'
  res.json({ attendance: db.prepare(sql).all(...params) })
})

app.post('/api/attendance', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const parsed = attendanceBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const body = parsed.data
  if (!db.prepare('SELECT id FROM children WHERE id = ?').get(body.childId)) {
    return res.status(404).json({ error: 'child_not_found' })
  }
  try {
    db.prepare(`
      INSERT INTO attendance (id, child_id, attendance_date, status, marked_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(child_id, attendance_date) DO UPDATE SET
        status=excluded.status, marked_by=excluded.marked_by, updated_at=excluded.updated_at
    `).run(randomUUID(), body.childId, body.attendanceDate, body.status, user.id, new Date().toISOString())
    const row = db.prepare(`${attendanceSelect} WHERE a.child_id = ? AND a.attendance_date = ?`)
      .get(body.childId, body.attendanceDate)
    return res.status(201).json({ attendance: row })
  } catch (error) {
    console.error('Could not save attendance:', error)
    return res.status(500).json({ error: 'save_failed' })
  }
})

app.get('/api/reports', requireAuth, (req, res) => {
  const user = authed(req)
  const parsed = z.object({ childId: z.string().trim().min(1).optional(), date: calendarDate.optional() }).strict().safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_query' })
  const { childId, date } = parsed.data

  let sql = `
    SELECT r.id, r.child_id AS childId, c.name AS childName, c.group_name AS groupName,
           r.teacher_user_id AS teacherUserId, u.name AS teacherName,
           r.report_date AS reportDate, r.mood, r.meals, r.nap, r.activities, r.note, r.created_at AS createdAt
    FROM reports r
    JOIN children c ON c.id = r.child_id
    JOIN users u ON u.id = r.teacher_user_id
    WHERE 1=1
  `
  const params: string[] = []
  if (user.role === 'parent') {
    sql += ' AND c.parent_user_id = ?'
    params.push(user.id)
  }
  if (childId) {
    sql += ' AND r.child_id = ?'
    params.push(childId)
  }
  if (date) {
    sql += ' AND r.report_date = ?'
    params.push(date)
  }
  sql += ' ORDER BY r.report_date DESC, c.name ASC LIMIT 50'
  res.json({ reports: db.prepare(sql).all(...params) })
})

const reportSchema = z.object({
  childId: z.string().min(1),
  reportDate: calendarDate,
  mood: z.string().min(1).max(5000).refine((value) => value.trim().length > 0),
  meals: z.string().min(1).max(5000).refine((value) => value.trim().length > 0),
  nap: z.string().min(1).max(5000).refine((value) => value.trim().length > 0),
  activities: z.string().min(1).max(5000).refine((value) => value.trim().length > 0),
  note: z.string().max(5000).default(''),
}).strict()

app.post('/api/reports', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const parsed = reportSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body' })
  }
  const body = parsed.data
  const child = db.prepare('SELECT id FROM children WHERE id = ?').get(body.childId)
  if (!child) return res.status(404).json({ error: 'child_not_found' })

  const id = randomUUID()
  try {
    db.prepare(
      `INSERT INTO reports (id, child_id, teacher_user_id, report_date, mood, meals, nap, activities, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(child_id, report_date) DO UPDATE SET
         teacher_user_id=excluded.teacher_user_id,
         mood=excluded.mood,
         meals=excluded.meals,
         nap=excluded.nap,
         activities=excluded.activities,
         note=excluded.note,
         created_at=excluded.created_at`,
    ).run(
      id,
      body.childId,
      user.id,
      body.reportDate,
      body.mood,
      body.meals,
      body.nap,
      body.activities,
      body.note,
      new Date().toISOString(),
    )
  } catch {
    return res.status(500).json({ error: 'save_failed' })
  }

  const row = db
    .prepare(
      `SELECT r.id, r.child_id AS childId, c.name AS childName, c.group_name AS groupName,
              r.teacher_user_id AS teacherUserId, u.name AS teacherName,
              r.report_date AS reportDate, r.mood, r.meals, r.nap, r.activities, r.note, r.created_at AS createdAt
       FROM reports r
       JOIN children c ON c.id = r.child_id
       JOIN users u ON u.id = r.teacher_user_id
       WHERE r.child_id = ? AND r.report_date = ?`,
    )
    .get(body.childId, body.reportDate)
  res.status(201).json({ report: row })
})


const positiveCents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const invoiceSchema = z.object({
  childId: z.string().trim().min(1),
  requestId: z.string().uuid().optional(),
  items: z.array(z.object({ description: z.string().trim().min(1).max(200), amountCents: positiveCents }).strict()).min(1).max(100),
  currency: z.literal('EUR').default('EUR'),
  periodLabel: z.string().trim().min(1).max(200),
  dueDate: calendarDate,
  notes: z.string().max(5000).optional(),
}).strict().refine((body) => Number.isSafeInteger(body.items.reduce((sum, item) => sum + item.amountCents, 0)))

const invoiceSelect = `SELECT i.id, i.child_id AS childId, c.name AS childName, c.group_name AS groupName,
  i.amount_cents AS amountCents, i.currency, i.period_label AS periodLabel,
  i.status, i.due_date AS dueDate, i.paid_at AS paidAt, i.created_by AS createdBy,
  i.created_at AS createdAt, i.notes FROM invoices i JOIN children c ON c.id = i.child_id`
function invoiceWithItems(row: unknown) {
  const invoice = row as { id: string }
  return { ...invoice, items: db.prepare('SELECT id, description, amount_cents AS amountCents FROM invoice_items WHERE invoice_id = ? ORDER BY position, id').all(invoice.id) }
}
app.get('/api/invoices', requireAuth, (req, res) => {
  const user = authed(req)
  const ownership = user.role === 'parent' ? ' AND c.parent_user_id = ?' : ''
  const params = user.role === 'parent' ? [user.id] : []
  const pending = db.prepare(`${invoiceSelect} WHERE i.status = 'pending'${ownership} ORDER BY i.due_date DESC, c.name`).all(...params)
  const paid = db.prepare(`${invoiceSelect} WHERE i.status = 'paid'${ownership} ORDER BY i.due_date DESC, c.name LIMIT 100`).all(...params)
  const rows = [...pending, ...paid]
  res.json({ invoices: rows.map(invoiceWithItems) })
})
app.post('/api/invoices', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'director' && user.role !== 'teacher') return res.status(403).json({ error: 'forbidden' })
  const parsed = invoiceSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const body = parsed.data
  if (!db.prepare('SELECT id FROM children WHERE id = ?').get(body.childId)) return res.status(404).json({ error: 'child_not_found' })
  const { requestId, ...invoicePayload } = body
  const payload = JSON.stringify(invoicePayload)
  if (requestId) {
    const prior = db.prepare('SELECT payload, invoice_id AS invoiceId FROM invoice_requests WHERE user_id = ? AND request_id = ?').get(user.id, requestId) as { payload: string; invoiceId: string } | undefined
    if (prior) {
      if (prior.payload !== payload) return res.status(409).json({ error: 'request_conflict' })
      return res.status(201).json({ invoice: invoiceWithItems(db.prepare(`${invoiceSelect} WHERE i.id = ?`).get(prior.invoiceId)) })
    }
  }
  const id = randomUUID()
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO invoices (id, child_id, amount_cents, currency, period_label, status, due_date, created_by, created_at, notes)
        VALUES (?, ?, ?, 'EUR', ?, 'pending', ?, ?, ?, ?)`).run(id, body.childId, body.items.reduce((sum, item) => sum + item.amountCents, 0), body.periodLabel, body.dueDate, user.id, new Date().toISOString(), body.notes ?? null)
      const insert = db.prepare('INSERT INTO invoice_items (id, invoice_id, description, amount_cents, position) VALUES (?, ?, ?, ?, ?)')
      body.items.forEach((item, index) => insert.run(randomUUID(), id, item.description, item.amountCents, index))
      if (requestId) db.prepare('INSERT INTO invoice_requests (request_id, user_id, payload, invoice_id) VALUES (?, ?, ?, ?)').run(requestId, user.id, payload, id)
    })()
  } catch { return res.status(500).json({ error: 'save_failed' }) }
  res.status(201).json({ invoice: invoiceWithItems(db.prepare(`${invoiceSelect} WHERE i.id = ?`).get(id)) })
})
app.patch('/api/invoices/:id/paid', requireAuth, (req, res) => {
  if (authed(req).role !== 'director') return res.status(403).json({ error: 'forbidden' })
  const row = db.prepare(`${invoiceSelect} WHERE i.id = ?`).get(req.params.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  db.prepare("UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'").run(new Date().toISOString(), req.params.id)
  res.json({ invoice: invoiceWithItems(db.prepare(`${invoiceSelect} WHERE i.id = ?`).get(req.params.id)) })
})

const parentSchema = z.object({ name: z.string().trim().min(1).max(200), email: z.string().trim().email().max(254), password: z.string().min(10).refine((value) => Buffer.byteLength(value, 'utf8') <= 72) }).strict()
app.get('/api/parents', requireAuth, (req, res) => {
  if (authed(req).role !== 'director') return res.status(403).json({ error: 'forbidden' })
  res.json({ parents: db.prepare("SELECT id, name, email, role FROM users WHERE role = 'parent' ORDER BY name, id").all() })
})
app.post('/api/parents', requireAuth, (req, res) => {
  if (authed(req).role !== 'director') return res.status(403).json({ error: 'forbidden' })
  const parsed = parentSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const body = parsed.data
  if (db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(body.email)) return res.status(409).json({ error: 'email_exists' })
  const parent = { id: randomUUID(), name: body.name, email: body.email.toLowerCase(), role: 'parent' }
  db.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(parent.id, parent.name, parent.email, bcrypt.hashSync(body.password, 10), parent.role)
  res.status(201).json({ parent })
})
const childSchema = z.object({ name: z.string().trim().min(1).max(200), groupName: z.string().trim().min(1).max(200), parentUserId: z.string().trim().min(1) }).strict()
function childRow(id: string) {
  const row = db.prepare('SELECT id, name, group_name AS groupName, parent_user_id AS parentUserId, photo_consent AS photoConsent FROM children WHERE id = ?').get(id) as { photoConsent: number }
  return { ...row, photoConsent: Boolean(row.photoConsent) }
}
app.post('/api/children', requireAuth, (req, res) => {
  if (authed(req).role !== 'director') return res.status(403).json({ error: 'forbidden' })
  const parsed = childSchema.extend({ requestId: z.string().uuid().optional() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const { requestId, ...body } = parsed.data
  const user = authed(req)
  const payload = JSON.stringify(body)
  if (requestId) {
    const prior = db.prepare('SELECT payload, child_id AS childId FROM child_requests WHERE user_id = ? AND request_id = ?').get(user.id, requestId) as { payload: string; childId: string } | undefined
    if (prior) {
      if (prior.payload !== payload) return res.status(409).json({ error: 'request_conflict' })
      return res.status(201).json({ child: childRow(prior.childId) })
    }
  }
  if (!db.prepare("SELECT id FROM users WHERE id = ? AND role = 'parent'").get(body.parentUserId)) return res.status(400).json({ error: 'invalid_parent' })
  const id = randomUUID()
  try {
    db.transaction(() => {
      db.prepare('INSERT INTO children (id, name, group_name, parent_user_id) VALUES (?, ?, ?, ?)').run(id, body.name, body.groupName, body.parentUserId)
      if (requestId) db.prepare('INSERT INTO child_requests (request_id, user_id, payload, child_id) VALUES (?, ?, ?, ?)').run(requestId, user.id, payload, id)
    })()
  } catch { return res.status(500).json({ error: 'save_failed' }) }
  res.status(201).json({ child: childRow(id) })
})
app.patch('/api/children/:id', requireAuth, (req, res) => {
  if (authed(req).role !== 'director') return res.status(403).json({ error: 'forbidden' })
  const parsed = childSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  if (!db.prepare('SELECT id FROM children WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'child_not_found' })
  const body = parsed.data
  if (!db.prepare("SELECT id FROM users WHERE id = ? AND role = 'parent'").get(body.parentUserId)) return res.status(400).json({ error: 'invalid_parent' })
  db.prepare(`UPDATE children SET name = ?, group_name = ?, photo_consent = CASE WHEN parent_user_id = ? THEN photo_consent ELSE 0 END, parent_user_id = ? WHERE id = ?`).run(body.name, body.groupName, body.parentUserId, body.parentUserId, req.params.id)
  res.json({ child: childRow(String(req.params.id)) })
})
app.patch('/api/children/:id/consent', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'parent') return res.status(403).json({ error: 'forbidden' })
  const parsed = z.object({ photoConsent: z.boolean() }).strict().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  if (!db.prepare('SELECT id FROM children WHERE id = ? AND parent_user_id = ?').get(req.params.id, user.id)) return res.status(403).json({ error: 'forbidden' })
  db.prepare('UPDATE children SET photo_consent = ? WHERE id = ? AND parent_user_id = ?').run(Number(parsed.data.photoConsent), req.params.id, user.id)
  res.json({ child: childRow(String(req.params.id)) })
})
app.get('/api/dashboard', requireAuth, (req, res) => {
  const parsed = z.object({ date: calendarDate }).strict().safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_query' })
  const user = authed(req)
  const ownership = user.role === 'parent' ? 'WHERE parent_user_id = ?' : ''
  const params = user.role === 'parent' ? [user.id] : []
  const summary = db.prepare(`WITH roster AS (SELECT id FROM children ${ownership}) SELECT
    (SELECT COUNT(*) FROM roster) AS children,
    (SELECT COUNT(*) FROM attendance WHERE attendance_date = ? AND status = 'present' AND child_id IN (SELECT id FROM roster)) AS present,
    (SELECT COUNT(*) FROM attendance WHERE attendance_date = ? AND status = 'absent' AND child_id IN (SELECT id FROM roster)) AS absent,
    (SELECT COUNT(DISTINCT child_id) FROM reports WHERE report_date = ? AND child_id IN (SELECT id FROM roster)) AS reports,
    (SELECT COUNT(*) FROM invoices WHERE status = 'pending' AND child_id IN (SELECT id FROM roster)) AS unpaidInvoices`).get(...params, parsed.data.date, parsed.data.date, parsed.data.date) as { children: number; present: number; absent: number }
  // Read integer cents as text and accumulate with BigInt: SQLite SUM can overflow,
  // and JSON numbers cannot represent totals above MAX_SAFE_INTEGER exactly.
  const balances = new Map<string, bigint>()
  const pending = db.prepare(`SELECT i.currency, CAST(i.amount_cents AS TEXT) AS cents FROM invoices i
    JOIN children c ON c.id = i.child_id WHERE i.status = 'pending'
    ${user.role === 'parent' ? 'AND c.parent_user_id = ?' : ''}`).all(...params) as { currency: string; cents: string }[]
  for (const invoice of pending) balances.set(invoice.currency, (balances.get(invoice.currency) || 0n) + BigInt(invoice.cents))
  const unpaidBalances = [...balances].sort(([a], [b]) => a.localeCompare(b)).map(([currency, cents]) => ({ currency, amountCents: cents.toString() }))
  const children = db.prepare(`SELECT c.id, c.name, c.group_name AS groupName, c.photo_consent AS photoConsent,
    a.status AS attendanceStatus, EXISTS(SELECT 1 FROM reports r WHERE r.child_id = c.id AND r.report_date = ?) AS hasReport
    FROM children c LEFT JOIN attendance a ON a.child_id = c.id AND a.attendance_date = ?
    ${user.role === 'parent' ? 'WHERE c.parent_user_id = ?' : ''} ORDER BY c.name, c.id`).all(parsed.data.date, parsed.data.date, ...params)
    .map((row) => { const child = row as { photoConsent: number; hasReport: number }; return { ...child, photoConsent: Boolean(child.photoConsent), hasReport: Boolean(child.hasReport) } })
  res.json({ summary: { ...summary, unpaidBalances, date: parsed.data.date, unmarked: summary.children - summary.present - summary.absent, childSummaries: children } })
})
