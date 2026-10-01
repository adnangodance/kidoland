import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { db, type DbUser } from './db.js'
import { requireAuth, signToken, type AuthUser } from './auth.js'

const app = express()
const PORT = Number(process.env.PORT) || 4000

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

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
        'SELECT id, name, group_name AS groupName, parent_user_id AS parentUserId FROM children WHERE parent_user_id = ? ORDER BY name',
      )
      .all(user.id)
    return res.json({ children: rows })
  }
  const rows = db
    .prepare(
      'SELECT id, name, group_name AS groupName, parent_user_id AS parentUserId FROM children ORDER BY name',
    )
    .all()
  res.json({ children: rows })
})

app.get('/api/reports', requireAuth, (req, res) => {
  const user = authed(req)
  const childId = typeof req.query.childId === 'string' ? req.query.childId : undefined
  const date = typeof req.query.date === 'string' ? req.query.date : undefined

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
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mood: z.string().min(1),
  meals: z.string().min(1),
  nap: z.string().min(1),
  activities: z.string().min(1),
  note: z.string().min(1),
})

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
  } catch (e) {
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


const invoiceSchema = z.object({
  childId: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: z.string().min(1).default('EUR'),
  periodLabel: z.string().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
})

app.get('/api/invoices', requireAuth, (req, res) => {
  const user = authed(req)
  let sql = `
    SELECT i.id, i.child_id AS childId, c.name AS childName, c.group_name AS groupName,
           i.amount_cents AS amountCents, i.currency, i.period_label AS periodLabel,
           i.status, i.due_date AS dueDate, i.paid_at AS paidAt,
           i.created_by AS createdBy, i.created_at AS createdAt, i.notes
    FROM invoices i
    JOIN children c ON c.id = i.child_id
    WHERE 1=1
  `
  const params: string[] = []
  if (user.role === 'parent') {
    sql += ' AND c.parent_user_id = ?'
    params.push(user.id)
  }
  sql += ' ORDER BY i.due_date DESC, c.name ASC LIMIT 100'
  res.json({ invoices: db.prepare(sql).all(...params) })
})

app.post('/api/invoices', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'director' && user.role !== 'teacher') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const parsed = invoiceSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body' })
  }
  const body = parsed.data
  const child = db.prepare('SELECT id FROM children WHERE id = ?').get(body.childId)
  if (!child) return res.status(404).json({ error: 'child_not_found' })

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO invoices (id, child_id, amount_cents, currency, period_label, status, due_date, paid_at, created_by, created_at, notes)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?, ?)`,
  ).run(
    id,
    body.childId,
    body.amountCents,
    body.currency || 'EUR',
    body.periodLabel,
    body.dueDate,
    user.id,
    createdAt,
    body.notes ?? null,
  )

  const row = db
    .prepare(
      `SELECT i.id, i.child_id AS childId, c.name AS childName, c.group_name AS groupName,
              i.amount_cents AS amountCents, i.currency, i.period_label AS periodLabel,
              i.status, i.due_date AS dueDate, i.paid_at AS paidAt,
              i.created_by AS createdBy, i.created_at AS createdAt, i.notes
       FROM invoices i
       JOIN children c ON c.id = i.child_id
       WHERE i.id = ?`,
    )
    .get(id)
  res.status(201).json({ invoice: row })
})

app.patch('/api/invoices/:id/paid', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const id = req.params.id
  const existing = db.prepare('SELECT id, status FROM invoices WHERE id = ?').get(id) as
    | { id: string; status: string }
    | undefined
  if (!existing) return res.status(404).json({ error: 'not_found' })
  if (existing.status === 'paid') {
    const row = db
      .prepare(
        `SELECT i.id, i.child_id AS childId, c.name AS childName, c.group_name AS groupName,
                i.amount_cents AS amountCents, i.currency, i.period_label AS periodLabel,
                i.status, i.due_date AS dueDate, i.paid_at AS paidAt,
                i.created_by AS createdBy, i.created_at AS createdAt, i.notes
         FROM invoices i
         JOIN children c ON c.id = i.child_id
         WHERE i.id = ?`,
      )
      .get(id)
    return res.json({ invoice: row })
  }
  const paidAt = new Date().toISOString()
  db.prepare(`UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?`).run(paidAt, id)
  const row = db
    .prepare(
      `SELECT i.id, i.child_id AS childId, c.name AS childName, c.group_name AS groupName,
              i.amount_cents AS amountCents, i.currency, i.period_label AS periodLabel,
              i.status, i.due_date AS dueDate, i.paid_at AS paidAt,
              i.created_by AS createdBy, i.created_at AS createdAt, i.notes
       FROM invoices i
       JOIN children c ON c.id = i.child_id
       WHERE i.id = ?`,
    )
    .get(id)
  res.json({ invoice: row })
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Kidoland API on http://127.0.0.1:${PORT}`)
})
