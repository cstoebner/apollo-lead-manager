import type { Availability, Instructor, InstructorAvailability, Lead, ScheduleEntry, TrialOpening } from './types'

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()
const daysFromNow = (days: number, hour: number) => {
  const date = new Date(Date.now() + days * 86_400_000)
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}

// Indexed by Date.getDay(): 0 = Sunday … 6 = Saturday
export const defaultAvailability: Availability = [
  { start: '13:00', end: '15:00', hotOnly: true }, // Sunday — hot leads only, nurture waits
  { start: '16:30', end: '19:00' }, // Monday
  { start: '16:30', end: '19:00' }, // Tuesday
  { start: '16:30', end: '19:00' }, // Wednesday
  { start: '16:30', end: '19:00' }, // Thursday
  { start: '16:00', end: '19:00' }, // Friday
  { start: '10:00', end: '12:00' }, // Saturday
]

export const demoTrialOpenings: TrialOpening[] = []

export const demoInstructors: Instructor[] = [
  { id: 'luke', name: 'Luke', instruments: ['Guitar'] },
  { id: 'faith', name: 'Faith', instruments: ['Voice', 'Piano'] },
  { id: 'kristina', name: 'Kristina', instruments: ['Piano', 'Voice'] },
  { id: 'race', name: 'Race', instruments: ['Saxophone'] },
  { id: 'conor', name: 'Conor', instruments: ['Trumpet', 'Trombone'] },
]

export const demoInstructorAvailability: InstructorAvailability[] = [
  { id: 'av1', instructorId: 'luke', dayOfWeek: 1, startTime: '16:30', endTime: '21:30' },
  { id: 'av2', instructorId: 'luke', dayOfWeek: 6, startTime: '11:00', endTime: '15:00' },
  { id: 'av3', instructorId: 'faith', dayOfWeek: 2, startTime: '16:30', endTime: '20:00' },
  { id: 'av4', instructorId: 'faith', dayOfWeek: 4, startTime: '16:30', endTime: '20:00' },
  { id: 'av5', instructorId: 'faith', dayOfWeek: 6, startTime: '10:00', endTime: '14:00' },
  { id: 'av6', instructorId: 'kristina', dayOfWeek: 1, startTime: '15:00', endTime: '20:00' },
  { id: 'av7', instructorId: 'kristina', dayOfWeek: 3, startTime: '15:00', endTime: '20:00' },
  { id: 'av8', instructorId: 'race', dayOfWeek: 2, startTime: '16:00', endTime: '20:00' },
  { id: 'av9', instructorId: 'conor', dayOfWeek: 4, startTime: '16:00', endTime: '20:00' },
]

export const demoScheduleEntries: ScheduleEntry[] = [
  { id: 'se1', instructorId: 'luke', studentName: 'Jordan', instrument: 'Guitar', kind: 'regular', durationMinutes: 30, dayOfWeek: 1, startTime: '17:30', startsOn: '2025-01-01' },
  { id: 'se2', instructorId: 'luke', studentName: 'Mia', instrument: 'Guitar', kind: 'regular', durationMinutes: 30, dayOfWeek: 6, startTime: '11:30', startsOn: '2025-01-01' },
  { id: 'se3', instructorId: 'luke', studentName: 'Theo', instrument: 'Guitar', kind: 'regular', durationMinutes: 30, dayOfWeek: 6, startTime: '12:00', startsOn: '2025-01-01' },
  { id: 'se4', instructorId: 'faith', studentName: 'Sofia', instrument: 'Voice', kind: 'regular', durationMinutes: 30, dayOfWeek: 2, startTime: '17:30', startsOn: '2025-01-01' },
  { id: 'se5', instructorId: 'faith', studentName: 'Amelia', instrument: 'Piano', kind: 'regular', durationMinutes: 30, dayOfWeek: 4, startTime: '18:00', startsOn: '2025-01-01' },
  { id: 'se6', instructorId: 'kristina', studentName: 'Leo', instrument: 'Piano', kind: 'regular', durationMinutes: 30, dayOfWeek: 1, startTime: '16:00', startsOn: '2025-01-01' },
]

export const demoLeads: Lead[] = [
  {
    id: '1', name: 'Maya Thompson', phone: '(614) 555-0127', email: 'maya@example.com', instruments: ['Piano'],
    receivedAt: hoursAgo(1.2), source: 'Meta', campaign: 'Summer Piano', status: 'hot', activities: [],
    holdFormComplete: false, trialAttended: false,
  },
  {
    id: '2', name: 'Noah Williams', phone: '(614) 555-0192', email: 'noah@example.com', instruments: ['Guitar'],
    receivedAt: hoursAgo(45), source: 'Website Traffic', campaign: 'Website inquiry', status: 'hot',
    activities: [{ id: 'a1', type: 'call', occurredAt: hoursAgo(42), outcome: 'Voicemail' }, { id: 'a2', type: 'text', occurredAt: hoursAgo(41.8), outcome: 'Intro text sent' }],
    holdFormComplete: false, trialAttended: false,
  },
  {
    id: '3', name: 'Olivia Chen', phone: '(614) 555-0144', email: 'olivia@example.com', instruments: ['Voice', 'Piano'],
    receivedAt: hoursAgo(118), source: 'Meta', campaign: 'Find Your Voice', status: 'hot',
    activities: [{ id: 'a3', type: 'call', occurredAt: hoursAgo(116), outcome: 'Connected' }],
    trialAt: daysFromNow(2, 17), holdFormComplete: true, trialAttended: false,
  },
  {
    id: '4', name: 'Liam Davis', phone: '(614) 555-0178', email: 'liam@example.com', instruments: ['Drums'],
    receivedAt: hoursAgo(210), source: 'WLS', campaign: 'World Learner School', status: 'active_student',
    activities: [{ id: 'a4', type: 'call', occurredAt: hoursAgo(208), outcome: 'Connected' }, { id: 'a5', type: 'text', occurredAt: hoursAgo(190), outcome: 'Trial reminder' }],
    trialAt: hoursAgo(72), holdFormComplete: true, trialAttended: true, enrolledAt: hoursAgo(48),
  },
  {
    id: '5', name: 'Ethan Rodriguez', phone: '(614) 555-0163', email: 'ethan@example.com', instruments: ['Saxophone'],
    receivedAt: hoursAgo(480), source: 'Meta', campaign: 'Summer Music', status: 'nurture',
    activities: [{ id: 'a6', type: 'call', occurredAt: hoursAgo(475), outcome: 'Voicemail' }, { id: 'a7', type: 'text', occurredAt: hoursAgo(430), outcome: 'Follow-up sent' }],
    holdFormComplete: false, trialAttended: false,
  },
  {
    id: '6', name: 'Sophia Martin', phone: '(614) 555-0116', email: 'sophia@example.com', instruments: ['Piano'],
    receivedAt: hoursAgo(1080), source: 'Word of Mouth', campaign: 'Parent referral', status: 'nurture_long_term',
    activities: [{ id: 'a8', type: 'call', occurredAt: hoursAgo(1076), outcome: 'Interested next semester' }],
    holdFormComplete: false, trialAttended: false,
  },
]
