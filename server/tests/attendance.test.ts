import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { createAttendanceRequests } from '../../src/attendance-requests.js'
import { localCalendarDate, validDate } from '../../src/attendance-date.js'

test('calendar dates and stale request protection', async () => {
  for (const date of ['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) assert.equal(validDate(date), true)
  for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '2026-1-1', '']) assert.equal(validDate(date), false)
  const now = new Date()
  assert.equal(localCalendarDate(), `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
  const requests = createAttendanceRequests()
  const firstLoad = requests.begin()
  const secondLoad = requests.begin()
  assert.equal(firstLoad(), false)
  assert.equal(secondLoad(), true)
  const save = requests.begin()
  requests.invalidate() // date/account switch or unmount
  requests.invalidate() // change back to the same date
  const nextLoad = requests.begin()
  assert.equal(save(), false)
  assert.equal(nextLoad(), true)
})

test('attendance API matrix and persistence on an isolated existing database', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kidoland-attendance-'))
  const databasePath = path.join(directory, 'test.sqlite')
  let processHandle: ChildProcess | undefined
  let base = ''
  let serverErrors = ''
  async function start() {
    processHandle = fork(fileURLToPath(new URL('./api-process.ts', import.meta.url)), [], {
      execArgv: ['--import', 'tsx'], env: { ...process.env, KIDOLAND_DB_PATH: databasePath },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    const child = processHandle
    base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('API startup timeout')), 15000)
      child.once('error', reject)
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`API exited: ${code}`)) })
      child.once('message', (message) => {
        clearTimeout(timer)
        resolve(`http://127.0.0.1:${(message as { port: number }).port}`)
      })
      child.stderr?.on('data', (data) => { serverErrors += String(data); if (!base) process.stderr.write(data) })
    })
  }
  async function stop() {
    const child = processHandle
    if (!child || child.exitCode !== null) return
    await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill('SIGTERM') })
    processHandle = undefined
  }
  async function request(route: string, token?: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${base}/api/${route}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, data: await response.json() }
  }
  async function login(role: string) {
    const response = await request('auth/login', undefined, { email: `${role}@kidoland.demo`, password: `${role}123` })
    assert.equal(response.status, 200)
    return response.data.token as string
  }
  try {
    await start()
    const teacher = await login('teacher')
    const legacyReports = (await request('reports', teacher)).data
    const legacyInvoices = (await request('invoices', teacher)).data
    await stop()
    const oldDatabase = new Database(databasePath)
    oldDatabase.exec('DROP TABLE attendance') // Model an existing pre-feature database, only in the temporary fixture.
    oldDatabase.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run('u-parent2', 'Second family', 'parent2@kidoland.demo', bcrypt.hashSync('parent2123', 4), 'parent')
    oldDatabase.prepare('INSERT INTO children (id, name, group_name, parent_user_id) VALUES (?, ?, ?, ?)').run('c-other', 'Other child', 'Other group', 'u-parent2')
    oldDatabase.close()
    await start()
    const parent = await login('parent')
    const parent2 = await login('parent2')
    const director = await login('director')
    const date = '2026-10-01'
    const validBody = { childId: 'c-arta', attendanceDate: date, status: 'present' }
    await t.test('migration preserves reports/invoices; reads never create absent records', async () => {
      assert.deepEqual((await request('reports', teacher)).data, legacyReports)
      assert.deepEqual((await request('invoices', teacher)).data, legacyInvoices)
      assert.deepEqual((await request(`attendance?date=${date}`, teacher)).data, { attendance: [] })
      assert.deepEqual((await request(`attendance?date=${date}`, teacher)).data, { attendance: [] })
    })
    await t.test('teacher save, director correction retains ID, other dates independent', async () => {
      const save = await request('attendance', teacher, validBody)
      assert.equal(save.status, 201)
      assert.equal(save.data.attendance.markedBy, 'u-teacher')
      assert.equal(save.data.attendance.attendanceDate, date)
      assert.equal(save.data.attendance.childName, 'Arta Krasniqi')
      assert.equal(save.data.attendance.status, 'present')
      assert.ok(!Number.isNaN(Date.parse(save.data.attendance.updatedAt)))
      const correction = await request('attendance', director, { ...validBody, status: 'absent' })
      assert.equal(correction.status, 201)
      assert.equal(correction.data.attendance.id, save.data.attendance.id)
      assert.equal(correction.data.attendance.markedBy, 'u-director')
      assert.equal(correction.data.attendance.status, 'absent')
      assert.equal((await request(`attendance?date=${date}`, teacher)).data.attendance.length, 1)
      await request('attendance', teacher, { ...validBody, attendanceDate: '2026-10-02' })
      assert.equal((await request(`attendance?date=${date}`, teacher)).data.attendance[0].status, 'absent')
      assert.equal((await request('attendance?date=2026-10-02', teacher)).data.attendance[0].status, 'present')
    })
    await t.test('parents read only linked children including foreign filters', async () => {
      await request('attendance', teacher, { ...validBody, childId: 'c-other' })
      assert.deepEqual((await request('children', parent)).data.children.map((child: { id: string }) => child.id), ['c-arta', 'c-luan'])
      assert.deepEqual((await request('children', parent2)).data.children.map((child: { id: string }) => child.id), ['c-other'])
      assert.deepEqual((await request(`attendance?date=${date}`, parent)).data.attendance.map((entry: { childId: string }) => entry.childId), ['c-arta'])
      assert.deepEqual((await request(`attendance?date=${date}`, parent2)).data.attendance.map((entry: { childId: string }) => entry.childId), ['c-other'])
      assert.deepEqual((await request(`attendance?date=${date}&childId=c-other`, parent)).data, { attendance: [] })
      assert.deepEqual((await request(`attendance?date=${date}&childId=c-arta`, parent2)).data, { attendance: [] })
      assert.equal((await request(`attendance?date=${date}&childId=c-arta`, parent)).data.attendance.length, 1)
    })
    await t.test('authorization and all invalid inputs reject without mutation', async () => {
      const before = (await request(`attendance?date=${date}`, teacher)).data
      assert.equal((await request('attendance', undefined, validBody)).status, 401)
      assert.equal((await request(`attendance?date=${date}`)).status, 401)
      assert.equal((await request(`attendance?date=${date}`, 'bad-token')).status, 401)
      assert.equal((await request('attendance', parent, validBody)).status, 403)
      assert.equal((await request('attendance', teacher, { ...validBody, childId: 'missing' })).status, 404)
      for (const body of [null, [], {}, { ...validBody, status: 'unmarked' }, { ...validBody, status: true }, { ...validBody, childId: '' }, { ...validBody, childId: 1 }, { ...validBody, extra: true }, ...['2026-02-29', '2026-04-31', '0000-01-01', '2026-1-1', 'x'].map((attendanceDate) => ({ ...validBody, attendanceDate }))]) {
        assert.equal((await request('attendance', teacher, body)).status, 400, JSON.stringify(body))
      }
      for (const query of ['', '?date=2026-02-29', '?date=2026-04-31', '?date=0000-01-01', '?date=2026-1-1', `?date=${date}&date=${date}`, `?date=${date}&childId=`, `?date=${date}&childId=x&childId=y`, `?date=${date}&extra=x`, '?date[foo]=x']) {
        assert.equal((await request(`attendance${query}`, teacher)).status, 400, query)
      }
      const malformed = await fetch(`${base}/api/attendance`, { method: 'POST', headers: { Authorization: `Bearer ${teacher}`, 'Content-Type': 'application/json' }, body: '{' })
      assert.equal(malformed.status, 400)
      assert.deepEqual((await request(`attendance?date=${date}`, teacher)).data, before)
    })
    await t.test('valid leap dates, unknown filters, and empty child roster', async () => {
      assert.equal((await request('attendance', teacher, { ...validBody, attendanceDate: '2024-02-29' })).status, 201)
      assert.deepEqual((await request(`attendance?date=${date}&childId=missing`, teacher)).data, { attendance: [] })
      await stop()
      const fixture = new Database(databasePath)
      fixture.prepare('UPDATE children SET parent_user_id = ? WHERE id = ?').run('u-parent', 'c-other')
      fixture.close()
      await start()
      assert.deepEqual((await request('children', parent2)).data, { children: [] })
      assert.deepEqual((await request(`attendance?date=${date}`, parent2)).data, { attendance: [] })
    })
    await t.test('API restart preserves corrections and original report/invoice contracts', async () => {
      const before = (await request(`attendance?date=${date}`, teacher)).data
      await stop()
      await start()
      assert.deepEqual((await request(`attendance?date=${date}`, teacher)).data, before)
      assert.deepEqual((await request('reports', teacher)).data, legacyReports)
      assert.deepEqual((await request('invoices', teacher)).data, legacyInvoices)
      const report = await request('reports', teacher, { childId: 'c-arta', reportDate: date, mood: 'happy', meals: 'all', nap: 'one hour', activities: 'play', note: 'smoke' })
      assert.equal(report.status, 201)
      const invoice = await request('invoices', director, { childId: 'c-arta', items: [{ description: 'Test fee', amountCents: 100 }], periodLabel: 'Test', dueDate: date })
      assert.equal(invoice.status, 201)
      const paid = await request(`invoices/${invoice.data.invoice.id}/paid`, director, undefined, 'PATCH')
      assert.equal(paid.status, 200)
      assert.equal(paid.data.invoice.status, 'paid')
    })
    await t.test('date index exists and save failures retain server cause only', async () => {
      const before = (await request(`attendance?date=${date}`, teacher)).data
      await stop()
      const fixture = new Database(databasePath)
      assert.deepEqual((fixture.prepare("PRAGMA index_info('attendance_date_child')").all() as { name: string }[]).map((column) => column.name), ['attendance_date', 'child_id'])
      fixture.exec("CREATE TRIGGER fail_attendance BEFORE INSERT ON attendance BEGIN SELECT RAISE(FAIL, 'attendance-test-write-failure'); END")
      fixture.close()
      await start()
      const failure = await request('attendance', teacher, validBody)
      assert.equal(failure.status, 500)
      assert.deepEqual(failure.data, { error: 'save_failed' })
      assert.deepEqual((await request(`attendance?date=${date}`, teacher)).data, before)
      assert.match(serverErrors, /Could not save attendance:[\s\S]*attendance-test-write-failure/)
    })
  } finally {
    await stop()
    await rm(directory, { recursive: true, force: true })
  }
})
