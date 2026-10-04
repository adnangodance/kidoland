import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { euro } from '../../src/pilot-utils.js'

async function fixture(existing?: (db: Database.Database) => void) {
  const directory = await mkdtemp(path.join(tmpdir(), 'kidoland-pilot-'))
  const databasePath = path.join(directory, 'test.sqlite')
  if (existing) { const db = new Database(databasePath); existing(db); db.close() }
  let child: ChildProcess | undefined
  let base = ''
  async function start() {
    child = fork(fileURLToPath(new URL('./api-process.ts', import.meta.url)), [], { execArgv: ['--import', 'tsx'], env: { ...process.env, KIDOLAND_DB_PATH: databasePath }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    const processHandle = child
    base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('API startup timeout')), 15000)
      processHandle.once('message', (message) => { clearTimeout(timer); resolve(`http://127.0.0.1:${(message as { port: number }).port}`) })
      processHandle.once('error', reject)
      processHandle.once('exit', (code) => { clearTimeout(timer); reject(new Error(`API exited ${code}`)) })
      processHandle.stderr?.on('data', (data) => process.stderr.write(data))
    })
  }
  async function stop() { if (child && child.exitCode === null) await new Promise<void>((resolve) => { child!.once('exit', () => resolve()); child!.kill('SIGTERM') }); child = undefined }
  async function request(route: string, token?: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${base}/api/${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, data: await response.json() }
  }
  async function login(role: string) { const result = await request('auth/login', undefined, { email: `${role}@kidoland.demo`, password: `${role}123` }); assert.equal(result.status, 200); return result.data.token as string }
  return { start, stop, request, login, databasePath, dispose: async () => { await stop(); await rm(directory, { recursive: true, force: true }) } }
}

