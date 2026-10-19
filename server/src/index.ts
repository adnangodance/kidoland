import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, localCalendarDate, ALL_FEATURES, getRoleFeaturePermissions, setRoleFeaturePermission, resetRoleFeaturePermissions, type DbUser, type DbChildSleepLog, type DbChildMedication, type DbChildHygieneLog } from './db.js'
import { requireAuth, signToken, type AuthUser } from './auth.js'

export const app = express()

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
)

const corsOrigin = process.env.CORS_ORIGIN
const allowedOrigins = corsOrigin
  ? corsOrigin.split(',').map((o) => o.trim()).filter(Boolean)
  : null

app.use(
  cors({
    origin: allowedOrigins
      ? (origin, callback) => {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true)
          } else {
            callback(new Error('Not allowed by CORS'))
          }
        }
      : true,
    credentials: true,
  }),
)
app.use(express.json({ limit: '10mb' }))
app.use((error: { type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') return res.status(400).json({ error: 'invalid_body' })
  next(error)
})

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 2000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_login_attempts' },
})

function authed(req: express.Request): AuthUser {
  return (req as express.Request & { user: AuthUser }).user
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'kidoland-api' })
})

app.get('/api/auth/setup-status', (_req, res) => {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
  res.json({ needsSetup: row.count === 0 })
})

const setupAdminSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().email(),
  password: z.string().min(6),
})

app.post('/api/auth/setup-admin', (req, res) => {
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
  if (countRow.count > 0) {
    return res.status(403).json({ error: 'setup_already_completed' })
  }
  const parsed = setupAdminSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body' })
  }
  const { name, email, password } = parsed.data
  const id = `u-${randomUUID()}`
  const hash = bcrypt.hashSync(password, 10)
  db.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(
    id,
    name,
    email.toLowerCase(),
    hash,
    'superadmin',
  )
  const user: AuthUser = {
    id,
    name,
    email: email.toLowerCase(),
    role: 'superadmin',
  }
  res.status(201).json({ token: signToken(user), user })
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

app.post('/api/auth/login', loginLimiter, (req, res) => {
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
        "SELECT id, name, group_name AS groupName, parent_user_id AS parentUserId, photo_consent AS photoConsent, COALESCE(allergies, '') AS allergies FROM children WHERE parent_user_id = ? ORDER BY name",
      )
      .all(user.id)
    return res.json({ children: rows.map((row) => ({ ...(row as object), photoConsent: Boolean((row as { photoConsent: number }).photoConsent), allergies: (row as { allergies?: string }).allergies || '' })) })
  }
  const rows = db
    .prepare(
      "SELECT id, name, group_name AS groupName, parent_user_id AS parentUserId, photo_consent AS photoConsent, COALESCE(allergies, '') AS allergies FROM children ORDER BY name",
    )
    .all()
  res.json({ children: rows.map((row) => ({ ...(row as object), photoConsent: Boolean((row as { photoConsent: number }).photoConsent), allergies: (row as { allergies?: string }).allergies || '' })) })
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
  if (user.role !== 'teacher' && user.role !== 'director' && user.role !== 'superadmin') {
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
           COALESCE(c.allergies, '') AS allergies,
           r.teacher_user_id AS teacherUserId, u.name AS teacherName,
           r.report_date AS reportDate, r.mood, r.meals, r.nap, r.activities, r.note, r.created_at AS createdAt,
           rp.image_url AS imageUrl
    FROM reports r
    JOIN children c ON c.id = r.child_id
    JOIN users u ON u.id = r.teacher_user_id
    LEFT JOIN report_photos rp ON rp.report_id = r.id
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
  imageUrl: z.string().max(8_000_000).nullable().optional(),
}).strict()

app.post('/api/reports', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director' && user.role !== 'superadmin') {
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
    db.transaction(() => {
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

      if (body.imageUrl !== undefined) {
        const reportRow = db.prepare('SELECT id FROM reports WHERE child_id = ? AND report_date = ?').get(body.childId, body.reportDate) as { id: string }
        if (body.imageUrl && body.imageUrl.trim().length > 0) {
          db.prepare(`
            INSERT INTO report_photos (id, report_id, image_url, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(report_id) DO UPDATE SET
              image_url=excluded.image_url,
              created_at=excluded.created_at
          `).run(randomUUID(), reportRow.id, body.imageUrl, new Date().toISOString())
        } else {
          db.prepare('DELETE FROM report_photos WHERE report_id = ?').run(reportRow.id)
        }
      }
    })()
  } catch {
    return res.status(500).json({ error: 'save_failed' })
  }

  const row = db
    .prepare(
      `SELECT r.id, r.child_id AS childId, c.name AS childName, c.group_name AS groupName,
              COALESCE(c.allergies, '') AS allergies,
              r.teacher_user_id AS teacherUserId, u.name AS teacherName,
              r.report_date AS reportDate, r.mood, r.meals, r.nap, r.activities, r.note, r.created_at AS createdAt,
              rp.image_url AS imageUrl
       FROM reports r
       JOIN children c ON c.id = r.child_id
       JOIN users u ON u.id = r.teacher_user_id
       LEFT JOIN report_photos rp ON rp.report_id = r.id
       WHERE r.child_id = ? AND r.report_date = ?`,
    )
    .get(body.childId, body.reportDate)
  res.status(201).json({ report: row })
})

const batchReportSchema = z.object({
  childIds: z.array(z.string().trim().min(1)).min(1).max(100),
  reportDate: calendarDate,
  mood: z.string().trim().min(1).max(100),
  meals: z.string().trim().min(1).max(100),
  nap: z.string().trim().min(1).max(100),
  activities: z.string().trim().min(1).max(500),
  note: z.string().max(5000).optional().default(''),
}).strict()

app.post('/api/reports/batch', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role === 'parent') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const parsed = batchReportSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const body = parsed.data

  const validChildren = db.prepare(`SELECT id FROM children WHERE id IN (${body.childIds.map(() => '?').join(',')})`).all(...body.childIds) as { id: string }[]
  if (validChildren.length === 0) {
    return res.status(404).json({ error: 'no_valid_children' })
  }

  const now = new Date().toISOString()
  try {
    db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO reports (id, child_id, teacher_user_id, report_date, mood, meals, nap, activities, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(child_id, report_date) DO UPDATE SET
          teacher_user_id=excluded.teacher_user_id,
          mood=excluded.mood,
          meals=excluded.meals,
          nap=excluded.nap,
          activities=excluded.activities,
          note=excluded.note,
          created_at=excluded.created_at
      `)
      for (const child of validChildren) {
        insert.run(randomUUID(), child.id, user.id, body.reportDate, body.mood, body.meals, body.nap, body.activities, body.note, now)
      }
    })()

    return res.status(201).json({ count: validChildren.length })
  } catch (error) {
    console.error('Batch report failed:', error)
    return res.status(500).json({ error: 'save_failed' })
  }
})


const programBodySchema = z.object({
  groupName: z.string().trim().min(1).max(100),
  programDate: calendarDate,
  theme: z.string().trim().min(1).max(300),
  activities: z.string().trim().min(1).max(5000),
  mealsMenu: z.string().trim().min(1).max(5000),
  notes: z.string().max(5000).optional().default(''),
}).strict()

app.get('/api/programs', requireAuth, (req, res) => {
  const user = authed(req)
  const parsed = z.object({
    date: calendarDate.optional(),
    groupName: z.string().trim().min(1).max(100).optional(),
  }).strict().safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_query' })
  const { date, groupName } = parsed.data

  let allowedGroups: string[] | null = null
  if (user.role === 'parent') {
    const parentGroups = db.prepare('SELECT DISTINCT group_name FROM children WHERE parent_user_id = ?').all(user.id) as { group_name: string }[]
    allowedGroups = parentGroups.map((g) => g.group_name)
    if (allowedGroups.length === 0) {
      return res.json({ programs: [] })
    }
    if (groupName && !allowedGroups.includes(groupName)) {
      return res.json({ programs: [] })
    }
  }

  let sql = `
    SELECT p.id, p.group_name AS groupName, p.program_date AS programDate,
           p.theme, p.activities, p.meals_menu AS mealsMenu, p.notes,
           p.created_by AS createdBy, u.name AS createdByName,
           p.created_at AS createdAt, p.updated_at AS updatedAt
    FROM daily_programs p
    JOIN users u ON u.id = p.created_by
    WHERE 1=1
  `
  const params: unknown[] = []
  if (date) {
    sql += ' AND p.program_date = ?'
    params.push(date)
  }
  if (groupName) {
    sql += ' AND p.group_name = ?'
    params.push(groupName)
  } else if (allowedGroups) {
    sql += ` AND p.group_name IN (${allowedGroups.map(() => '?').join(',')})`
    params.push(...allowedGroups)
  }
  sql += ' ORDER BY p.program_date DESC, p.group_name ASC'

  const rows = db.prepare(sql).all(...params)
  res.json({ programs: rows })
})

app.post('/api/programs', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role === 'parent') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const parsed = programBodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body' })
  }
  const body = parsed.data
  const id = randomUUID()
  const now = new Date().toISOString()

  try {
    db.prepare(`
      INSERT INTO daily_programs (id, group_name, program_date, theme, activities, meals_menu, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_name, program_date) DO UPDATE SET
        theme=excluded.theme,
        activities=excluded.activities,
        meals_menu=excluded.meals_menu,
        notes=excluded.notes,
        created_by=excluded.created_by,
        updated_at=excluded.updated_at
    `).run(id, body.groupName, body.programDate, body.theme, body.activities, body.mealsMenu, body.notes || '', user.id, now, now)

    const row = db.prepare(`
      SELECT p.id, p.group_name AS groupName, p.program_date AS programDate,
             p.theme, p.activities, p.meals_menu AS mealsMenu, p.notes,
             p.created_by AS createdBy, u.name AS createdByName,
             p.created_at AS createdAt, p.updated_at AS updatedAt
      FROM daily_programs p
      JOIN users u ON u.id = p.created_by
      WHERE p.group_name = ? AND p.program_date = ?
    `).get(body.groupName, body.programDate)

    res.status(201).json({ program: row })
  } catch (error) {
    console.error('Could not save program:', error)
    res.status(500).json({ error: 'save_failed' })
  }
})

const announcementBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(5000),
  priority: z.enum(['normal', 'important', 'urgent']).default('normal'),
  targetGroup: z.string().trim().min(1).max(100).default('all'),
  eventDate: calendarDate.optional().nullable(),
}).strict()

app.get('/api/announcements', requireAuth, (req, res) => {
  const user = authed(req)
  let rows: any[]
  if (user.role === 'parent') {
    const parentGroups = db.prepare('SELECT DISTINCT group_name FROM children WHERE parent_user_id = ?').all(user.id) as { group_name: string }[]
    const groups = ['all', ...parentGroups.map((g) => g.group_name)]
    const placeholders = groups.map(() => '?').join(',')
    rows = db.prepare(`
      SELECT a.id, a.title, a.content, a.priority, a.target_group AS targetGroup,
             a.event_date AS eventDate, a.created_at AS createdAt, u.name AS authorName,
             a.created_by AS createdBy
      FROM announcements a
      JOIN users u ON u.id = a.created_by
      WHERE a.target_group IN (${placeholders})
      ORDER BY
        CASE a.priority WHEN 'urgent' THEN 1 WHEN 'important' THEN 2 ELSE 3 END,
        a.created_at DESC
    `).all(...groups)
  } else {
    rows = db.prepare(`
      SELECT a.id, a.title, a.content, a.priority, a.target_group AS targetGroup,
             a.event_date AS eventDate, a.created_at AS createdAt, u.name AS authorName,
             a.created_by AS createdBy
      FROM announcements a
      JOIN users u ON u.id = a.created_by
      ORDER BY
        CASE a.priority WHEN 'urgent' THEN 1 WHEN 'important' THEN 2 ELSE 3 END,
        a.created_at DESC
    `).all()
  }
  res.json({ announcements: rows })
})

app.post('/api/announcements', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role === 'parent') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const parsed = announcementBodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body' })
  }
  const body = parsed.data
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  db.prepare(`
    INSERT INTO announcements (id, title, content, priority, target_group, event_date, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, body.title, body.content, body.priority, body.targetGroup, body.eventDate || null, user.id, createdAt)

  const row = db.prepare(`
    SELECT a.id, a.title, a.content, a.priority, a.target_group AS targetGroup,
           a.event_date AS eventDate, a.created_at AS createdAt, u.name AS authorName,
           a.created_by AS createdBy
    FROM announcements a
    JOIN users u ON u.id = a.created_by
    WHERE a.id = ?
  `).get(id)
  res.status(201).json({ announcement: row })
})

app.delete('/api/announcements/:id', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role === 'parent') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const existing = db.prepare('SELECT id, created_by FROM announcements WHERE id = ?').get(req.params.id) as { id: string; created_by: string } | undefined
  if (!existing) {
    return res.status(404).json({ error: 'not_found' })
  }
  if (user.role === 'teacher' && existing.created_by !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id)
  res.json({ success: true })
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
  i.status, i.due_date AS dueDate, i.paid_at AS paidAt, COALESCE(i.payment_method, '') AS paymentMethod,
  COALESCE(i.transaction_ref, '') AS transactionRef, i.created_by AS createdBy,
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
  if (user.role !== 'director' && user.role !== 'teacher' && user.role !== 'superadmin') return res.status(403).json({ error: 'forbidden' })
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
  const user = authed(req)
  if (user.role !== 'director' && user.role !== 'superadmin') return res.status(403).json({ error: 'forbidden' })
  const row = db.prepare(`${invoiceSelect} WHERE i.id = ?`).get(req.params.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  db.prepare("UPDATE invoices SET status = 'paid', paid_at = ?, payment_method = 'manual' WHERE id = ? AND status = 'pending'").run(new Date().toISOString(), req.params.id)
  res.json({ invoice: invoiceWithItems(db.prepare(`${invoiceSelect} WHERE i.id = ?`).get(req.params.id)) })
})

const invoicePaySchema = z.object({
  paymentMethod: z.enum(['card', 'bank_transfer']),
  reference: z.string().trim().max(100).optional(),
}).strict()

app.post('/api/invoices/:id/pay', requireAuth, (req, res) => {
  const user = authed(req)
  const row = db.prepare(`SELECT i.id, i.status, c.parent_user_id AS parentUserId FROM invoices i JOIN children c ON c.id = i.child_id WHERE i.id = ?`).get(req.params.id) as { id: string; status: string; parentUserId: string } | undefined
  if (!row) return res.status(404).json({ error: 'not_found' })

  if (user.role === 'parent' && row.parentUserId !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  if (row.status === 'paid') {
    return res.status(400).json({ error: 'already_paid' })
  }

  const parsed = invoicePaySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })

  const now = new Date().toISOString()
  const ref = parsed.data.reference || `TXN-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`

  db.prepare(`
    UPDATE invoices
    SET status = 'paid', paid_at = ?, payment_method = ?, transaction_ref = ?
    WHERE id = ? AND status = 'pending'
  `).run(now, parsed.data.paymentMethod, ref, req.params.id)

  const updated = db.prepare(`${invoiceSelect} WHERE i.id = ?`).get(req.params.id)
  res.json({ invoice: invoiceWithItems(updated) })
})

