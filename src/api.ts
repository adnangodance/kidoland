const API_URL = import.meta.env.VITE_API_URL !== undefined
  ? import.meta.env.VITE_API_URL
  : import.meta.env.PROD
  ? ''
  : 'http://127.0.0.1:4000'

export type Role = 'parent' | 'teacher' | 'director' | 'superadmin'

export type User = {
  id: string
  name: string
  email: string
  role: Role
}

export type Child = {
  id: string
  name: string
  groupName: string
  parentUserId: string
  photoConsent: boolean
  allergies?: string
}

export type AttendanceStatus = 'present' | 'absent'
export type AttendanceEntry = {
  id: string
  childId: string
  childName: string
  groupName: string
  attendanceDate: string
  status: AttendanceStatus
  markedBy: string
  updatedAt: string
}

export type Report = {
  id: string
  childId: string
  childName: string
  groupName: string
  teacherUserId: string
  teacherName: string
  reportDate: string
  mood: string
  meals: string
  nap: string
  activities: string
  note: string
  imageUrl?: string | null
  allergies?: string
  createdAt: string
}


export type Invoice = {
  id: string
  childId: string
  childName: string
  groupName: string
  amountCents: number
  currency: string
  periodLabel: string
  status: 'pending' | 'paid'
  dueDate: string
  paidAt: string | null
  paymentMethod?: string | null
  transactionRef?: string | null
  createdBy: string
  createdAt: string
  notes: string | null
  items: { id: string; description: string; amountCents: number }[]
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function api<T>(path: string, opts: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined),
  }
  if (opts.body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const deadline = AbortSignal.timeout(15_000)
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline
  const res = await fetch(`${API_URL}${path}`, { ...opts, headers, signal })
  const data = await res.json()
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new CustomEvent('kidoland-session-expired', { detail: token }))
    throw new ApiError(data.error || 'request_failed', res.status)
  }
  return data as T
}