test('pilot API authorization, management, consent, reports, fees and durable retries', async (t) => {
  const f = await fixture()
  const { request } = f
  try {
    await f.start()
    const director = await f.login('director'), teacher = await f.login('teacher'), parent = await f.login('parent')
    const date = '2040-10-01'
    let familyId = '', familyToken = '', childId = '', invoiceId = ''
    const parentDraft = { name: 'New family', email: 'Family@example.test', password: 'initial-password' }
    await t.test('parent provisioning is director only, strict and hashed', async () => {
      for (const token of [undefined, parent, teacher]) {
        assert.equal((await request('parents', token)).status, token ? 403 : 401)
        assert.equal((await request('parents', token, parentDraft)).status, token ? 403 : 401)
      }
      for (const body of [{ ...parentDraft, role: 'director' }, { ...parentDraft, password: 'short' }, { ...parentDraft, password: 'é'.repeat(40) }, { ...parentDraft, name: ' ' }, { ...parentDraft, email: 'bad' }]) assert.equal((await request('parents', director, body)).status, 400)
      const result = await request('parents', director, parentDraft)
      assert.equal(result.status, 201); familyId = result.data.parent.id
      assert.equal(result.data.parent.role, 'parent'); assert.deepEqual(Object.keys(result.data.parent).sort(), ['email', 'id', 'name', 'role'])
      assert.equal((await request('parents', director, { ...parentDraft, email: 'FAMILY@EXAMPLE.TEST' })).status, 409)
      assert.ok((await request('parents', director)).data.parents.every((row: object) => !('password_hash' in row)))
      const db = new Database(f.databasePath); const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(familyId) as { password_hash: string }; db.close()
      assert.notEqual(row.password_hash, parentDraft.password); assert.ok(bcrypt.compareSync(parentDraft.password, row.password_hash))
      familyToken = (await request('auth/login', undefined, { email: 'FAMILY@example.test', password: parentDraft.password })).data.token
    })
    await t.test('child validation, creation, edits and ownership', async () => {
      const draft = { name: 'New Child', groupName: 'Group A', parentUserId: familyId }
      for (const token of [undefined, parent, teacher]) assert.equal((await request('children', token, draft)).status, token ? 403 : 401)
      for (const body of [{ ...draft, name: ' ' }, { ...draft, groupName: '' }, { ...draft, parentUserId: 'missing' }, { ...draft, parentUserId: 'u-teacher' }, { ...draft, photoConsent: true }]) assert.equal((await request('children', director, body)).status, 400)
      const result = await request('children', director, draft); assert.equal(result.status, 201); childId = result.data.child.id; assert.equal(result.data.child.photoConsent, false)
      assert.equal((await request(`children/${childId}`, teacher, draft, 'PATCH')).status, 403)
      assert.equal((await request(`children/${childId}`, parent, draft, 'PATCH')).status, 403)
      assert.equal((await request('children/missing', director, draft, 'PATCH')).status, 404)
      assert.equal((await request(`children/${childId}`, director, { ...draft, name: 'Edited Child' }, 'PATCH')).data.child.name, 'Edited Child')
      assert.deepEqual((await request('children', familyToken)).data.children.map((row: { id: string }) => row.id), [childId])
      assert.ok(!(await request('children', parent)).data.children.some((row: { id: string }) => row.id === childId))
    })
    await t.test('own parent strict boolean consent and parent transfer reset', async () => {
      for (const token of [undefined, parent, teacher, director]) assert.equal((await request(`children/${childId}/consent`, token, { photoConsent: true }, 'PATCH')).status, token ? 403 : 401)
      for (const body of [{ photoConsent: 1 }, { photoConsent: 'true' }, {}, { photoConsent: true, extra: 1 }]) assert.equal((await request(`children/${childId}/consent`, familyToken, body, 'PATCH')).status, 400)
      assert.equal((await request(`children/${childId}/consent`, familyToken, { photoConsent: true }, 'PATCH')).data.child.photoConsent, true)
      assert.equal((await request('children', teacher)).data.children.find((row: { id: string }) => row.id === childId).photoConsent, true)
      const draft = { name: 'Edited Child', groupName: 'Group B', parentUserId: familyId }
      assert.equal((await request(`children/${childId}`, director, draft, 'PATCH')).data.child.photoConsent, true)
      assert.equal((await request(`children/${childId}`, director, { ...draft, parentUserId: 'u-parent' }, 'PATCH')).data.child.photoConsent, false)
      assert.equal((await request(`children/${childId}/consent`, familyToken, { photoConsent: true }, 'PATCH')).status, 403)
      await request(`children/${childId}`, director, draft, 'PATCH')
    })
    await t.test('real report date, optional notes, correction uniqueness and parent isolation', async () => {
      const body = { childId, reportDate: date, mood: 'mood:happy', meals: 'meals:all', nap: 'nap:short', activities: 'activity:art|activity:stories' }
      assert.equal((await request('reports', parent, body)).status, 403)
      for (const invalid of [{ ...body, reportDate: '2026-02-29' }, { ...body, mood: ' ' }, { ...body, extra: true }]) assert.equal((await request('reports', teacher, invalid)).status, 400)
      assert.equal((await request('reports', teacher, { ...body, childId: 'missing' })).status, 404)
      const saved = await request('reports', teacher, body); assert.equal(saved.status, 201); assert.equal(saved.data.report.note, '')
      const correction = await request('reports', director, { ...body, mood: 'mood:calm', note: 'Correction' }); assert.equal(correction.data.report.id, saved.data.report.id)
      assert.equal((await request(`reports?childId=${childId}&date=${date}`, familyToken)).data.reports.length, 1)
      assert.equal((await request(`reports?childId=${childId}&date=${date}`, parent)).data.reports.length, 0)
      assert.equal((await request('reports?date=2026-04-31', teacher)).status, 400)
      await request('attendance', teacher, { childId, attendanceDate: date, status: 'present' })
      assert.equal((await request(`attendance?date=${date}`, familyToken)).data.attendance[0].childId, childId)
    })
    await t.test('report image upload, persistence, correction and parent access', async () => {
      const sampleImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      const body = { childId, reportDate: date, mood: 'mood:happy', meals: 'meals:all', nap: 'nap:short', activities: 'activity:art', note: 'With photo', imageUrl: sampleImage }
      const res = await request('reports', teacher, body)
      assert.equal(res.status, 201)
      assert.equal(res.data.report.imageUrl, sampleImage)
      const list = await request(`reports?childId=${childId}&date=${date}`, familyToken)
      assert.equal(list.data.reports[0].imageUrl, sampleImage)
      const updated = await request('reports', teacher, { ...body, imageUrl: '' })
      assert.equal(updated.status, 201)
      assert.equal(updated.data.report.imageUrl, null)
      const rechecked = await request(`reports?childId=${childId}&date=${date}`, familyToken)
      assert.equal(rechecked.data.reports[0].imageUrl, null)
      const hugeImage = 'data:image/png;base64,' + 'A'.repeat(8_000_001)
      assert.equal((await request('reports', teacher, { ...body, imageUrl: hugeImage })).status, 400)
    })
    const invoice = { childId, requestId: randomUUID(), periodLabel: 'October', dueDate: date, items: [{ description: 'Tuition', amountCents: 12345 }, { description: 'Meals', amountCents: 678 }] }
    await t.test('item sums, validation, create roles, parent isolation and mark paid', async () => {
      assert.equal((await request('invoices', parent, invoice)).status, 403)
      for (const invalid of [{ ...invoice, currency: 'USD' }, { ...invoice, dueDate: '2026-04-31' }, { ...invoice, items: [] }, ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((amountCents) => ({ ...invoice, items: [{ description: 'Fee', amountCents }] })), { ...invoice, items: [{ description: ' ', amountCents: 10 }] }, { ...invoice, items: [{ description: 'Fee', amountCents: Number.MAX_SAFE_INTEGER }, { description: 'Fee', amountCents: 1 }] }]) assert.equal((await request('invoices', teacher, invalid)).status, 400)
      const result = await request('invoices', teacher, invoice); assert.equal(result.status, 201); invoiceId = result.data.invoice.id
      assert.equal(result.data.invoice.amountCents, 13023); assert.deepEqual(result.data.invoice.items.map((row: { amountCents: number }) => row.amountCents), [12345, 678])
      assert.ok((await request('invoices', familyToken)).data.invoices.some((row: { id: string }) => row.id === invoiceId))
      assert.ok(!(await request('invoices', parent)).data.invoices.some((row: { id: string }) => row.id === invoiceId))
      for (const token of [undefined, teacher, parent, familyToken]) assert.equal((await request(`invoices/${invoiceId}/paid`, token, undefined, 'PATCH')).status, token ? 403 : 401)
      const paid = (await request(`invoices/${invoiceId}/paid`, director, undefined, 'PATCH')).data.invoice
      const repeated = (await request(`invoices/${invoiceId}/paid`, director, undefined, 'PATCH')).data.invoice
      assert.equal(paid.status, 'paid'); assert.deepEqual(repeated, paid); assert.deepEqual(paid.items, result.data.invoice.items)
    })
    await t.test('durable user scoped invoice retry and changed payload conflict after restart', async () => {
      await f.stop(); await f.start()
      assert.equal((await request('invoices', teacher, invoice)).data.invoice.id, invoiceId)
      assert.equal((await request('invoices', teacher, { ...invoice, periodLabel: 'Changed' })).status, 409)
      const otherUser = await request('invoices', director, invoice); assert.equal(otherUser.status, 201); assert.notEqual(otherUser.data.invoice.id, invoiceId)
    })
    await t.test('atomic rollback on failed line insertion', async () => {
      await f.stop(); const db = new Database(f.databasePath)
      const before = db.prepare('SELECT COUNT(*) AS n FROM invoices').get()
      db.exec("CREATE TRIGGER fail_item BEFORE INSERT ON invoice_items BEGIN SELECT RAISE(FAIL, 'test-failure'); END"); db.close(); await f.start()
      assert.equal((await request('invoices', teacher, { ...invoice, requestId: randomUUID() })).status, 500)
      await f.stop(); const check = new Database(f.databasePath); assert.deepEqual(check.prepare('SELECT COUNT(*) AS n FROM invoices').get(), before); check.exec('DROP TRIGGER fail_item'); check.close(); await f.start()
    })
    await t.test('uncapped school/family dashboard and selected-child correction beyond history cap', async () => {
      await f.stop(); const db = new Database(f.databasePath)
      db.transaction(() => { for (let i = 0; i < 105; i++) {
        const id = `bulk-${i}`; db.prepare('INSERT INTO children (id,name,group_name,parent_user_id) VALUES (?,?,?,?)').run(id, id, 'Bulk', 'u-parent')
        db.prepare('INSERT INTO reports VALUES (?,?,?,?,?,?,?,?,?,?)').run(`r-${id}`, id, 'u-teacher', date, 'legacy text', 'all', 'none', 'play', '', date)
        db.prepare('INSERT INTO invoices (id,child_id,amount_cents,currency,period_label,status,due_date,created_by,created_at) VALUES (?,?,100,\'EUR\',\'Bulk\',\'pending\',?,\'u-director\',?)').run(`i-${id}`, id, date, date)
      } })(); db.close(); await f.start()
      const summary = (await request(`dashboard?date=${date}`, teacher)).data.summary
      assert.equal(summary.children, 108); assert.equal(summary.reports, 106); assert.equal(summary.unpaidInvoices, 108); assert.deepEqual(summary.unpaidBalances, [{ currency: 'EUR', amountCents: '59523' }])
      assert.equal(summary.present + summary.absent + summary.unmarked, summary.children)
      assert.equal((await request('reports', teacher)).data.reports.length, 50)
      assert.equal((await request(`reports?date=${date}&childId=bulk-99`, teacher)).data.reports[0].mood, 'legacy text')
      const own = (await request(`dashboard?date=${date}`, familyToken)).data.summary
      assert.equal(own.children, 1); assert.equal(own.reports, 1); assert.equal(own.present, 1); assert.equal(own.unpaidInvoices, 1); assert.deepEqual(own.unpaidBalances, [{ currency: 'EUR', amountCents: '13023' }]); assert.equal(own.childSummaries[0].id, childId)
      assert.equal((await request('dashboard?date=2026-04-31', teacher)).status, 400)
    })
    await t.test('JWT fields cannot elevate roles, deleted accounts are rejected', async () => {
      const forgedClaims = jwt.sign({ sub: 'u-parent', role: 'director' }, process.env.JWT_SECRET || 'kidoland-dev-secret-change-me')
      assert.equal((await request('parents', forgedClaims)).status, 403)
      const missing = jwt.sign({ sub: 'missing', role: 'director' }, process.env.JWT_SECRET || 'kidoland-dev-secret-change-me')
      assert.equal((await request('children', missing)).status, 401)
    })
  } finally { await f.dispose() }
})

