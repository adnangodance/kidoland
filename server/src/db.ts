import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.KIDOLAND_DB_PATH || path.join(__dirname, '..', 'kidoland.sqlite')

export const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('parent','teacher','director'))
  );

  CREATE TABLE IF NOT EXISTS children (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    group_name TEXT NOT NULL,
    parent_user_id TEXT NOT NULL REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES children(id),
    teacher_user_id TEXT NOT NULL REFERENCES users(id),
    report_date TEXT NOT NULL,
    mood TEXT NOT NULL,
    meals TEXT NOT NULL,
    nap TEXT NOT NULL,
    activities TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(child_id, report_date)
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES children(id),
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    period_label TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','paid')),
    due_date TEXT NOT NULL,
    paid_at TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES children(id),
    attendance_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('present','absent')),
    marked_by TEXT NOT NULL REFERENCES users(id),
    updated_at TEXT NOT NULL,
    UNIQUE(child_id, attendance_date)
  );
  CREATE INDEX IF NOT EXISTS attendance_date_child ON attendance(attendance_date, child_id);
`)

// Additive migration: older pilot rows retain their IDs, balances and paid state.
const childColumns = db.prepare('PRAGMA table_info(children)').all() as { name: string }[]
if (!childColumns.some((column) => column.name === 'photo_consent')) {
  db.exec('ALTER TABLE children ADD COLUMN photo_consent INTEGER NOT NULL DEFAULT 0 CHECK(photo_consent IN (0,1))')
}
db.exec(`CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  position INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS invoice_items_invoice ON invoice_items(invoice_id, position);
 CREATE TABLE IF NOT EXISTS invoice_requests (
   request_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), payload TEXT NOT NULL,
   invoice_id TEXT NOT NULL REFERENCES invoices(id), PRIMARY KEY(user_id, request_id)
 );
 CREATE TABLE IF NOT EXISTS child_requests (
   request_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), payload TEXT NOT NULL,
   child_id TEXT NOT NULL REFERENCES children(id), PRIMARY KEY(user_id, request_id)
 );`)

export type DbUser = {
  id: string
  name: string
  email: string
  password_hash: string
  role: 'parent' | 'teacher' | 'director'
}

type Seed = { id: string; name: string; email: string; password: string; role: string }

const seeds: Seed[] = [
  {
    id: 'u-parent',
    name: 'Elira Krasniqi',
    email: 'parent@kidoland.demo',
    password: 'parent123',
    role: 'parent',
  },
  {
    id: 'u-teacher',
    name: 'Mira Hoxha',
    email: 'teacher@kidoland.demo',
    password: 'teacher123',
    role: 'teacher',
  },
  {
    id: 'u-director',
    name: 'Arben Berisha',
    email: 'director@kidoland.demo',
    password: 'director123',
    role: 'director',
  },
]

const count = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }
if (count.c === 0) {
  const insert = db.prepare(
    'INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
  )
  for (const s of seeds) {
    insert.run(s.id, s.name, s.email, bcrypt.hashSync(s.password, 10), s.role)
  }
}

const childCount = db.prepare('SELECT COUNT(*) AS c FROM children').get() as { c: number }
if (childCount.c === 0 && db.prepare("SELECT id FROM users WHERE id = 'u-parent' AND role = 'parent'").get()) {
  db.prepare(
    'INSERT INTO children (id, name, group_name, parent_user_id) VALUES (?, ?, ?, ?)',
  ).run('c-arta', 'Arta Krasniqi', 'Bletët / Bumblebees', 'u-parent')
  db.prepare(
    'INSERT INTO children (id, name, group_name, parent_user_id) VALUES (?, ?, ?, ?)',
  ).run('c-luan', 'Luan Gashi', 'Bletët / Bumblebees', 'u-parent')
}

const reportCount = db.prepare('SELECT COUNT(*) AS c FROM reports').get() as { c: number }
if (reportCount.c === 0 && db.prepare("SELECT id FROM children WHERE id = 'c-arta'").get() && db.prepare("SELECT id FROM users WHERE id = 'u-teacher'").get()) {
  const today = new Date().toISOString().slice(0, 10)
  db.prepare(
    `INSERT INTO reports (id, child_id, teacher_user_id, report_date, mood, meals, nap, activities, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'r-arta-seed',
    'c-arta',
    'u-teacher',
    today,
    'Happy & playful',
    'Breakfast ✓ · Lunch ✓ · Snack ✓',
    '1h 20m',
    'Outdoor play, painting, story time',
    'Arta shared toys kindly today. Great participation in circle time.',
    new Date().toISOString(),
  )
}

const invoiceCount = db.prepare('SELECT COUNT(*) AS c FROM invoices').get() as { c: number }
if (invoiceCount.c === 0 && db.prepare("SELECT id FROM children WHERE id = 'c-arta'").get() && db.prepare("SELECT id FROM children WHERE id = 'c-luan'").get() && db.prepare("SELECT id FROM users WHERE id = 'u-director'").get()) {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO invoices (id, child_id, amount_cents, currency, period_label, status, due_date, paid_at, created_by, created_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'inv-arta-oct',
    'c-arta',
    18000,
    'EUR',
    'October 2026',
    'pending',
    '2026-10-05',
    null,
    'u-director',
    now,
    'Monthly tuition',
  )
  db.prepare(
    `INSERT INTO invoices (id, child_id, amount_cents, currency, period_label, status, due_date, paid_at, created_by, created_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'inv-luan-sep',
    'c-luan',
    18000,
    'EUR',
    'September 2026',
    'paid',
    '2026-09-05',
    '2026-09-03T10:00:00.000Z',
    'u-director',
    now,
    'Monthly tuition',
  )
  db.prepare(
    `INSERT INTO invoices (id, child_id, amount_cents, currency, period_label, status, due_date, paid_at, created_by, created_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'inv-luan-oct',
    'c-luan',
    18000,
    'EUR',
    'October 2026',
    'pending',
    '2026-10-05',
    null,
    'u-director',
    now,
    'Monthly tuition',
  )
}

// Backfill after seeding, and only invoices without any breakdown.
db.exec(`INSERT INTO invoice_items (id, invoice_id, description, amount_cents, position)
  SELECT 'legacy-' || i.id, i.id, 'tuition', i.amount_cents, 0 FROM invoices i
  WHERE NOT EXISTS (SELECT 1 FROM invoice_items item WHERE item.invoice_id = i.id)`)