app.get('/api/invoices/:id/receipt', requireAuth, (req, res) => {
  const user = authed(req)
  const invoiceRow = db.prepare(`
    SELECT i.id, i.child_id AS childId, c.name AS childName, c.group_name AS groupName,
           c.parent_user_id AS parentUserId, u.name AS parentName, u.email AS parentEmail,
           i.amount_cents AS amountCents, i.currency, i.period_label AS periodLabel,
           i.status, i.due_date AS dueDate, i.paid_at AS paidAt,
           COALESCE(i.payment_method, '') AS paymentMethod,
           COALESCE(i.transaction_ref, '') AS transactionRef,
           i.created_at AS createdAt, i.notes
    FROM invoices i
    JOIN children c ON c.id = i.child_id
    JOIN users u ON u.id = c.parent_user_id
    WHERE i.id = ?
  `).get(req.params.id) as any
  if (!invoiceRow) return res.status(404).json({ error: 'not_found' })

  if (user.role === 'parent' && invoiceRow.parentUserId !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const items = db.prepare('SELECT id, description, amount_cents AS amountCents FROM invoice_items WHERE invoice_id = ? ORDER BY position, id').all(invoiceRow.id)

  const receipt = {
    receiptNumber: `REC-${invoiceRow.id.slice(0, 8).toUpperCase()}`,
    kindergarten: {
      name: 'Kidoland Kindergarten Sh.p.k.',
      address: 'Rruga e Kopshtit Nr. 12, Prishtinë, Kosovë',
      taxId: '810992341',
      iban: 'XK05 1501 0010 2030 4050',
      bankName: 'Banka Ekonomike / NLB Banka',
    },
    invoice: {
      ...invoiceRow,
      items,
    },
  }

  res.json({ receipt })
})

const parentSchema = z.object({ name: z.string().trim().min(1).max(200), email: z.string().trim().email().max(254), password: z.string().min(10).refine((value) => Buffer.byteLength(value, 'utf8') <= 72) }).strict()
app.get('/api/parents', requireAuth, (req, res) => {
  const caller = authed(req)
  if (caller.role !== 'director' && caller.role !== 'superadmin') return res.status(403).json({ error: 'forbidden' })
  res.json({ parents: db.prepare("SELECT id, name, email, role FROM users WHERE role = 'parent' ORDER BY name, id").all() })
})
app.post('/api/parents', requireAuth, (req, res) => {
  const caller = authed(req)
  if (caller.role !== 'director' && caller.role !== 'superadmin') return res.status(403).json({ error: 'forbidden' })
  const parsed = parentSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const body = parsed.data
  if (db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(body.email)) return res.status(409).json({ error: 'email_exists' })
  const parent = { id: randomUUID(), name: body.name, email: body.email.toLowerCase(), role: 'parent' }
  db.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(parent.id, parent.name, parent.email, bcrypt.hashSync(body.password, 10), parent.role)
  res.status(201).json({ parent })
})

const staffSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  password: z.string().min(6).refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
  role: z.enum(['teacher', 'director']),
}).strict()

app.get('/api/staff', requireAuth, (req, res) => {
  const caller = authed(req)
  if (caller.role !== 'director' && caller.role !== 'superadmin') return res.status(403).json({ error: 'forbidden' })
  const staff = db.prepare("SELECT id, name, email, role FROM users WHERE role IN ('teacher', 'director') ORDER BY role, name").all()
  res.json({ staff })
})

app.post('/api/staff', requireAuth, (req, res) => {
  const caller = authed(req)
  if (caller.role !== 'director' && caller.role !== 'superadmin') return res.status(403).json({ error: 'forbidden' })
  const parsed = staffSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const body = parsed.data
  if (caller.role === 'director' && body.role === 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }
  if (db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(body.email)) {
    return res.status(409).json({ error: 'email_exists' })
  }
  const id = randomUUID()
  db.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(
    id,
    body.name,
    body.email.toLowerCase(),
    bcrypt.hashSync(body.password, 10),
    body.role,
  )
  res.status(201).json({ staff: { id, name: body.name, email: body.email.toLowerCase(), role: body.role } })
})

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6).refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
})

app.post('/api/users/:id/reset-password', requireAuth, (req, res) => {
  const caller = authed(req)
  if (caller.role !== 'director' && caller.role !== 'superadmin') return res.status(403).json({ error: 'forbidden' })
  const target = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(req.params.id) as DbUser | undefined
  if (!target) return res.status(404).json({ error: 'user_not_found' })
  if (caller.role !== 'superadmin' && (target.role === 'superadmin' || target.role === 'director')) {
    return res.status(403).json({ error: 'forbidden' })
  }
  const parsed = resetPasswordSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    bcrypt.hashSync(parsed.data.newPassword, 10),
    target.id,
  )
  res.json({ ok: true, userId: target.id })
})

const childSchema = z.object({ name: z.string().trim().min(1).max(200), groupName: z.string().trim().min(1).max(200), parentUserId: z.string().trim().min(1), allergies: z.string().max(500).optional().default('') }).strict()
function childRow(id: string) {
  const row = db.prepare("SELECT id, name, group_name AS groupName, parent_user_id AS parentUserId, photo_consent AS photoConsent, COALESCE(allergies, '') AS allergies FROM children WHERE id = ?").get(id) as { photoConsent: number; allergies: string }
  return { ...row, photoConsent: Boolean(row.photoConsent), allergies: row.allergies || '' }
}
app.post('/api/children', requireAuth, (req, res) => {
  const caller = authed(req)
  if (caller.role !== 'director' && caller.role !== 'superadmin') return res.status(403).json({ error: 'forbidden' })
  const parsed = childSchema.extend({ requestId: z.string().uuid().optional() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const { requestId, ...body } = parsed.data
  const user = caller
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
      db.prepare('INSERT INTO children (id, name, group_name, parent_user_id, allergies) VALUES (?, ?, ?, ?, ?)').run(id, body.name, body.groupName, body.parentUserId, body.allergies || '')
      if (requestId) db.prepare('INSERT INTO child_requests (request_id, user_id, payload, child_id) VALUES (?, ?, ?, ?)').run(requestId, user.id, payload, id)
    })()
  } catch { return res.status(500).json({ error: 'save_failed' }) }
  res.status(201).json({ child: childRow(id) })
})
app.patch('/api/children/:id', requireAuth, (req, res) => {
  const caller = authed(req)
  if (caller.role !== 'director' && caller.role !== 'superadmin') return res.status(403).json({ error: 'forbidden' })
  const parsed = childSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  if (!db.prepare('SELECT id FROM children WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'child_not_found' })
  const body = parsed.data
  if (!db.prepare("SELECT id FROM users WHERE id = ? AND role = 'parent'").get(body.parentUserId)) return res.status(400).json({ error: 'invalid_parent' })
  db.prepare(`UPDATE children SET name = ?, group_name = ?, photo_consent = CASE WHEN parent_user_id = ? THEN photo_consent ELSE 0 END, parent_user_id = ?, allergies = ? WHERE id = ?`).run(body.name, body.groupName, body.parentUserId, body.parentUserId, body.allergies || '', req.params.id)
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

const pickupPersonSchema = z.object({
  name: z.string().trim().min(1).max(100),
  relationship: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(1).max(50),
  isEmergency: z.boolean().default(false),
}).strict()

function verifyChildAccess(childId: string, user: { id: string; role: string }) {
  const child = db.prepare('SELECT id, parent_user_id FROM children WHERE id = ?').get(childId) as { id: string; parent_user_id: string } | undefined
  if (!child) return { status: 404, error: 'child_not_found' }
  if (user.role === 'parent' && child.parent_user_id !== user.id) {
    return { status: 403, error: 'forbidden' }
  }
  return { status: 200, child }
}

app.get('/api/children/:id/profile', requireAuth, (req, res) => {
  const user = authed(req)
  const access = verifyChildAccess(String(req.params.id), user)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })

  const child = db.prepare(`
    SELECT c.id, c.name, c.group_name AS groupName, c.parent_user_id AS parentUserId,
           c.photo_consent AS photoConsent, COALESCE(c.allergies, '') AS allergies
    FROM children c
    WHERE c.id = ?
  `).get(req.params.id) as {
    id: string
    name: string
    groupName: string
    parentUserId: string
    photoConsent: number
    allergies: string
  }

  const parent = db.prepare(`
    SELECT id, name, email, role FROM users WHERE id = ?
  `).get(child.parentUserId) as { id: string; name: string; email: string; role: string } | undefined

  const pickups = db.prepare(`
    SELECT id, name, relationship, phone, is_emergency AS isEmergency
    FROM authorized_pickups
    WHERE child_id = ?
    ORDER BY is_emergency DESC, name ASC
  `).all(child.id).map((p: any) => ({ ...p, isEmergency: Boolean(p.isEmergency) }))

  const medical = db.prepare(`
    SELECT pediatrician_name AS pediatricianName, pediatrician_phone AS pediatricianPhone,
           blood_type AS bloodType, chronic_conditions AS chronicConditions,
           emergency_medications AS emergencyMedications, notes
    FROM child_medical_profiles
    WHERE child_id = ?
  `).get(child.id) || null

  const activeMedications = db.prepare(`
    SELECT id, medication_name AS medicationName, dosage, frequency_schedule AS frequencySchedule, instructions
    FROM child_medications
    WHERE child_id = ? AND status = 'active'
  `).all(child.id)

  const attendanceRows = db.prepare(`
    SELECT attendance_date AS date, status
    FROM attendance
    WHERE child_id = ?
    ORDER BY attendance_date DESC
    LIMIT 30
  `).all(child.id) as { date: string; status: 'present' | 'absent' }[]

  let totalPresent = 0
  let totalAbsent = 0
  let streak = 0
  let streakBroken = false

  for (const a of attendanceRows) {
    if (a.status === 'present') {
      totalPresent++
      if (!streakBroken) streak++
    } else {
      totalAbsent++
      streakBroken = true
    }
  }

  const recentReports = db.prepare(`
    SELECT r.id, r.report_date AS date, r.mood, r.meals, r.nap, r.activities, r.note,
           (SELECT image_url FROM report_photos p WHERE p.report_id = r.id LIMIT 1) AS photoUrl
    FROM reports r
    WHERE r.child_id = ?
    ORDER BY r.report_date DESC
    LIMIT 3
  `).all(child.id)

  const milestoneRecords = db.prepare(`
    SELECT r.status, m.domain, m.title_en AS titleEn, m.title_sq AS titleSq
    FROM child_milestone_records r
    JOIN developmental_milestones m ON m.id = r.milestone_id
    WHERE r.child_id = ?
  `).all(child.id) as { status: string; domain: string; titleEn: string; titleSq: string }[]

  const masteredCount = milestoneRecords.filter((m) => m.status === 'mastered').length
  const achievedCount = milestoneRecords.filter((m) => m.status === 'achieved').length
  const emergingCount = milestoneRecords.filter((m) => m.status === 'emerging').length

  const isSpecial = child.name.toLowerCase().includes('sea godanci') || Boolean(parent && parent.name.toLowerCase().includes('adnan godanci'))

  res.json({
    child: {
      ...child,
      photoConsent: Boolean(child.photoConsent),
      isSpecial: Boolean(isSpecial),
    },
    parent: parent ? {
      id: parent.id,
      name: parent.name,
      email: parent.email,
      phone: isSpecial ? '+383 44 123 456' : '+383 44 987 654',
    } : null,
    pickups,
    medical,
    activeMedications,
    attendance: {
      totalPresent,
      totalAbsent,
      streak,
      history: attendanceRows.slice(0, 7),
    },
    recentReports,
    milestones: {
      masteredCount,
      achievedCount,
      emergingCount,
      totalTracked: milestoneRecords.length,
      sampleMastered: milestoneRecords.filter((m) => m.status === 'mastered').slice(0, 3),
    },
  })
})

app.get('/api/children/:id/pickups', requireAuth, (req, res) => {
  const user = authed(req)
  const access = verifyChildAccess(String(req.params.id), user)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })

  const rows = db.prepare(`
    SELECT id, child_id AS childId, name, relationship, phone, is_emergency AS isEmergency, created_at AS createdAt
    FROM authorized_pickups
    WHERE child_id = ?
    ORDER BY is_emergency DESC, created_at ASC
  `).all(req.params.id)
    .map((row) => ({ ...(row as object), isEmergency: Boolean((row as { isEmergency: number }).isEmergency) }))
  res.json({ pickups: rows })
})

app.post('/api/children/:id/pickups', requireAuth, (req, res) => {
  const user = authed(req)
  const access = verifyChildAccess(String(req.params.id), user)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })

  if (user.role !== 'parent' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const parsed = pickupPersonSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const body = parsed.data
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO authorized_pickups (id, child_id, name, relationship, phone, is_emergency, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.id, body.name, body.relationship, body.phone, Number(body.isEmergency), now)

  const row = db.prepare(`
    SELECT id, child_id AS childId, name, relationship, phone, is_emergency AS isEmergency, created_at AS createdAt
    FROM authorized_pickups WHERE id = ?
  `).get(id) as { isEmergency: number }
  res.status(201).json({ pickup: { ...row, isEmergency: Boolean(row.isEmergency) } })
})

app.delete('/api/children/:id/pickups/:pickupId', requireAuth, (req, res) => {
  const user = authed(req)
  const access = verifyChildAccess(String(req.params.id), user)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })

  if (user.role !== 'parent' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const existing = db.prepare('SELECT id FROM authorized_pickups WHERE id = ? AND child_id = ?').get(req.params.pickupId, req.params.id)
  if (!existing) return res.status(404).json({ error: 'not_found' })

  db.prepare('DELETE FROM authorized_pickups WHERE id = ?').run(req.params.pickupId)
  res.json({ success: true })
})

const pickupLogSchema = z.object({
  logDate: calendarDate,
  logTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  action: z.enum(['check_in', 'check_out']),
  guardianName: z.string().trim().min(1).max(100),
  notes: z.string().max(1000).optional().default(''),
}).strict()

app.get('/api/children/:id/pickup-logs', requireAuth, (req, res) => {
  const user = authed(req)
  const access = verifyChildAccess(String(req.params.id), user)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })

  const parsed = z.object({ date: calendarDate.optional() }).strict().safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_query' })

  let sql = `
    SELECT l.id, l.child_id AS childId, l.log_date AS logDate, l.log_time AS logTime,
           l.action, l.guardian_name AS guardianName, l.notes, l.created_at AS createdAt,
           u.name AS staffName
    FROM pickup_logs l
    JOIN users u ON u.id = l.staff_user_id
    WHERE l.child_id = ?
  `
  const params: any[] = [req.params.id]
  if (parsed.data.date) {
    sql += ' AND l.log_date = ?'
    params.push(parsed.data.date)
  }
  sql += ' ORDER BY l.log_date DESC, l.log_time DESC'

  const rows = db.prepare(sql).all(...params)
  res.json({ logs: rows })
})

app.post('/api/children/:id/pickup-logs', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role === 'parent') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const access = verifyChildAccess(String(req.params.id), user)
  if (access.status !== 200) return res.status(access.status).json({ error: access.error })

  const parsed = pickupLogSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const body = parsed.data
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO pickup_logs (id, child_id, log_date, log_time, action, guardian_name, staff_user_id, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.id, body.logDate, body.logTime, body.action, body.guardianName, user.id, body.notes, now)

  const row = db.prepare(`
    SELECT l.id, l.child_id AS childId, l.log_date AS logDate, l.log_time AS logTime,
           l.action, l.guardian_name AS guardianName, l.notes, l.created_at AS createdAt,
           u.name AS staffName
    FROM pickup_logs l
    JOIN users u ON u.id = l.staff_user_id
    WHERE l.id = ?
  `).get(id)
  res.status(201).json({ log: row })
})