test('legacy migration preserves identifiers, totals and paid state and is idempotent', async () => {
  const f = await fixture()
  try {
    await f.start(); const token = await f.login('director'); const before = (await f.request('invoices', token)).data.invoices
    await f.stop(); const db = new Database(f.databasePath)
    db.exec('DROP TABLE invoice_requests; DROP TABLE invoice_items; ALTER TABLE children DROP COLUMN photo_consent'); db.close()
    await f.start()
    const first = (await f.request('invoices', token)).data.invoices
    assert.deepEqual(first, before)
    assert.ok(first.every((row: { amountCents: number; items: { amountCents: number }[] }) => row.items.length === 1 && row.items[0].amountCents === row.amountCents))
    await f.stop(); await f.start(); assert.deepEqual((await f.request('invoices', token)).data.invoices, first)
    const paid = first.find((row: { status: string }) => row.status === 'paid')
    assert.deepEqual((await f.request(`invoices/${paid.id}/paid`, token, undefined, 'PATCH')).data.invoice, paid)
  } finally { await f.dispose() }
})

test('partial pre-pilot database seeds no dangling demo references', async () => {
  const f = await fixture((db) => {
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL)")
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('real-user', 'Real parent', 'real@example.test', bcrypt.hashSync('initial-password', 4), 'parent')
  })
  try {
    await f.start(); await f.stop()
    const db = new Database(f.databasePath)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 1)
    for (const table of ['children', 'reports', 'invoices']) assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); db.close()
    await f.start()
  } finally { await f.dispose() }
})


