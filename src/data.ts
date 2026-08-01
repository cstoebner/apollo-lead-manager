import type { Availability, Lead } from './types'

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()
const daysFromNow = (days: number, hour: number) => {
  const date = new Date(Date.now() + days * 86_400_000)
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}

export const defaultAvailability: Availability = {
  weekdayStart: '16:30',
  weekdayEnd: '20:00',
  weekendStart: '10:00',
  weekendEnd: '16:00',
  tuesdayBlackout: ['17:00', '17:30'],
  thursdayBlackout: ['16:30', '17:30'],
}

export const demoLeads: Lead[] = [
  {
    id: '1', name: 'Maya Thompson', phone: '(614) 555-0127', email: 'maya@example.com', instrument: 'Piano',
    receivedAt: hoursAgo(1.2), source: 'Facebook', campaign: 'Summer Piano', status: 'new', activities: [],
    holdFormComplete: false, trialAttended: false, adCost: 24,
  },
  {
    id: '2', name: 'Noah Williams', phone: '(614) 555-0192', email: 'noah@example.com', instrument: 'Guitar',
    receivedAt: hoursAgo(45), source: 'Google', campaign: 'Guitar Lessons', status: 'contacting',
    activities: [{ id: 'a1', type: 'call', occurredAt: hoursAgo(42), outcome: 'Voicemail' }, { id: 'a2', type: 'text', occurredAt: hoursAgo(41.8), outcome: 'Intro text sent' }],
    holdFormComplete: false, trialAttended: false, adCost: 31,
  },
  {
    id: '3', name: 'Olivia Chen', phone: '(614) 555-0144', email: 'olivia@example.com', instrument: 'Voice',
    receivedAt: hoursAgo(118), source: 'Instagram', campaign: 'Find Your Voice', status: 'trial_booked',
    activities: [{ id: 'a3', type: 'call', occurredAt: hoursAgo(116), outcome: 'Connected' }],
    trialAt: daysFromNow(2, 17), holdFormComplete: true, trialAttended: false, adCost: 19,
  },
  {
    id: '4', name: 'Liam Davis', phone: '(614) 555-0178', email: 'liam@example.com', instrument: 'Drums',
    receivedAt: hoursAgo(210), source: 'Google', campaign: 'Music Lessons Near Me', status: 'enrolled',
    activities: [{ id: 'a4', type: 'call', occurredAt: hoursAgo(208), outcome: 'Connected' }, { id: 'a5', type: 'text', occurredAt: hoursAgo(190), outcome: 'Trial reminder' }],
    trialAt: hoursAgo(72), holdFormComplete: true, trialAttended: true, enrolledAt: hoursAgo(48), adCost: 38,
  },
  {
    id: '5', name: 'Ethan Rodriguez', phone: '(614) 555-0163', email: 'ethan@example.com', instrument: 'Saxophone',
    receivedAt: hoursAgo(480), source: 'Facebook', campaign: 'Summer Music', status: 'nurture',
    activities: [{ id: 'a6', type: 'call', occurredAt: hoursAgo(475), outcome: 'Voicemail' }, { id: 'a7', type: 'text', occurredAt: hoursAgo(430), outcome: 'Follow-up sent' }],
    holdFormComplete: false, trialAttended: false, adCost: 22,
  },
  {
    id: '6', name: 'Sophia Martin', phone: '(614) 555-0116', email: 'sophia@example.com', instrument: 'Piano',
    receivedAt: hoursAgo(1080), source: 'Referral', campaign: 'Parent referral', status: 'long_term_nurture',
    activities: [{ id: 'a8', type: 'call', occurredAt: hoursAgo(1076), outcome: 'Interested next semester' }],
    holdFormComplete: false, trialAttended: false, adCost: 0,
  },
]