export async function loginRequest(email: string, password: string) {
  return api<{ token: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function getSetupStatus() {
  return api<{ needsSetup: boolean }>('/api/auth/setup-status')
}

export async function setupAdminRequest(name: string, email: string, password: string) {
  return api<{ token: string; user: User }>('/api/auth/setup-admin', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  })
}

export async function meRequest(token: string) {
  return api<{ user: User }>('/api/auth/me', {}, token)
}

export async function listStaff(token: string) {
  return api<{ staff: User[] }>('/api/staff', {}, token)
}

export async function createStaff(token: string, body: { name: string; email: string; password: string; role: 'teacher' | 'director' | 'superadmin' }) {
  return api<{ staff: User }>('/api/staff', { method: 'POST', body: JSON.stringify(body) }, token)
}

export async function resetUserPassword(token: string, userId: string, newPassword: string) {
  return api<{ ok: boolean; userId: string }>(`/api/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  }, token)
}

export async function listChildren(token: string) {
  return api<{ children: Child[] }>('/api/children', {}, token)
}

export async function listAttendance(token: string, date: string, childId?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ date })
  if (childId) query.set('childId', childId)
  return api<{ attendance: AttendanceEntry[] }>(`/api/attendance?${query}`, { signal }, token)
}

export async function saveAttendance(
  token: string,
  body: { childId: string; attendanceDate: string; status: AttendanceStatus },
) {
  return api<{ attendance: AttendanceEntry }>(
    '/api/attendance', { method: 'POST', body: JSON.stringify(body) }, token,
  )
}

export async function listReports(token: string, childId?: string, date?: string, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (childId) query.set('childId', childId)
  if (date) query.set('date', date)
  return api<{ reports: Report[] }>(`/api/reports?${query}`, { signal }, token)
}

export async function saveReport(
  token: string,
  body: {
    childId: string
    reportDate: string
    mood: string
    meals: string
    nap: string
    activities: string
    note: string
    imageUrl?: string | null
  },
) {
  return api<{ report: Report }>(
    '/api/reports',
    { method: 'POST', body: JSON.stringify(body) },
    token,
  )
}

export async function saveBatchReports(
  token: string,
  body: {
    childIds: string[]
    reportDate: string
    mood: string
    meals: string
    nap: string
    activities: string
    note?: string
  },
) {
  return api<{ count: number }>(
    '/api/reports/batch',
    { method: 'POST', body: JSON.stringify(body) },
    token,
  )
}

export async function listInvoices(token: string) {
  return api<{ invoices: Invoice[] }>('/api/invoices', {}, token)
}

export async function createInvoice(
  token: string,
  body: {
    childId: string
    requestId?: string
    items: { description: string; amountCents: number }[]
    currency?: string
    periodLabel: string
    dueDate: string
    notes?: string
  },
) {
  return api<{ invoice: Invoice }>(
    '/api/invoices',
    { method: 'POST', body: JSON.stringify(body) },
    token,
  )
}

export async function markInvoicePaid(token: string, id: string) {
  return api<{ invoice: Invoice }>(
    `/api/invoices/${encodeURIComponent(id)}/paid`,
    { method: 'PATCH' },
    token,
  )
}

export type ChildInput = Pick<Child, 'name' | 'groupName' | 'parentUserId'> & { allergies?: string }
export const listParents = (token: string) => api<{ parents: User[] }>('/api/parents', {}, token)
export const createParent = (token: string, body: { name: string; email: string; password: string }) => api<{ parent: User }>('/api/parents', { method: 'POST', body: JSON.stringify(body) }, token)
export const createChild = (token: string, body: ChildInput & { requestId?: string }) => api<{ child: Child }>('/api/children', { method: 'POST', body: JSON.stringify(body) }, token)
export const updateChild = (token: string, id: string, body: ChildInput) => api<{ child: Child }>(`/api/children/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token)
export const saveConsent = (token: string, id: string, photoConsent: boolean) => api<{ child: Child }>(`/api/children/${encodeURIComponent(id)}/consent`, { method: 'PATCH', body: JSON.stringify({ photoConsent }) }, token)
export type DashboardSummary = { date: string; children: number; present: number; absent: number; unmarked: number; reports: number; unpaidInvoices: number; unpaidBalances: { currency: string; amountCents: string }[]; childSummaries: { id: string; name: string; groupName: string; photoConsent: boolean; attendanceStatus: AttendanceStatus | null; hasReport: boolean; allergies?: string }[] }
export const getDashboard = (token: string, date: string) => api<{ summary: DashboardSummary }>(`/api/dashboard?date=${encodeURIComponent(date)}`, {}, token)

export type DailyProgram = {
  id: string
  groupName: string
  programDate: string
  theme: string
  activities: string
  mealsMenu: string
  notes: string
  createdBy: string
  createdByName?: string
  createdAt: string
  updatedAt: string
}

export type ProgramInput = {
  groupName: string
  programDate: string
  theme: string
  activities: string
  mealsMenu: string
  notes?: string
}

export async function listPrograms(token: string, date?: string, groupName?: string, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (date) query.set('date', date)
  if (groupName) query.set('groupName', groupName)
  return api<{ programs: DailyProgram[] }>(`/api/programs?${query}`, { signal }, token)
}

export async function saveProgram(token: string, body: ProgramInput) {
  return api<{ program: DailyProgram }>('/api/programs', { method: 'POST', body: JSON.stringify(body) }, token)
}

export type AnnouncementPriority = 'normal' | 'important' | 'urgent'

export type Announcement = {
  id: string
  title: string
  content: string
  priority: AnnouncementPriority
  targetGroup: string
  eventDate?: string | null
  authorName: string
  createdBy: string
  createdAt: string
}

export type AnnouncementInput = {
  title: string
  content: string
  priority: AnnouncementPriority
  targetGroup: string
  eventDate?: string | null
}

export async function listAnnouncements(token: string, signal?: AbortSignal) {
  return api<{ announcements: Announcement[] }>('/api/announcements', { signal }, token)
}

export async function createAnnouncement(token: string, body: AnnouncementInput) {
  return api<{ announcement: Announcement }>('/api/announcements', { method: 'POST', body: JSON.stringify(body) }, token)
}

export async function deleteAnnouncement(token: string, id: string) {
  return api<{ success: boolean }>(`/api/announcements/${id}`, { method: 'DELETE' }, token)
}

export type AuthorizedPickup = {
  id: string
  childId: string
  name: string
  relationship: string
  phone: string
  isEmergency: boolean
  createdAt: string
}

export type PickupInput = {
  name: string
  relationship: string
  phone: string
  isEmergency?: boolean
}

export type PickupLog = {
  id: string
  childId: string
  logDate: string
  logTime: string
  action: 'check_in' | 'check_out'
  guardianName: string
  staffName: string
  notes?: string
  createdAt: string
}

export type PickupLogInput = {
  logDate: string
  logTime: string
  action: 'check_in' | 'check_out'
  guardianName: string
  notes?: string
}

export async function listPickups(token: string, childId: string, signal?: AbortSignal) {
  return api<{ pickups: AuthorizedPickup[] }>(`/api/children/${childId}/pickups`, { signal }, token)
}

export async function addPickup(token: string, childId: string, body: PickupInput) {
  return api<{ pickup: AuthorizedPickup }>(`/api/children/${childId}/pickups`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, token)
}

export async function deletePickup(token: string, childId: string, pickupId: string) {
  return api<{ success: boolean }>(`/api/children/${childId}/pickups/${pickupId}`, {
    method: 'DELETE',
  }, token)
}

export async function listPickupLogs(token: string, childId: string, date?: string, signal?: AbortSignal) {
  const query = date ? `?date=${date}` : ''
  return api<{ logs: PickupLog[] }>(`/api/children/${childId}/pickup-logs${query}`, { signal }, token)
}

export async function recordPickupLog(token: string, childId: string, body: PickupLogInput) {
  return api<{ log: PickupLog }>(`/api/children/${childId}/pickup-logs`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, token)
}

export type Conversation = {
  id: string
  childId: string
  parentUserId: string
  subject: string
  childName: string
  groupName: string
  parentName: string
  lastMessage?: string | null
  lastMessageAt?: string | null
  lastSenderName?: string | null
  unreadCount: number
  createdAt: string
  updatedAt: string
}

export type ConversationInput = {
  childId: string
  subject: string
  message: string
}

export type ChatMessage = {
  id: string
  conversationId: string
  senderUserId: string
  senderName: string
  senderRole: string
  content: string
  readAt?: string | null
  createdAt: string
}

export async function listConversations(token: string, signal?: AbortSignal) {
  return api<{ conversations: Conversation[] }>('/api/conversations', { signal }, token)
}

export async function createConversation(token: string, body: ConversationInput) {
  return api<{ conversation: Conversation; message: ChatMessage }>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify(body),
  }, token)
}

