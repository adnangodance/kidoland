import { createRoot } from 'react-dom/client'
import App from '../src/App'
import { translations } from '../src/i18n/translations'
import { euro } from '../src/pilot-utils'
import { saveReport, listReports } from '../src/api'
import { localCalendarDate } from '../src/attendance-date'
import '../src/index.css'

const output = document.getElementById('results')!
const results: string[] = []
const originalFetch = window.fetch.bind(window)
let failPath = '', loseInvoice = false, loseChild = false, loseParent = false, holdNextLogin = false, holdNextReport = false, unauthorizedPath = '', holdUnauthorizedPath = '', heldLogin: (() => void) | undefined, heldReport: (() => void) | undefined, heldUnauthorized: (() => void) | undefined, holdNextDashboard = false, heldDashboard: (() => void) | undefined
window.fetch = async (input, options) => {
  const url = String(input)
  if (failPath && url.includes(failPath)) { failPath = ''; throw new Error('deterministic network failure') }
  if (holdNextDashboard && url.includes('/api/dashboard')) {
    holdNextDashboard = false
    const response = await originalFetch(input, options)
    await new Promise<void>((resolve) => { heldDashboard = resolve })
    return response
  }
  if (unauthorizedPath && url.includes(unauthorizedPath)) {
    unauthorizedPath = ''
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }
  if (holdUnauthorizedPath && url.includes(holdUnauthorizedPath)) {
    holdUnauthorizedPath = ''
    await new Promise<void>((resolve) => { heldUnauthorized = resolve })
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }
  const response = await originalFetch(input, options)
  if (holdNextLogin && url.endsWith('/api/auth/login')) {
    holdNextLogin = false
    await new Promise<void>((resolve) => { heldLogin = resolve })
  }
  if (holdNextReport && url.includes('/api/reports?')) {
    holdNextReport = false
    await new Promise<void>((resolve) => { heldReport = resolve })
  }
  if (loseChild && url.endsWith('/api/children') && options?.method === 'POST') { loseChild = false; throw new Error('lost child response') }
  if (loseParent && url.endsWith('/api/parents') && options?.method === 'POST') { loseParent = false; throw new Error('lost parent response') }
  if (loseInvoice && url.endsWith('/api/invoices') && options?.method === 'POST') { loseInvoice = false; throw new Error('lost invoice response after durable save') }
  return response
}
const resumed = sessionStorage.getItem('kidoland.test-resume')
if (!resumed) { localStorage.clear(); localStorage.setItem('kidoland.language', 'en') }
let root = createRoot(document.getElementById('root')!)
root.render(<App />)
function assert(condition: unknown, label: string) { if (!condition) throw new Error(label); results.push(`PASS: ${label}`); output.textContent = results.join('\n') }
async function until(check: () => unknown, label = 'UI state') { const deadline = Date.now() + 7000; while (!check()) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}; ${document.querySelector('main')?.textContent}`); await new Promise((resolve) => setTimeout(resolve, 10)) } }
const main = () => document.querySelector('main') || document.getElementById('root')!
function button(text: string, scope: ParentNode = document) { const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === text); if (!found) throw new Error(`Button missing: ${text}`); found.click() }
function fill(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) { const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) }
function field(label: string, scope: ParentNode = main()) { const found = [...scope.querySelectorAll('label')].find((element) => element.childNodes[0]?.textContent?.trim() === label)?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea'); if (!found) throw new Error(`Field missing: ${label}`); return found }
async function set(label: string, value: string, scope?: ParentNode) { fill(field(label, scope), value); await new Promise((resolve) => setTimeout(resolve, 10)) }
async function nav(text: string) { button(text, document.querySelector('nav')!); await until(() => main().querySelector('h1')); await new Promise((resolve) => setTimeout(resolve, 50)) }
async function login(role: string, email = `${role}@kidoland.demo`, password = `${role}123`) {
  if (!main().querySelector('input[type=email]')) button(translations.en.ctaStart)
  await until(() => main().querySelector('input[type=email]'))
  await set(translations.en.loginEmail, email); await set(translations.en.loginPassword, password); button(translations.en.loginSubmit, main())
  await until(() => main().querySelector('.metrics'), `login ${role}`)
  assert(main().textContent?.includes(role === 'director' ? translations.en.dashDirector : role === 'teacher' ? translations.en.dashTeacher : translations.en.dashParent), `${role} login opens authorized dashboard`)
}
async function logout() { button(translations.en.logout); await until(() => !document.querySelector('nav [aria-current]')); assert(!main().querySelector('.roster-card, .attendance-row, .metrics'), 'logout removes account records immediately') }
function fit(label: string) { assert(document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll<HTMLElement>('nav button,input,select,textarea')].every((element) => { const box = element.getBoundingClientRect(); return box.width === 0 || box.right <= window.innerWidth + 1 && box.left >= -1 }), `${label}: navigation and controls fit ${window.innerWidth}px`); assert([...document.querySelectorAll<HTMLElement>('nav button')].every((element) => element.getBoundingClientRect().height >= 40), `${label}: mobile navigation remains visible and reachable`) }
async function run() {
  if (!resumed) {
  await until(() => document.querySelector('.hero'))
  await login('director'); fit('director dashboard')
  await nav(translations.en.childrenTitle)
  await until(() => main().querySelector('.roster-card'))
  button(translations.en.newParent, main())
  await until(() => main().querySelector('input[type=password]'))
  await set(translations.en.parentName, 'Browser Family'); await set(translations.en.loginEmail, 'browser@example.test'); await set(translations.en.initialPassword, 'browser-password')
  loseParent = true; button(translations.en.newParent, main().querySelector('form')!)
  await until(() => main().querySelector('[role=alert]'))
  button(translations.en.newParent, main().querySelector('form')!)
  await until(() => main().textContent?.includes(translations.en.emailExists) && field(translations.en.initialPassword).value === '')
  assert(field(translations.en.initialPassword).value === '', 'lost parent creation retry reconciles directory and clears password')
  button(translations.en.newParent, main())
  await until(() => !main().querySelector('input[type=password]'))
  assert(true, 'director provisions and reconciles an explicit parent account')
  button(translations.en.createChild, main())
  await until(() => main().querySelector('select'))
  await set(translations.en.childName, 'Browser Child With A Long Name For Mobile'); await set(translations.en.attendanceGroup, 'Browser group')
  const parentSelect = field(translations.en.linkedParent) as HTMLSelectElement
  const family = [...parentSelect.options].find((option) => option.text.includes('browser@example.test'))!
  fill(parentSelect, family.value); await new Promise((resolve) => setTimeout(resolve, 10)); fit('child form'); loseChild = true; button(translations.en.save, main()); await until(() => main().querySelector('[role=alert]')?.textContent?.includes(translations.en.saveError)); button(translations.en.save, main())
  await until(() => [...main().querySelectorAll('article')].some((row) => row.textContent?.includes('Browser Child')))
  const childCard = [...main().querySelectorAll('article')].find((row) => row.textContent?.includes('Browser Child'))!
  assert(childCard.textContent?.includes('Browser Family') && [...main().querySelectorAll('article')].filter((card) => card.textContent?.includes('Browser Child')).length === 1, 'lost child creation response retries one child linked to selected parent')
  button(`${translations.en.edit} · Browser Child With A Long Name For Mobile`, main()); await until(() => main().querySelector('form')); await set(translations.en.attendanceGroup, 'Edited group')
  await set(translations.en.linkedParent, 'u-parent')
  assert(main().textContent?.includes(translations.en.transferWarning), 'parent transfer warning appears before save')
  await set(translations.en.linkedParent, family.value); button(translations.en.save, main()); await until(() => !main().querySelector('form'))
  await nav(translations.en.attendanceTitle); await until(() => main().querySelectorAll('.attendance-row').length === 3)
  const row = [...main().querySelectorAll('.attendance-row')].find((element) => element.textContent?.includes('Browser Child'))!
  button(translations.en.attendancePresent, row); await until(() => row.querySelector('.attendance-status')?.textContent === translations.en.attendancePresent)
  button(translations.en.attendanceAbsent, row); await until(() => row.querySelector('.attendance-status')?.textContent === translations.en.attendanceAbsent)
  assert(row.querySelector('button[aria-pressed=true]')?.textContent === translations.en.attendanceAbsent, 'director attendance save/correction confirms selected status')
  fit('director attendance'); await logout()
  await login('teacher'); await nav(translations.en.attendanceTitle); await until(() => main().querySelectorAll('.attendance-row').length === 3)
  const teacherRow = [...main().querySelectorAll('.attendance-row')].find((element) => element.textContent?.includes('Browser Child'))!
  button(translations.en.attendancePresent, teacherRow); await until(() => teacherRow.querySelector('.attendance-status')?.textContent === translations.en.attendancePresent)
  assert(true, 'teacher corrects the same persisted attendance record'); fit('teacher attendance')
  await nav(translations.en.navReports); await until(() => main().querySelector('form'))
  const children = field(translations.en.paymentsChild) as HTMLSelectElement
  const childId = [...children.options].find((option) => option.text.includes('Browser Child'))!.value
  await set(translations.en.paymentsChild, childId); await until(() => main().querySelector('form') && !main().querySelector('[role=status]'))
  await set(translations.en.reportsMood, 'mood:happy'); await set(translations.en.reportsMeals, 'meals:all'); await set(translations.en.reportsNap, 'nap:short')
  main().querySelector<HTMLInputElement>('input[type=checkbox]')!.click(); await set(translations.en.reportsNote, 'Browser note')
  failPath = '/api/reports'; button(translations.en.reportSave, main()); await until(() => main().querySelector('[role=alert]'))
  assert(field(translations.en.reportsNote).value === 'Browser note' && !main().querySelector('.roster-card'), 'failed report save preserves draft without false success')
  button(translations.en.reportSave, main()); await until(() => main().textContent?.includes(translations.en.attendanceSaved))
  assert(main().textContent?.includes(translations.en.moodHappy), 'checklist report saves translated values')
  for (const [label, value] of [[translations.en.reportsMood, 'mood:calm'], [translations.en.reportsMeals, 'meals:some'], [translations.en.reportsNap, 'nap:long'], [translations.en.reportsNote, 'Edited note']]) {
    await set(label, value)
    assert(!main().querySelector('[role=status]'), `editing ${label} clears Saved`)
    button(translations.en.reportSave, main()); await until(() => main().textContent?.includes(translations.en.attendanceSaved))
  }
  main().querySelector<HTMLInputElement>('input[type=checkbox]:not(:checked)')!.click(); await new Promise((resolve) => setTimeout(resolve, 10))
  assert(!main().querySelector('[role=status]'), 'editing report activities clears Saved')
  await set(translations.en.reportsMood, 'mood:happy'); await set(translations.en.reportsNote, 'Browser note'); button(translations.en.reportSave, main()); await until(() => main().textContent?.includes(translations.en.attendanceSaved))
  await nav(translations.en.attendanceTitle); await nav(translations.en.navReports); await until(() => main().querySelector('form')); await set(translations.en.paymentsChild, childId)
  await until(() => (field(translations.en.reportsNote) as HTMLTextAreaElement).value === 'Browser note')
  assert(field(translations.en.reportsMood).value === 'mood:happy', 'report correction preloads exact child/day values')
  await set(translations.en.reportsMood, 'mood:calm'); await set(translations.en.reportsNote, 'Corrected browser note')
  const fileInput = field(translations.en.reportPhoto) as HTMLInputElement
  const file = new File(['image-content'], 'pic.png', { type: 'image/png' })
  const dt = new DataTransfer()
  dt.items.add(file)
  fileInput.files = dt.files
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  await until(() => main().querySelector('.report-image-preview img'))
  assert(Boolean(main().querySelector('.report-image-preview img')), 'file input loads report image preview')
  button(translations.en.reportSave, main()); await until(() => main().textContent?.includes(translations.en.attendanceSaved)); fit('teacher report')
  assert(Boolean(main().querySelector('.report-photo img')), 'saved report displays uploaded photo')
  button(`SQ · ${translations.en.langToggle}`)
  await until(() => document.documentElement.lang === 'sq')
  assert(field(translations.sq.reportsNote).value === 'Corrected browser note' && field(translations.sq.reportsMood).value === 'mood:calm', 'language switch translates controls and preserves report draft')
  fit('Albanian report'); button(`EN · ${translations.sq.langToggle}`); await until(() => document.documentElement.lang === 'en')
  const teacherToken = localStorage.getItem('kidoland.token')!
  const legacyValues = { mood: 'Unfamiliar mood text', meals: 'Legacy meals 17', nap: 'Legacy nap 23', activities: 'Legacy free-form activities' }
  await saveReport(teacherToken, { childId: 'c-arta', reportDate: '2041-10-01', ...legacyValues, note: 'Legacy note' })
  await saveReport(teacherToken, { childId: 'c-luan', reportDate: '2041-10-01', mood: 'mood:happy', meals: 'meals:all', nap: 'nap:short', activities: 'activity:art', note: 'Newer child note' })
  await set(translations.en.attendanceDate, '2041-10-01'); await until(() => main().querySelector('form'))
  holdNextReport = true; heldReport = undefined; await set(translations.en.paymentsChild, 'c-arta'); await until(() => heldReport)
  await set(translations.en.paymentsChild, 'c-luan'); await until(() => main().querySelector('form') && field(translations.en.reportsNote).value === 'Newer child note')
  heldReport?.(); await new Promise((resolve) => setTimeout(resolve, 50))
  assert(field(translations.en.paymentsChild).value === 'c-luan' && field(translations.en.attendanceDate).value === '2041-10-01' && field(translations.en.reportsNote).value === 'Newer child note' && main().querySelector('.roster-card')?.textContent?.includes('Luan Gashi'), 'late child/day report response preserves newer identity and draft')
  await set(translations.en.paymentsChild, 'c-arta'); await until(() => main().querySelector('form') && field(translations.en.reportsNote).value === 'Legacy note')
  button(`SQ · ${translations.en.langToggle}`); await until(() => document.documentElement.lang === 'sq')
  await set(translations.sq.reportsNote, 'Only note corrected'); button(translations.sq.reportSave, main()); await until(() => main().textContent?.includes(translations.sq.attendanceSaved))
  const legacySaved = (await listReports(teacherToken, 'c-arta', '2041-10-01')).reports[0]
  assert(Object.entries(legacyValues).every(([key, value]) => legacySaved[key as keyof typeof legacyValues] === value) && legacySaved.note === 'Only note corrected', 'unfamiliar legacy values survive language change and note-only correction')
  button(`EN · ${translations.sq.langToggle}`); await until(() => document.documentElement.lang === 'en')
  await nav(translations.en.navPayments); await until(() => main().querySelector('form'))
  await set(translations.en.paymentsChild, childId); await set(translations.en.paymentsPeriod, 'Browser October'); await set(translations.en.fee, 'Tuition'); await set(translations.en.paymentsAmountLabel, '12.34')
  button(translations.en.addFee, main()); await until(() => main().querySelectorAll('input[type=number]').length === 2); const descriptions = [...main().querySelectorAll<HTMLLabelElement>('label')].filter((label) => label.childNodes[0]?.textContent?.trim() === translations.en.fee); const amounts = [...main().querySelectorAll<HTMLLabelElement>('label')].filter((label) => label.childNodes[0]?.textContent?.trim() === translations.en.paymentsAmountLabel)
  fill(descriptions[1].querySelector('input')!, 'Meals'); fill(amounts[1].querySelector('input')!, '5.67'); await new Promise((resolve) => setTimeout(resolve, 10))
  fit('teacher invoice'); loseInvoice = true; button(translations.en.paymentsCreate, main()); await until(() => main().querySelector('[role=alert]'))
  assert(field(translations.en.paymentsPeriod).value === 'Browser October', 'lost invoice response retains unchanged draft for retry')
  await nav(translations.en.navDashboard); await nav(translations.en.navPayments); await until(() => main().querySelector('form'))
  assert(field(translations.en.paymentsPeriod).value === 'Browser October' && main().querySelectorAll('input[type=number]').length === 2, 'unresolved invoice draft and line items survive navigation')
  sessionStorage.setItem('kidoland.test-resume', JSON.stringify(results))
  window.location.reload()
  await new Promise<void>(() => {})
  } else {
    results.push(...JSON.parse(resumed))
    output.textContent = results.join('\n')
    sessionStorage.removeItem('kidoland.test-resume')
    await until(() => main().querySelector('.metrics'))
    await nav(translations.en.navPayments); await until(() => main().querySelector('form'))
    assert(field(translations.en.paymentsPeriod).value === 'Browser October' && field(translations.en.paymentsAmountLabel).value === '12.34', 'actual browser reload restores account-scoped unresolved invoice draft')
  }
  button(translations.en.paymentsCreate, main()); await until(() => main().textContent?.includes(translations.en.attendanceSaved))
  button(translations.en.paymentsCreate, main()); await until(() => !main().querySelector('fieldset')?.disabled)
  assert([...main().querySelectorAll('.roster-card')].filter((card) => card.textContent?.includes('Browser October')).length === 1, 'durable retry and repeated unchanged submission show one invoice')
  assert(!main().textContent?.includes(translations.en.paymentsMarkPaid), 'teacher cannot mark invoice paid')
  await logout(); await login('parent', 'browser@example.test', 'browser-password')
  assert(main().querySelectorAll('.roster-card').length === 1 && main().textContent?.includes('Browser Child'), 'new family dashboard contains only linked child')
  await nav(translations.en.attendanceTitle); await until(() => main().querySelector('.attendance-row'))
  assert(main().querySelectorAll('.attendance-row').length === 1 && !main().querySelector('.attendance-controls') && main().textContent?.includes(translations.en.attendancePresent), 'parent reads persisted linked attendance without write controls'); fit('parent attendance')
  await nav(translations.en.navReports); await until(() => main().querySelector('.roster-card'))
  assert(main().textContent?.includes('Corrected browser note') && main().textContent?.includes(translations.en.moodCalm) && !main().querySelector('form'), 'parent reads corrected linked report')
  assert(Boolean(main().querySelector('.report-photo img')), 'parent reads uploaded report photo')
  await nav(translations.en.consentTitle); await until(() => main().querySelector('input[type=radio]'))
  main().querySelector<HTMLInputElement>('input[type=radio][value=true]')?.click()
  // Native consent radio values are intentionally independent of translated text.
  const radios = main().querySelectorAll<HTMLInputElement>('input[type=radio]'); radios[0].click(); await new Promise((resolve) => setTimeout(resolve, 10)); failPath = '/consent'; button(translations.en.saveChoice, main()); await until(() => main().querySelector('[role=alert]'));
  assert(radios[0].checked && main().textContent?.includes(translations.en.notAllowed), 'failed consent save keeps draft and last confirmed permission')
  button(translations.en.attendanceRetry, main()); await until(() => main().textContent?.includes(translations.en.attendanceSaved))
  assert(main().textContent?.includes(translations.en.allowed), 'parent photo consent persists after explicit save'); fit('parent consent')
  assert(main().textContent?.includes(translations.en.authorizedPickups), 'parent view exposes authorized pickups section')
  await nav(translations.en.navMessages); await until(() => main().textContent?.includes(translations.en.noMessages))
  assert(main().textContent?.includes(translations.en.messagesTitle), 'new parent opens direct messages panel'); fit('parent messages')
  button(`+ ${translations.en.newMessage}`, main()); await until(() => main().querySelector('textarea'))
  await set(translations.en.messageSubject, 'Browser Question'); await set(translations.en.messageContent, 'Browser message inquiry')
  button(translations.en.startConversation, main()); await until(() => main().querySelector('.chat-message-stream'))
  assert(main().textContent?.includes('Browser Question') && main().textContent?.includes('Browser message inquiry'), 'parent creates direct message thread'); fit('chat thread')
  await nav(translations.en.navPayments); await until(() => main().querySelector('.roster-card'))
  assert(main().querySelectorAll('.roster-card').length === 1 && main().textContent?.includes('Tuition') && main().textContent?.includes('Meals') && /18[.,]01/.test(main().textContent || '') && !main().querySelector('form'), 'parent sees exact two-fee total and no payment mutation controls')
  button(translations.en.payNow, main()); await until(() => main().querySelector('.modal-content'))
  assert(Boolean(main().querySelector('.modal-content')), 'parent opens online payment modal'); fit('parent payment modal')
  button(`🏦 ${translations.en.payWithBank}`, main()); await until(() => main().textContent?.includes('XK05'))
  assert(main().textContent?.includes('Banka Ekonomike'), 'bank transfer details display IBAN')
  button(`💳 ${translations.en.payWithCard}`, main()); await until(() => main().querySelector('input[placeholder="4532 •••• •••• 1234"]'))
  button(translations.en.cancel, main()); await until(() => !main().querySelector('.modal-content'))
  assert(!main().querySelector('.modal-content'), 'closing payment modal restores invoice view')
  await nav(translations.en.navAbsences); await until(() => main().textContent?.includes(translations.en.absencesTitle))
  assert(main().textContent?.includes(translations.en.absencesTitle), 'parent navigates to absences panel'); fit('parent absences')
  button(`+ ${translations.en.reportAbsence}`, main()); await until(() => main().querySelector('.absence-form'))
  assert(Boolean(main().querySelector('.absence-form')), 'parent opens report absence form'); fit('report absence form')
  await set(translations.en.absenceNotes, 'Recovering from mild flu')
  button(translations.en.reportAbsence, main().querySelector('.absence-form')!); await until(() => main().textContent?.includes(translations.en.absenceReported))
  assert(main().textContent?.includes('Recovering from mild flu'), 'parent successfully submits absence notice')
  await nav(translations.en.navMeals); await until(() => main().textContent?.includes(translations.en.mealsTitle))
  assert(main().textContent?.includes(translations.en.mealsTitle), 'parent navigates to food menu'); fit('weekly meals')
  button(translations.en.tuesday, main()); await until(() => main().textContent?.includes('Hearty lentil'))
  assert(main().textContent?.includes('Hearty lentil'), 'parent views Tuesday meal details')
  await nav(translations.en.navIncidents); await until(() => main().textContent?.includes(translations.en.incidentsTitle))
  assert(main().textContent?.includes(translations.en.incidentsTitle), 'parent navigates to health and incidents'); fit('health and incidents')
  assert(main().textContent?.includes(translations.en.medicalProfile), 'parent sees emergency medical profile')
  await nav(translations.en.navMoments); await until(() => main().textContent?.includes(translations.en.momentsTitle))
  await until(() => main().querySelector('.moment-card'))
  assert(main().textContent?.includes(translations.en.momentsTitle), 'parent navigates to classroom moments'); fit('classroom moments')
  assert(Boolean(main().querySelector('.moment-card')), 'parent sees classroom moments feed')
  await nav(translations.en.navEvents); await until(() => main().textContent?.includes(translations.en.eventsTitle))
  await until(() => main().querySelector('.event-card'))
  assert(main().textContent?.includes(translations.en.eventsTitle), 'parent navigates to events and calendar'); fit('events feed')
  assert(Boolean(main().querySelector('.event-card')), 'parent sees upcoming kindergarten events')
  assert(main().textContent?.includes(translations.en.badgeFieldTripSlip), 'parent sees field trip permission slip requirement')
  const rsvpBtn = [...main().querySelectorAll<HTMLButtonElement>('.event-card button')].find((b) => b.textContent?.includes(translations.en.submitRsvp) || b.textContent?.includes('RSVP'))!
  rsvpBtn.click(); await until(() => main().querySelector('.event-rsvp-modal'))
  assert(Boolean(main().querySelector('.event-rsvp-modal')), 'parent opens event RSVP modal'); fit('event rsvp modal')
  button(translations.en.cancelAbsence, main().querySelector('.event-rsvp-modal')!); await until(() => !main().querySelector('.event-rsvp-modal'))
  await logout(); await login('director'); await nav(translations.en.navStaffShifts); await until(() => main().textContent?.includes(translations.en.staffShiftsTitle))
  await until(() => main().querySelector('.ratio-card'))
  assert(main().textContent?.includes(translations.en.ratioComplianceTitle), 'director navigates to staff shifts and room ratio monitor'); fit('staff shifts and ratios')
  assert(Boolean(main().querySelector('.ratio-card')), 'director views room ratio compliance cards')
  assert(main().textContent?.includes(translations.en.badgeOptimal), 'director sees compliant room ratio badge')
  await nav(translations.en.childrenTitle); await until(() => main().querySelector('.roster-card'))
  assert([...main().querySelectorAll('.roster-card')].find((card) => card.textContent?.includes('Browser Child'))?.textContent?.includes(translations.en.allowed) && !main().querySelector('input[type=radio]'), 'staff reads persisted photo permission without consent controls')
  await nav(translations.en.navPayments); await until(() => main().querySelector('.roster-card'))
  await set(translations.en.paymentsPeriod, 'Unsubmitted draft'); await set(translations.en.fee, 'Draft fee'); await set(translations.en.paymentsAmountLabel, '9.99')
  const bill = [...main().querySelectorAll('.roster-card')].find((card) => card.textContent?.includes('Browser October'))!
  button(`${translations.en.paymentsMarkPaid} · Browser Child With A Long Name For Mobile`, bill); await until(() => bill.textContent?.includes(translations.en.paymentsPaid))
  assert(![...main().querySelectorAll<HTMLButtonElement>('form button')].find((control) => control.textContent === translations.en.paymentsCreate)?.disabled && field(translations.en.paymentsPeriod).value === 'Unsubmitted draft', 'mark-paid feedback leaves separate invoice draft submit-ready')
  assert(bill.textContent?.includes('Tuition') && bill.textContent?.includes('Meals') && /18[.,]01/.test(bill.textContent || ''), 'director marking paid preserves exact fee breakdown')
  button(translations.en.viewReceipt, bill); await until(() => main().querySelector('.receipt-modal'))
  assert(main().textContent?.includes(translations.en.officialReceipt) && main().textContent?.includes('PAID / PAGUAR'), 'official tax receipt modal opens with registration details and stamp'); fit('receipt modal')
  button(translations.en.closeReceipt, main()); await until(() => !main().querySelector('.receipt-modal'))
  assert(!main().querySelector('.receipt-modal'), 'closing receipt modal restores dashboard view')
  failPath = '/api/dashboard'; await nav(translations.en.navDashboard); await until(() => main().querySelector('[role=alert]'))
  assert(!main().querySelector('.metrics'), 'failed dashboard shows translated error instead of false zeros')
  button(translations.en.attendanceRetry, main()); await until(() => main().querySelector('.metrics'))
  assert(main().querySelectorAll('.metrics article').length === 6, 'dashboard retry restores real operational metrics')
  // Hold a real old-account response until after logout and a different role login.
  await nav(translations.en.navPayments); holdNextDashboard = true; heldDashboard = undefined; await nav(translations.en.navDashboard); await until(() => heldDashboard)
  await new Promise((resolve) => setTimeout(resolve, 100)); const release = heldDashboard; await logout(); await login('parent'); release?.(); await new Promise((resolve) => setTimeout(resolve, 50))
  assert(!main().textContent?.includes('Browser Child'), 'late staff dashboard response cannot expose data in another account')
  assert(main().querySelectorAll('.roster-card').length === 2, 'demo parent dashboard exposes both linked children')
  await set(translations.en.attendanceDate, '2040-10-01'); await until(() => main().querySelectorAll('.roster-card').length === 2)
  button(translations.en.attendanceTitle, main()); await until(() => main().querySelector('#attendance-date')); assert((main().querySelector('#attendance-date') as HTMLInputElement).value === '2040-10-01', 'dashboard attendance shortcut carries the selected date')
  await nav(translations.en.navDashboard); await until(() => main().querySelectorAll('.roster-card').length === 2); await set(translations.en.attendanceDate, '2040-10-01'); await until(() => main().querySelectorAll('.roster-card').length === 2)
  const secondChild = [...main().querySelectorAll('.roster-card')].find((card) => card.textContent?.includes('Luan Gashi'))!
  button(translations.en.dashRead, secondChild)
  await until(() => main().querySelector('select') && !main().querySelector('[role=status]'))
  assert(field(translations.en.paymentsChild).value === 'c-luan' && field(translations.en.attendanceDate).value === '2040-10-01', 'specific parent dashboard report action carries second child and selected date')
  await nav(translations.en.navPayments); await until(() => main().querySelectorAll('.roster-card').length === 3)
  const legacy = [...main().querySelectorAll('.roster-card')].find((card) => card.textContent?.includes('September 2026'))!
  assert(legacy.textContent?.includes('2026-99-99') && /US\$|USD|\$180/.test(legacy.textContent || ''), 'legacy invalid invoice date and stored USD currency remain readable')
  assert(main().textContent?.includes('180.00 EURO'), 'invalid legacy currency code uses readable number and raw label')
  await nav(translations.en.navMessages); await until(() => main().querySelector('.conversation-card'))
  assert(main().textContent?.includes('Water bottle & Spare clothes'), 'demo parent reads seeded conversation thread')
  await logout()
  root.unmount(); localStorage.setItem('kidoland.language', 'sq'); root = createRoot(document.getElementById('root')!); root.render(<App />)
  await until(() => document.documentElement.lang === 'sq' && document.querySelector('.hero'))
  assert(localStorage.getItem('kidoland.language') === 'sq' && document.querySelector('h1')?.textContent === translations.sq.heroTitle, 'language preference survives a fresh app mount')
  assert(localCalendarDate().length === 10, 'real browser local date supports report and attendance defaults')
  button(`EN · ${translations.sq.langToggle}`); await until(() => document.documentElement.lang === 'en'); await login('parent'); fit('final parent dashboard')
  const bootToken = localStorage.getItem('kidoland.token')!
  failPath = '/api/auth/me'; root.unmount(); root = createRoot(document.getElementById('root')!); root.render(<App />)
  await until(() => main().querySelector('[role=alert]'))
  assert(localStorage.getItem('kidoland.token') === bootToken && main().textContent?.includes(translations.en.loadError), 'saved-token startup network failure preserves session and exposes Retry')
  button(`SQ · ${translations.en.langToggle}`); await until(() => document.documentElement.lang === 'sq')
  assert(main().textContent?.includes(translations.sq.loadError), 'startup recovery error and retry translate')
  button(translations.sq.attendanceRetry, main()); await until(() => main().querySelector('.metrics'))
  assert(main().textContent?.includes(translations.sq.dashParent), 'startup Retry restores real authenticated dashboard')
  button(`EN · ${translations.sq.langToggle}`); await until(() => document.documentElement.lang === 'en')
  await nav(translations.en.navPayments); unauthorizedPath = '/api/dashboard'; await nav(translations.en.navDashboard)
  await until(() => !main().querySelector('.metrics') && !localStorage.getItem('kidoland.token'))
  assert(!main().querySelector('.roster-card') && main().textContent?.includes(translations.en.attendanceSessionExpired), 'current-token401 clears protected content and stored token')
  await login('parent'); await nav(translations.en.navPayments); holdUnauthorizedPath = '/api/dashboard'; await nav(translations.en.navDashboard); await until(() => heldUnauthorized)
  await logout(); await login('teacher'); const newToken = localStorage.getItem('kidoland.token'); heldUnauthorized?.(); await new Promise((resolve) => setTimeout(resolve, 50))
  assert(localStorage.getItem('kidoland.token') === newToken && main().textContent?.includes(translations.en.dashTeacher), 'old-token401 cannot clear newly logged-in session')
  await logout()
  holdNextLogin = true; heldLogin = undefined; button(translations.en.ctaStart); await until(() => main().querySelector('input[type=email]'))
  await set(translations.en.loginEmail, 'teacher@kidoland.demo'); await set(translations.en.loginPassword, 'teacher123'); button(translations.en.loginSubmit, main()); await until(() => heldLogin)
  document.querySelector<HTMLButtonElement>('.brand')!.click(); await until(() => document.querySelector('.hero')); await login('parent'); const latestToken = localStorage.getItem('kidoland.token'); heldLogin?.(); await new Promise((resolve) => setTimeout(resolve, 50))
  assert(localStorage.getItem('kidoland.token') === latestToken && main().textContent?.includes(translations.en.dashParent), 'delayed older login cannot overwrite newer account after Login remount')
  await logout()
  holdNextLogin = true; heldLogin = undefined; button(translations.en.ctaStart); await until(() => main().querySelector('input[type=email]'))
  await set(translations.en.loginEmail, 'teacher@kidoland.demo'); await set(translations.en.loginPassword, 'teacher123'); button(translations.en.loginSubmit, main()); await until(() => heldLogin)
  document.querySelector<HTMLButtonElement>('.brand')!.click(); await until(() => document.querySelector('.hero')); await login('parent'); await logout(); heldLogin?.(); await new Promise((resolve) => setTimeout(resolve, 50))
  assert(!localStorage.getItem('kidoland.token') && document.querySelector('.hero'), 'logout invalidates older pending login completions')
  await login('parent')
  assert(euro(Number.MAX_SAFE_INTEGER, 'en').replace(/[^0-9]/g, '') === '9007199254740991' && euro(Number.MAX_SAFE_INTEGER, 'sq', 'EURO').replace(/[^0-9]/g, '') === '9007199254740991', 'boundary integer cents format exactly in English and Albanian')
  assert([...main().querySelectorAll('.metrics article')].find((card) => card.textContent?.includes(translations.en.dashUnpaid))?.textContent?.includes('EURO'), 'dashboard retains separate pending legacy-currency balance')
  output.dataset.result = 'passed'; output.textContent = `${results.join('\n')}\n${results.length} full-app checks passed.`
}
void run().then(() => originalFetch('/__pilot_results', { method: 'POST', body: JSON.stringify({ ok: true, output: output.textContent }) })).catch((error) => { output.dataset.result = 'failed'; output.textContent += `\nFAIL: ${String(error)}`; return originalFetch('/__pilot_results', { method: 'POST', body: JSON.stringify({ ok: false, output: output.textContent }) }) })
