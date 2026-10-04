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
const invoiceColumns = db.prepare('PRAGMA table_info(invoices)').all() as { name: string }[]
if (!invoiceColumns.some((column) => column.name === 'payment_method')) {
  db.exec("ALTER TABLE invoices ADD COLUMN payment_method TEXT DEFAULT ''")
}
if (!invoiceColumns.some((column) => column.name === 'transaction_ref')) {
  db.exec("ALTER TABLE invoices ADD COLUMN transaction_ref TEXT DEFAULT ''")
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
  CREATE INDEX IF NOT EXISTS messages_conversation_created ON messages(conversation_id, created_at ASC);
  CREATE TABLE IF NOT EXISTS absence_notices (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    parent_user_id TEXT NOT NULL REFERENCES users(id),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    reason_type TEXT NOT NULL CHECK(reason_type IN ('sick', 'vacation', 'appointment', 'other')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS absence_notices_child ON absence_notices(child_id, start_date, end_date);
  CREATE INDEX IF NOT EXISTS absence_notices_dates ON absence_notices(start_date, end_date);
  CREATE TABLE IF NOT EXISTS weekly_meals (
    id TEXT PRIMARY KEY,
    day_of_week TEXT NOT NULL CHECK(day_of_week IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday')),
    breakfast TEXT NOT NULL,
    morning_snack TEXT NOT NULL,
    lunch TEXT NOT NULL,
    afternoon_snack TEXT NOT NULL,
    allergens TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL REFERENCES users(id),
    updated_at TEXT NOT NULL,
    UNIQUE(day_of_week)
  );
  CREATE TABLE IF NOT EXISTS child_medical_profiles (
    child_id TEXT PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
    pediatrician_name TEXT NOT NULL DEFAULT '',
    pediatrician_phone TEXT NOT NULL DEFAULT '',
    blood_type TEXT NOT NULL DEFAULT '',
    chronic_conditions TEXT NOT NULL DEFAULT '',
    emergency_medications TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS incident_reports (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    reporter_id TEXT NOT NULL REFERENCES users(id),
    incident_date TEXT NOT NULL,
    incident_time TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('scrape', 'bump', 'bruise', 'cut', 'bite', 'fever', 'other')),
    location TEXT NOT NULL CHECK(location IN ('playground', 'classroom', 'cafeteria', 'nap_room', 'bathroom', 'other')),
    first_aid TEXT NOT NULL CHECK(first_aid IN ('ice_pack', 'cleaned_bandaged', 'temperature_taken', 'rest', 'doctor_called', 'none')),
    description TEXT NOT NULL,
    action_taken TEXT NOT NULL,
    parent_notified INTEGER NOT NULL DEFAULT 1 CHECK(parent_notified IN (0,1)),
    parent_acknowledged_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS incident_reports_child ON incident_reports(child_id, incident_date);
  CREATE INDEX IF NOT EXISTS incident_reports_date ON incident_reports(incident_date DESC);
  CREATE TABLE IF NOT EXISTS classroom_moments (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    group_name TEXT NOT NULL,
    learning_area TEXT NOT NULL CHECK(learning_area IN ('art', 'stem', 'motor', 'music', 'story', 'outdoor', 'other')),
    moment_date TEXT NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT,
    tagged_children TEXT NOT NULL DEFAULT '[]',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS classroom_moments_date ON classroom_moments(moment_date DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS classroom_moments_group ON classroom_moments(group_name);
  CREATE TABLE IF NOT EXISTS moment_reactions (
    id TEXT PRIMARY KEY,
    moment_id TEXT NOT NULL REFERENCES classroom_moments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    reaction_type TEXT NOT NULL DEFAULT 'heart' CHECK(reaction_type IN ('heart', 'star', 'clap')),
    created_at TEXT NOT NULL,
    UNIQUE(moment_id, user_id, reaction_type)
  );
  CREATE INDEX IF NOT EXISTS moment_reactions_moment ON moment_reactions(moment_id);
  CREATE TABLE IF NOT EXISTS kindergarten_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('celebration', 'field_trip', 'conference', 'holiday', 'workshop', 'other')),
    event_date TEXT NOT NULL,
    end_date TEXT,
    start_time TEXT,
    end_time TEXT,
    location TEXT NOT NULL,
    group_name TEXT NOT NULL DEFAULT 'all',
    requires_rsvp INTEGER NOT NULL DEFAULT 1 CHECK(requires_rsvp IN (0, 1)),
    requires_permission_slip INTEGER NOT NULL DEFAULT 0 CHECK(requires_permission_slip IN (0, 1)),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS kindergarten_events_date ON kindergarten_events(event_date ASC);
  CREATE INDEX IF NOT EXISTS kindergarten_events_group ON kindergarten_events(group_name);
  CREATE TABLE IF NOT EXISTS event_rsvps (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES kindergarten_events(id) ON DELETE CASCADE,
    parent_id TEXT NOT NULL REFERENCES users(id),
    child_id TEXT NOT NULL REFERENCES children(id),
    status TEXT NOT NULL CHECK(status IN ('attending', 'declined', 'tentative')),
    attending_adults INTEGER NOT NULL DEFAULT 1,
    permission_signed INTEGER NOT NULL DEFAULT 0 CHECK(permission_signed IN (0, 1)),
    notes TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(event_id, child_id)
  );
  CREATE INDEX IF NOT EXISTS event_rsvps_event ON event_rsvps(event_id);
  CREATE INDEX IF NOT EXISTS event_rsvps_child ON event_rsvps(child_id);`)

export type DbKindergartenEvent = {
  id: string
  title: string
  description: string
  event_type: 'celebration' | 'field_trip' | 'conference' | 'holiday' | 'workshop' | 'other'
  event_date: string
  end_date: string | null
  start_time: string | null
  end_time: string | null
  location: string
  group_name: string
  requires_rsvp: number
  requires_permission_slip: number
  created_by: string
  created_at: string
}

export type DbEventRsvp = {
  id: string
  event_id: string
  parent_id: string
  child_id: string
  status: 'attending' | 'declined' | 'tentative'
  attending_adults: number
  permission_signed: number
  notes: string | null
  updated_at: string
}

export type DbClassroomMoment = {
  id: string
  title: string
  group_name: string
  learning_area: string
  moment_date: string
  description: string
  image_url: string | null
  tagged_children: string
  created_by: string
  created_at: string
}

export type DbMomentReaction = {
  id: string
  moment_id: string
  user_id: string
  reaction_type: string
  created_at: string
}

export type DbMedicalProfile = {
  child_id: string
  pediatrician_name: string
  pediatrician_phone: string
  blood_type: string
  chronic_conditions: string
  emergency_medications: string
  notes: string
  updated_at: string
}

export type DbIncidentReport = {
  id: string
  child_id: string
  reporter_id: string
  incident_date: string
  incident_time: string
  type: string
  location: string
  first_aid: string
  description: string
  action_taken: string
  parent_notified: number
  parent_acknowledged_at: string | null
  created_at: string
}

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

const absenceCount = db.prepare('SELECT COUNT(*) AS c FROM absence_notices').get() as { c: number }
if (absenceCount.c === 0 && db.prepare("SELECT id FROM children WHERE id = 'c-luan'").get()) {
  db.prepare(`
    INSERT INTO absence_notices (id, child_id, parent_user_id, start_date, end_date, reason_type, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'abs-1',
    'c-luan',
    'u-parent',
    '2026-10-15',
    '2026-10-16',
    'appointment',
    'Kontrollë rutinë tek dentisti / Pediatric dental checkup',
    new Date().toISOString(),
  )
}

const mealCount = db.prepare('SELECT COUNT(*) AS c FROM weekly_meals').get() as { c: number }
if (mealCount.c === 0 && db.prepare("SELECT id FROM users WHERE id = 'u-director'").get()) {
  const insertMeal = db.prepare(`
    INSERT INTO weekly_meals (id, day_of_week, breakfast, morning_snack, lunch, afternoon_snack, allergens, notes, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()
  insertMeal.run(
    'meal-mon',
    'monday',
    'Qull tërshëre me mollë, mjaltë dhe kanellë / Oatmeal with fresh apples, honey & cinnamon',
    'Dardha dhe mandarina të freskëta / Fresh seasonal pears & mandarins',
    'Supë pule me perime fshati, fileto pule me pure patatesh dhe sallatë / Chicken vegetable soup, fillet with mashed potatoes & salad',
    'Biskota tërshëre shtëpie dhe qumësht / Homemade oat cookies & warm milk',
    'Lactose / Qumësht',
    'Menu e pasur me fibra dhe vitamina / Rich in fiber and vitamins',
    'u-director',
    now,
  )
  insertMeal.run(
    'meal-tue',
    'tuesday',
    'Vezë të ziera fshati, djathë i bardhë dhe bukë e thekur / Farm-fresh boiled eggs, cottage cheese & toast',
    'Mollë të kuqe dhe karota të prera / Crisp apples & baby carrot sticks',
    'Gjellë tradicionale me thjerrëza dhe perime, sallatë jeshile / Hearty lentil & vegetable stew with mixed green salad',
    'Keku me mollë dhe çaj mali / Homemade apple sponge cake & mountain tea',
    'Eggs / Vezë, Gluten',
    'Dita vegjetariane e thjerrëzave / Vegetarian protein day',
    'u-director',
    now,
  )
  insertMeal.run(
    'meal-wed',
    'wednesday',
    'Petulla të buta furre me reçel boronice / Baked wholewheat pancakes with blueberry jam',
    'Banane dhe feta portokalli / Sweet bananas & sliced oranges',
    'Supë kremoze kungulli, oriz me perime dhe qofte viçi furre / Creamy pumpkin soup, vegetable risotto & baked beef meatballs',
    'Jogurt natyral me fruta / Natural yogurt with fresh fruit',
    'Gluten, Lactose / Qumësht',
    'Përgatitur me përbërës organikë lokalë / Prepared with organic local produce',
    'u-director',
    now,
  )
  insertMeal.run(
    'meal-thu',
    'thursday',
    'Tost me bukë integrale, djathë dhe gjalpë / Whole-grain grilled toast with melted cheese & butter',
    'Shalqi ose pjepër sezonal / Fresh seasonal melon slices',
    'Fileto peshku furre me patate dhe brokoli në avull / Oven-baked fish fillet with steamed potatoes & broccoli',
    'Pudding shtëpie me qumësht dhe kakao / Homemade mild chocolate pudding & milk',
    'Fish / Peshk, Lactose / Qumësht',
    'Dita e peshkut dhe Omega-3 / Fish & Omega-3 day',
    'u-director',
    now,
  )
  insertMeal.run(
    'meal-fri',
    'friday',
    'Drithëra integrale me qumësht të ngrohtë dhe rrush të thatë / Whole-grain cereal flakes with warm milk & raisins',
    'Kivi dhe pjeshkë të lëngshme / Fresh kiwi & peach slices',
    'Makarona me salcë domatesh të freskëta dhe djathë parmixhan / Pasta with fresh tomato basil sauce & parmesan',
    'Keku me banane shtëpie / Freshly baked banana bread',
    'Gluten, Lactose / Qumësht',
    'Dita e lumtur e makaronave me perime / Happy pasta & veggie day',
    'u-director',
    now,
  )
}

const medCount = db.prepare('SELECT COUNT(*) AS c FROM child_medical_profiles').get() as { c: number }
if (medCount.c === 0 && db.prepare("SELECT id FROM children WHERE id = 'c-arta'").get()) {
  const insertMed = db.prepare(`
    INSERT INTO child_medical_profiles (child_id, pediatrician_name, pediatrician_phone, blood_type, chronic_conditions, emergency_medications, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()
  insertMed.run(
    'c-arta',
    'Dr. Valbona Kelmendi',
    '+383 44 112 233',
    'A+',
    'Lehtësisht e ndjeshme ndaj pluhurit / Mild dust sensitivity',
    'Ventolin inhaler (nëse nevojitet / as needed)',
    'Pediatre në QKUK Prishtinë. Kontrollë vjetore e rregullt.',
    now,
  )
  if (db.prepare("SELECT id FROM children WHERE id = 'c-luan'").get()) {
    insertMed.run(
      'c-luan',
      'Dr. Arben Gashi',
      '+383 49 556 677',
      'O+',
      'Nuk ka gjendje kronike / No chronic conditions',
      'Nuk ka medikamente emergjente / None',
      'Vaksinimi i plotë sipas kalendarit kombëtar',
      now,
    )
  }
}

const incCount = db.prepare('SELECT COUNT(*) AS c FROM incident_reports').get() as { c: number }
if (incCount.c === 0 && db.prepare("SELECT id FROM children WHERE id = 'c-arta'").get() && db.prepare("SELECT id FROM users WHERE id = 'u-teacher'").get()) {
  const insertInc = db.prepare(`
    INSERT INTO incident_reports (id, child_id, reporter_id, incident_date, incident_time, type, location, first_aid, description, action_taken, parent_notified, parent_acknowledged_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()
  const today = now.slice(0, 10)
  insertInc.run(
    'inc-seed-1',
    'c-arta',
    'u-teacher',
    today,
    '10:45',
    'scrape',
    'playground',
    'cleaned_bandaged',
    'U rrëzua gjatë vrapimit në bar dhe gërvishti lehtë gjurin e majtë / Tripped while running on grass and grazed left knee',
    'Plaga u pastrua me ujë steril, u dezinfektua me kujdes dhe u vendos një fashë zbavitëse me ngjyra. Arta u qetësua menjëherë dhe vazhdoi lojën / Cleaned with sterile wash, disinfected, applied a cheerful bandage. Child happily resumed playing.',
    1,
    null,
    now,
  )
}

const momentCount = db.prepare('SELECT COUNT(*) AS c FROM classroom_moments').get() as { c: number }
if (momentCount.c === 0 && db.prepare("SELECT id FROM users WHERE id = 'u-teacher'").get()) {
  const insertMoment = db.prepare(`
    INSERT INTO classroom_moments (id, title, group_name, learning_area, moment_date, description, image_url, tagged_children, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  insertMoment.run(
    'moment-art-1',
    'Piktura me gishta dhe përzierja e ngjyrave / Finger painting & color mixing 🎨',
    'all',
    'art',
    today,
    'Sot fëmijët eksploruan ngjyrat bazë dhe krijuan ylberin e tyre duke përzier të verdhën me të kaltrën për të zbuluar të gjelbrën! / Today children explored primary colors and mixed blue and yellow to create vibrant greens for our giant classroom rainbow.',
    null,
    JSON.stringify(['c-arta', 'c-luan']),
    'u-teacher',
    now,
  )

  insertMoment.run(
    'moment-outdoor-1',
    'Eksplorimi i gjetheve të vjeshtës në kopsht / Autumn nature walk & sensory discovery 🍂',
    'Bletët / Bumblebees',
    'outdoor',
    today,
    'Mblodhëm gjethe të thata me ngjyra të ndryshme në oborrin e kopshtit dhe mësuam për ndryshimin e stinëve! / We collected crisp colorful leaves in the kindergarten garden and learned how trees change during autumn.',
    null,
    JSON.stringify(['c-arta']),
    'u-teacher',
    now,
  )

  if (db.prepare("SELECT id FROM users WHERE id = 'u-parent'").get()) {
    db.prepare(`
      INSERT INTO moment_reactions (id, moment_id, user_id, reaction_type, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('rx-1', 'moment-art-1', 'u-parent', 'heart', now)
  }
}

const eventCount = db.prepare('SELECT COUNT(*) AS c FROM kindergarten_events').get() as { c: number }
if (eventCount.c === 0 && db.prepare("SELECT id FROM users WHERE id = 'u-director'").get()) {
  const insertEvent = db.prepare(`
    INSERT INTO kindergarten_events (id, title, description, event_type, event_date, end_date, start_time, end_time, location, group_name, requires_rsvp, requires_permission_slip, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()

  insertEvent.run(
    'event-farm-trip',
    'Ekskursion Edukativ në Fermën e Kafshëve / Educational Farm Field Trip 🐑',
    'Vizitë interaktive ku fëmijët do të ushqejnë qengjat, do të mësojnë për pemët frutore dhe do të shijojnë piknik në natyrë. / Interactive outdoor adventure where children meet farm animals and enjoy a guided nature picnic.',
    'field_trip',
    '2026-10-18',
    null,
    '09:00',
    '13:00',
    'Ferma Agroturistike & Parku Natyror',
    'all',
    1,
    1,
    'u-director',
    now,
  )

  insertEvent.run(
    'event-autumn-fest',
    'Festa e Vjeshtës & Panairi i Kopshtit / Autumn Harvest Family Celebration 🍂',
    'Muzikë festive, recitime, kostume me ngjyrat e vjeshtës dhe panair me punime artizanale nga të gjitha grupet! / Music performances, costume showcase, seasonal crafts exhibition and family gathering.',
    'celebration',
    '2026-10-25',
    null,
    '10:30',
    '12:30',
    'Oborri Qendror i Kopshtit / Main Playground',
    'all',
    1,
    0,
    'u-director',
    now,
  )

  if (db.prepare("SELECT id FROM users WHERE id = 'u-parent'").get() && db.prepare("SELECT id FROM children WHERE id = 'c-arta'").get()) {
    db.prepare(`
      INSERT INTO event_rsvps (id, event_id, parent_id, child_id, status, attending_adults, permission_signed, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'rsvp-1',
      'event-farm-trip',
      'u-parent',
      'c-arta',
      'attending',
      1,
      1,
      'Arta mezi po pret të shohë kafshët! / Excited to visit the farm!',
      now,
    )
  }
}