const conversationCreateSchema = z.object({
  childId: z.string().trim().min(1),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
}).strict()

const messageCreateSchema = z.object({
  content: z.string().trim().min(1).max(5000),
}).strict()

app.get('/api/conversations', requireAuth, (req, res) => {
  const user = authed(req)
  let sql = `
    SELECT c.id, c.child_id AS childId, c.parent_user_id AS parentUserId,
           c.subject, c.created_at AS createdAt, c.updated_at AS updatedAt,
           ch.name AS childName, ch.group_name AS groupName,
           pu.name AS parentName,
           (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS lastMessage,
           (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS lastMessageAt,
           (SELECT m.sender_name FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS lastSenderName,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_user_id != ? AND m.read_at IS NULL) AS unreadCount
    FROM conversations c
    JOIN children ch ON ch.id = c.child_id
    JOIN users pu ON pu.id = c.parent_user_id
  `
  const params: unknown[] = [user.id]
  if (user.role === 'parent') {
    sql += ' WHERE c.parent_user_id = ?'
    params.push(user.id)
  }
  sql += ' ORDER BY c.updated_at DESC'
  const rows = db.prepare(sql).all(...params)
  res.json({ conversations: rows })
})

app.post('/api/conversations', requireAuth, (req, res) => {
  const user = authed(req)
  const parsed = conversationCreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const { childId, subject, message } = parsed.data

  const childRow = db.prepare('SELECT id, parent_user_id, name, group_name FROM children WHERE id = ?').get(childId) as { id: string; parent_user_id: string; name: string; group_name: string } | undefined
  if (!childRow) return res.status(404).json({ error: 'child_not_found' })

  if (user.role === 'parent' && childRow.parent_user_id !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const convId = randomUUID()
  const msgId = randomUUID()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO conversations (id, child_id, parent_user_id, subject, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(convId, childId, childRow.parent_user_id, subject, now, now)

  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_user_id, sender_name, sender_role, content, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(msgId, convId, user.id, user.name, user.role, message, now, now)

  const createdConv = db.prepare(`
    SELECT c.id, c.child_id AS childId, c.parent_user_id AS parentUserId,
           c.subject, c.created_at AS createdAt, c.updated_at AS updatedAt,
           ch.name AS childName, ch.group_name AS groupName,
           pu.name AS parentName
    FROM conversations c
    JOIN children ch ON ch.id = c.child_id
    JOIN users pu ON pu.id = c.parent_user_id
    WHERE c.id = ?
  `).get(convId)

  const createdMsg = db.prepare(`
    SELECT id, conversation_id AS conversationId, sender_user_id AS senderUserId,
           sender_name AS senderName, sender_role AS senderRole, content,
           read_at AS readAt, created_at AS createdAt
    FROM messages WHERE id = ?
  `).get(msgId)

  res.status(201).json({ conversation: createdConv, message: createdMsg })
})

app.get('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const user = authed(req)
  const conv = db.prepare(`
    SELECT c.id, c.child_id AS childId, c.parent_user_id AS parentUserId,
           c.subject, c.created_at AS createdAt, c.updated_at AS updatedAt,
           ch.name AS childName, ch.group_name AS groupName,
           pu.name AS parentName
    FROM conversations c
    JOIN children ch ON ch.id = c.child_id
    JOIN users pu ON pu.id = c.parent_user_id
    WHERE c.id = ?
  `).get(req.params.id) as any
  if (!conv) return res.status(404).json({ error: 'not_found' })

  if (user.role === 'parent' && conv.parentUserId !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const now = new Date().toISOString()
  db.prepare(`
    UPDATE messages SET read_at = ?
    WHERE conversation_id = ? AND sender_user_id != ? AND read_at IS NULL
  `).run(now, req.params.id, user.id)

  const messages = db.prepare(`
    SELECT id, conversation_id AS conversationId, sender_user_id AS senderUserId,
           sender_name AS senderName, sender_role AS senderRole, content,
           read_at AS readAt, created_at AS createdAt
    FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC
  `).all(req.params.id)

  res.json({ conversation: conv, messages })
})

app.post('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const user = authed(req)
  const conv = db.prepare('SELECT id, parent_user_id FROM conversations WHERE id = ?').get(req.params.id) as { id: string; parent_user_id: string } | undefined
  if (!conv) return res.status(404).json({ error: 'not_found' })

  if (user.role === 'parent' && conv.parent_user_id !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const parsed = messageCreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })

  const msgId = randomUUID()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_user_id, sender_name, sender_role, content, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(msgId, req.params.id, user.id, user.name, user.role, parsed.data.content, null, now)

  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, req.params.id)

  const createdMsg = db.prepare(`
    SELECT id, conversation_id AS conversationId, sender_user_id AS senderUserId,
           sender_name AS senderName, sender_role AS senderRole, content,
           read_at AS readAt, created_at AS createdAt
    FROM messages WHERE id = ?
  `).get(msgId)

  res.status(201).json({ message: createdMsg })
})

const absenceNoticeSelect = `
  SELECT n.id, n.child_id AS childId, c.name AS childName, c.group_name AS groupName,
         n.parent_user_id AS parentUserId, u.name AS parentName,
         n.start_date AS startDate, n.end_date AS endDate,
         n.reason_type AS reasonType, n.notes, n.created_at AS createdAt
  FROM absence_notices n
  JOIN children c ON c.id = n.child_id
  JOIN users u ON u.id = n.parent_user_id
`

const absenceQuery = z.object({
  childId: z.string().optional(),
  date: calendarDate.optional(),
}).strict()

const absenceBody = z.object({
  childId: z.string().min(1),
  startDate: calendarDate,
  endDate: calendarDate,
  reasonType: z.enum(['sick', 'vacation', 'appointment', 'other']),
  notes: z.string().max(1000).optional().default(''),
}).strict()

app.get('/api/absence-notices', requireAuth, (req, res) => {
  const parsed = absenceQuery.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_query' })
  const user = authed(req)
  let sql = `${absenceNoticeSelect} WHERE 1=1`
  const params: string[] = []

  if (user.role === 'parent') {
    sql += ' AND c.parent_user_id = ?'
    params.push(user.id)
  }

  if (parsed.data.childId) {
    sql += ' AND n.child_id = ?'
    params.push(parsed.data.childId)
  }

  if (parsed.data.date) {
    sql += ' AND n.start_date <= ? AND n.end_date >= ?'
    params.push(parsed.data.date, parsed.data.date)
  }

  sql += ' ORDER BY n.start_date DESC, n.created_at DESC'
  const notices = db.prepare(sql).all(...params)
  res.json({ notices })
})