export async function getConversationMessages(token: string, id: string, signal?: AbortSignal) {
  return api<{ conversation: Conversation; messages: ChatMessage[] }>(`/api/conversations/${id}/messages`, { signal }, token)
}

export async function sendChatMessage(token: string, conversationId: string, content: string) {
  return api<{ message: ChatMessage }>(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  }, token)
}

export type PaymentMethod = 'card' | 'bank_transfer'

export type PaymentReceipt = {
  receiptNumber: string
  kindergarten: {
    name: string
    address: string
    taxId: string
    iban: string
    bankName: string
  }
  invoice: Invoice & {
    parentName: string
    parentEmail: string
  }
}

export async function payInvoice(token: string, id: string, body: { paymentMethod: PaymentMethod; reference?: string }) {
  return api<{ invoice: Invoice }>(`/api/invoices/${id}/pay`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, token)
}

export async function getInvoiceReceipt(token: string, id: string, signal?: AbortSignal) {
  return api<{ receipt: PaymentReceipt }>(`/api/invoices/${id}/receipt`, { signal }, token)
}

export type AbsenceReason = 'sick' | 'vacation' | 'appointment' | 'other'

export type AbsenceNotice = {
  id: string
  childId: string
  childName: string
  groupName: string
  parentUserId: string
  parentName: string
  startDate: string
  endDate: string
  reasonType: AbsenceReason
  notes: string
  createdAt: string
}

export type AbsenceInput = {
  childId: string
  startDate: string
  endDate: string
  reasonType: AbsenceReason
  notes?: string
}

export async function listAbsenceNotices(token: string, options?: { childId?: string; date?: string }, signal?: AbortSignal) {
  const params = new URLSearchParams()
  if (options?.childId) params.set('childId', options.childId)
  if (options?.date) params.set('date', options.date)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return api<{ notices: AbsenceNotice[] }>(`/api/absence-notices${qs}`, { signal }, token)
}

