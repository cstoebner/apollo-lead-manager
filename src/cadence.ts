import type { Activity, Availability, Lead } from './types'

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
  dueNow?: boolean
}

// A "cadence_change" activity is a manual checkpoint (see CadenceMoveModal): the latest one for a track
// overrides the position derived from call/text history, and only activity logged after it counts.
export type CadenceCheckpoint = { at: number; target: number; dueNow: boolean }

export function latestCadenceCheckpoint(activities: Activity[], kind: 'active' | 'nurture'): CadenceCheckpoint | undefined {
  let latest: CadenceCheckpoint | undefined
  for (const activity of activities) {
    if (activity.type !== 'cadence_change') continue
    const match = kind === 'active' ? activity.outcome.match(/^Moved to step (\d) of/) : activity.outcome.match(/^Moved to nurture week (\d+)/)
    if (!match) continue
    const at = Date.parse(activity.occurredAt)
    if (latest && at < latest.at) continue
    latest = { at, target: kind === 'active' ? Number(match[1]) - 1 : Number(match[1]), dueNow: /· due now$/.test(activity.outcome) }
  }
  return latest
}

const activeCallRequired = [true, true, true, true]

export function activeCadenceState(lead: Lead): OutreachProgress {
  const checkpoint = latestCadenceCheckpoint(lead.activities, 'active')
  const events = lead.activities
    .filter((activity) => (activity.type === 'call' || activity.type === 'text') && (!checkpoint || Date.parse(activity.occurredAt) > checkpoint.at))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
  let stage = Math.min(checkpoint?.target ?? 0, OFFSETS.length - 1)
  let callLogged = false
  let textLogged = false
  let lastCompletedAt: number | undefined = checkpoint && stage > 0 ? checkpoint.at : undefined

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
  return { stage, complete: stage >= OFFSETS.length, callLogged, textLogged, lastCompletedAt, partialAt: latestPartial, dueNow: Boolean(checkpoint?.dueNow) && events.length === 0 }
}

type NurtureAnchor = Pick<Lead, 'receivedAt' | 'activities'>

// The checkpoint only applies if it was made during the current nurture stretch (not before a later move into Nurture).
export function activeNurtureCheckpoint(lead: NurtureAnchor) {
  const statusChange = [...lead.activities].reverse().find((activity) =>
    activity.type === 'status_change' && activity.outcome.includes('to Nurture'),
  )
  const checkpoint = latestCadenceCheckpoint(lead.activities, 'nurture')
  const baseAt = Date.parse(statusChange ? statusChange.occurredAt : lead.receivedAt)
  return checkpoint && checkpoint.at >= baseAt ? checkpoint : undefined
}

// Picks a virtual start so the existing elapsed-time week math lands on the chosen week: at the move itself when
// due now, or at the next contact (14 days later) when waiting the normal gap.
export function nurtureStartedAt(lead: NurtureAnchor) {
  const checkpoint = activeNurtureCheckpoint(lead)
  if (checkpoint) return new Date(checkpoint.at - (checkpoint.dueNow ? checkpoint.target - 1 : Math.max(0, checkpoint.target - 3)) * 7 * DAY)
  const statusChange = [...lead.activities].reverse().find((activity) =>
    activity.type === 'status_change' && activity.outcome.includes('to Nurture'),
  )
  return statusChange ? new Date(statusChange.occurredAt) : new Date(lead.receivedAt)
}

export function nurtureWeekFor(lead: NurtureAnchor, contactAt: Date) {
  const elapsedWeeks = Math.max(2, (contactAt.getTime() - nurtureStartedAt(lead).getTime()) / DAY / 7)
  return Math.ceil(elapsedWeeks / 2) * 2
}

export function nurtureRequiresCall(lead: NurtureAnchor, contactAt: Date) {
  const week = nurtureWeekFor(lead, contactAt)
  return week <= 2 || (week > 4 && week <= 6) || (week > 8 && week <= 10)
}

export function nurtureCadenceState(lead: Lead): OutreachProgress {
  const checkpoint = activeNurtureCheckpoint(lead)
  const startedAt = Math.max(nurtureStartedAt(lead).getTime(), checkpoint?.at ?? 0)
  const partialCutoff = Date.now() - 36 * 60 * 60 * 1000
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
    } else if (group.lastAt >= partialCutoff && (!lastCompletedAt || group.lastAt > lastCompletedAt)) {
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
    dueNow: Boolean(checkpoint?.dueNow) && groups.size === 0,
  }
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

function findAvailableTime(date: Date, availability: Availability, allowHotOnly: boolean) {
  const candidate = new Date(date)
  for (let attempts = 0; attempts < 14; attempts += 1) {
    const holidays = majorHolidays(candidate.getFullYear())
    if (holidays.has(dateKey(candidate))) {
      candidate.setDate(candidate.getDate() + 1)
      continue
    }

    const window = availability[candidate.getDay()]
    if (!window || (window.hotOnly && !allowHotOnly)) {
      candidate.setDate(candidate.getDate() + 1)
      setTime(candidate, '00:00')
      continue
    }

    const start = setTime(new Date(candidate), window.start)
    const end = setTime(new Date(candidate), window.end)
    const available = candidate < start ? start : new Date(candidate)
    if (available > end) {
      candidate.setDate(candidate.getDate() + 1)
      setTime(candidate, '00:00')
      continue
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
  if (progress.dueNow) {
    return { at: findAvailableTime(new Date(now), availability, true), reason: stage >= 3 ? 'Final cadence follow-up' : `Cadence follow-up ${stage + 1}`, complete: false }
  }

  const offset = OFFSETS[stage] ?? 8
  const previousOffset = OFFSETS[Math.max(0, stage - 1)] ?? 0
  const interval = Math.max(1, offset - previousOffset)
  const anchor = progress.lastCompletedAt ?? Date.parse(lead.receivedAt)
  const baseline = new Date(anchor + interval * DAY)
  if (baseline < now) baseline.setTime(now.getTime())

  return {
    at: findAvailableTime(baseline, availability, true),
    reason: stage >= 3 ? 'Final cadence follow-up' : `Cadence follow-up ${stage + 1}`,
    complete: false,
  }
}

export function nextNurtureContact(lead: Lead, availability: Availability, now = new Date()) {
  const progress = nurtureCadenceState(lead)
  const intervalDays = 14
  if (progress.partialAt) return {
    at: now,
    reason: 'Finish this nurture step',
  }
  const checkpoint = activeNurtureCheckpoint(lead)
  const anchor = progress.lastCompletedAt ?? checkpoint?.at ?? nurtureStartedAt(lead).getTime()
  let target = progress.dueNow ? new Date(now) : new Date(anchor + intervalDays * DAY)
  if (target < now) target = new Date(now)
  if (target.getDay() === 0) target.setDate(target.getDate() + 1) // Sunday's window is hot-leads only

  return {
    at: findAvailableTime(target, availability, false),
    reason: lead.status === 'nurture_long_term' ? '2-week long-term nurture' : '2-week nurture',
  }
}