app.post('/api/absence-notices', requireAuth, (req, res) => {
  const user = authed(req)
  const parsed = absenceBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const { childId, startDate, endDate, reasonType, notes } = parsed.data

  if (startDate > endDate) {
    return res.status(400).json({ error: 'invalid_date_range' })
  }

  const child = db.prepare('SELECT id, parent_user_id AS parentUserId FROM children WHERE id = ?').get(childId) as { id: string; parentUserId: string } | undefined
  if (!child) return res.status(404).json({ error: 'child_not_found' })

  if (user.role === 'parent' && child.parentUserId !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const id = randomUUID()
  const parentUserId = user.role === 'parent' ? user.id : child.parentUserId
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO absence_notices (id, child_id, parent_user_id, start_date, end_date, reason_type, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, childId, parentUserId, startDate, endDate, reasonType, notes, now)

  const notice = db.prepare(`${absenceNoticeSelect} WHERE n.id = ?`).get(id)
  res.status(201).json({ notice })
})

app.delete('/api/absence-notices/:id', requireAuth, (req, res) => {
  const user = authed(req)
  const notice = db.prepare('SELECT id, parent_user_id AS parentUserId FROM absence_notices WHERE id = ?').get(req.params.id) as { id: string; parentUserId: string } | undefined
  if (!notice) return res.status(404).json({ error: 'notice_not_found' })

  if (user.role === 'parent' && notice.parentUserId !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  db.prepare('DELETE FROM absence_notices WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

const mealSelect = `
  SELECT id, day_of_week AS dayOfWeek, breakfast, morning_snack AS morningSnack,
         lunch, afternoon_snack AS afternoonSnack, allergens, notes,
         updated_by AS updatedBy, updated_at AS updatedAt
  FROM weekly_meals
  ORDER BY CASE day_of_week
    WHEN 'monday' THEN 1
    WHEN 'tuesday' THEN 2
    WHEN 'wednesday' THEN 3
    WHEN 'thursday' THEN 4
    WHEN 'friday' THEN 5
    ELSE 6
  END
`

const monthlyMealSelect = `
  SELECT id, menu_month AS menuMonth, week_number AS weekNumber,
         day_of_week AS dayOfWeek, breakfast, morning_snack AS morningSnack,
         lunch, afternoon_snack AS afternoonSnack, allergens, notes,
         updated_by AS updatedBy, updated_at AS updatedAt
  FROM monthly_meals
`

const mealBody = z.object({
  dayOfWeek: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  weekNumber: z.number().int().min(0).max(5).optional().default(0),
  breakfast: z.string().trim().min(1).max(500),
  morningSnack: z.string().max(500).optional().default(''),
  lunch: z.string().trim().min(1).max(500),
  afternoonSnack: z.string().max(500).optional().default(''),
  allergens: z.string().max(300).optional().default(''),
  notes: z.string().max(1000).optional().default(''),
}).strict()

app.get('/api/meals', requireAuth, (req, res) => {
  const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : null
  const weekNumber = typeof req.query.week === 'string' && /^[0-5]$/.test(req.query.week)
    ? Number(req.query.week)
    : 0

  if (month) {
    const days: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
    const templateMeals = db.prepare(mealSelect).all() as any[]
    const templateMap = new Map(templateMeals.map((m) => [m.dayOfWeek, m]))

    const specificWeekMeals = db.prepare(`${monthlyMealSelect} WHERE menu_month = ? AND week_number = ?`).all(month, weekNumber) as any[]
    const specificMap = new Map(specificWeekMeals.map((m) => [m.dayOfWeek, m]))

    const week0Meals = weekNumber !== 0
      ? (db.prepare(`${monthlyMealSelect} WHERE menu_month = ? AND week_number = 0`).all(month) as any[])
      : []
    const week0Map = new Map(week0Meals.map((m) => [m.dayOfWeek, m]))

    const meals = days.map((day) => {
      if (specificMap.has(day)) return specificMap.get(day)
      if (week0Map.has(day)) return { ...week0Map.get(day), weekNumber }
      const templ = templateMap.get(day)
      if (templ) {
        return {
          ...templ,
          menuMonth: month,
          weekNumber,
        }
      }
      return {
        id: randomUUID(),
        menuMonth: month,
        weekNumber,
        dayOfWeek: day,
        breakfast: '',
        morningSnack: '',
        lunch: '',
        afternoonSnack: '',
        allergens: '',
        notes: '',
        updatedBy: null,
        updatedAt: null,
      }
    })

    return res.json({ meals, month, weekNumber })
  }

  const meals = db.prepare(mealSelect).all()
  res.json({ meals })
})

app.post('/api/meals', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director' && user.role !== 'superadmin') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const parsed = mealBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const { dayOfWeek, month, weekNumber, breakfast, morningSnack, lunch, afternoonSnack, allergens, notes } = parsed.data

  const now = new Date().toISOString()
  const targetMonth = month || now.slice(0, 7)

  // Save to monthly_meals
  const existingMonthly = db.prepare('SELECT id FROM monthly_meals WHERE menu_month = ? AND week_number = ? AND day_of_week = ?').get(targetMonth, weekNumber, dayOfWeek) as { id: string } | undefined
  const monthlyId = existingMonthly?.id || randomUUID()

  db.prepare(`
    INSERT INTO monthly_meals (id, menu_month, week_number, day_of_week, breakfast, morning_snack, lunch, afternoon_snack, allergens, notes, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(menu_month, week_number, day_of_week) DO UPDATE SET
      breakfast=excluded.breakfast,
      morning_snack=excluded.morning_snack,
      lunch=excluded.lunch,
      afternoon_snack=excluded.afternoon_snack,
      allergens=excluded.allergens,
      notes=excluded.notes,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at
  `).run(monthlyId, targetMonth, weekNumber, dayOfWeek, breakfast, morningSnack, lunch, afternoonSnack, allergens, notes, user.id, now)

  // Maintain weekly_meals for default/fallback views
  const existingWeekly = db.prepare('SELECT id FROM weekly_meals WHERE day_of_week = ?').get(dayOfWeek) as { id: string } | undefined
  const weeklyId = existingWeekly?.id || randomUUID()

  db.prepare(`
    INSERT INTO weekly_meals (id, day_of_week, breakfast, morning_snack, lunch, afternoon_snack, allergens, notes, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day_of_week) DO UPDATE SET
      breakfast=excluded.breakfast,
      morning_snack=excluded.morning_snack,
      lunch=excluded.lunch,
      afternoon_snack=excluded.afternoon_snack,
      allergens=excluded.allergens,
      notes=excluded.notes,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at
  `).run(weeklyId, dayOfWeek, breakfast, morningSnack, lunch, afternoonSnack, allergens, notes, user.id, now)

  const meal = db.prepare(`${monthlyMealSelect} WHERE id = ?`).get(monthlyId)
  res.status(200).json({ meal: meal || db.prepare(`${mealSelect.split('ORDER BY')[0]} WHERE id = ?`).get(weeklyId) })
})

app.post('/api/meals/copy-month', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director' && user.role !== 'superadmin') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const copySchema = z.object({
    fromMonth: z.string().regex(/^\d{4}-\d{2}$/),
    toMonth: z.string().regex(/^\d{4}-\d{2}$/),
  }).strict()
  const parsed = copySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const { fromMonth, toMonth } = parsed.data

  let sourceMeals = db.prepare(`SELECT * FROM monthly_meals WHERE menu_month = ?`).all(fromMonth) as any[]
  if (sourceMeals.length === 0) {
    const defaults = db.prepare(`SELECT * FROM weekly_meals`).all() as any[]
    sourceMeals = defaults.map((d) => ({
      ...d,
      menu_month: fromMonth,
      week_number: 0,
    }))
  }

  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT INTO monthly_meals (id, menu_month, week_number, day_of_week, breakfast, morning_snack, lunch, afternoon_snack, allergens, notes, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(menu_month, week_number, day_of_week) DO UPDATE SET
      breakfast=excluded.breakfast,
      morning_snack=excluded.morning_snack,
      lunch=excluded.lunch,
      afternoon_snack=excluded.afternoon_snack,
      allergens=excluded.allergens,
      notes=excluded.notes,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at
  `)

  db.transaction(() => {
    for (const m of sourceMeals) {
      insert.run(
        randomUUID(),
        toMonth,
        m.week_number || 0,
        m.day_of_week,
        m.breakfast,
        m.morning_snack,
        m.lunch,
        m.afternoon_snack,
        m.allergens || '',
        m.notes || '',
        user.id,
        now,
      )
    }
  })()

  res.json({ success: true, count: sourceMeals.length })
})

const medicalProfileSchema = z.object({
  pediatricianName: z.string().max(100).default(''),
  pediatricianPhone: z.string().max(50).default(''),
  bloodType: z.string().max(10).default(''),
  chronicConditions: z.string().max(300).default(''),
  emergencyMedications: z.string().max(300).default(''),
  notes: z.string().max(500).default(''),
}).strict()

app.get('/api/children/:childId/medical', requireAuth, (req, res) => {
  const user = authed(req)
  const child = db.prepare('SELECT id, parent_user_id AS parentUserId FROM children WHERE id = ?').get(req.params.childId) as { id: string; parentUserId: string | null } | undefined
  if (!child) return res.status(404).json({ error: 'not_found' })
  if (user.role === 'parent' && child.parentUserId !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const profile = db.prepare(`
    SELECT child_id AS childId, pediatrician_name AS pediatricianName,
           pediatrician_phone AS pediatricianPhone, blood_type AS bloodType,
           chronic_conditions AS chronicConditions, emergency_medications AS emergencyMedications,
           notes, updated_at AS updatedAt
    FROM child_medical_profiles WHERE child_id = ?
  `).get(req.params.childId) as any

  res.json({ medicalProfile: profile || null })
})

app.put('/api/children/:childId/medical', requireAuth, (req, res) => {
  const user = authed(req)
  const child = db.prepare('SELECT id, parent_user_id AS parentUserId FROM children WHERE id = ?').get(req.params.childId) as { id: string; parentUserId: string | null } | undefined
  if (!child) return res.status(404).json({ error: 'not_found' })
  if (user.role === 'parent' && child.parentUserId !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const parsed = medicalProfileSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })

  const { pediatricianName, pediatricianPhone, bloodType, chronicConditions, emergencyMedications, notes } = parsed.data
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO child_medical_profiles (child_id, pediatrician_name, pediatrician_phone, blood_type, chronic_conditions, emergency_medications, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(child_id) DO UPDATE SET
      pediatrician_name = excluded.pediatrician_name,
      pediatrician_phone = excluded.pediatrician_phone,
      blood_type = excluded.blood_type,
      chronic_conditions = excluded.chronic_conditions,
      emergency_medications = excluded.emergency_medications,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(req.params.childId, pediatricianName, pediatricianPhone, bloodType, chronicConditions, emergencyMedications, notes, now)

  const updated = db.prepare(`
    SELECT child_id AS childId, pediatrician_name AS pediatricianName,
           pediatrician_phone AS pediatricianPhone, blood_type AS bloodType,
           chronic_conditions AS chronicConditions, emergency_medications AS emergencyMedications,
           notes, updated_at AS updatedAt
    FROM child_medical_profiles WHERE child_id = ?
  `).get(req.params.childId)

  res.json({ medicalProfile: updated })
})

const incidentSelect = `
  SELECT i.id, i.child_id AS childId, c.name AS childName, c.group_name AS groupName,
         i.reporter_id AS reporterId, u.name AS reporterName, u.role AS reporterRole,
         i.incident_date AS incidentDate, i.incident_time AS incidentTime,
         i.type, i.location, i.first_aid AS firstAid,
         i.description, i.action_taken AS actionTaken,
         i.parent_notified AS parentNotified,
         i.parent_acknowledged_at AS parentAcknowledgedAt,
         i.created_at AS createdAt
  FROM incident_reports i
  JOIN children c ON c.id = i.child_id
  JOIN users u ON u.id = i.reporter_id
`

const incidentQuery = z.object({
  childId: z.string().optional(),
  date: calendarDate.optional(),
}).strict()

const incidentBody = z.object({
  childId: z.string().min(1),
  incidentDate: calendarDate,
  incidentTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  type: z.enum(['scrape', 'bump', 'bruise', 'cut', 'bite', 'fever', 'other']),
  location: z.enum(['playground', 'classroom', 'cafeteria', 'nap_room', 'bathroom', 'other']),
  firstAid: z.enum(['ice_pack', 'cleaned_bandaged', 'temperature_taken', 'rest', 'doctor_called', 'none']),
  description: z.string().min(1).max(500),
  actionTaken: z.string().min(1).max(500),
  parentNotified: z.boolean().default(true),
}).strict()

app.get('/api/incidents', requireAuth, (req, res) => {
  const parsed = incidentQuery.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_query' })
  const user = authed(req)
  let sql = `${incidentSelect} WHERE 1=1`
  const params: string[] = []

  if (user.role === 'parent') {
    sql += ' AND c.parent_user_id = ?'
    params.push(user.id)
  }
  if (parsed.data.childId) {
    sql += ' AND i.child_id = ?'
    params.push(parsed.data.childId)
  }
  if (parsed.data.date) {
    sql += ' AND i.incident_date = ?'
    params.push(parsed.data.date)
  }

  sql += ' ORDER BY i.incident_date DESC, i.incident_time DESC, i.created_at DESC'
  const rows = db.prepare(sql).all(...params) as any[]
  const incidents = rows.map((r) => ({
    ...r,
    parentNotified: Boolean(r.parentNotified),
  }))
  res.json({ incidents })
})

app.post('/api/incidents', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const parsed = incidentBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })

  const child = db.prepare('SELECT id FROM children WHERE id = ?').get(parsed.data.childId)
  if (!child) return res.status(404).json({ error: 'not_found' })

  const id = randomUUID()
  const now = new Date().toISOString()
  const { childId, incidentDate, incidentTime, type, location, firstAid, description, actionTaken, parentNotified } = parsed.data

  db.prepare(`
    INSERT INTO incident_reports (id, child_id, reporter_id, incident_date, incident_time, type, location, first_aid, description, action_taken, parent_notified, parent_acknowledged_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, childId, user.id, incidentDate, incidentTime, type, location, firstAid, description, actionTaken, parentNotified ? 1 : 0, null, now)

  const created = db.prepare(`${incidentSelect} WHERE i.id = ?`).get(id) as any
  res.status(201).json({
    incident: {
      ...created,
      parentNotified: Boolean(created.parentNotified),
    },
  })
})

app.post('/api/incidents/:id/acknowledge', requireAuth, (req, res) => {
  const user = authed(req)
  const incident = db.prepare(`
    SELECT i.id, i.child_id, c.parent_user_id AS parentUserId
    FROM incident_reports i
    JOIN children c ON c.id = i.child_id
    WHERE i.id = ?
  `).get(req.params.id) as { id: string; child_id: string; parentUserId: string | null } | undefined

  if (!incident) return res.status(404).json({ error: 'not_found' })
  if (user.role === 'parent' && incident.parentUserId !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const now = new Date().toISOString()
  db.prepare('UPDATE incident_reports SET parent_acknowledged_at = ? WHERE id = ?').run(now, req.params.id)

  const updated = db.prepare(`${incidentSelect} WHERE i.id = ?`).get(req.params.id) as any
  res.json({
    incident: {
      ...updated,
      parentNotified: Boolean(updated.parentNotified),
    },
  })
})

const momentSelect = `
  SELECT m.id, m.title, m.group_name AS groupName, m.learning_area AS learningArea,
         m.moment_date AS momentDate, m.description, m.image_url AS imageUrl,
         m.tagged_children AS taggedChildren, m.created_by AS createdBy,
         u.name AS createdByName, u.role AS createdByRole,
         m.created_at AS createdAt
  FROM classroom_moments m
  JOIN users u ON u.id = m.created_by
`

const momentQuery = z.object({
  groupName: z.string().optional(),
  date: calendarDate.optional(),
  area: z.string().optional(),
}).strict()

const momentBody = z.object({
  title: z.string().min(1).max(200),
  groupName: z.string().min(1).max(100),
  learningArea: z.enum(['art', 'stem', 'motor', 'music', 'story', 'outdoor', 'other']),
  momentDate: calendarDate,
  description: z.string().min(1).max(2000),
  imageUrl: z.string().max(1000000).nullable().optional(),
  taggedChildren: z.array(z.string()).default([]),
}).strict()

function enrichMoment(m: any, currentUserId: string) {
  let tagged: string[] = []
  try { tagged = JSON.parse(m.taggedChildren || '[]') } catch { tagged = [] }
  let taggedChildrenDetails: { id: string; name: string; photoConsent: boolean }[] = []
  if (tagged.length > 0) {
    const placeholders = tagged.map(() => '?').join(',')
    const rows = db.prepare(`SELECT id, name, photo_consent AS photoConsent FROM children WHERE id IN (${placeholders})`).all(...tagged) as any[]
    taggedChildrenDetails = rows.map((r) => ({ id: r.id, name: r.name, photoConsent: Boolean(r.photoConsent) }))
  }

  const reactionCountRow = db.prepare('SELECT COUNT(*) AS c FROM moment_reactions WHERE moment_id = ?').get(m.id) as { c: number }
  const userReactedRow = db.prepare('SELECT id FROM moment_reactions WHERE moment_id = ? AND user_id = ?').get(m.id, currentUserId)

  return {
    ...m,
    taggedChildren: tagged,
    taggedChildrenDetails,
    reactionCount: reactionCountRow?.c || 0,
    userReacted: Boolean(userReactedRow),
  }
}

app.get('/api/moments', requireAuth, (req, res) => {
  const parsed = momentQuery.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_query' })
  const user = authed(req)

  let sql = `${momentSelect} WHERE 1=1`
  const params: any[] = []

  if (user.role === 'parent') {
    const parentGroups = db.prepare('SELECT DISTINCT group_name FROM children WHERE parent_user_id = ?').all(user.id) as { group_name: string }[]
    const groupNames = parentGroups.map((g) => g.group_name)
    if (groupNames.length === 0) {
      sql += " AND (m.group_name = 'all')"
    } else {
      const placeholders = groupNames.map(() => '?').join(',')
      sql += ` AND (m.group_name IN (${placeholders}) OR m.group_name = 'all')`
      params.push(...groupNames)
    }
  }

  if (parsed.data.groupName) {
    sql += ' AND m.group_name = ?'
    params.push(parsed.data.groupName)
  }
  if (parsed.data.date) {
    sql += ' AND m.moment_date = ?'
    params.push(parsed.data.date)
  }
  if (parsed.data.area) {
    sql += ' AND m.learning_area = ?'
    params.push(parsed.data.area)
  }

  sql += ' ORDER BY m.moment_date DESC, m.created_at DESC'
  const rows = db.prepare(sql).all(...params) as any[]
  const moments = rows.map((m) => enrichMoment(m, user.id))
  res.json({ moments })
})

app.post('/api/moments', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const parsed = momentBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })

  const id = randomUUID()
  const now = new Date().toISOString()
  const { title, groupName, learningArea, momentDate, description, imageUrl, taggedChildren } = parsed.data

  db.prepare(`
    INSERT INTO classroom_moments (id, title, group_name, learning_area, moment_date, description, image_url, tagged_children, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, groupName, learningArea, momentDate, description, imageUrl || null, JSON.stringify(taggedChildren || []), user.id, now)

  const created = db.prepare(`${momentSelect} WHERE m.id = ?`).get(id) as any
  res.status(201).json({ moment: enrichMoment(created, user.id) })
})

app.post('/api/moments/:id/react', requireAuth, (req, res) => {
  const user = authed(req)
  const moment = db.prepare('SELECT id FROM classroom_moments WHERE id = ?').get(req.params.id)
  if (!moment) return res.status(404).json({ error: 'not_found' })

  const existing = db.prepare('SELECT id FROM moment_reactions WHERE moment_id = ? AND user_id = ?').get(req.params.id, user.id) as { id: string } | undefined
  if (existing) {
    db.prepare('DELETE FROM moment_reactions WHERE id = ?').run(existing.id)
  } else {
    const rxId = randomUUID()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO moment_reactions (id, moment_id, user_id, reaction_type, created_at)
      VALUES (?, ?, ?, 'heart', ?)
    `).run(rxId, req.params.id, user.id, now)
  }

  const countRow = db.prepare('SELECT COUNT(*) AS c FROM moment_reactions WHERE moment_id = ?').get(req.params.id) as { c: number }
  res.json({
    momentId: req.params.id,
    reacted: !existing,
    reactionCount: countRow?.c || 0,
  })
})

