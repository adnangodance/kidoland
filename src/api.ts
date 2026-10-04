const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000'

export type Role = 'parent' | 'teacher' | 'director'

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

export async function meRequest(token: string) {
  return api<{ user: User }>('/api/auth/me', {}, token)
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
  breakfast: string
  morningSnack: string
  lunch: string
  afternoonSnack: string
  allergens?: string
  notes?: string
}

export async function listWeeklyMeals(token: string, signal?: AbortSignal) {
  return api<{ meals: WeeklyMeal[] }>('/api/meals', { signal }, token)
}

export async function updateWeeklyMeal(token: string, input: MealInput) {
  return api<{ meal: WeeklyMeal }>('/api/meals', {
    method: 'POST',
    body: JSON.stringify(input),
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