test('review regressions: exact currency balances, uncapped pending invoices and durable child retries', async () => {
  const f = await fixture()
  try {
    await f.start()
    const director = await f.login('director'), parent = await f.login('parent')
    const childDraft = { name: 'Retry child', groupName: 'Retry group', parentUserId: 'u-parent', requestId: randomUUID() }
    const first = await f.request('children', director, childDraft)
    assert.equal(first.status, 201)
    await f.stop(); await f.start()
    const replay = await f.request('children', director, childDraft)
    assert.deepEqual(replay.data.child, first.data.child)
    assert.equal((await f.request('children', director, { ...childDraft, name: 'Changed' })).status, 409)
    assert.equal((await f.request('children', director)).data.children.filter((child: { name: string }) => child.name === 'Retry child').length, 1)
    await f.stop()
    const db = new Database(f.databasePath)
    db.prepare("UPDATE invoices SET due_date = '1999-01-01' WHERE id = 'inv-arta-oct'").run()
    db.transaction(() => {
      const insert = db.prepare("INSERT INTO invoices (id,child_id,amount_cents,currency,period_label,status,due_date,created_by,created_at) VALUES (?,'c-arta',?,?,?,?,'2040-01-01','u-director','2040-01-01')")
      for (let index = 0; index < 1100; index++) insert.run(`boundary-${index}`, Number.MAX_SAFE_INTEGER, 'EUR', 'Boundary', 'pending')
      insert.run('legacy-usd', 12345, 'USD', 'Legacy USD', 'pending')
      insert.run('legacy-invalid', 45678, 'EURO', 'Legacy currency', 'pending')
      for (let index = 0; index < 105; index++) insert.run(`paid-${index}`, 100, 'EUR', 'Paid history', 'paid')
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('second-director', 'Second director', 'second-director@example.test', bcrypt.hashSync('initial-password', 4), 'director')
    })()
    db.close(); await f.start()
    const summary = (await f.request('dashboard?date=2040-01-01', parent)).data.summary
    assert.deepEqual(summary.unpaidBalances, [
      { currency: 'EUR', amountCents: (BigInt(Number.MAX_SAFE_INTEGER) * 1100n + 36000n).toString() },
      { currency: 'EURO', amountCents: '45678' }, { currency: 'USD', amountCents: '12345' },
    ])
    const invoices = (await f.request('invoices', director)).data.invoices
    assert.equal(invoices.filter((invoice: { status: string }) => invoice.status === 'pending').length, 1104)
    assert.equal(invoices.filter((invoice: { status: string }) => invoice.status === 'paid').length, 100)
    assert.ok(invoices.some((invoice: { id: string }) => invoice.id === 'inv-arta-oct'))
    assert.equal((await f.request('invoices/inv-arta-oct/paid', director, undefined, 'PATCH')).data.invoice.status, 'paid')
    const second = jwt.sign({ sub: 'second-director', role: 'director' }, process.env.JWT_SECRET || 'kidoland-dev-secret-change-me')
    const secondChild = await f.request('children', second, childDraft)
    assert.equal(secondChild.status, 201); assert.notEqual(secondChild.data.child.id, first.data.child.id)
    for (const lang of ['en', 'sq']) {
      const max = euro(Number.MAX_SAFE_INTEGER, lang)
      assert.ok(max.endsWith(lang === 'en' ? '.91' : '€') || max.includes(',91'), max)
      assert.equal(euro('9007199254740991', lang), max)
      const expected = lang === 'en' ? '90,071,992,547,409.91 EURO' : '90\u00a0071\u00a0992\u00a0547\u00a0409,91 EURO'
      assert.equal(euro('9007199254740991', lang, 'EURO'), expected)
    }
  } finally { await f.dispose() }
})