app.delete('/api/moments/:id', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const existing = db.prepare('SELECT id FROM classroom_moments WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'not_found' })

  db.prepare('DELETE FROM classroom_moments WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

const eventInputSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(2).max(2000),
  eventType: z.enum(['celebration', 'field_trip', 'conference', 'holiday', 'workshop', 'other']),
  eventDate: calendarDate,
  endDate: calendarDate.optional().nullable(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
  location: z.string().trim().min(2).max(200),
  groupName: z.string().trim().min(1).default('all'),
  requiresRsvp: z.boolean().default(true),
  requiresPermissionSlip: z.boolean().default(false),
})

const rsvpInputSchema = z.object({
  childId: z.string().min(1),
  status: z.enum(['attending', 'declined', 'tentative']),
  attendingAdults: z.number().int().min(1).max(10).default(1),
  permissionSigned: z.boolean().default(false),
  notes: z.string().max(500).optional().nullable(),
})

app.get('/api/events', requireAuth, (req, res) => {
  const user = authed(req)
  const month = req.query.month ? String(req.query.month) : null

  if (user.role === 'parent') {
    const parentChildren = db.prepare('SELECT id, name, group_name FROM children WHERE parent_user_id = ?').all(user.id) as { id: string; name: string; group_name: string }[]
    const groupNames = Array.from(new Set(parentChildren.map((c) => c.group_name)))

    let query = 'SELECT * FROM kindergarten_events WHERE (group_name = ?'
    const params: any[] = ['all']
    if (groupNames.length > 0) {
      query += ` OR group_name IN (${groupNames.map(() => '?').join(', ')})`
      params.push(...groupNames)
    }
    query += ')'

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      query += ' AND event_date LIKE ?'
      params.push(`${month}%`)
    }
    query += ' ORDER BY event_date ASC, start_time ASC'

    const events = db.prepare(query).all(...params) as any[]

    const childIds = parentChildren.map((c) => c.id)
    const enriched = events.map((ev) => {
      const rsvps = childIds.length > 0
        ? db.prepare(`
            SELECT r.*, c.name AS child_name
            FROM event_rsvps r
            JOIN children c ON c.id = r.child_id
            WHERE r.event_id = ? AND r.parent_id = ?
          `).all(ev.id, user.id) as any[]
        : []

      return {
        id: ev.id,
        title: ev.title,
        description: ev.description,
        eventType: ev.event_type,
        eventDate: ev.event_date,
        endDate: ev.end_date,
        startTime: ev.start_time,
        endTime: ev.end_time,
        location: ev.location,
        groupName: ev.group_name,
        requiresRsvp: Boolean(ev.requires_rsvp),
        requiresPermissionSlip: Boolean(ev.requires_permission_slip),
        createdBy: ev.created_by,
        createdAt: ev.created_at,
        rsvps: rsvps.map((r) => ({
          id: r.id,
          childId: r.child_id,
          childName: r.child_name,
          status: r.status,
          attendingAdults: r.attending_adults,
          permissionSigned: Boolean(r.permission_signed),
          notes: r.notes || '',
          updatedAt: r.updated_at,
        })),
      }
    })

    return res.json({ events: enriched })
  }

  // Teacher or Director
  let query = 'SELECT * FROM kindergarten_events'
  const params: any[] = []
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    query += ' WHERE event_date LIKE ?'
    params.push(`${month}%`)
  }
  query += ' ORDER BY event_date ASC, start_time ASC'

  const events = db.prepare(query).all(...params) as any[]

  const enriched = events.map((ev) => {
    const summaryRow = db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'attending' THEN 1 END) AS attending_count,
        COUNT(CASE WHEN status = 'declined' THEN 1 END) AS declined_count,
        COUNT(CASE WHEN status = 'tentative' THEN 1 END) AS tentative_count,
        SUM(CASE WHEN status = 'attending' THEN attending_adults ELSE 0 END) AS total_adults,
        COUNT(CASE WHEN permission_signed = 1 THEN 1 END) AS permission_signed_count
      FROM event_rsvps
      WHERE event_id = ?
    `).get(ev.id) as any

    const rsvpRows = db.prepare(`
      SELECT r.*, c.name AS child_name, u.name AS parent_name, u.email AS parent_email
      FROM event_rsvps r
      JOIN children c ON c.id = r.child_id
      JOIN users u ON u.id = r.parent_id
      WHERE r.event_id = ?
      ORDER BY r.updated_at DESC
    `).all(ev.id) as any[]

    return {
      id: ev.id,
      title: ev.title,
      description: ev.description,
      eventType: ev.event_type,
      eventDate: ev.event_date,
      endDate: ev.end_date,
      startTime: ev.start_time,
      endTime: ev.end_time,
      location: ev.location,
      groupName: ev.group_name,
      requiresRsvp: Boolean(ev.requires_rsvp),
      requiresPermissionSlip: Boolean(ev.requires_permission_slip),
      createdBy: ev.created_by,
      createdAt: ev.created_at,
      summary: {
        attendingCount: summaryRow?.attending_count || 0,
        declinedCount: summaryRow?.declined_count || 0,
        tentativeCount: summaryRow?.tentative_count || 0,
        totalAdults: summaryRow?.total_adults || 0,
        permissionSignedCount: summaryRow?.permission_signed_count || 0,
      },
      rsvps: rsvpRows.map((r) => ({
        id: r.id,
        childId: r.child_id,
        childName: r.child_name,
        parentId: r.parent_id,
        parentName: r.parent_name,
        parentEmail: r.parent_email,
        status: r.status,
        attendingAdults: r.attending_adults,
        permissionSigned: Boolean(r.permission_signed),
        notes: r.notes || '',
        updatedAt: r.updated_at,
      })),
    }
  })

  res.json({ events: enriched })
})

app.post('/api/events', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const parsed = eventInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })

  const id = randomUUID()
  const now = new Date().toISOString()
  const {
    title,
    description,
    eventType,
    eventDate,
    endDate,
    startTime,
    endTime,
    location,
    groupName,
    requiresRsvp,
    requiresPermissionSlip,
  } = parsed.data

  db.prepare(`
    INSERT INTO kindergarten_events (id, title, description, event_type, event_date, end_date, start_time, end_time, location, group_name, requires_rsvp, requires_permission_slip, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title,
    description,
    eventType,
    eventDate,
    endDate || null,
    startTime || null,
    endTime || null,
    location,
    groupName,
    requiresRsvp ? 1 : 0,
    requiresPermissionSlip ? 1 : 0,
    user.id,
    now,
  )

  const created = db.prepare('SELECT * FROM kindergarten_events WHERE id = ?').get(id) as any
  res.status(201).json({
    event: {
      id: created.id,
      title: created.title,
      description: created.description,
      eventType: created.event_type,
      eventDate: created.event_date,
      endDate: created.end_date,
      startTime: created.start_time,
      endTime: created.end_time,
      location: created.location,
      groupName: created.group_name,
      requiresRsvp: Boolean(created.requires_rsvp),
      requiresPermissionSlip: Boolean(created.requires_permission_slip),
      createdBy: created.created_by,
      createdAt: created.created_at,
      summary: {
        attendingCount: 0,
        declinedCount: 0,
        tentativeCount: 0,
        totalAdults: 0,
        permissionSignedCount: 0,
      },
      rsvps: [],
    },
  })
})

app.delete('/api/events/:id', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const existing = db.prepare('SELECT id FROM kindergarten_events WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'not_found' })

  db.prepare('DELETE FROM kindergarten_events WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

app.post('/api/events/:id/rsvp', requireAuth, (req, res) => {
  const user = authed(req)
  const parsed = rsvpInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })

  const event = db.prepare('SELECT * FROM kindergarten_events WHERE id = ?').get(req.params.id) as any
  if (!event) return res.status(404).json({ error: 'not_found' })

  const child = db.prepare('SELECT * FROM children WHERE id = ?').get(parsed.data.childId) as any
  if (!child) return res.status(404).json({ error: 'child_not_found' })

  if (user.role === 'parent' && child.parent_user_id !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const existing = db.prepare('SELECT id FROM event_rsvps WHERE event_id = ? AND child_id = ?').get(req.params.id, parsed.data.childId) as { id: string } | undefined
  const rsvpId = existing ? existing.id : randomUUID()
  const now = new Date().toISOString()

  if (existing) {
    db.prepare(`
      UPDATE event_rsvps
      SET status = ?, attending_adults = ?, permission_signed = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(
      parsed.data.status,
      parsed.data.attendingAdults,
      parsed.data.permissionSigned ? 1 : 0,
      parsed.data.notes || null,
      now,
      rsvpId,
    )
  } else {
    db.prepare(`
      INSERT INTO event_rsvps (id, event_id, parent_id, child_id, status, attending_adults, permission_signed, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rsvpId,
      req.params.id,
      user.id,
      parsed.data.childId,
      parsed.data.status,
      parsed.data.attendingAdults,
      parsed.data.permissionSigned ? 1 : 0,
      parsed.data.notes || null,
      now,
    )
  }

  res.json({
    rsvp: {
      id: rsvpId,
      eventId: req.params.id,
      childId: parsed.data.childId,
      status: parsed.data.status,
      attendingAdults: parsed.data.attendingAdults,
      permissionSigned: parsed.data.permissionSigned,
      notes: parsed.data.notes || '',
      updatedAt: now,
    },
  })
})

const shiftInputSchema = z.object({
  staffId: z.string().min(1),
  shiftDate: calendarDate,
  shiftType: z.enum(['morning', 'regular', 'closing', 'substitute']),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  groupName: z.string().trim().min(1),
  notes: z.string().max(500).optional().nullable(),
})

const shiftStatusSchema = z.object({
  status: z.enum(['scheduled', 'checked_in', 'completed', 'absent']),
})

app.get('/api/staff-shifts', requireAuth, (req, res) => {
  const user = authed(req)
  const targetDate = req.query.date && typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : localCalendarDate()

  // 1. Fetch shifts
  let shiftsQuery = `
    SELECT s.*, u.name AS staff_name, u.role AS staff_role, u.email AS staff_email
    FROM staff_shifts s
    JOIN users u ON u.id = s.staff_id
    WHERE s.shift_date = ?
  `
  const params: any[] = [targetDate]

  if (user.role === 'parent') {
    const parentChildren = db.prepare('SELECT group_name FROM children WHERE parent_user_id = ?').all(user.id) as { group_name: string }[]
    const groups = Array.from(new Set(parentChildren.map((c) => c.group_name)))
    if (groups.length > 0) {
      shiftsQuery += ` AND (s.group_name = 'all' OR s.group_name IN (${groups.map(() => '?').join(', ')}))`
      params.push(...groups)
    } else {
      shiftsQuery += " AND s.group_name = 'all'"
    }
  }

  shiftsQuery += ' ORDER BY s.start_time ASC'
  const shiftRows = db.prepare(shiftsQuery).all(...params) as any[]

  // 2. Calculate Room Ratios
  const policies = db.prepare("SELECT * FROM room_ratio_policies WHERE group_name != 'all'").all() as any[]
  const roomRatios = policies.map((pol) => {
    const childrenPresentRow = db.prepare(`
      SELECT COUNT(*) AS c
      FROM attendance a
      JOIN children c ON c.id = a.child_id
      WHERE a.attendance_date = ? AND a.status = 'present' AND c.group_name = ?
    `).get(targetDate, pol.group_name) as { c: number }

    const activeStaffRow = db.prepare(`
      SELECT COUNT(DISTINCT staff_id) AS c
      FROM staff_shifts
      WHERE shift_date = ? AND group_name = ? AND status IN ('scheduled', 'checked_in')
    `).get(targetDate, pol.group_name) as { c: number }

    const childrenCount = childrenPresentRow?.c || 0
    const staffCount = activeStaffRow?.c || 0
    const maxCapacity = pol.max_room_capacity
    const maxRatio = pol.max_children_per_educator
    const minEducators = pol.min_educators

    let isCompliant = true
    let status: 'optimal' | 'warning' | 'exceeded' = 'optimal'

    if (childrenCount > 0 && staffCount < minEducators) {
      isCompliant = false
      status = 'exceeded'
    } else if (staffCount > 0 && childrenCount > staffCount * maxRatio) {
      isCompliant = false
      status = 'exceeded'
    } else if (staffCount > 0 && childrenCount > 0 && staffCount * maxRatio - childrenCount <= 2) {
      status = 'warning'
    }

    const currentRatioStr = staffCount > 0
      ? `1:${Math.ceil(childrenCount / staffCount)}`
      : childrenCount > 0 ? 'N/A' : '0:0'

    return {
      groupName: pol.group_name,
      childrenCount,
      staffCount,
      currentRatioStr,
      maxRatio,
      maxCapacity,
      minEducators,
      isCompliant,
      status,
    }
  })

  const staffMembers = user.role !== 'parent'
    ? db.prepare("SELECT id, name, role, email FROM users WHERE role IN ('teacher', 'director')").all()
    : []

  res.json({
    date: targetDate,
    shifts: shiftRows.map((s) => ({
      id: s.id,
      staffId: s.staff_id,
      staffName: s.staff_name,
      staffRole: s.staff_role,
      staffEmail: s.staff_email,
      shiftDate: s.shift_date,
      shiftType: s.shift_type,
      startTime: s.start_time,
      endTime: s.end_time,
      groupName: s.group_name,
      status: s.status,
      notes: s.notes || '',
      createdAt: s.created_at,
    })),
    roomRatios,
    staffMembers,
  })
})

app.post('/api/staff-shifts', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'director' && user.role !== 'teacher') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const parsed = shiftInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })

  const staff = db.prepare("SELECT id, name, role, email FROM users WHERE id = ? AND role IN ('teacher', 'director')").get(parsed.data.staffId) as any
  if (!staff) return res.status(404).json({ error: 'staff_not_found' })

  const id = randomUUID()
  const now = new Date().toISOString()
  const { staffId, shiftDate, shiftType, startTime, endTime, groupName, notes } = parsed.data

  db.prepare(`
    INSERT INTO staff_shifts (id, staff_id, shift_date, shift_type, start_time, end_time, group_name, status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)
  `).run(id, staffId, shiftDate, shiftType, startTime, endTime, groupName, notes || null, now)

  res.status(201).json({
    shift: {
      id,
      staffId,
      staffName: staff.name,
      staffRole: staff.role,
      staffEmail: staff.email,
      shiftDate,
      shiftType,
      startTime,
      endTime,
      groupName,
      status: 'scheduled',
      notes: notes || '',
      createdAt: now,
    },
  })
})

app.put('/api/staff-shifts/:id/status', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'director' && user.role !== 'teacher') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const parsed = shiftStatusSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })

  const shift = db.prepare('SELECT * FROM staff_shifts WHERE id = ?').get(req.params.id) as any
  if (!shift) return res.status(404).json({ error: 'not_found' })

  db.prepare('UPDATE staff_shifts SET status = ? WHERE id = ?').run(parsed.data.status, req.params.id)

  const updated = db.prepare(`
    SELECT s.*, u.name AS staff_name, u.role AS staff_role, u.email AS staff_email
    FROM staff_shifts s
    JOIN users u ON u.id = s.staff_id
    WHERE s.id = ?
  `).get(req.params.id) as any

  res.json({
    shift: {
      id: updated.id,
      staffId: updated.staff_id,
      staffName: updated.staff_name,
      staffRole: updated.staff_role,
      staffEmail: updated.staff_email,
      shiftDate: updated.shift_date,
      shiftType: updated.shift_type,
      startTime: updated.start_time,
      endTime: updated.end_time,
      groupName: updated.group_name,
      status: updated.status,
      notes: updated.notes || '',
      createdAt: updated.created_at,
    },
  })
})

