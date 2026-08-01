import type { Availability, Lead } from './types'

const DAY = 86_400_000
const OFFSETS = [0, 2, 5, 8]

const pad = (value: number) => String(value).padStart(2, '0')
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

function nthWeekday(year: number, month: number, weekday: number, occurrence: number) {
  const date = new Date(year, month, 1)
  const shift = (weekday - date.getDay() + 7) % 7
  date.setDate(1 + shift + (occurrence - 1) * 7)
  return dateKey(date)
}

function lastWeekday(year: number, month: number, weekday: number) {
  const date = new Date(year, month + 1, 0)
  date.setDate(date.getDate() - ((date.getDay() - weekday + 7) % 7))
  return dateKey(date)
}

function observed(date: Date) {
  const day = date.getDay()
  if (day === 6) date.setDate(date.getDate() - 1)
  if (day === 0) date.setDate(date.getDate() + 1)
  return dateKey(date)
}

export function majorHolidays(year: number) {
  const fixed = [new Date(year, 0, 1), new Date(year, 5, 19), new Date(year, 6, 4), new Date(year, 10, 11), new Date(year, 11, 25)]
  return new Set([
    ...fixed.flatMap((date) => [dateKey(date), observed(new Date(date))]),
    nthWeekday(year, 0, 1, 3),
    lastWeekday(year, 4, 1),
    nthWeekday(year, 8, 1, 1),
    nthWeekday(year, 10, 4, 4),
  ])
}

function setTime(date: Date, time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  date.setHours(hours, minutes, 0, 0)
  return date
}

function isInsideBlackout(date: Date, blackout: [string, string]) {
  const minutes = date.getHours() * 60 + date.getMinutes()
  const [startHour, startMinute] = blackout[0].split(':').map(Number)
  const [endHour, endMinute] = blackout[1].split(':').map(Number)
  return minutes >= startHour * 60 + startMinute && minutes < endHour * 60 + endMinute
}

function findAvailableTime(date: Date, availability: Availability) {
  const candidate = new Date(date)
  for (let attempts = 0; attempts < 14; attempts += 1) {
    const holidays = majorHolidays(candidate.getFullYear())
    if (holidays.has(dateKey(candidate))) {
      candidate.setDate(candidate.getDate() + 1)
      continue
    }

    const day = candidate.getDay()
    if (day === 0 || day === 6) {
      const start = setTime(new Date(candidate), availability.weekendStart)
      const end = setTime(new Date(candidate), availability.weekendEnd)
      if (candidate < start) return start
      if (candidate <= end) return candidate
      candidate.setDate(candidate.getDate() + 1)
      setTime(candidate, '00:00')
      continue
    }

    const start = setTime(new Date(candidate), availability.weekdayStart)
    const end = setTime(new Date(candidate), availability.weekdayEnd)
    let available = candidate < start ? start : new Date(candidate)
    if (available > end) {
      candidate.setDate(candidate.getDate() + 1)
      setTime(candidate, '00:00')
      continue
    }
    if (day === 2 && isInsideBlackout(available, availability.tuesdayBlackout)) {
      available = setTime(available, availability.tuesdayBlackout[1])
    }
    if (day === 4 && isInsideBlackout(available, availability.thursdayBlackout)) {
      available = setTime(available, availability.thursdayBlackout[1])
    }
    return available
  }
  return candidate
}

export function nextContact(lead: Lead, availability: Availability, now = new Date()) {
  const attempts = lead.activities.filter((activity) => activity.type === 'call' || activity.type === 'text').length
  if (attempts === 0) {
    const received = new Date(lead.receivedAt)
    const isFresh = now.getTime() - received.getTime() < 4 * 60 * 60 * 1000
    if (isFresh && !majorHolidays(now.getFullYear()).has(dateKey(now))) {
      const available = findAvailableTime(now, availability)
      if (available.getTime() - now.getTime() < 60_000) return { at: now, reason: 'Fresh lead — contact now' }
      return { at: available, reason: 'Fresh lead — next open window' }
    }
  }

  const offset = OFFSETS[Math.min(attempts, OFFSETS.length - 1)] ?? 8
  const baseline = new Date(new Date(lead.receivedAt).getTime() + offset * DAY)
  const recent = lead.activities
    .filter((activity) => activity.type === 'call' || activity.type === 'text')
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0]
  if (recent && baseline <= new Date(recent.occurredAt)) baseline.setTime(Date.parse(recent.occurredAt) + 3 * DAY)
  if (baseline < now) baseline.setTime(now.getTime())

  return {
    at: findAvailableTime(baseline, availability),
    reason: attempts >= 3 ? 'Final cadence follow-up' : `Cadence follow-up ${attempts + 1}`,
  }
}