export async function createAbsenceNotice(token: string, input: AbsenceInput) {
  return api<{ notice: AbsenceNotice }>('/api/absence-notices', {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export async function deleteAbsenceNotice(token: string, id: string) {
  return api<{ success: boolean }>(`/api/absence-notices/${id}`, {
    method: 'DELETE',
  }, token)
}

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday'

export type WeeklyMeal = {
  id: string
  dayOfWeek: DayOfWeek
  menuMonth?: string
  weekNumber?: number
  breakfast: string
  morningSnack: string
  lunch: string
  afternoonSnack: string
  allergens: string
  notes: string
  updatedBy: string
  updatedAt: string
}

export type MealInput = {
  dayOfWeek: DayOfWeek
  month?: string
  weekNumber?: number
  breakfast: string
  morningSnack: string
  lunch: string
  afternoonSnack: string
  allergens?: string
  notes?: string
}

export async function listWeeklyMeals(token: string, month?: string, week?: number, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (month) query.set('month', month)
  if (typeof week === 'number') query.set('week', String(week))
  const qs = query.toString() ? `?${query.toString()}` : ''
  return api<{ meals: WeeklyMeal[]; month?: string; weekNumber?: number }>(`/api/meals${qs}`, { signal }, token)
}

export async function updateWeeklyMeal(token: string, input: MealInput) {
  return api<{ meal: WeeklyMeal }>('/api/meals', {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export async function copyMonthlyMeals(token: string, fromMonth: string, toMonth: string) {
  return api<{ success: boolean; count: number }>('/api/meals/copy-month', {
    method: 'POST',
    body: JSON.stringify({ fromMonth, toMonth }),
  }, token)
}

export type ChildMedicalProfile = {
  childId: string
  pediatricianName: string
  pediatricianPhone: string
  bloodType: string
  chronicConditions: string
  emergencyMedications: string
  notes: string
  updatedAt: string
}

export type MedicalProfileInput = {
  pediatricianName?: string
  pediatricianPhone?: string
  bloodType?: string
  chronicConditions?: string
  emergencyMedications?: string
  notes?: string
}

export type IncidentType = 'scrape' | 'bump' | 'bruise' | 'cut' | 'bite' | 'fever' | 'other'
export type IncidentLocation = 'playground' | 'classroom' | 'cafeteria' | 'nap_room' | 'bathroom' | 'other'
export type IncidentFirstAid = 'ice_pack' | 'cleaned_bandaged' | 'temperature_taken' | 'rest' | 'doctor_called' | 'none'

export type IncidentReport = {
  id: string
  childId: string
  childName: string
  groupName: string
  reporterId: string
  reporterName: string
  reporterRole: string
  incidentDate: string
  incidentTime: string
  type: IncidentType
  location: IncidentLocation
  firstAid: IncidentFirstAid
  description: string
  actionTaken: string
  parentNotified: boolean
  parentAcknowledgedAt: string | null
  createdAt: string
}

export type IncidentInput = {
  childId: string
  incidentDate: string
  incidentTime: string
  type: IncidentType
  location: IncidentLocation
  firstAid: IncidentFirstAid
  description: string
  actionTaken: string
  parentNotified?: boolean
}

export async function getMedicalProfile(token: string, childId: string, signal?: AbortSignal) {
  return api<{ medicalProfile: ChildMedicalProfile | null }>(`/api/children/${childId}/medical`, { signal }, token)
}

export async function updateMedicalProfile(token: string, childId: string, input: MedicalProfileInput) {
  return api<{ medicalProfile: ChildMedicalProfile }>(`/api/children/${childId}/medical`, {
    method: 'PUT',
    body: JSON.stringify(input),
  }, token)
}

export async function listIncidents(token: string, options?: { childId?: string; date?: string }, signal?: AbortSignal) {
  const params = new URLSearchParams()
  if (options?.childId) params.set('childId', options.childId)
  if (options?.date) params.set('date', options.date)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return api<{ incidents: IncidentReport[] }>(`/api/incidents${qs}`, { signal }, token)
}

export async function createIncident(token: string, input: IncidentInput) {
  return api<{ incident: IncidentReport }>('/api/incidents', {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export async function acknowledgeIncident(token: string, incidentId: string) {
  return api<{ incident: IncidentReport }>(`/api/incidents/${incidentId}/acknowledge`, {
    method: 'POST',
  }, token)
}

export type LearningArea = 'art' | 'stem' | 'motor' | 'music' | 'story' | 'outdoor' | 'other'

export type TaggedChildDetail = {
  id: string
  name: string
  photoConsent: boolean
}

export type ClassroomMoment = {
  id: string
  title: string
  groupName: string
  learningArea: LearningArea
  momentDate: string
  description: string
  imageUrl?: string | null
  taggedChildren: string[]
  taggedChildrenDetails: TaggedChildDetail[]
  reactionCount: number
  userReacted: boolean
  createdBy: string
  createdByName: string
  createdByRole: string
  createdAt: string
}

export type MomentInput = {
  title: string
  groupName: string
  learningArea: LearningArea
  momentDate: string
  description: string
  imageUrl?: string | null
  taggedChildren?: string[]
}

export async function listMoments(token: string, options?: { groupName?: string; date?: string; area?: string }, signal?: AbortSignal) {
  const params = new URLSearchParams()
  if (options?.groupName) params.set('groupName', options.groupName)
  if (options?.date) params.set('date', options.date)
  if (options?.area) params.set('area', options.area)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return api<{ moments: ClassroomMoment[] }>(`/api/moments${qs}`, { signal }, token)
}

export async function createMoment(token: string, input: MomentInput) {
  return api<{ moment: ClassroomMoment }>('/api/moments', {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export async function toggleMomentReaction(token: string, momentId: string) {
  return api<{ momentId: string; reacted: boolean; reactionCount: number }>(`/api/moments/${momentId}/react`, {
    method: 'POST',
  }, token)
}

export async function deleteMoment(token: string, momentId: string) {
  return api<{ success: boolean }>(`/api/moments/${momentId}`, {
    method: 'DELETE',
  }, token)
}

export type EventType = 'celebration' | 'field_trip' | 'conference' | 'holiday' | 'workshop' | 'other'

export type RsvpStatus = 'attending' | 'declined' | 'tentative'

export type EventRsvp = {
  id: string
  childId: string
  childName?: string
  parentId?: string
  parentName?: string
  parentEmail?: string
  status: RsvpStatus
  attendingAdults: number
  permissionSigned: boolean
  notes: string
  updatedAt: string
}

export type EventSummary = {
  attendingCount: number
  declinedCount: number
  tentativeCount: number
  totalAdults: number
  permissionSignedCount: number
}

export type KindergartenEvent = {
  id: string
  title: string
  description: string
  eventType: EventType
  eventDate: string
  endDate?: string | null
  startTime?: string | null
  endTime?: string | null
  location: string
  groupName: string
  requiresRsvp: boolean
  requiresPermissionSlip: boolean
  createdBy: string
  createdAt: string
  summary?: EventSummary
  rsvps?: EventRsvp[]
}

export type EventInput = {
  title: string
  description: string
  eventType: EventType
  eventDate: string
  endDate?: string | null
  startTime?: string | null
  endTime?: string | null
  location: string
  groupName?: string
  requiresRsvp?: boolean
  requiresPermissionSlip?: boolean
}

export type RsvpInput = {
  childId: string
  status: RsvpStatus
  attendingAdults?: number
  permissionSigned?: boolean
  notes?: string
}

export async function listEvents(token: string, month?: string, signal?: AbortSignal) {
  const qs = month ? `?month=${encodeURIComponent(month)}` : ''
  return api<{ events: KindergartenEvent[] }>(`/api/events${qs}`, { signal }, token)
}

export async function createEvent(token: string, input: EventInput) {
  return api<{ event: KindergartenEvent }>('/api/events', {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export async function deleteEvent(token: string, id: string) {
  return api<{ success: boolean }>(`/api/events/${id}`, {
    method: 'DELETE',
  }, token)
}

export async function submitEventRsvp(token: string, eventId: string, input: RsvpInput) {
  return api<{ rsvp: EventRsvp }>(`/api/events/${eventId}/rsvp`, {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export type ShiftType = 'morning' | 'regular' | 'closing' | 'substitute'
export type ShiftStatus = 'scheduled' | 'checked_in' | 'completed' | 'absent'

export type StaffMember = {
  id: string
  name: string
  role: string
  email: string
}

export type StaffShift = {
  id: string
  staffId: string
  staffName: string
  staffRole: string
  staffEmail: string
  shiftDate: string
  shiftType: ShiftType
  startTime: string
  endTime: string
  groupName: string
  status: ShiftStatus
  notes: string
  createdAt: string
}

export type RoomRatioStat = {
  groupName: string
  childrenCount: number
  staffCount: number
  currentRatioStr: string
  maxRatio: number
  maxCapacity: number
  minEducators: number
  isCompliant: boolean
  status: 'optimal' | 'warning' | 'exceeded'
}

export type StaffShiftInput = {
  staffId: string
  shiftDate: string
  shiftType: ShiftType
  startTime: string
  endTime: string
  groupName: string
  notes?: string
}

export async function listStaffShifts(token: string, date?: string, signal?: AbortSignal) {
  const qs = date ? `?date=${encodeURIComponent(date)}` : ''
  return api<{
    date: string
    shifts: StaffShift[]
    roomRatios: RoomRatioStat[]
    staffMembers: StaffMember[]
  }>(`/api/staff-shifts${qs}`, { signal }, token)
}

export async function createStaffShift(token: string, input: StaffShiftInput) {
  return api<{ shift: StaffShift }>('/api/staff-shifts', {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export async function updateShiftStatus(token: string, id: string, status: ShiftStatus) {
  return api<{ shift: StaffShift }>(`/api/staff-shifts/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  }, token)
}

export async function deleteStaffShift(token: string, id: string) {
  return api<{ success: boolean }>(`/api/staff-shifts/${id}`, {
    method: 'DELETE',
  }, token)
}

export type MilestoneDomain = 'cognitive' | 'language' | 'motor' | 'social_emotional' | 'creative'
export type MilestoneStatus = 'emerging' | 'achieved' | 'mastered'

export type DevelopmentalMilestone = {
  id: string
  domain: MilestoneDomain
  ageGroup: string
  titleEn: string
  titleSq: string
  descriptionEn: string
  descriptionSq: string
  sortOrder: number
}

export type ChildMilestoneItem = {
  milestoneId: string
  domain: MilestoneDomain
  ageGroup: string
  titleEn: string
  titleSq: string
  descriptionEn: string
  descriptionSq: string
  sortOrder: number
  recordId: string | null
  status: MilestoneStatus | null
  observedDate: string | null
  notes: string
  evaluatedBy: string | null
  evaluatedByName: string | null
  updatedAt: string | null
}

export type DomainStat = {
  total: number
  emerging: number
  achieved: number
  mastered: number
  percent: number
}

export type ChildMilestonesResponse = {
  child: {
    id: string
    name: string
    groupName: string
  }
  items: ChildMilestoneItem[]
  domainStats: Record<string, DomainStat>
  summary: {
    totalMilestones: number
    recordedCount: number
    masteredCount: number
    achievedCount: number
    emergingCount: number
    overallProgressPercent: number
  }
}

export type RecordMilestoneInput = {
  milestoneId: string
  status: MilestoneStatus
  observedDate: string
  notes?: string
}

export async function listMilestonesFramework(token: string, signal?: AbortSignal) {
  return api<{ milestones: DevelopmentalMilestone[] }>('/api/milestones', { signal }, token)
}

export async function getChildMilestones(token: string, childId: string, signal?: AbortSignal) {
  return api<ChildMilestonesResponse>(`/api/children/${childId}/milestones`, { signal }, token)
}

export async function recordChildMilestone(token: string, childId: string, input: RecordMilestoneInput) {
  return api<{ success: boolean; record: any }>(`/api/children/${childId}/milestones`, {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export async function resetChildMilestone(token: string, childId: string, milestoneId: string) {
  return api<{ success: boolean }>(`/api/children/${childId}/milestones/${milestoneId}`, {
    method: 'DELETE',
  }, token)
}

export type DocumentType = 'enrollment_contract' | 'vaccination_record' | 'birth_certificate' | 'medical_clearance' | 'custody_legal' | 'other'
export type DocumentStatus = 'pending_review' | 'verified' | 'rejected' | 'expired'

export type ChildDocument = {
  id: string
  childId: string
  childName: string
  groupName: string
  documentType: DocumentType
  title: string
  fileUrl: string
  fileName: string
  fileSizeBytes: number
  status: DocumentStatus
  notes: string
  expirationDate: string | null
  uploadedBy: string
  uploadedByName: string
  verifiedBy: string | null
  verifiedByName: string | null
  verifiedAt: string | null
  rejectionReason: string | null
  createdAt: string
  updatedAt: string
}

export type DocumentSummaryStats = {
  total: number
  verified: number
  pendingReview: number
  rejected: number
  expired: number
}

export type UploadDocumentInput = {
  childId: string
  documentType: DocumentType
  title: string
  fileUrl: string
  fileName: string
  fileSizeBytes?: number
  notes?: string
  expirationDate?: string | null
}

export async function listDocuments(token: string, filters?: { childId?: string; status?: string; type?: string }, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (filters?.childId) query.set('childId', filters.childId)
  if (filters?.status) query.set('status', filters.status)
  if (filters?.type) query.set('type', filters.type)
  const qs = query.toString() ? `?${query}` : ''
  return api<{ documents: ChildDocument[]; summary: DocumentSummaryStats }>(`/api/documents${qs}`, { signal }, token)
}

export async function uploadDocument(token: string, input: UploadDocumentInput) {
  return api<{ success: boolean; document: ChildDocument }>('/api/documents', {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export async function verifyDocument(token: string, id: string, status: 'verified' | 'rejected', rejectionReason?: string) {
  return api<{ success: boolean; document: ChildDocument }>(`/api/documents/${id}/verify`, {
    method: 'PUT',
    body: JSON.stringify({ status, rejectionReason }),
  }, token)
}

export async function deleteDocument(token: string, id: string) {
  return api<{ success: boolean }>(`/api/documents/${id}`, {
    method: 'DELETE',
  }, token)
}

export type SleepQuality = 'restful' | 'light' | 'restless' | 'refused_nap'

export type ChildSleepLog = {
  id: string
  childId: string
  childName: string
  groupName: string
  logDate: string
  startTime: string
  endTime: string | null
  durationMinutes: number | null
  quality: SleepQuality
  notes: string | null
  recordedBy: string
  recordedByName: string
  createdAt: string
  updatedAt: string
}

export type SleepSummaryStats = {
  totalLogs: number
  totalSleepMinutes: number
  activeNappingCount: number
  restfulCount: number
  lightCount: number
  restlessCount: number
  refusedCount: number
}

export type CreateSleepLogInput = {
  childId: string
  logDate: string
  startTime: string
  endTime?: string | null
  quality: SleepQuality
  notes?: string
}

export type UpdateSleepLogInput = {
  startTime?: string
  endTime?: string | null
  quality?: SleepQuality
  notes?: string
}

export async function listSleepLogs(token: string, options?: { date?: string; childId?: string }, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (options?.date) query.set('date', options.date)
  if (options?.childId) query.set('childId', options.childId)
  const qs = query.toString() ? `?${query}` : ''
  return api<{ logs: ChildSleepLog[]; summary: SleepSummaryStats }>(`/api/sleep-logs${qs}`, { signal }, token)
}

export async function createSleepLog(token: string, input: CreateSleepLogInput) {
  return api<{ success: boolean; log: ChildSleepLog }>('/api/sleep-logs', {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export async function updateSleepLog(token: string, id: string, input: UpdateSleepLogInput) {
  return api<{ success: boolean; log: ChildSleepLog }>(`/api/sleep-logs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  }, token)
}

export async function deleteSleepLog(token: string, id: string) {
  return api<{ success: boolean }>(`/api/sleep-logs/${id}`, {
    method: 'DELETE',
  }, token)
}

export type MedicationStorage = 'room_temperature' | 'refrigerated' | 'locked_box'
export type MedicationStatus = 'active' | 'completed' | 'cancelled'
export type ChildReaction = 'normal' | 'drowsy' | 'refused' | 'adverse'

export type ChildMedication = {
  id: string
  childId: string
  childName: string
  groupName: string
  medicationName: string
  dosage: string
  frequencySchedule: string
  instructions: string
  storageType: MedicationStorage
  doctorName: string
  prescriptionNumber: string
  startDate: string
  endDate: string
  status: MedicationStatus
  authorizedBy: string
  authorizedByName: string
  createdAt: string
  updatedAt: string
  logsCount: number
  lastAdministeredAt: string | null
}

export type MedicationLog = {
  id: string
  medicationId: string
  childId: string
  administeredAt: string
  dosageGiven: string
  reaction: ChildReaction
  administeredBy: string
  administeredByName: string
  witnessBy: string | null
  witnessByName: string | null
  notes: string
  createdAt: string
}

export type DailyHealthCheck = {
  id: string
  childId: string
  childName: string
  groupName: string
  checkDate: string
  checkTime: string
  temperatureCelsius: number
  symptoms: string[]
  passedTriage: boolean
  notes: string
  checkedBy: string
  checkedByName: string
  createdAt: string
  updatedAt: string
}

export type MedicationSummaryStats = {
  total: number
  active: number
  completed: number
  cancelled: number
}

export type HealthCheckSummaryStats = {
  total: number
  passed: number
  flagged: number
  averageTemp: number
}

export type CreateMedicationInput = {
  childId: string
  medicationName: string
  dosage: string
  frequencySchedule: string
  instructions: string
  storageType: MedicationStorage
  doctorName: string
  prescriptionNumber?: string
  startDate: string
  endDate: string
}

export type UpdateMedicationInput = {
  status?: MedicationStatus
  instructions?: string
  storageType?: MedicationStorage
  endDate?: string
}

export type AdministerMedicationInput = {
  dosageGiven: string
  reaction: ChildReaction
  witnessBy?: string | null
  notes?: string
  administeredAt?: string
}

export type CreateHealthCheckInput = {
  childId: string
  checkDate: string
  checkTime: string
  temperatureCelsius: number
  symptoms: string[]
  passedTriage: boolean
  notes?: string
}

export async function listMedications(token: string, options?: { childId?: string; status?: MedicationStatus }, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (options?.childId) query.set('childId', options.childId)
  if (options?.status) query.set('status', options.status)
  const qs = query.toString() ? `?${query}` : ''
  return api<{ medications: ChildMedication[]; summary: MedicationSummaryStats }>(`/api/medications${qs}`, { signal }, token)
}

export async function createMedication(token: string, input: CreateMedicationInput) {
  return api<{ success: boolean; medication: ChildMedication }>('/api/medications', {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export async function updateMedication(token: string, id: string, input: UpdateMedicationInput) {
  return api<{ success: boolean; medication: ChildMedication }>(`/api/medications/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  }, token)
}

export async function listMedicationLogs(token: string, medicationId: string, signal?: AbortSignal) {
  return api<{ logs: MedicationLog[] }>(`/api/medications/${medicationId}/logs`, { signal }, token)
}

export async function administerMedication(token: string, medicationId: string, input: AdministerMedicationInput) {
  return api<{ success: boolean; log: MedicationLog }>(`/api/medications/${medicationId}/administer`, {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export async function listHealthChecks(token: string, options?: { date?: string; childId?: string }, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (options?.date) query.set('date', options.date)
  if (options?.childId) query.set('childId', options.childId)
  const qs = query.toString() ? `?${query}` : ''
  return api<{ checks: DailyHealthCheck[]; summary: HealthCheckSummaryStats }>(`/api/health-checks${qs}`, { signal }, token)
}

export async function createHealthCheck(token: string, input: CreateHealthCheckInput) {
  return api<{ success: boolean; check: DailyHealthCheck }>('/api/health-checks', {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export type HygieneEntryType = 'diaper' | 'potty'
export type DiaperType = 'wet' | 'dirty' | 'both' | 'dry'
export type PottyResult = 'success_pee' | 'success_bm' | 'success_both' | 'tried_dry' | 'accident'

export type ChildHygieneLog = {
  id: string
  childId: string
  childName: string
  groupName: string
  logDate: string
  logTime: string
  entryType: HygieneEntryType
  diaperType: DiaperType | null
  pottyResult: PottyResult | null
  creamApplied: boolean
  notes: string
  recordedBy: string
  recordedByName: string
  createdAt: string
  updatedAt: string
}

export type HygieneSummaryStats = {
  total: number
  wetCount: number
  dirtyCount: number
  pottySuccessCount: number
  accidentsCount: number
  creamCount: number
}

export type CreateHygieneLogInput = {
  childId: string
  logDate: string
  logTime: string
  entryType: HygieneEntryType
  diaperType?: DiaperType | null
  pottyResult?: PottyResult | null
  creamApplied?: boolean
  notes?: string
}

export type UpdateHygieneLogInput = {
  logTime?: string
  entryType?: HygieneEntryType
  diaperType?: DiaperType | null
  pottyResult?: PottyResult | null
  creamApplied?: boolean
  notes?: string
}

export async function listHygieneLogs(token: string, options?: { childId?: string; date?: string; type?: HygieneEntryType }, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (options?.childId) query.set('childId', options.childId)
  if (options?.date) query.set('date', options.date)
  if (options?.type) query.set('type', options.type)
  const qs = query.toString() ? `?${query}` : ''
  return api<{ logs: ChildHygieneLog[]; summary: HygieneSummaryStats }>(`/api/hygiene-logs${qs}`, { signal }, token)
}

export async function createHygieneLog(token: string, input: CreateHygieneLogInput) {
  return api<{ success: boolean; log: ChildHygieneLog }>('/api/hygiene-logs', {
    method: 'POST',
    body: JSON.stringify(input),
  }, token)
}

export async function updateHygieneLog(token: string, id: string, input: UpdateHygieneLogInput) {
  return api<{ success: boolean; log: ChildHygieneLog }>(`/api/hygiene-logs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  }, token)
}

export async function deleteHygieneLog(token: string, id: string) {
  return api<{ success: boolean }>(`/api/hygiene-logs/${id}`, {
    method: 'DELETE',
  }, token)
}

export type TimelineCategory = 'arrival' | 'departure' | 'health' | 'hygiene' | 'sleep' | 'medication' | 'moment' | 'report' | 'incident'

export type TimelineEvent = {
  id: string
  category: TimelineCategory
  time: string
  title: string
  description: string
  badge?: string
  icon: string
  imageUrl?: string | null
  author?: string
}

export type TimelineSummary = {
  totalEvents: number
  checkInTime: string | null
  checkOutTime: string | null
  napMinutes: number
  hygieneCount: number
  hasHealthCheck: boolean
  hasReport: boolean
}

export type TimelineResponse = {
  child: {
    id: string
    name: string
    groupName: string
  }
  date: string
  summary: TimelineSummary
  timeline: TimelineEvent[]
}

export async function getTimeline(token: string, childId: string, date: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ childId, date })
  return api<TimelineResponse>(`/api/timeline?${query}`, { signal }, token)
}

export type FeatureRole = 'director' | 'teacher' | 'parent'

export type FeaturePermissionMap = {
  director: Record<string, boolean>
  teacher: Record<string, boolean>
  parent: Record<string, boolean>
}

export type FeatureInfo = {
  key: string
  category: 'daily' | 'community' | 'admin'
}

export async function getFeaturePermissions(token: string, signal?: AbortSignal) {
  return api<{
    permissions: FeaturePermissionMap
    features: FeatureInfo[]
    role?: string
    enabledFeatures?: string[]
  }>('/api/features', { signal }, token)
}

export async function updateFeaturePermission(
  token: string,
  role: FeatureRole,
  featureKey: string,
  isEnabled: boolean,
) {
  return api<{
    success: boolean
    permissions: FeaturePermissionMap
  }>('/api/admin/features', {
    method: 'PUT',
    body: JSON.stringify({ role, featureKey, isEnabled }),
  }, token)
}

export async function resetFeaturePermissions(token: string) {
  return api<{
    success: boolean
    permissions: FeaturePermissionMap
  }>('/api/admin/features/reset', {
    method: 'POST',
  }, token)
}

export type ChildProfileChild = {
  id: string
  name: string
  groupName: string
  parentUserId: string
  photoConsent: boolean
  allergies: string
  isSpecial: boolean
}

export type ChildProfileParent = {
  id: string
  name: string
  email: string
  phone: string
}

export type ChildProfilePickup = {
  id: string
  name: string
  relationship: string
  phone: string
  isEmergency: boolean
}

export type ChildProfileMedical = {
  pediatricianName: string
  pediatricianPhone: string
  bloodType: string
  chronicConditions: string
  emergencyMedications: string
  notes: string
} | null

export type ChildProfileMedication = {
  id: string
  medicationName: string
  dosage: string
  frequencySchedule: string
  instructions: string
}

export type ChildProfileAttendance = {
  totalPresent: number
  totalAbsent: number
  streak: number
  history: { date: string; status: 'present' | 'absent' }[]
}

export type ChildProfileRecentReport = {
  id: string
  date: string
  mood: string
  meals: string
  nap: string
  activities: string
  note: string
  photoUrl?: string | null
}

export type ChildProfileMilestones = {
  masteredCount: number
  achievedCount: number
  emergingCount: number
  totalTracked: number
  sampleMastered: { status: string; domain: string; titleEn: string; titleSq: string }[]
}

export type ChildProfileResponse = {
  child: ChildProfileChild
  parent: ChildProfileParent | null
  pickups: ChildProfilePickup[]
  medical: ChildProfileMedical
  activeMedications: ChildProfileMedication[]
  attendance: ChildProfileAttendance
  recentReports: ChildProfileRecentReport[]
  milestones: ChildProfileMilestones
}

export async function getChildProfile(childId: string, token: string, signal?: AbortSignal) {
  return api<ChildProfileResponse>(`/api/children/${encodeURIComponent(childId)}/profile`, { signal }, token)
}

export async function downloadDatabaseBackup(token: string) {
  const deadline = AbortSignal.timeout(30_000)
  const res = await fetch(`${API_URL}/api/admin/backup`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: deadline,
  })
  if (!res.ok) throw new ApiError('backup_download_failed', res.status)
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') || ''
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/)
  const filename = filenameMatch ? filenameMatch[1] : `kidoland-backup-${new Date().toISOString().slice(0, 10)}.sqlite`
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}

export async function restoreDatabaseBackup(token: string, file: File | Blob) {
  const deadline = AbortSignal.timeout(60_000)
  const res = await fetch(`${API_URL}/api/admin/restore`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: file,
    signal: deadline,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(data.error || 'restore_failed', res.status)
  }
  return data as { ok: boolean; message: string }
}

export async function cleanOldReportPhotosRequest(token: string, days = 30) {
  return api<{ ok: boolean; deletedCount: number }>('/api/admin/clean-photos', {
    method: 'POST',
    body: JSON.stringify({ days }),
  }, token)
}