app.delete('/api/staff-shifts/:id', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const existing = db.prepare('SELECT id FROM staff_shifts WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'not_found' })

  db.prepare('DELETE FROM staff_shifts WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

// --- Early Childhood Developmental Milestones (EYFS) ---

const recordMilestoneSchema = z.object({
  milestoneId: z.string().trim().min(1),
  status: z.enum(['emerging', 'achieved', 'mastered']),
  observedDate: calendarDate,
  notes: z.string().trim().max(1000).optional().default(''),
}).strict()

app.get('/api/milestones', requireAuth, (_req, res) => {
  const rows = db.prepare(`
    SELECT id, domain, age_group AS ageGroup,
           title_en AS titleEn, title_sq AS titleSq,
           description_en AS descriptionEn, description_sq AS descriptionSq,
           sort_order AS sortOrder
    FROM developmental_milestones
    ORDER BY domain, sort_order
  `).all()
  res.json({ milestones: rows })
})

app.get('/api/children/:childId/milestones', requireAuth, (req, res) => {
  const user = authed(req)
  const child = db.prepare('SELECT id, name, group_name AS groupName, parent_user_id AS parentUserId FROM children WHERE id = ?').get(req.params.childId) as any
  if (!child) return res.status(404).json({ error: 'child_not_found' })

  if (user.role === 'parent' && child.parentUserId !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const items = db.prepare(`
    SELECT m.id AS milestoneId, m.domain, m.age_group AS ageGroup,
           m.title_en AS titleEn, m.title_sq AS titleSq,
           m.description_en AS descriptionEn, m.description_sq AS descriptionSq,
           m.sort_order AS sortOrder,
           r.id AS recordId, r.status, r.observed_date AS observedDate,
           COALESCE(r.notes, '') AS notes, r.evaluated_by AS evaluatedBy,
           u.name AS evaluatedByName, r.updated_at AS updatedAt
    FROM developmental_milestones m
    LEFT JOIN child_milestone_records r ON r.milestone_id = m.id AND r.child_id = ?
    LEFT JOIN users u ON u.id = r.evaluated_by
    ORDER BY m.domain, m.sort_order
  `).all(req.params.childId) as any[]

  const domains = ['language', 'cognitive', 'motor', 'social_emotional', 'creative'] as const
  const domainStats: Record<string, { total: number; emerging: number; achieved: number; mastered: number; percent: number }> = {}

  let totalMilestones = items.length
  let recordedCount = 0
  let masteredCount = 0
  let achievedCount = 0
  let emergingCount = 0

  for (const domain of domains) {
    const domainItems = items.filter((i) => i.domain === domain)
    const total = domainItems.length
    const emerging = domainItems.filter((i) => i.status === 'emerging').length
    const achieved = domainItems.filter((i) => i.status === 'achieved').length
    const mastered = domainItems.filter((i) => i.status === 'mastered').length
    const percent = total > 0 ? Math.round(((emerging * 0.4 + achieved * 0.8 + mastered * 1.0) / total) * 100) : 0

    domainStats[domain] = { total, emerging, achieved, mastered, percent }
  }

  for (const item of items) {
    if (item.status) {
      recordedCount++
      if (item.status === 'mastered') masteredCount++
      else if (item.status === 'achieved') achievedCount++
      else if (item.status === 'emerging') emergingCount++
    }
  }

  const overallProgressPercent = totalMilestones > 0
    ? Math.round(((emergingCount * 0.4 + achievedCount * 0.8 + masteredCount * 1.0) / totalMilestones) * 100)
    : 0

  res.json({
    child: {
      id: child.id,
      name: child.name,
      groupName: child.groupName,
    },
    items,
    domainStats,
    summary: {
      totalMilestones,
      recordedCount,
      masteredCount,
      achievedCount,
      emergingCount,
      overallProgressPercent,
    },
  })
})

app.post('/api/children/:childId/milestones', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'director' && user.role !== 'teacher') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const child = db.prepare('SELECT id, name FROM children WHERE id = ?').get(req.params.childId)
  if (!child) return res.status(404).json({ error: 'child_not_found' })

  const parsed = recordMilestoneSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.issues })

  const milestone = db.prepare('SELECT id FROM developmental_milestones WHERE id = ?').get(parsed.data.milestoneId)
  if (!milestone) return res.status(404).json({ error: 'milestone_not_found' })

  const recordId = `mr-${randomUUID().slice(0, 8)}`
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO child_milestone_records (id, child_id, milestone_id, status, observed_date, notes, evaluated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(child_id, milestone_id) DO UPDATE SET
      status = excluded.status,
      observed_date = excluded.observed_date,
      notes = excluded.notes,
      evaluated_by = excluded.evaluated_by,
      updated_at = excluded.updated_at
  `).run(
    recordId,
    req.params.childId,
    parsed.data.milestoneId,
    parsed.data.status,
    parsed.data.observedDate,
    parsed.data.notes || '',
    user.id,
    now,
  )

  const updatedRecord = db.prepare(`
    SELECT r.id AS recordId, r.status, r.observed_date AS observedDate,
           r.notes, r.evaluated_by AS evaluatedBy, u.name AS evaluatedByName, r.updated_at AS updatedAt
    FROM child_milestone_records r
    JOIN users u ON u.id = r.evaluated_by
    WHERE r.child_id = ? AND r.milestone_id = ?
  `).get(req.params.childId, parsed.data.milestoneId)

  res.status(200).json({ success: true, record: updatedRecord })
})

app.delete('/api/children/:childId/milestones/:milestoneId', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'director' && user.role !== 'teacher') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const existing = db.prepare('SELECT id FROM child_milestone_records WHERE child_id = ? AND milestone_id = ?').get(
    req.params.childId,
    req.params.milestoneId,
  )
  if (!existing) return res.status(404).json({ error: 'not_found' })

  db.prepare('DELETE FROM child_milestone_records WHERE child_id = ? AND milestone_id = ?').run(
    req.params.childId,
    req.params.milestoneId,
  )
  res.json({ success: true })
})

// --- School Document Hub & Digital Enrollment Contracts ---

const uploadDocSchema = z.object({
  childId: z.string().trim().min(1),
  documentType: z.enum(['enrollment_contract', 'vaccination_record', 'birth_certificate', 'medical_clearance', 'custody_legal', 'other']),
  title: z.string().trim().min(1).max(200),
  fileUrl: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255),
  fileSizeBytes: z.number().int().nonnegative().max(5 * 1024 * 1024).optional().default(0),
  notes: z.string().trim().max(1000).optional().default(''),
  expirationDate: calendarDate.nullable().optional(),
}).strict()

const verifyDocSchema = z.object({
  status: z.enum(['verified', 'rejected']),
  rejectionReason: z.string().trim().max(500).optional(),
}).strict()

const docSelectFields = `
  SELECT d.id, d.child_id AS childId, c.name AS childName, c.group_name AS groupName,
         d.document_type AS documentType, d.title, d.file_url AS fileUrl, d.file_name AS fileName,
         d.file_size_bytes AS fileSizeBytes, d.status, d.notes, d.expiration_date AS expirationDate,
         d.uploaded_by AS uploadedBy, u1.name AS uploadedByName,
         d.verified_by AS verifiedBy, u2.name AS verifiedByName, d.verified_at AS verifiedAt,
         d.rejection_reason AS rejectionReason, d.created_at AS createdAt, d.updated_at AS updatedAt
  FROM child_documents d
  JOIN children c ON c.id = d.child_id
  JOIN users u1 ON u1.id = d.uploaded_by
  LEFT JOIN users u2 ON u2.id = d.verified_by
`

app.get('/api/documents', requireAuth, (req, res) => {
  const user = authed(req)
  const childIdFilter = typeof req.query.childId === 'string' ? req.query.childId.trim() : null
  const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : null
  const typeFilter = typeof req.query.type === 'string' ? req.query.type.trim() : null

  let conditions: string[] = []
  let params: any[] = []

  if (user.role === 'parent') {
    conditions.push('c.parent_user_id = ?')
    params.push(user.id)
  }

  if (childIdFilter) {
    conditions.push('d.child_id = ?')
    params.push(childIdFilter)
  }

  if (statusFilter) {
    conditions.push('d.status = ?')
    params.push(statusFilter)
  }

  if (typeFilter) {
    conditions.push('d.document_type = ?')
    params.push(typeFilter)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db.prepare(`${docSelectFields} ${whereClause} ORDER BY d.created_at DESC`).all(...params)

  // Overall summary statistics
  const summaryScopeWhere = user.role === 'parent' ? 'WHERE c.parent_user_id = ?' : ''
  const summaryParams = user.role === 'parent' ? [user.id] : []
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN d.status = 'verified' THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN d.status = 'pending_review' THEN 1 ELSE 0 END) AS pendingReview,
      SUM(CASE WHEN d.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN d.status = 'expired' THEN 1 ELSE 0 END) AS expired
    FROM child_documents d
    JOIN children c ON c.id = d.child_id
    ${summaryScopeWhere}
  `).get(...summaryParams) as any

  res.json({
    documents: rows,
    summary: {
      total: counts.total || 0,
      verified: counts.verified || 0,
      pendingReview: counts.pendingReview || 0,
      rejected: counts.rejected || 0,
      expired: counts.expired || 0,
    },
  })
})

app.post('/api/documents', requireAuth, (req, res) => {
  const user = authed(req)
  const parsed = uploadDocSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.issues })

  const child = db.prepare('SELECT id, parent_user_id AS parentUserId FROM children WHERE id = ?').get(parsed.data.childId) as any
  if (!child) return res.status(404).json({ error: 'child_not_found' })

  if (user.role === 'parent' && child.parentUserId !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const id = `doc-${randomUUID().slice(0, 8)}`
  const now = new Date().toISOString()
  const initialStatus = user.role === 'director' ? 'verified' : 'pending_review'
  const verifiedBy = user.role === 'director' ? user.id : null
  const verifiedAt = user.role === 'director' ? now : null

  db.prepare(`
    INSERT INTO child_documents (id, child_id, document_type, title, file_url, file_name, file_size_bytes, status, notes, expiration_date, uploaded_by, verified_by, verified_at, rejection_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    parsed.data.childId,
    parsed.data.documentType,
    parsed.data.title,
    parsed.data.fileUrl,
    parsed.data.fileName,
    parsed.data.fileSizeBytes,
    initialStatus,
    parsed.data.notes,
    parsed.data.expirationDate || null,
    user.id,
    verifiedBy,
    verifiedAt,
    null,
    now,
    now,
  )

  const created = db.prepare(`${docSelectFields} WHERE d.id = ?`).get(id)
  res.status(201).json({ success: true, document: created })
})

app.put('/api/documents/:id/verify', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const existing = db.prepare('SELECT id FROM child_documents WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'not_found' })

  const parsed = verifyDocSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.issues })

  const now = new Date().toISOString()
  const verifiedBy = parsed.data.status === 'verified' ? user.id : null
  const verifiedAt = parsed.data.status === 'verified' ? now : null
  const rejectionReason = parsed.data.status === 'rejected' ? (parsed.data.rejectionReason || 'Document rejected') : null

  db.prepare(`
    UPDATE child_documents
    SET status = ?, verified_by = ?, verified_at = ?, rejection_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(
    parsed.data.status,
    verifiedBy,
    verifiedAt,
    rejectionReason,
    now,
    req.params.id,
  )

  const updated = db.prepare(`${docSelectFields} WHERE d.id = ?`).get(req.params.id)
  res.json({ success: true, document: updated })
})

app.delete('/api/documents/:id', requireAuth, (req, res) => {
  const user = authed(req)
  const existing = db.prepare(`
    SELECT d.id, d.uploaded_by, d.status, c.parent_user_id
    FROM child_documents d
    JOIN children c ON c.id = d.child_id
    WHERE d.id = ?
  `).get(req.params.id) as any

  if (!existing) return res.status(404).json({ error: 'not_found' })

  if (user.role === 'parent') {
    if (existing.parent_user_id !== user.id) return res.status(403).json({ error: 'forbidden' })
    if (existing.status === 'verified') return res.status(400).json({ error: 'cannot_delete_verified_document' })
  } else if (user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  db.prepare('DELETE FROM child_documents WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

function computeDurationMinutes(start: string, end: string | null | undefined): number | null {
  if (!end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let diff = (eh * 60 + em) - (sh * 60 + sm)
  if (diff < 0) diff += 24 * 60
  return diff
}

const sleepQualitySchema = z.enum(['restful', 'light', 'restless', 'refused_nap'])
const timeFormatRegex = /^([01]\d|2[0-3]):[0-5]\d$/

const createSleepLogSchema = z.object({
  childId: z.string().min(1),
  logDate: calendarDate,
  startTime: z.string().regex(timeFormatRegex, 'invalid_time_format'),
  endTime: z.string().regex(timeFormatRegex, 'invalid_time_format').nullable().optional(),
  quality: sleepQualitySchema,
  notes: z.string().max(1000).optional().default(''),
})

const updateSleepLogSchema = z.object({
  startTime: z.string().regex(timeFormatRegex, 'invalid_time_format').optional(),
  endTime: z.string().regex(timeFormatRegex, 'invalid_time_format').nullable().optional(),
  quality: sleepQualitySchema.optional(),
  notes: z.string().max(1000).optional(),
})

const sleepSelectFields = `
  SELECT s.id, s.child_id AS childId, c.name AS childName, c.group_name AS groupName,
         s.log_date AS logDate, s.start_time AS startTime, s.end_time AS endTime,
         s.duration_minutes AS durationMinutes, s.quality, s.notes,
         s.recorded_by AS recordedBy, u.name AS recordedByName,
         s.created_at AS createdAt, s.updated_at AS updatedAt
  FROM child_sleep_logs s
  JOIN children c ON c.id = s.child_id
  JOIN users u ON u.id = s.recorded_by
`

app.get('/api/sleep-logs', requireAuth, (req, res) => {
  const user = authed(req)
  const { date, childId } = req.query as { date?: string; childId?: string }

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'invalid_date' })
  }

  const conditions: string[] = []
  const params: unknown[] = []

  if (user.role === 'parent') {
    conditions.push('c.parent_user_id = ?')
    params.push(user.id)
  }

  if (childId) {
    conditions.push('s.child_id = ?')
    params.push(childId)
  }

  if (date) {
    conditions.push('s.log_date = ?')
    params.push(date)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const sql = `${sleepSelectFields} ${whereClause} ORDER BY s.log_date DESC, s.start_time DESC`
  const logs = db.prepare(sql).all(...params) as any[]

  let totalSleepMinutes = 0
  let activeNappingCount = 0
  let restfulCount = 0
  let lightCount = 0
  let restlessCount = 0
  let refusedCount = 0

  for (const log of logs) {
    if (log.durationMinutes != null) {
      totalSleepMinutes += log.durationMinutes
    }
    if (log.endTime == null) {
      activeNappingCount++
    }
    if (log.quality === 'restful') restfulCount++
    else if (log.quality === 'light') lightCount++
    else if (log.quality === 'restless') restlessCount++
    else if (log.quality === 'refused_nap') refusedCount++
  }

  res.json({
    logs,
    summary: {
      totalLogs: logs.length,
      totalSleepMinutes,
      activeNappingCount,
      restfulCount,
      lightCount,
      restlessCount,
      refusedCount,
    },
  })
})

app.post('/api/sleep-logs', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const parsed = createSleepLogSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.issues })
  }

  const child = db.prepare('SELECT id, name FROM children WHERE id = ?').get(parsed.data.childId)
  if (!child) return res.status(404).json({ error: 'child_not_found' })

  const durationMinutes = computeDurationMinutes(parsed.data.startTime, parsed.data.endTime)
  const logId = `sl-${randomUUID().slice(0, 8)}`
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO child_sleep_logs (id, child_id, log_date, start_time, end_time, duration_minutes, quality, notes, recorded_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    logId,
    parsed.data.childId,
    parsed.data.logDate,
    parsed.data.startTime,
    parsed.data.endTime || null,
    durationMinutes,
    parsed.data.quality,
    parsed.data.notes || '',
    user.id,
    now,
    now,
  )

  const created = db.prepare(`${sleepSelectFields} WHERE s.id = ?`).get(logId)
  res.status(201).json({ success: true, log: created })
})