test('daily programs API: authorization, group isolation, and validation', async () => {
  const f = await fixture()
  const { request } = f
  try {
    await f.start()
    const director = await f.login('director')
    const teacher = await f.login('teacher')
    const parent = await f.login('parent')

    const date = '2040-10-15'
    const programDraft = {
      groupName: 'Bletët / Bumblebees',
      programDate: date,
      theme: 'Space & Stars',
      activities: '09:00 Circle time\n10:00 Rocket craft\n11:00 Garden play',
      mealsMenu: 'Breakfast: Porridge\nLunch: Soup\nSnack: Apple',
      notes: 'Wear comfortable shoes',
    }

    // Unauthorized
    assert.equal((await request('programs')).status, 401)
    assert.equal((await request('programs', undefined, programDraft)).status, 401)

    // Parent cannot post program
    assert.equal((await request('programs', parent, programDraft)).status, 403)

    // Validation failures
    assert.equal((await request('programs', teacher, { ...programDraft, programDate: 'invalid-date' })).status, 400)
    assert.equal((await request('programs', teacher, { ...programDraft, theme: '' })).status, 400)
    assert.equal((await request('programs', teacher, { ...programDraft, groupName: '' })).status, 400)

    // Teacher can post program
    const created = await request('programs', teacher, programDraft)
    assert.equal(created.status, 201)
    assert.equal(created.data.program.theme, 'Space & Stars')
    assert.equal(created.data.program.groupName, 'Bletët / Bumblebees')

    // Teacher can update existing program (UPSERT)
    const updated = await request('programs', teacher, { ...programDraft, theme: 'Space & Planets Updated' })
    assert.equal(updated.status, 201)
    assert.equal(updated.data.program.theme, 'Space & Planets Updated')

    // Parent sees program for their linked child's group
    const parentGet = await request(`programs?date=${date}`, parent)
    assert.equal(parentGet.status, 200)
    assert.equal(parentGet.data.programs.length, 1)
    assert.equal(parentGet.data.programs[0].theme, 'Space & Planets Updated')

    // Parent querying an unlinked group returns empty
    const unlinkedGet = await request(`programs?date=${date}&groupName=UnlinkedGroup`, parent)
    assert.equal(unlinkedGet.status, 200)
    assert.equal(unlinkedGet.data.programs.length, 0)

    // Director can also GET and POST
    const dirGet = await request(`programs?date=${date}`, director)
    assert.equal(dirGet.status, 200)
    assert.equal(dirGet.data.programs.length, 1)

    const dirCreate = await request('programs', director, {
      ...programDraft,
      groupName: 'Fluturat / Butterflies',
      theme: 'Spring & Butterflies',
    })
    assert.equal(dirCreate.status, 201)
    assert.equal(dirCreate.data.program.groupName, 'Fluturat / Butterflies')
  } finally {
    await f.dispose()
  }
})

