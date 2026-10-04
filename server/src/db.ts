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
if (!childColumns.some((column) => column.name === 'allergies')) {
  db.exec("ALTER TABLE children ADD COLUMN allergies TEXT NOT NULL DEFAULT ''")
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
 );
 CREATE TABLE IF NOT EXISTS report_photos (
   id TEXT PRIMARY KEY,
   report_id TEXT NOT NULL UNIQUE REFERENCES reports(id) ON DELETE CASCADE,
   image_url TEXT NOT NULL,
   created_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS report_photos_report ON report_photos(report_id);
 CREATE TABLE IF NOT EXISTS daily_programs (
   id TEXT PRIMARY KEY,
   group_name TEXT NOT NULL,
   program_date TEXT NOT NULL,
   theme TEXT NOT NULL,
   activities TEXT NOT NULL,
   meals_menu TEXT NOT NULL,
   notes TEXT NOT NULL DEFAULT '',
   created_by TEXT NOT NULL REFERENCES users(id),
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL,
   UNIQUE(group_name, program_date)
 );
 CREATE INDEX IF NOT EXISTS daily_programs_date_group ON daily_programs(program_date, group_name);
  CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority TEXT NOT NULL CHECK(priority IN ('normal', 'important', 'urgent')),
    target_group TEXT NOT NULL DEFAULT 'all',
    event_date TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS announcements_created ON announcements(created_at DESC);
  CREATE TABLE IF NOT EXISTS authorized_pickups (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    relationship TEXT NOT NULL,
    phone TEXT NOT NULL,
    is_emergency INTEGER NOT NULL DEFAULT 0 CHECK(is_emergency IN (0,1)),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS authorized_pickups_child ON authorized_pickups(child_id);
  CREATE TABLE IF NOT EXISTS pickup_logs (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    log_date TEXT NOT NULL,
    log_time TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('check_in', 'check_out')),
    guardian_name TEXT NOT NULL,
    staff_user_id TEXT NOT NULL REFERENCES users(id),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pickup_logs_child_date ON pickup_logs(child_id, log_date);
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    parent_user_id TEXT NOT NULL REFERENCES users(id),
    subject TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS conversations_child ON conversations(child_id);
  CREATE INDEX IF NOT EXISTS conversations_parent ON conversations(parent_user_id);
  CREATE INDEX IF NOT EXISTS conversations_updated ON conversations(updated_at DESC);
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_user_id TEXT NOT NULL REFERENCES users(id),
    sender_name TEXT NOT NULL,
    sender_role TEXT NOT NULL,
    content TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_conversation_created ON messages(conversation_id, created_at ASC);`)

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
    'INSERT INTO children (id, name, group_name, parent_user_id, allergies) VALUES (?, ?, ?, ?, ?)',
  ).run('c-arta', 'Arta Krasniqi', 'Bletët / Bumblebees', 'u-parent', 'Alergji në kikirik / Peanut allergy')
  db.prepare(
    'INSERT INTO children (id, name, group_name, parent_user_id, allergies) VALUES (?, ?, ?, ?, ?)',
  ).run('c-luan', 'Luan Gashi', 'Bletët / Bumblebees', 'u-parent', '')
}
db.prepare("UPDATE children SET allergies = 'Alergji në kikirik / Peanut allergy' WHERE id = 'c-arta' AND (allergies IS NULL OR allergies = '')").run()

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

const programCount = db.prepare('SELECT COUNT(*) AS c FROM daily_programs').get() as { c: number }
if (programCount.c === 0 && db.prepare("SELECT id FROM users WHERE id = 'u-teacher'").get()) {
  const today = new Date().toISOString().slice(0, 10)
  db.prepare(`
    INSERT INTO daily_programs (id, group_name, program_date, theme, activities, meals_menu, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'prog-today-seed',
    'Bletët / Bumblebees',
    today,
    'Kafshët dhe Natyra / Animals and Nature',
    '09:00 Rrethi i mëngjesit & kënga / Morning circle & songs\n10:00 Pikturim me gishta / Finger painting animals\n11:00 Lojëra në kopsht / Outdoor garden play\n14:30 Përralla: Ariu i Vogël / Storytime: The Little Bear',
    'Mëngjesi: Qull tërshëre me mollë / Oatmeal with apples\nDreka: Supë me perime & pulë / Vegetable chicken soup\nZemra: Biskota & banane / Biscuits & bananas',
    'Ju lutem sillni çizme shiu për lojën në kopsht / Please bring rain boots for the outdoor playground.',
    'u-teacher',
    new Date().toISOString(),
    new Date().toISOString(),
  )
}

const announcementCount = db.prepare('SELECT COUNT(*) AS c FROM announcements').get() as { c: number }
if (announcementCount.c === 0 && db.prepare("SELECT id FROM users WHERE id = 'u-director'").get()) {
  const insertAnnouncement = db.prepare(`
    INSERT INTO announcements (id, title, content, priority, target_group, event_date, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insertAnnouncement.run(
    'ann-1',
    'Mbledhja e Prindërve të Vjeshtës / Autumn Parent-Teacher Gathering',
    'Të nderuar prindër, ju ftojmë në takimin e parë të vjeshtës për të diskutuar progresin e fëmijëve dhe aktivitetet e planifikuara.\nDear parents, you are warmly invited to our Autumn gathering to discuss children’s learning milestones and upcoming events.',
    'important',
    'all',
    '2026-10-20',
    'u-director',
    new Date().toISOString(),
  )
  insertAnnouncement.run(
    'ann-2',
    'Dita e Frutave dhe Veshjes me Ngjyra / Colorful Fruit & Nature Day',
    'Këtë të premte kemi ditë speciale tematike! Çdo fëmijë mund të sjellë frutin e preferuar për sallatën e përbashkët të frutave.\nThis Friday is Colorful Fruit Day! Children can bring their favorite fresh fruit for our shared healthy fruit salad activity.',
    'normal',
    'Bletët / Bumblebees',
    '2026-10-16',
    'u-teacher',
    new Date().toISOString(),
  )
}

const pickupCount = db.prepare('SELECT COUNT(*) AS c FROM authorized_pickups').get() as { c: number }
if (pickupCount.c === 0 && db.prepare("SELECT id FROM children WHERE id = 'c-arta'").get()) {
  const insertPickup = db.prepare(`
    INSERT INTO authorized_pickups (id, child_id, name, relationship, phone, is_emergency, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  insertPickup.run('pick-1', 'c-arta', 'Flora Krasniqi', 'Gjyshja / Grandmother', '+383 44 222 333', 1, new Date().toISOString())
  insertPickup.run('pick-2', 'c-arta', 'Valon Krasniqi', 'Daja / Uncle', '+383 49 111 222', 0, new Date().toISOString())

  const today = new Date().toISOString().slice(0, 10)
  db.prepare(`
    INSERT INTO pickup_logs (id, child_id, log_date, log_time, action, guardian_name, staff_user_id, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('log-1', 'c-arta', today, '08:20', 'check_in', 'Elira Krasniqi (Nëna / Mother)', 'u-teacher', 'Arrived happily', new Date().toISOString())
}

const conversationCount = db.prepare('SELECT COUNT(*) AS c FROM conversations').get() as { c: number }
if (conversationCount.c === 0 && db.prepare("SELECT id FROM children WHERE id = 'c-arta'").get() && db.prepare("SELECT id FROM users WHERE id = 'u-parent'").get()) {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO conversations (id, child_id, parent_user_id, subject, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('conv-1', 'c-arta', 'u-parent', 'Shishe uji & Veshje rezervë / Water bottle & Spare clothes', now, now)

  const insertMsg = db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_user_id, sender_name, sender_role, content, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insertMsg.run(
    'msg-1',
    'conv-1',
    'u-parent',
    'Elira Krasniqi',
    'parent',
    'Përshëndetje mësuese Mira, Arta ka harruar shishen e saj të ujit në veturë sot. A ka ujë të freskët në klasë?\nHello teacher Mira, Arta forgot her water bottle in the car today. Are cups available in class?',
    now,
    now,
  )
  insertMsg.run(
    'msg-2',
    'conv-1',
    'u-teacher',
    'Mira Hoxha',
    'teacher',
    'Përshëndetje Elira! Mos u shqetësoni aspak, kemi gota dhe shishe rezervë të sterilizuara. Ajo po luan me shoqet e saj! 😊\nHello Elira! Don’t worry at all, we have sanitized spare cups and fresh water. She is happily playing with friends! 😊',
    null,
    now,
  )
}