app.put('/api/sleep-logs/:id', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const existing = db.prepare('SELECT * FROM child_sleep_logs WHERE id = ?').get(req.params.id) as DbChildSleepLog | undefined
  if (!existing) return res.status(404).json({ error: 'not_found' })

  const parsed = updateSleepLogSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.issues })
  }

  const startTime = parsed.data.startTime !== undefined ? parsed.data.startTime : existing.start_time
  const endTime = parsed.data.endTime !== undefined ? parsed.data.endTime : existing.end_time
  const durationMinutes = computeDurationMinutes(startTime, endTime)
  const quality = parsed.data.quality !== undefined ? parsed.data.quality : existing.quality
  const notes = parsed.data.notes !== undefined ? parsed.data.notes : existing.notes
  const now = new Date().toISOString()

  db.prepare(`
    UPDATE child_sleep_logs
    SET start_time = ?, end_time = ?, duration_minutes = ?, quality = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(startTime, endTime || null, durationMinutes, quality, notes, now, req.params.id)

  const updated = db.prepare(`${sleepSelectFields} WHERE s.id = ?`).get(req.params.id)
  res.json({ success: true, log: updated })
})

app.delete('/api/sleep-logs/:id', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const existing = db.prepare('SELECT id FROM child_sleep_logs WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'not_found' })

  db.prepare('DELETE FROM child_sleep_logs WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

// --- Phase 14: Medication Administration & Daily Health Triage ---

const medicationSelectFields = `
  SELECT m.id, m.child_id AS childId, c.name AS childName, c.group_name AS groupName,
         m.medication_name AS medicationName, m.dosage, m.frequency_schedule AS frequencySchedule,
         m.instructions, m.storage_type AS storageType, m.doctor_name AS doctorName,
         m.prescription_number AS prescriptionNumber, m.start_date AS startDate, m.end_date AS endDate,
         m.status, m.authorized_by AS authorizedBy, u.name AS authorizedByName,
         m.created_at AS createdAt, m.updated_at AS updatedAt,
         (SELECT COUNT(*) FROM medication_logs ml WHERE ml.medication_id = m.id) AS logsCount,
         (SELECT ml.administered_at FROM medication_logs ml WHERE ml.medication_id = m.id ORDER BY ml.administered_at DESC LIMIT 1) AS lastAdministeredAt
  FROM child_medications m
  JOIN children c ON c.id = m.child_id
  JOIN users u ON u.id = m.authorized_by
`

const medicationLogSelectFields = `
  SELECT l.id, l.medication_id AS medicationId, l.child_id AS childId,
         l.administered_at AS administeredAt, l.dosage_given AS dosageGiven,
         l.reaction, l.administered_by AS administeredBy, u1.name AS administeredByName,
         l.witness_by AS witnessBy, u2.name AS witnessByName,
         l.notes, l.created_at AS createdAt
  FROM medication_logs l
  JOIN users u1 ON u1.id = l.administered_by
  LEFT JOIN users u2 ON u2.id = l.witness_by
`

const healthCheckSelectFields = `
  SELECT h.id, h.child_id AS childId, c.name AS childName, c.group_name AS groupName,
         h.check_date AS checkDate, h.check_time AS checkTime,
         h.temperature_celsius AS temperatureCelsius, h.symptoms,
         h.passed_triage AS passedTriage, h.notes,
         h.checked_by AS checkedBy, u.name AS checkedByName,
         h.created_at AS createdAt, h.updated_at AS updatedAt
  FROM daily_health_checks h
  JOIN children c ON c.id = h.child_id
  JOIN users u ON u.id = h.checked_by
`

const createMedicationSchema = z.object({
  childId: z.string().trim().min(1),
  medicationName: z.string().trim().min(1),
  dosage: z.string().trim().min(1),
  frequencySchedule: z.string().trim().min(1),
  instructions: z.string().trim(),
  storageType: z.enum(['room_temperature', 'refrigerated', 'locked_box']),
  doctorName: z.string().trim().min(1),
  prescriptionNumber: z.string().trim().optional(),
  startDate: calendarDate,
  endDate: calendarDate,
}).strict()

const updateMedicationSchema = z.object({
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
  instructions: z.string().trim().optional(),
  storageType: z.enum(['room_temperature', 'refrigerated', 'locked_box']).optional(),
  endDate: calendarDate.optional(),
}).strict()

const administerMedicationSchema = z.object({
  dosageGiven: z.string().trim().min(1),
  reaction: z.enum(['normal', 'drowsy', 'refused', 'adverse']),
  witnessBy: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional(),
  administeredAt: z.string().datetime().optional(),
}).strict()

const createHealthCheckSchema = z.object({
  childId: z.string().trim().min(1),
  checkDate: calendarDate,
  checkTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  temperatureCelsius: z.number().min(34.0).max(42.0),
  symptoms: z.array(z.string().trim()),
  passedTriage: z.boolean(),
  notes: z.string().trim().optional(),
}).strict()

app.get('/api/medications', requireAuth, (req, res) => {
  const user = authed(req)
  const childId = typeof req.query.childId === 'string' && req.query.childId ? req.query.childId : undefined
  const status = typeof req.query.status === 'string' && ['active', 'completed', 'cancelled'].includes(req.query.status)
    ? req.query.status
    : undefined

  if (user.role === 'parent' && childId) {
    const owned = db.prepare('SELECT id FROM children WHERE id = ? AND parent_user_id = ?').get(childId, user.id)
    if (!owned) return res.status(403).json({ error: 'forbidden' })
  }

  const conditions: string[] = []
  const params: any[] = []

  if (user.role === 'parent') {
    conditions.push('c.parent_user_id = ?')
    params.push(user.id)
  }

  if (childId) {
    conditions.push('m.child_id = ?')
    params.push(childId)
  }

  if (status) {
    conditions.push('m.status = ?')
    params.push(status)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const sql = `${medicationSelectFields} ${whereClause} ORDER BY m.created_at DESC`
  const medications = db.prepare(sql).all(...params) as any[]

  let activeCount = 0
  let completedCount = 0
  let cancelledCount = 0

  for (const m of medications) {
    if (m.status === 'active') activeCount++
    else if (m.status === 'completed') completedCount++
    else if (m.status === 'cancelled') cancelledCount++
  }

  res.json({
    medications,
    summary: {
      total: medications.length,
      active: activeCount,
      completed: completedCount,
      cancelled: cancelledCount,
    },
  })
})

app.post('/api/medications', requireAuth, (req, res) => {
  const user = authed(req)
  const parsed = createMedicationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.issues })
  }

  const child = db.prepare('SELECT id, parent_user_id FROM children WHERE id = ?').get(parsed.data.childId) as { id: string; parent_user_id: string } | undefined
  if (!child) return res.status(404).json({ error: 'child_not_found' })

  if (user.role === 'parent' && child.parent_user_id !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const medId = `med-${randomUUID().slice(0, 8)}`
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO child_medications (id, child_id, medication_name, dosage, frequency_schedule, instructions, storage_type, doctor_name, prescription_number, start_date, end_date, status, authorized_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(
    medId,
    parsed.data.childId,
    parsed.data.medicationName,
    parsed.data.dosage,
    parsed.data.frequencySchedule,
    parsed.data.instructions,
    parsed.data.storageType,
    parsed.data.doctorName,
    parsed.data.prescriptionNumber || '',
    parsed.data.startDate,
    parsed.data.endDate,
    user.id,
    now,
    now,
  )

  const created = db.prepare(`${medicationSelectFields} WHERE m.id = ?`).get(medId)
  res.status(201).json({ success: true, medication: created })
})

app.put('/api/medications/:id', requireAuth, (req, res) => {
  const user = authed(req)
  const existing = db.prepare('SELECT m.*, c.parent_user_id FROM child_medications m JOIN children c ON c.id = m.child_id WHERE m.id = ?').get(req.params.id) as (DbChildMedication & { parent_user_id: string }) | undefined
  if (!existing) return res.status(404).json({ error: 'not_found' })

  if (user.role === 'parent' && existing.parent_user_id !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const parsed = updateMedicationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.issues })
  }

  const status = parsed.data.status || existing.status
  const instructions = parsed.data.instructions !== undefined ? parsed.data.instructions : existing.instructions
  const storageType = parsed.data.storageType || existing.storage_type
  const endDate = parsed.data.endDate || existing.end_date
  const now = new Date().toISOString()

  db.prepare(`
    UPDATE child_medications
    SET status = ?, instructions = ?, storage_type = ?, end_date = ?, updated_at = ?
    WHERE id = ?
  `).run(status, instructions, storageType, endDate, now, req.params.id)

  const updated = db.prepare(`${medicationSelectFields} WHERE m.id = ?`).get(req.params.id)
  res.json({ success: true, medication: updated })
})

app.get('/api/medications/:id/logs', requireAuth, (req, res) => {
  const user = authed(req)
  const medication = db.prepare('SELECT m.*, c.parent_user_id FROM child_medications m JOIN children c ON c.id = m.child_id WHERE m.id = ?').get(req.params.id) as (DbChildMedication & { parent_user_id: string }) | undefined
  if (!medication) return res.status(404).json({ error: 'not_found' })

  if (user.role === 'parent' && medication.parent_user_id !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const logs = db.prepare(`${medicationLogSelectFields} WHERE l.medication_id = ? ORDER BY l.administered_at DESC`).all(req.params.id)
  res.json({ logs })
})

app.post('/api/medications/:id/administer', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const medication = db.prepare('SELECT * FROM child_medications WHERE id = ?').get(req.params.id) as DbChildMedication | undefined
  if (!medication) return res.status(404).json({ error: 'not_found' })

  if (medication.status !== 'active') {
    return res.status(400).json({ error: 'medication_not_active' })
  }

  const parsed = administerMedicationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.issues })
  }

  let witnessId: string | null = null
  if (parsed.data.witnessBy) {
    const witnessUser = db.prepare('SELECT id FROM users WHERE id = ?').get(parsed.data.witnessBy)
    if (witnessUser) {
      witnessId = parsed.data.witnessBy
    }
  }

  const logId = `mlog-${randomUUID().slice(0, 8)}`
  const now = new Date().toISOString()
  const administeredAt = parsed.data.administeredAt || now

  db.prepare(`
    INSERT INTO medication_logs (id, medication_id, child_id, administered_at, dosage_given, reaction, administered_by, witness_by, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    logId,
    medication.id,
    medication.child_id,
    administeredAt,
    parsed.data.dosageGiven,
    parsed.data.reaction,
    user.id,
    witnessId,
    parsed.data.notes || '',
    now,
  )

  const createdLog = db.prepare(`${medicationLogSelectFields} WHERE l.id = ?`).get(logId)
  res.status(201).json({ success: true, log: createdLog })
})

app.get('/api/health-checks', requireAuth, (req, res) => {
  const user = authed(req)
  const childId = typeof req.query.childId === 'string' && req.query.childId ? req.query.childId : undefined
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined

  if (user.role === 'parent' && childId) {
    const owned = db.prepare('SELECT id FROM children WHERE id = ? AND parent_user_id = ?').get(childId, user.id)
    if (!owned) return res.status(403).json({ error: 'forbidden' })
  }

  const conditions: string[] = []
  const params: any[] = []

  if (user.role === 'parent') {
    conditions.push('c.parent_user_id = ?')
    params.push(user.id)
  }

  if (childId) {
    conditions.push('h.child_id = ?')
    params.push(childId)
  }

  if (date) {
    conditions.push('h.check_date = ?')
    params.push(date)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const sql = `${healthCheckSelectFields} ${whereClause} ORDER BY h.check_date DESC, h.check_time DESC`
  const rows = db.prepare(sql).all(...params) as any[]

  let passedCount = 0
  let flaggedCount = 0
  let totalTemp = 0

  const checks = rows.map((r) => {
    let symptomsArr: string[] = []
    try {
      symptomsArr = JSON.parse(r.symptoms)
    } catch {
      symptomsArr = []
    }
    const passed = Boolean(r.passedTriage)
    if (passed) passedCount++
    else flaggedCount++
    totalTemp += r.temperatureCelsius

    return {
      ...r,
      passedTriage: passed,
      symptoms: symptomsArr,
    }
  })

  const averageTemp = checks.length > 0 ? Number((totalTemp / checks.length).toFixed(1)) : 36.6

  res.json({
    checks,
    summary: {
      total: checks.length,
      passed: passedCount,
      flagged: flaggedCount,
      averageTemp,
    },
  })
})

app.post('/api/health-checks', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const parsed = createHealthCheckSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.issues })
  }

  const child = db.prepare('SELECT id FROM children WHERE id = ?').get(parsed.data.childId)
  if (!child) return res.status(404).json({ error: 'child_not_found' })

  const checkId = `dhc-${randomUUID().slice(0, 8)}`
  const now = new Date().toISOString()
  const symptomsJson = JSON.stringify(parsed.data.symptoms)
  const passedInt = parsed.data.passedTriage ? 1 : 0

  db.prepare(`
    INSERT INTO daily_health_checks (id, child_id, check_date, check_time, temperature_celsius, symptoms, passed_triage, notes, checked_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(child_id, check_date) DO UPDATE SET
      check_time = excluded.check_time,
      temperature_celsius = excluded.temperature_celsius,
      symptoms = excluded.symptoms,
      passed_triage = excluded.passed_triage,
      notes = excluded.notes,
      checked_by = excluded.checked_by,
      updated_at = excluded.updated_at
  `).run(
    checkId,
    parsed.data.childId,
    parsed.data.checkDate,
    parsed.data.checkTime,
    parsed.data.temperatureCelsius,
    symptomsJson,
    passedInt,
    parsed.data.notes || '',
    user.id,
    now,
    now,
  )

  const createdRow = db.prepare(`${healthCheckSelectFields} WHERE h.child_id = ? AND h.check_date = ?`).get(parsed.data.childId, parsed.data.checkDate) as any
  let symptomsArr: string[] = []
  try {
    symptomsArr = JSON.parse(createdRow.symptoms)
  } catch {
    symptomsArr = []
  }

  res.status(201).json({
    success: true,
    check: {
      ...createdRow,
      passedTriage: Boolean(createdRow.passedTriage),
      symptoms: symptomsArr,
    },
  })
})

// --- Phase 15: Child Potty & Diaper Hygiene Tracker ---

const hygieneSelectFields = `
  SELECT h.id, h.child_id AS childId, c.name AS childName, c.group_name AS groupName,
         h.log_date AS logDate, h.log_time AS logTime,
         h.entry_type AS entryType, h.diaper_type AS diaperType,
         h.potty_result AS pottyResult, h.cream_applied AS creamApplied,
         h.notes, h.recorded_by AS recordedBy, u.name AS recordedByName,
         h.created_at AS createdAt, h.updated_at AS updatedAt
  FROM child_hygiene_logs h
  JOIN children c ON c.id = h.child_id
  JOIN users u ON u.id = h.recorded_by
`

const createHygieneLogSchema = z.object({
  childId: z.string().trim().min(1),
  logDate: calendarDate,
  logTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  entryType: z.enum(['diaper', 'potty']),
  diaperType: z.enum(['wet', 'dirty', 'both', 'dry']).optional().nullable(),
  pottyResult: z.enum(['success_pee', 'success_bm', 'success_both', 'tried_dry', 'accident']).optional().nullable(),
  creamApplied: z.boolean().optional(),
  notes: z.string().trim().optional(),
}).strict()

const updateHygieneLogSchema = z.object({
  logTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  entryType: z.enum(['diaper', 'potty']).optional(),
  diaperType: z.enum(['wet', 'dirty', 'both', 'dry']).optional().nullable(),
  pottyResult: z.enum(['success_pee', 'success_bm', 'success_both', 'tried_dry', 'accident']).optional().nullable(),
  creamApplied: z.boolean().optional(),
  notes: z.string().trim().optional(),
}).strict()

app.get('/api/hygiene-logs', requireAuth, (req, res) => {
  const user = authed(req)
  const childId = typeof req.query.childId === 'string' && req.query.childId ? req.query.childId : undefined
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined
  const entryType = typeof req.query.type === 'string' && ['diaper', 'potty'].includes(req.query.type) ? req.query.type : undefined

  if (user.role === 'parent' && childId) {
    const owned = db.prepare('SELECT id FROM children WHERE id = ? AND parent_user_id = ?').get(childId, user.id)
    if (!owned) return res.status(403).json({ error: 'forbidden' })
  }

  const conditions: string[] = []
  const params: any[] = []

  if (user.role === 'parent') {
    conditions.push('c.parent_user_id = ?')
    params.push(user.id)
  }

  if (childId) {
    conditions.push('h.child_id = ?')
    params.push(childId)
  }

  if (date) {
    conditions.push('h.log_date = ?')
    params.push(date)
  }

  if (entryType) {
    conditions.push('h.entry_type = ?')
    params.push(entryType)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const sql = `${hygieneSelectFields} ${whereClause} ORDER BY h.log_date DESC, h.log_time DESC`
  const rows = db.prepare(sql).all(...params) as any[]

  let wetCount = 0
  let dirtyCount = 0
  let pottySuccessCount = 0
  let accidentsCount = 0
  let creamCount = 0

  const logs = rows.map((r) => {
    const cream = Boolean(r.creamApplied)
    if (cream) creamCount++
    if (r.entryType === 'diaper') {
      if (r.diaperType === 'wet' || r.diaperType === 'both') wetCount++
      if (r.diaperType === 'dirty' || r.diaperType === 'both') dirtyCount++
    } else if (r.entryType === 'potty') {
      if (r.pottyResult?.startsWith('success')) pottySuccessCount++
      else if (r.pottyResult === 'accident') accidentsCount++
    }

    return {
      ...r,
      creamApplied: cream,
    }
  })

  res.json({
    logs,
    summary: {
      total: logs.length,
      wetCount,
      dirtyCount,
      pottySuccessCount,
      accidentsCount,
      creamCount,
    },
  })
})

app.post('/api/hygiene-logs', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const parsed = createHygieneLogSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.issues })
  }

  const child = db.prepare('SELECT id FROM children WHERE id = ?').get(parsed.data.childId)
  if (!child) return res.status(404).json({ error: 'child_not_found' })

  const logId = `hyg-${randomUUID().slice(0, 8)}`
  const now = new Date().toISOString()
  const creamInt = parsed.data.creamApplied ? 1 : 0

  db.prepare(`
    INSERT INTO child_hygiene_logs (id, child_id, log_date, log_time, entry_type, diaper_type, potty_result, cream_applied, notes, recorded_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    logId,
    parsed.data.childId,
    parsed.data.logDate,
    parsed.data.logTime,
    parsed.data.entryType,
    parsed.data.diaperType || null,
    parsed.data.pottyResult || null,
    creamInt,
    parsed.data.notes || '',
    user.id,
    now,
    now,
  )

  const created = db.prepare(`${hygieneSelectFields} WHERE h.id = ?`).get(logId) as any
  res.status(201).json({
    success: true,
    log: {
      ...created,
      creamApplied: Boolean(created.creamApplied),
    },
  })
})

app.put('/api/hygiene-logs/:id', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const existing = db.prepare('SELECT * FROM child_hygiene_logs WHERE id = ?').get(req.params.id) as DbChildHygieneLog | undefined
  if (!existing) return res.status(404).json({ error: 'not_found' })

  const parsed = updateHygieneLogSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.issues })
  }

  const logTime = parsed.data.logTime || existing.log_time
  const entryType = parsed.data.entryType || existing.entry_type
  const diaperType = parsed.data.diaperType !== undefined ? parsed.data.diaperType : existing.diaper_type
  const pottyResult = parsed.data.pottyResult !== undefined ? parsed.data.pottyResult : existing.potty_result
  const creamApplied = parsed.data.creamApplied !== undefined ? (parsed.data.creamApplied ? 1 : 0) : existing.cream_applied
  const notes = parsed.data.notes !== undefined ? parsed.data.notes : existing.notes
  const now = new Date().toISOString()

  db.prepare(`
    UPDATE child_hygiene_logs
    SET log_time = ?, entry_type = ?, diaper_type = ?, potty_result = ?, cream_applied = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(logTime, entryType, diaperType, pottyResult, creamApplied, notes, now, req.params.id)

  const updated = db.prepare(`${hygieneSelectFields} WHERE h.id = ?`).get(req.params.id) as any
  res.json({
    success: true,
    log: {
      ...updated,
      creamApplied: Boolean(updated.creamApplied),
    },
  })
})