test('batch reports API and child allergies persistence', async () => {
  const f = await fixture()
  const { request } = f
  try {
    await f.start()
    const director = await f.login('director')
    const teacher = await f.login('teacher')
    const parent = await f.login('parent')

    const date = '2040-10-16'

    // Unauthorized
    assert.equal((await request('reports/batch', undefined, { childIds: ['c-arta'], reportDate: date, mood: 'happy', meals: 'all', nap: '1h', activities: 'paint' })).status, 401)

    // Parent cannot batch report
    assert.equal((await request('reports/batch', parent, { childIds: ['c-arta'], reportDate: date, mood: 'happy', meals: 'all', nap: '1h', activities: 'paint' })).status, 403)

    // Validation: empty childIds or invalid date
    assert.equal((await request('reports/batch', teacher, { childIds: [], reportDate: date, mood: 'happy', meals: 'all', nap: '1h', activities: 'paint' })).status, 400)
    assert.equal((await request('reports/batch', teacher, { childIds: ['c-arta'], reportDate: 'bad-date', mood: 'happy', meals: 'all', nap: '1h', activities: 'paint' })).status, 400)

    // Teacher saves batch reports for both children in group
    const batchRes = await request('reports/batch', teacher, {
      childIds: ['c-arta', 'c-luan'],
      reportDate: date,
      mood: 'Happy & playful',
      meals: 'Breakfast ✓ · Lunch ✓ · Snack ✓',
      nap: '1h 20m',
      activities: 'Outdoor play, painting, story time',
      note: 'Great day together!',
    })
    assert.equal(batchRes.status, 201)
    assert.equal(batchRes.data.count, 2)

    // Verify reports persisted and reflect in GET /api/reports
    const artaReports = await request(`reports?childId=c-arta&date=${date}`, parent)
    assert.equal(artaReports.status, 200)
    assert.equal(artaReports.data.reports.length, 1)
    assert.equal(artaReports.data.reports[0].note, 'Great day together!')
    assert.equal(artaReports.data.reports[0].allergies, 'Alergji në kikirik / Peanut allergy')

    // Director edits child allergies
    const patchRes = await request('children/c-luan', director, {
      name: 'Luan Gashi',
      groupName: 'Bletët / Bumblebees',
      parentUserId: 'u-parent',
      allergies: 'Alergji në qumësht / Milk allergy',
    }, 'PATCH')
    assert.equal(patchRes.status, 200)
    assert.equal(patchRes.data.child.allergies, 'Alergji në qumësht / Milk allergy')

    // Dashboard summary reflects allergies
    const dash = await request(`dashboard?date=${date}`, parent)
    assert.equal(dash.status, 200)
    const luanSummary = dash.data.summary.childSummaries.find((c: any) => c.id === 'c-luan')
    assert.equal(luanSummary.allergies, 'Alergji në qumësht / Milk allergy')
  } finally {
    await f.dispose()
  }
})

test('announcements API: authorization, targeting, creation, and deletion', async () => {
  const f = await fixture()
  const { request } = f
  try {
    await f.start()
    const director = await f.login('director')
    const teacher = await f.login('teacher')
    const parent = await f.login('parent')

    // Unauthorized
    assert.equal((await request('announcements')).status, 401)
    assert.equal((await request('announcements', undefined, { title: 'Test', content: 'Test' })).status, 401)

    // Parent cannot create announcement
    assert.equal((await request('announcements', parent, { title: 'Parent Post', content: 'Hello' })).status, 403)

    // Teacher creates school-wide announcement
    const createRes = await request('announcements', teacher, {
      title: 'Field Trip to the Zoo',
      content: 'Please arrive by 08:30 with backpack and water bottle.',
      priority: 'important',
      targetGroup: 'all',
      eventDate: '2040-10-25',
    })
    assert.equal(createRes.status, 201)
    const tripId = createRes.data.announcement.id
    assert.equal(createRes.data.announcement.title, 'Field Trip to the Zoo')
    assert.equal(createRes.data.announcement.priority, 'important')

    // Director creates urgent alert for a specific group
    const urgentRes = await request('announcements', director, {
      title: 'Water play clothes needed',
      content: 'Bring change of clothes tomorrow.',
      priority: 'urgent',
      targetGroup: 'Bletët / Bumblebees',
    })
    assert.equal(urgentRes.status, 201)
    const urgentId = urgentRes.data.announcement.id

    // Director creates notice for an unlinked group
    const unlinkedRes = await request('announcements', director, {
      title: 'Butterflies only',
      content: 'Notice for unlinked group.',
      priority: 'normal',
      targetGroup: 'Fluturat / Butterflies',
    })
    assert.equal(unlinkedRes.status, 201)
    const unlinkedId = unlinkedRes.data.announcement.id

    // Parent queries announcements:
    // Should see 'all' and 'Bletët / Bumblebees', but NOT 'Fluturat / Butterflies'
    const parentList = await request('announcements', parent)
    assert.equal(parentList.status, 200)
    const titles = parentList.data.announcements.map((a: any) => a.title)
    assert(titles.includes('Field Trip to the Zoo'))
    assert(titles.includes('Water play clothes needed'))
    assert(!titles.includes('Butterflies only'))
    // Priority order: urgent first
    assert.equal(parentList.data.announcements[0].priority, 'urgent')

    // Parent cannot delete
    assert.equal((await request(`announcements/${tripId}`, parent, undefined, 'DELETE')).status, 403)

    // Teacher can delete own announcement
    assert.equal((await request(`announcements/${tripId}`, teacher, undefined, 'DELETE')).status, 200)

    // Teacher cannot delete director's announcement
    assert.equal((await request(`announcements/${urgentId}`, teacher, undefined, 'DELETE')).status, 403)

    // Director can delete any announcement
    assert.equal((await request(`announcements/${urgentId}`, director, undefined, 'DELETE')).status, 200)
    assert.equal((await request(`announcements/${unlinkedId}`, director, undefined, 'DELETE')).status, 200)
  } finally {
    await f.dispose()
  }
})

