export type LeadStatus = 'new' | 'contacting' | 'trial_booked' | 'trial_complete' | 'nurture' | 'long_term_nurture' | 'enrolled' | 'lost'
export type ActivityType = 'call' | 'text' | 'email' | 'note'

export interface Activity {
  id: string
  type: ActivityType
  occurredAt: string
  outcome: string
}

export interface Lead {
  id: string
  name: string
  phone: string
  email: string
  instrument: string
  receivedAt: string
  source: string
  campaign: string
  status: LeadStatus
  activities: Activity[]
  trialAt?: string
  holdFormComplete: boolean
  trialAttended: boolean
  enrolledAt?: string
  adCost: number
}

export interface Availability {
  weekdayStart: string
  weekdayEnd: string
  weekendStart: string
  weekendEnd: string
  tuesdayBlackout: [string, string]
  thursdayBlackout: [string, string]
}
