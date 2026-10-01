import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, '..', 'kidoland.sqlite')

export const db = new Database(dbPath)

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
`)

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
if (childCount.c === 0) {
  db.prepare(
    'INSERT INTO children (id, name, group_name, parent_user_id) VALUES (?, ?, ?, ?)',
  ).run('c-arta', 'Arta Krasniqi', 'Bletët / Bumblebees', 'u-parent')
  db.prepare(
    'INSERT INTO children (id, name, group_name, parent_user_id) VALUES (?, ?, ?, ?)',
  ).run('c-luan', 'Luan Gashi', 'Bletët / Bumblebees', 'u-parent')
}

const reportCount = db.prepare('SELECT COUNT(*) AS c FROM reports').get() as { c: number }
if (reportCount.c === 0) {
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