test('authorized pickups and pickup logs API: permissions, validation, and operations', async () => {
  const f = await fixture()
  const { request } = f
  try {
    await f.start()
    const director = await f.login('director')
    const teacher = await f.login('teacher')
    const parent = await f.login('parent')

    const date = '2040-10-18'

    // Unauthorized
    assert.equal((await request('children/c-arta/pickups')).status, 401)
    assert.equal((await request('children/c-arta/pickup-logs')).status, 401)

    // Parent can read seeded pickups for linked child
    const parentPickups = await request('children/c-arta/pickups', parent)
    assert.equal(parentPickups.status, 200)
    assert.equal(parentPickups.data.pickups.length, 2)
    assert.equal(parentPickups.data.pickups[0].name, 'Flora Krasniqi')
    assert.equal(parentPickups.data.pickups[0].isEmergency, true)

    // Parent cannot access pickups for a non-existent or unlinked child
    assert.equal((await request('children/non-existent/pickups', parent)).status, 404)

    // Parent adds authorized person for own child
    const addRes = await request('children/c-arta/pickups', parent, {
      name: 'Besnik Gashi',
      relationship: 'Kujdestar / Babysitter',
      phone: '+383 49 999 888',
      isEmergency: false,
    })
    assert.equal(addRes.status, 201)
    const newPickupId = addRes.data.pickup.id
    assert.equal(addRes.data.pickup.name, 'Besnik Gashi')

    // Director can also read pickups
    const directorPickups = await request('children/c-arta/pickups', director)
    assert.equal(directorPickups.status, 200)

    // Teacher cannot add pickup person (only parent or director)
    assert.equal((await request('children/c-arta/pickups', teacher, {
      name: 'Illegal Add',
      relationship: 'Friend',
      phone: '123',
    })).status, 403)

    // Parent cannot log check-in/out (staff only)
    assert.equal((await request('children/c-arta/pickup-logs', parent, {
      logDate: date,
      logTime: '08:15',
      action: 'check_in',
      guardianName: 'Flora Krasniqi',
    })).status, 403)

    // Teacher logs check_in
    const checkInRes = await request('children/c-arta/pickup-logs', teacher, {
      logDate: date,
      logTime: '08:30',
      action: 'check_in',
      guardianName: 'Flora Krasniqi (Gjyshja)',
      notes: 'Morning drop-off with bag',
    })
    assert.equal(checkInRes.status, 201)
    assert.equal(checkInRes.data.log.action, 'check_in')
    assert.equal(checkInRes.data.log.guardianName, 'Flora Krasniqi (Gjyshja)')

    // Teacher logs check_out
    const checkOutRes = await request('children/c-arta/pickup-logs', teacher, {
      logDate: date,
      logTime: '16:15',
      action: 'check_out',
      guardianName: 'Elira Krasniqi (Nëna)',
      notes: 'Collected with artwork',
    })
    assert.equal(checkOutRes.status, 201)
    assert.equal(checkOutRes.data.log.action, 'check_out')

    // Parent can read own child logs for that date
    const logsRes = await request(`children/c-arta/pickup-logs?date=${date}`, parent)
    assert.equal(logsRes.status, 200)
    assert.equal(logsRes.data.logs.length, 2)
    assert.equal(logsRes.data.logs[0].action, 'check_out')
    assert.equal(logsRes.data.logs[1].action, 'check_in')

    // Parent deletes authorized person
    assert.equal((await request(`children/c-arta/pickups/${newPickupId}`, parent, undefined, 'DELETE')).status, 200)
  } finally {
    await f.dispose()
  }
})

