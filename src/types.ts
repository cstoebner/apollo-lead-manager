export type LeadStatus = 'active_student' | 'hot' | 'action_pending' | 'nurture' | 'nurture_long_term' | 'unresponsive' | 'unenrolled'
export type ActivityType = 'call' | 'text' | 'email' | 'note' | 'status_change' | 'trial_update' | 'lead_created' | 'lead_update'

export interface Activity {
  id: string
  type: ActivityType
  occurredAt: string
  outcome: string
}

export interface Lead {
  id: string
  name: string
  studentName?: string
  phone: string
  email: string
  instruments: string[]
  receivedAt: string
  source: string
  campaign: string
  status: LeadStatus
  activities: Activity[]
  trialAt?: string
  holdFormComplete: boolean
  trialAttended: boolean
  enrolledAt?: string
  enrollmentAgreementSigned?: boolean
  followUpAt?: string
  followUpNote?: string
}

export interface DayWindow {
  start: string
  end: string
  hotOnly?: boolean
}

export type Availability = DayWindow[]

export interface TrialOpening {
  id: string
  instruments: string[]
  instructor: string
  startsAt: string
}

export interface Instructor {
  id: string
  name: string
  instruments: string[]
}

export interface InstructorAvailability {
  id: string
  instructorId: string
  dayOfWeek: number
  startTime: string
  endTime: string
}

export type ScheduleEntryKind = 'regular' | 'trial' | 'one_time' | 'break'

export interface ScheduleEntry {
  id: string
  instructorId: string
  leadId?: string
  studentName: string
  instrument: string
  kind: ScheduleEntryKind
  durationMinutes: 15 | 30 | 45 | 60
  dayOfWeek?: number
  startTime?: string
  startsAt?: string
  startsOn?: string
  endsOn?: string
  skippedDates?: string[]
  repeatIntervalWeeks?: 1 | 2
}

export interface ScheduleActivity {
  id: string
  occurredAt: string
  action: string
  instructor: string
  details: string
  studentName?: string
}