app.delete('/api/hygiene-logs/:id', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }

  const existing = db.prepare('SELECT id FROM child_hygiene_logs WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'not_found' })

  db.prepare('DELETE FROM child_hygiene_logs WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

// --- Phase 16: Super Admin & Role-Based Feature Permissions ---

app.get('/api/features', requireAuth, (req, res) => {
  const user = authed(req)
  const permissions = getRoleFeaturePermissions()
  const userRole = user.role as 'director' | 'teacher' | 'parent' | 'superadmin'

  if (userRole === 'superadmin') {
    return res.json({
      role: 'superadmin',
      permissions,
      features: ALL_FEATURES,
      enabledFeatures: ALL_FEATURES.map((f) => f.key),
    })
  }

  const rolePerms = permissions[userRole] || {}
  const enabledFeatures = ALL_FEATURES
    .filter((f) => rolePerms[f.key] !== false)
    .map((f) => f.key)

  res.json({
    role: userRole,
    permissions,
    features: ALL_FEATURES,
    enabledFeatures,
  })
})

app.put('/api/admin/features', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'superadmin') {
    return res.status(403).json({ error: 'forbidden', message: 'Super admin access required' })
  }

  const singleSchema = z.object({
    role: z.enum(['director', 'teacher', 'parent']),
    featureKey: z.string().min(1),
    isEnabled: z.boolean(),
  })

  const bulkSchema = z.object({
    updates: z.array(singleSchema).min(1),
  })

  const singleParsed = singleSchema.safeParse(req.body)
  if (singleParsed.success) {
    setRoleFeaturePermission(singleParsed.data.role, singleParsed.data.featureKey, singleParsed.data.isEnabled)
    return res.json({
      success: true,
      permissions: getRoleFeaturePermissions(),
    })
  }

  const bulkParsed = bulkSchema.safeParse(req.body)
  if (bulkParsed.success) {
    for (const u of bulkParsed.data.updates) {
      setRoleFeaturePermission(u.role, u.featureKey, u.isEnabled)
    }
    return res.json({
      success: true,
      permissions: getRoleFeaturePermissions(),
    })
  }

  res.status(400).json({ error: 'invalid_body', details: singleParsed.error.issues })
})

app.post('/api/admin/features/reset', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'superadmin') {
    return res.status(403).json({ error: 'forbidden', message: 'Super admin access required' })
  }

  resetRoleFeaturePermissions()
  res.json({
    success: true,
    permissions: getRoleFeaturePermissions(),
  })
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
  const children = db.prepare(`SELECT c.id, c.name, c.group_name AS groupName, c.photo_consent AS photoConsent, COALESCE(c.allergies, '') AS allergies,
    a.status AS attendanceStatus, EXISTS(SELECT 1 FROM reports r WHERE r.child_id = c.id AND r.report_date = ?) AS hasReport
    FROM children c LEFT JOIN attendance a ON a.child_id = c.id AND a.attendance_date = ?
    ${user.role === 'parent' ? 'WHERE c.parent_user_id = ?' : ''} ORDER BY c.name, c.id`).all(parsed.data.date, parsed.data.date, ...params)
    .map((row) => { const child = row as { photoConsent: number; hasReport: number; allergies?: string }; return { ...child, photoConsent: Boolean(child.photoConsent), hasReport: Boolean(child.hasReport), allergies: child.allergies || '' } })
  res.json({ summary: { ...summary, unpaidBalances, date: parsed.data.date, unmarked: summary.children - summary.present - summary.absent, childSummaries: children } })
})

app.get('/api/timeline', requireAuth, (req, res) => {
  const parsed = z.object({
    childId: z.string().min(1),
    date: calendarDate,
  }).safeParse(req.query)

  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query' })
  }

  const user = authed(req)
  const child = db.prepare('SELECT id, name, group_name AS groupName, parent_user_id AS parentUserId FROM children WHERE id = ?').get(parsed.data.childId) as { id: string; name: string; groupName: string; parentUserId: string } | undefined

  if (!child) {
    return res.status(404).json({ error: 'child_not_found' })
  }

  if (user.role === 'parent' && child.parentUserId !== user.id) {
    return res.status(403).json({ error: 'forbidden' })
  }

  type TimelineEvent = {
    id: string
    category: 'arrival' | 'departure' | 'health' | 'hygiene' | 'sleep' | 'medication' | 'moment' | 'report' | 'incident'
    time: string
    title: string
    description: string
    badge?: string
    icon: string
    imageUrl?: string | null
    author?: string
  }

  const events: TimelineEvent[] = []

  // 1. Pickups & Check-ins
  const pickups = db.prepare(`
    SELECT id, log_time AS time, action, guardian_name AS guardianName, notes
    FROM pickup_logs
    WHERE child_id = ? AND log_date = ?
    ORDER BY log_time ASC
  `).all(child.id, parsed.data.date) as { id: string; time: string; action: 'check_in' | 'check_out'; guardianName: string; notes: string }[]

  for (const p of pickups) {
    events.push({
      id: `pickup-${p.id}`,
      category: p.action === 'check_in' ? 'arrival' : 'departure',
      time: p.time,
      title: p.action === 'check_in' ? 'Ardhja në çerdhe / Morning Check-in' : 'Largimi nga çerdhja / Afternoon Pick-up',
      description: p.notes ? `${p.guardianName} · ${p.notes}` : p.guardianName,
      badge: p.action === 'check_in' ? 'Check-in' : 'Check-out',
      icon: p.action === 'check_in' ? 'check' : 'children',
    })
  }

  // 2. Health check
  const healthCheck = db.prepare(`
    SELECT id, check_time AS time, temperature_celsius AS temperature, symptoms, passed_triage AS passedTriage, notes
    FROM daily_health_checks
    WHERE child_id = ? AND check_date = ?
  `).get(child.id, parsed.data.date) as { id: string; time: string; temperature: number; symptoms: string; passedTriage: number; notes: string } | undefined

  if (healthCheck) {
    events.push({
      id: `health-${healthCheck.id}`,
      category: 'health',
      time: healthCheck.time,
      title: 'Triazhi & Kontrolli Shëndetësor / Morning Health Check',
      description: [
        healthCheck.symptoms && healthCheck.symptoms !== '[]' ? `Simptomat / Symptoms: ${healthCheck.symptoms}` : '',
        healthCheck.notes,
      ].filter(Boolean).join(' · ') || 'Kontroll i rregullt i mëngjesit / Normal morning check',
      badge: `${healthCheck.temperature}°C · ${healthCheck.passedTriage ? 'PASSED' : 'FLAGGED'}`,
      icon: 'leaf',
    })
  }

  // 3. Hygiene & Diaper logs
  const hygieneLogs = db.prepare(`
    SELECT id, log_time AS time, entry_type AS entryType, diaper_type AS diaperType, potty_result AS pottyResult, cream_applied AS creamApplied, notes
    FROM child_hygiene_logs
    WHERE child_id = ? AND log_date = ?
    ORDER BY log_time ASC
  `).all(child.id, parsed.data.date) as { id: string; time: string; entryType: 'diaper' | 'potty'; diaperType: string | null; pottyResult: string | null; creamApplied: number; notes: string }[]

  for (const h of hygieneLogs) {
    events.push({
      id: `hyg-${h.id}`,
      category: 'hygiene',
      time: h.time,
      title: h.entryType === 'diaper' ? 'Ndërrim Pelene / Diaper Change' : 'Përdorim Tualeti / Potty Training',
      description: [
        h.creamApplied ? 'Aplikuar krem mbrojtës / Barrier cream applied' : '',
        h.notes,
      ].filter(Boolean).join(' · ') || (h.entryType === 'diaper' ? 'Ndërrim i rregullt' : 'Tualet'),
      badge: (h.entryType === 'diaper' ? h.diaperType : h.pottyResult) || h.entryType,
      icon: 'hygiene',
    })
  }

  // 4. Sleep logs
  const sleepLogs = db.prepare(`
    SELECT id, start_time AS startTime, end_time AS endTime, duration_minutes AS durationMinutes, quality, notes
    FROM child_sleep_logs
    WHERE child_id = ? AND log_date = ?
    ORDER BY start_time ASC
  `).all(child.id, parsed.data.date) as { id: string; startTime: string; endTime: string | null; durationMinutes: number | null; quality: string; notes: string | null }[]

  for (const s of sleepLogs) {
    events.push({
      id: `sleep-${s.id}`,
      category: 'sleep',
      time: s.startTime,
      title: 'Pushimi & Gjumi i Ditës / Nap & Rest',
      description: s.notes || (s.endTime ? `${s.startTime} - ${s.endTime} (${s.durationMinutes || 0} min)` : 'Gjumë i pushuar'),
      badge: `${s.durationMinutes ? `${s.durationMinutes} min · ` : ''}${s.quality}`,
      icon: 'sleep',
    })
  }

  // 5. Medications
  const medLogs = db.prepare(`
    SELECT ml.id, SUBSTR(ml.administered_at, 12, 5) AS time, cm.medication_name AS medicationName, ml.dosage_given AS dosage, ml.reaction, ml.notes
    FROM medication_logs ml
    JOIN child_medications cm ON cm.id = ml.medication_id
    WHERE ml.child_id = ? AND ml.administered_at LIKE ?
    ORDER BY ml.administered_at ASC
  `).all(child.id, `${parsed.data.date}%`) as { id: string; time: string; medicationName: string; dosage: string; reaction: string; notes: string }[]

  for (const m of medLogs) {
    events.push({
      id: `med-${m.id}`,
      category: 'medication',
      time: m.time || '12:00',
      title: `Administrim Bari: ${m.medicationName} / Medication: ${m.medicationName}`,
      description: [
        `Doza / Dose: ${m.dosage}`,
        `Reagimi / Reaction: ${m.reaction}`,
        m.notes,
      ].filter(Boolean).join(' · '),
      badge: m.dosage,
      icon: 'medication',
    })
  }

  // 6. Incidents
  const incidents = db.prepare(`
    SELECT id, incident_time AS time, type, location, first_aid AS firstAid, description, action_taken AS actionTaken
    FROM incident_reports
    WHERE child_id = ? AND incident_date = ?
    ORDER BY incident_time ASC
  `).all(child.id, parsed.data.date) as { id: string; time: string; type: string; location: string; firstAid: string; description: string; actionTaken: string }[]

  for (const inc of incidents) {
    events.push({
      id: `inc-${inc.id}`,
      category: 'incident',
      time: inc.time,
      title: `Raport Incidenti & Ndihmë e Parë / Incident: ${inc.type}`,
      description: `${inc.description} · Veprimi / Action: ${inc.actionTaken}`,
      badge: `${inc.location} · ${inc.firstAid}`,
      icon: 'incidents',
    })
  }

  // 7. Classroom moments
  const moments = db.prepare(`
    SELECT id, title, learning_area AS learningArea, description, image_url AS imageUrl
    FROM classroom_moments
    WHERE moment_date = ? AND (group_name = ? OR tagged_children LIKE ?)
    ORDER BY created_at ASC
  `).all(parsed.data.date, child.groupName, `%"${child.id}"%`) as { id: string; title: string; learningArea: string; description: string; imageUrl: string | null }[]

  for (const mom of moments) {
    events.push({
      id: `mom-${mom.id}`,
      category: 'moment',
      time: '11:15',
      title: mom.title,
      description: mom.description,
      badge: mom.learningArea.toUpperCase(),
      imageUrl: mom.imageUrl,
      icon: 'moments',
    })
  }

  // 8. Daily teacher report & photo
  const report = db.prepare(`
    SELECT r.id, r.mood, r.meals, r.nap, r.activities, r.note, rp.image_url AS imageUrl, u.name AS teacherName
    FROM reports r
    LEFT JOIN report_photos rp ON rp.report_id = r.id
    LEFT JOIN users u ON u.id = r.teacher_user_id
    WHERE r.child_id = ? AND r.report_date = ?
  `).get(child.id, parsed.data.date) as { id: string; mood: string; meals: string; nap: string; activities: string; note: string; imageUrl: string | null; teacherName: string | null } | undefined

  if (report) {
    events.push({
      id: `rep-${report.id}`,
      category: 'report',
      time: '14:30',
      title: 'Tregimi Ditor i Edukatores / Teacher Daily Care Story',
      description: report.note || `Aktivitetet / Activities: ${report.activities}`,
      badge: report.mood,
      imageUrl: report.imageUrl,
      author: report.teacherName || 'Edukatorja / Teacher',
      icon: 'reports',
    })
  }

  // Sort events chronologically
  events.sort((a, b) => a.time.localeCompare(b.time))

  const checkIn = pickups.find((p) => p.action === 'check_in')
  const checkOut = pickups.find((p) => p.action === 'check_out')
  const totalNap = sleepLogs.reduce((acc, s) => acc + (s.durationMinutes || 0), 0)

  res.json({
    child: {
      id: child.id,
      name: child.name,
      groupName: child.groupName,
    },
    date: parsed.data.date,
    summary: {
      totalEvents: events.length,
      checkInTime: checkIn?.time || null,
      checkOutTime: checkOut?.time || null,
      napMinutes: totalNap,
      hygieneCount: hygieneLogs.length,
      hasHealthCheck: Boolean(healthCheck),
      hasReport: Boolean(report),
    },
    timeline: events,
  })
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '../../dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(distDir, 'index.html'))
    }
    next()
  })
}