test('conversations and direct messaging API: permissions, validation, and threaded exchange', async () => {
  const f = await fixture()
  const { request } = f
  try {
    await f.start()
    const parent = await f.login('parent')
    const teacher = await f.login('teacher')

    // Unauthorized
    assert.equal((await request('conversations')).status, 401)
    assert.equal((await request('conversations/conv-1/messages')).status, 401)

    // Parent lists seeded conversations
    const listRes = await request('conversations', parent)
    assert.equal(listRes.status, 200)
    assert.equal(listRes.data.conversations.length, 1)
    assert.equal(listRes.data.conversations[0].childName, 'Arta Krasniqi')
    assert.equal(listRes.data.conversations[0].unreadCount, 1)

    // Teacher also lists conversations
    const teacherList = await request('conversations', teacher)
    assert.equal(teacherList.status, 200)
    assert.equal(teacherList.data.conversations.length, 1)

    // Parent reads messages -> marks as read
    const readRes = await request('conversations/conv-1/messages', parent)
    assert.equal(readRes.status, 200)
    assert.equal(readRes.data.messages.length, 2)
    assert.equal(readRes.data.messages[0].senderRole, 'parent')
    assert.equal(readRes.data.messages[1].senderRole, 'teacher')

    // Unread count now 0 for parent
    const listResAfterRead = await request('conversations', parent)
    assert.equal(listResAfterRead.data.conversations[0].unreadCount, 0)

    // Parent cannot create conversation for a non-existent child
    assert.equal((await request('conversations', parent, {
      childId: 'non-existent',
      subject: 'Test',
      message: 'Hello',
    })).status, 404)

    // Parent creates a new conversation
    const newConvRes = await request('conversations', parent, {
      childId: 'c-arta',
      subject: 'Pyetje për ushqimin / Meal question',
      message: 'A hëngri Arta të gjithë supën sot? / Did Arta eat all her soup today?',
    })
    assert.equal(newConvRes.status, 201)
    const newConvId = newConvRes.data.conversation.id
    assert.equal(newConvRes.data.conversation.subject, 'Pyetje për ushqimin / Meal question')

    // Teacher sends a reply
    const replyRes = await request(`conversations/${newConvId}/messages`, teacher, {
      content: 'Po, hëngri shumë mirë dhe kërkoi edhe pak fruta! / Yes, she ate very well and asked for extra fruit!',
    })
    assert.equal(replyRes.status, 201)
    assert.equal(replyRes.data.message.senderRole, 'teacher')

    // Verify messages in new conversation
    const threadRes = await request(`conversations/${newConvId}/messages`, parent)
    assert.equal(threadRes.status, 200)
    assert.equal(threadRes.data.messages.length, 2)
    assert.equal(threadRes.data.messages[1].content, 'Po, hëngri shumë mirë dhe kërkoi edhe pak fruta! / Yes, she ate very well and asked for extra fruit!')
  } finally {
    await f.dispose()
  }
})

test('online payment and official invoice receipt API: parent payment, validation, and receipt generation', async () => {
  const f = await fixture()
  const { request } = f
  try {
    await f.start()
    const parent = await f.login('parent')
    const director = await f.login('director')

    // Director creates an invoice for c-arta
    const invRes = await request('invoices', director, {
      childId: 'c-arta',
      periodLabel: 'Nëntor 2026 / November 2026',
      dueDate: '2026-11-10',
      items: [
        { description: 'Tuition Fee / Pagesa Mujore', amountCents: 15000 },
        { description: 'Fresh Meals & Snacks / Ushqimi', amountCents: 3500 },
      ],
      notes: 'Standard monthly care and meals',
    })
    assert.equal(invRes.status, 201)
    const invoiceId = invRes.data.invoice.id

    // Parent can pay own pending invoice
    const payRes = await request(`invoices/${invoiceId}/pay`, parent, {
      paymentMethod: 'card',
      reference: 'TXN-CARD-TEST-12345',
    })
    assert.equal(payRes.status, 200)
    assert.equal(payRes.data.invoice.status, 'paid')
    assert.equal(payRes.data.invoice.paymentMethod, 'card')
    assert.equal(payRes.data.invoice.transactionRef, 'TXN-CARD-TEST-12345')

    // Cannot pay an already paid invoice
    const doublePay = await request(`invoices/${invoiceId}/pay`, parent, {
      paymentMethod: 'card',
    })
    assert.equal(doublePay.status, 400)
    assert.equal(doublePay.data.error, 'already_paid')

    // Parent can download/view official receipt
    const receiptRes = await request(`invoices/${invoiceId}/receipt`, parent)
    assert.equal(receiptRes.status, 200)
    assert.equal(receiptRes.data.receipt.kindergarten.name, 'Kidoland Kindergarten Sh.p.k.')
    assert.equal(receiptRes.data.receipt.invoice.amountCents, 18500)
    assert.equal(receiptRes.data.receipt.invoice.items.length, 2)
  } finally {
    await f.dispose()
  }
})
