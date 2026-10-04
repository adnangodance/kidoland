// Run at /tests/attendance-ui.html on the Vite dev server. All transport is
// mocked on this page: these UI checks never contact or mutate a database.
import { createRoot } from 'react-dom/client'
import Attendance from '../src/Attendance'
import { AuthProvider } from '../src/auth'
import { useAuth } from '../src/auth-context'
import { LanguageProvider } from '../src/i18n/LanguageContext'
import { useI18n } from '../src/i18n/language-context'
import { localCalendarDate } from '../src/attendance-date'
import { listAttendance, type AttendanceEntry, type Child, type Role } from '../src/api'
import '../src/index.css'
import '../src/App.css'

type PendingRequest = { date: string; body?: Record<string, string>; resolve: (data: unknown) => void; reject: () => void }
const reads: PendingRequest[] = []
const writes: PendingRequest[] = []
let empty = false
const staffChildren: Child[] = [
  { id: 'a', name: 'Arta Test', groupName: 'Bletët', parentUserId: 'parent', photoConsent: false },
  { id: 'b', name: 'Other family child', groupName: 'Bletët', parentUserId: 'other-parent', photoConsent: false },
]
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
const user = (role: string) => ({ id: role, name: role, email: `${role}@test.local`, role })
const originalToken = localStorage.getItem('kidoland.token')
const originalFetch = window.fetch
const originalTimeout = AbortSignal.timeout.bind(AbortSignal)
let shortDeadline = false
let deadlineUsed = 0
AbortSignal.timeout = (milliseconds) => { deadlineUsed = milliseconds; return originalTimeout(shortDeadline ? 50 : milliseconds) }
function restoreEnvironment() {
  if (originalToken === null) localStorage.removeItem('kidoland.token')
  else localStorage.setItem('kidoland.token', originalToken)
  window.fetch = originalFetch
  AbortSignal.timeout = originalTimeout
}
localStorage.removeItem('kidoland.token')
window.fetch = async (input, options) => {
  const url = new URL(String(input))
  const token = (options?.headers as Record<string, string>)?.Authorization?.replace('Bearer ', '')
  if (url.pathname === '/api/auth/login') {
    const role = JSON.parse(String(options?.body)).email.split('@')[0]
    return response({ token: role, user: user(role) })
  }
  if (url.pathname === '/api/auth/me') return response({ user: user(token ?? 'parent') })
  if (url.pathname === '/api/children') return response({ children: empty ? [] : token === 'parent' ? staffChildren.slice(0, 1) : staffChildren })
  if (url.pathname === '/api/attendance') return new Promise<Response>((resolve, reject) => {
    const abort = () => reject(options?.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    if (options?.signal?.aborted) { abort(); return }
    options?.signal?.addEventListener('abort', abort, { once: true })
    const body = options?.body ? JSON.parse(String(options.body)) : undefined
    const pending = { date: body?.attendanceDate ?? url.searchParams.get('date') ?? '', body, resolve: (data: unknown) => resolve(response(data)), reject: () => reject(new Error('network')) }
    if (options?.method === 'POST') writes.push(pending)
    else reads.push(pending)
  })
  throw new Error(`Unexpected transport: ${url.pathname}`)
}

export function Harness() {
  const { user, token, login, logout } = useAuth()
  const { toggle } = useI18n()
  return <><div id="harness">
    {(['teacher', 'director', 'parent'] as Role[]).map((role) => <button key={role} id={role} onClick={() => void login(`${role}@test.local`, 'test')}>{role}</button>)}
    <button id="language" onClick={toggle}>Language</button><button id="logout" onClick={logout}>Logout</button>
  </div>{user && <Attendance key={`${user.id}:${token}`} />}</>
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><AuthProvider><Harness /></AuthProvider></LanguageProvider>)

const results: string[] = []
const output = document.getElementById('results')!
function assert(condition: unknown, description: string) {
  if (!condition) throw new Error(description)
  results.push(`PASS: ${description}`)
  output.textContent = results.join('\n')
}
async function until(check: () => unknown) {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for UI state')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
const panel = () => document.querySelector('.attendance-panel')!
const click = (selector: string) => (document.querySelector(selector) as HTMLButtonElement).click()
function changeDate(date: string) {
  const input = document.querySelector('#attendance-date') as HTMLInputElement
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, date)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
function entry(request: PendingRequest): AttendanceEntry {
  return { id: 'saved', childId: request.body!.childId, childName: 'Arta Test', groupName: 'Bletët', attendanceDate: request.date, status: request.body!.status as 'present' | 'absent', markedBy: 'teacher', updatedAt: new Date().toISOString() }
}

async function run() {
  await until(() => document.querySelector('#teacher'))
  click('#teacher')
  await until(() => reads.length === 1)
  assert(panel().textContent?.includes('Duke ngarkuar'), 'translated loading appears before data')
  assert(!document.querySelector('.attendance-row'), 'loading has no stale roster')
  const initialRead = reads.shift()!
  const initialDate = localCalendarDate()
  assert(initialRead.date === initialDate, 'initial read uses the browser local calendar date')
  initialRead.resolve({ attendance: [] })
  await until(() => document.querySelectorAll('.attendance-row').length === 2)
  assert(panel().textContent?.includes('Pa shënuar'), 'missing records are explicitly unmarked')
  click('#language')
  await until(() => panel().textContent?.includes('Unmarked'))
  assert(document.querySelector('h1')?.textContent === 'Attendance', 'language toggle translates heading and status')
  click('.attendance-controls button')
  await until(() => writes.length === 1)
  assert([...document.querySelectorAll<HTMLButtonElement>('.attendance-controls button')].every((button) => button.disabled), 'all staff actions disabled during save')
  assert(document.querySelector('.attendance-status')?.textContent === 'Unmarked', 'saving keeps last confirmed status')
  const initialSave = writes.shift()!
  assert(initialSave.date === initialDate && JSON.stringify(Object.keys(initialSave.body!).sort()) === JSON.stringify(['attendanceDate', 'childId', 'status']), 'save sends only childId, status and selected attendanceDate')
  assert((document.querySelector('#attendance-date') as HTMLInputElement).disabled && (document.querySelector('.attendance-date button') as HTMLButtonElement).disabled, 'date and Today controls are disabled throughout saving')
  initialSave.reject()
  await until(() => document.querySelector('.attendance-error'))
  assert(document.querySelector('.attendance-status')?.textContent === 'Unmarked', 'failed save retains last confirmed status')
  click('.attendance-error button')
  await until(() => writes.length === 1)
  const retry = writes.shift()!
  assert(retry.body?.status === 'present' && retry.body.childId === 'a' && retry.date === initialDate && JSON.stringify(Object.keys(retry.body).sort()) === JSON.stringify(['attendanceDate', 'childId', 'status']), 'save retry sends exact child, status and selected date without session metadata')
  retry.resolve({ attendance: entry(retry) })
  await until(() => document.querySelector('.attendance-status')?.textContent === 'Present')
  assert(document.querySelector('.attendance-controls button')?.getAttribute('aria-pressed') === 'true', 'confirmed save selects its status accessibly')
  changeDate('2026-10-02')
  await until(() => reads.length === 1)
  const stale = reads.shift()!
  assert(stale.date === '2026-10-02', 'date change reads the selected date')
  assert(!document.querySelector('.attendance-row'), 'date change immediately clears previous roster')
  changeDate('2026-10-03')
  await until(() => reads.length === 1)
  const newest = reads.shift()!
  assert(newest.date === '2026-10-03', 'newest read uses the latest selected date')
  newest.resolve({ attendance: [] })
  await until(() => document.querySelector('.attendance-row'))
  stale.resolve({ attendance: [{ childId: 'a', status: 'absent' }] })
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert(document.querySelector('.attendance-status')?.textContent === 'Unmarked', 'late date response is ignored')
  changeDate('2026-10-04')
  await until(() => reads.length === 1)
  const failedLoad = reads.shift()!
  assert(failedLoad.date === '2026-10-04', 'failed read targets the selected date')
  failedLoad.reject()
  await until(() => document.querySelector('.attendance-error'))
  assert(!document.querySelector('.attendance-row') && panel().textContent?.includes('Could not load'), 'load failure shows error with no stale roster')
  click('.attendance-error button')
  await until(() => reads.length === 1)
  const retriedLoad = reads.shift()!
  assert(retriedLoad.date === '2026-10-04', 'read retry retains the selected date')
  retriedLoad.resolve({ attendance: [] })
  await until(() => document.querySelector('.attendance-row'))
  assert(!document.querySelector('.attendance-error'), 'load retry restores roster')
  click('.attendance-controls button')
  await until(() => writes.length === 1)
  const serializedSave = writes.shift()!
  assert(serializedSave.date === '2026-10-04', 'later save targets the selected day')
  changeDate('2026-10-05')
  click('.attendance-date button')
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert(reads.length === 0 && writes.length === 0, 'date and Today cannot change context or start another write during saving')
  serializedSave.resolve({ attendance: entry(serializedSave) })
  await until(() => document.querySelector('.attendance-status')?.textContent === 'Present')
  assert((document.querySelector('#attendance-date') as HTMLInputElement).value === '2026-10-04', 'serialized save confirms the original selected day')
  click('.attendance-controls button:nth-child(2)')
  await until(() => writes.length === 1)
  const correction = writes.shift()!
  assert(correction.date === '2026-10-04' && correction.body?.status === 'absent', 'correction starts only after prior save confirms')
  correction.resolve({ attendance: entry(correction) })
  await until(() => document.querySelector('.attendance-status')?.textContent === 'Absent')
  shortDeadline = true
  changeDate('2026-10-05')
  await until(() => reads.length === 1)
  const timedRead = reads.shift()!
  shortDeadline = false
  await until(() => document.querySelector('.attendance-error'))
  assert(deadlineUsed === 15000 && timedRead.date === '2026-10-05', 'unresolved read reaches the bounded fetch deadline for the selected date')
  click('.attendance-error button')
  await until(() => reads.length === 1)
  const recoveredRead = reads.shift()!
  assert(recoveredRead.date === timedRead.date, 'read timeout retry preserves its date')
  recoveredRead.resolve({ attendance: [] })
  await until(() => document.querySelector('.attendance-row'))
  shortDeadline = true
  click('.attendance-controls button')
  await until(() => writes.length === 1)
  const timedSave = writes.shift()!
  shortDeadline = false
  await until(() => document.querySelector('.attendance-error'))
  assert(!(document.querySelector('#attendance-date') as HTMLInputElement).disabled && document.querySelector('.attendance-status')?.textContent === 'Unmarked', 'save timeout unlocks controls and retains confirmed status')
  click('.attendance-error button')
  await until(() => writes.length === 1)
  const recoveredSave = writes.shift()!
  assert(JSON.stringify(recoveredSave.body) === JSON.stringify(timedSave.body), 'save timeout retry preserves the exact attempted payload')
  recoveredSave.resolve({ attendance: entry(recoveredSave) })
  await until(() => document.querySelector('.attendance-status')?.textContent === 'Present')
  changeDate('2026-10-06')
  await until(() => reads.length === 1)
  const staleAccount = reads.shift()!
  click('#parent')
  await until(() => reads.length === 1)
  reads.shift()!.resolve({ attendance: [] })
  await until(() => document.querySelectorAll('.attendance-row').length === 1)
  staleAccount.resolve({ attendance: [{ childId: 'b', status: 'present' }] })
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert(!panel().textContent?.includes('Other family child'), 'account change exposes only linked children')
  assert(!document.querySelector('.attendance-controls'), 'parent roster has no mutation controls')
  empty = true
  changeDate('2026-10-07')
  await until(() => reads.length === 1)
  reads.shift()!.resolve({ attendance: [] })
  await until(() => panel().textContent?.includes('No children to show.'))
  assert(!document.querySelector('.attendance-row'), 'successful empty roster is distinct from a failure')
  changeDate('')
  await until(() => panel().textContent?.includes('Choose a valid date.'))
  assert(reads.length === 0, 'invalid date is translated and sends no request')
  const controller = new AbortController()
  const callerAbort = listAttendance('parent', '2026-10-08', undefined, controller.signal)
    .then(() => false, (error: unknown) => error instanceof DOMException && error.name === 'AbortError')
  await until(() => reads.length === 1)
  reads.shift()
  controller.abort()
  assert(await callerAbort, 'bounded fetch preserves caller cancellation signals')
  click('#logout')
  await until(() => !document.querySelector('.attendance-panel'))
  assert(!document.querySelector('.attendance-row'), 'logout clears personal attendance content')
  output.dataset.result = 'passed'
  output.textContent += `\n${results.length} checks passed.`
}
void run().catch((error: unknown) => { output.dataset.result = 'failed'; output.textContent += `\nFAIL: ${String(error)}` }).finally(restoreEnvironment)
