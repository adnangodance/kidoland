import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { db, type DbUser } from './db.js'
import { requireAuth, signToken, type AuthUser } from './auth.js'

export const app = express()

app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '10mb' }))
app.use((error: { type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') return res.status(400).json({ error: 'invalid_body' })
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
const childSchema = z.object({ name: z.string().trim().min(1).max(200), groupName: z.string().trim().min(1).max(200), parentUserId: z.string().trim().min(1), allergies: z.string().max(500).optional().default('') }).strict()
function childRow(id: string) {
  const row = db.prepare("SELECT id, name, group_name AS groupName, parent_user_id AS parentUserId, photo_consent AS photoConsent, COALESCE(allergies, '') AS allergies FROM children WHERE id = ?").get(id) as { photoConsent: number; allergies: string }
  return { ...row, photoConsent: Boolean(row.photoConsent), allergies: row.allergies || '' }
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
      db.prepare('INSERT INTO children (id, name, group_name, parent_user_id, allergies) VALUES (?, ?, ?, ?, ?)').run(id, body.name, body.groupName, body.parentUserId, body.allergies || '')
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

const mealBody = z.object({
  dayOfWeek: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  breakfast: z.string().trim().min(1).max(500),
  morningSnack: z.string().trim().min(1).max(500),
  lunch: z.string().trim().min(1).max(500),
  afternoonSnack: z.string().trim().min(1).max(500),
  allergens: z.string().max(300).optional().default(''),
  notes: z.string().max(1000).optional().default(''),
}).strict()

app.get('/api/meals', requireAuth, (_req, res) => {
  const meals = db.prepare(mealSelect).all()
  res.json({ meals })
})

app.post('/api/meals', requireAuth, (req, res) => {
  const user = authed(req)
  if (user.role !== 'teacher' && user.role !== 'director') {
    return res.status(403).json({ error: 'forbidden' })
  }
  const parsed = mealBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const { dayOfWeek, breakfast, morningSnack, lunch, afternoonSnack, allergens, notes } = parsed.data

  const now = new Date().toISOString()
  const existing = db.prepare('SELECT id FROM weekly_meals WHERE day_of_week = ?').get(dayOfWeek) as { id: string } | undefined
  const id = existing?.id || randomUUID()

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
  `).run(id, dayOfWeek, breakfast, morningSnack, lunch, afternoonSnack, allergens, notes, user.id, now)

  const meal = db.prepare(`${mealSelect.split('ORDER BY')[0]} WHERE id = ?`).get(id)
  res.status(200).json({ meal })
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
    : new Date().toISOString().slice(0, 10)

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
