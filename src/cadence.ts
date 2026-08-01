import type { Availability, Lead } from './types'

const DAY = 86_400_000
const OFFSETS = [0, 2, 5, 8]

const pad = (value: number) => String(value).padStart(2, '0')
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

type OutreachProgress = {
  stage: number
  complete: boolean
  callLogged: boolean
  textLogged: boolean
  lastCompletedAt?: number
  partialAt?: number
}

const activeCallRequired = [true, false, false, false]

export function activeCadenceState(lead: Lead): OutreachProgress {
  const events = lead.activities
    .filter((activity) => activity.type === 'call' || activity.type === 'text')
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
  let stage = 0
  let callLogged = false
  let textLogged = false
  let lastCompletedAt: number | undefined

  for (const activity of events) {
    if (stage >= OFFSETS.length) break
    if (activity.type === 'call') callLogged = true
    if (activity.type === 'text') textLogged = true
    if (textLogged && (!activeCallRequired[stage] || callLogged)) {
      lastCompletedAt = Date.parse(activity.occurredAt)
      stage += 1
      callLogged = false
      textLogged = false
    }
  }

  const latestPartial = events.length && (callLogged || textLogged) ? Date.parse(events[events.length - 1].occurredAt) : undefined
  return { stage, complete: stage >= OFFSETS.length, callLogged, textLogged, lastCompletedAt, partialAt: latestPartial }
}

export function nurtureStartedAt(lead: Lead) {
  const statusChange = [...lead.activities].reverse().find((activity) =>
    activity.type === 'status_change' && activity.outcome.includes('to Nurture'),
  )
  return statusChange ? new Date(statusChange.occurredAt) : new Date(lead.receivedAt)
}

export function nurtureWeekFor(lead: Lead, contactAt: Date) {
  const elapsedWeeks = Math.max(2, (contactAt.getTime() - nurtureStartedAt(lead).getTime()) / DAY / 7)
  return Math.ceil(elapsedWeeks / 2) * 2
}

export function nurtureRequiresCall(lead: Lead, contactAt: Date) {
  const week = nurtureWeekFor(lead, contactAt)
  return week <= 2 || (week > 4 && week <= 6) || (week > 8 && week <= 10)
}

export function nurtureCadenceState(lead: Lead): OutreachProgress {
  const startedAt = nurtureStartedAt(lead).getTime()
  const groups = new Map<string, { call: boolean; text: boolean; lastAt: number }>()
  lead.activities
    .filter((activity) => (activity.type === 'call' || activity.type === 'text') && Date.parse(activity.occurredAt) >= startedAt)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
    .forEach((activity) => {
      const timestamp = Date.parse(activity.occurredAt)
      const key = dateKey(new Date(timestamp))
      const group = groups.get(key) ?? { call: false, text: false, lastAt: timestamp }
      if (activity.type === 'call') group.call = true
      if (activity.type === 'text') group.text = true
      group.lastAt = Math.max(group.lastAt, timestamp)
      groups.set(key, group)
    })

  let stage = 0
  let lastCompletedAt: number | undefined
  let partial: { call: boolean; text: boolean; lastAt: number } | undefined
  for (const group of groups.values()) {
    const complete = group.text && (!nurtureRequiresCall(lead, new Date(group.lastAt)) || group.call)
    if (complete) {
      stage += 1
      lastCompletedAt = group.lastAt
      partial = undefined
    } else if (!lastCompletedAt || group.lastAt > lastCompletedAt) {
      partial = group
    }
  }

  return {
    stage,
    complete: false,
    callLogged: partial?.call ?? false,
    textLogged: partial?.text ?? false,
    lastCompletedAt,
    partialAt: partial?.lastAt,
  }
}

function contactDays(lead: Lead) {
  const latestByDay = new Map<string, number>()
  lead.activities
    .filter((activity) => activity.type === 'call' || activity.type === 'text')
    .forEach((activity) => {
      const timestamp = Date.parse(activity.occurredAt)
      const key = dateKey(new Date(timestamp))
      latestByDay.set(key, Math.max(latestByDay.get(key) ?? 0, timestamp))
    })
  return [...latestByDay.values()].sort((a, b) => b - a)
}

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
  const progress = activeCadenceState(lead)
  if (progress.complete) return { at: now, reason: 'Active cadence complete', complete: true }
  const stage = Math.min(progress.stage, OFFSETS.length - 1)
  if (progress.partialAt) return { at: now, reason: 'Finish this outreach step', complete: false }
  if (stage === 0) {
    return { at: now, reason: 'New lead — contact now' }
  }

  const offset = OFFSETS[stage] ?? 8
  const baseline = new Date(new Date(lead.receivedAt).getTime() + offset * DAY)
  const recent = progress.lastCompletedAt
  const previousOffset = OFFSETS[Math.max(0, stage - 1)] ?? 0
  const interval = Math.max(1, offset - previousOffset)
  if (recent && baseline.getTime() <= recent) baseline.setTime(recent + interval * DAY)
  if (baseline < now) baseline.setTime(now.getTime())

  return {
    at: findAvailableTime(baseline, availability),
    reason: stage >= 3 ? 'Final cadence follow-up' : `Cadence follow-up ${stage + 1}`,
    complete: false,
  }
}

export function nextNurtureContact(lead: Lead, availability: Availability, now = new Date()) {
  const progress = nurtureCadenceState(lead)
  const intervalDays = 14
  if (progress.partialAt) return {
    at: now,
    channel: 'call' as const,
    reason: 'Finish this nurture step',
  }
  const anchor = progress.lastCompletedAt ?? nurtureStartedAt(lead).getTime()
  let target = new Date(anchor + intervalDays * DAY)
  if (target < now) target = new Date(now)
  if (target.getDay() === 6) target.setDate(target.getDate() + 2)
  if (target.getDay() === 0) target.setDate(target.getDate() + 1)

  return {
    at: findAvailableTime(target, availability),
    channel: 'call' as const,
    reason: lead.status === 'nurture_long_term' ? '2-week long-term nurture' : '2-week nurture',
  }
}
