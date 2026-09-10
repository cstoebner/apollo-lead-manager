import type { EsstHoursEntry, EsstUsageEntry } from './types'

// Minnesota Earned Sick and Safe Time (accrual method): 1 hour earned per 30 hours worked,
// balance capped at 80 hours — accrual pauses at the cap until usage brings it back down.
export const ESST_ACCRUAL_DIVISOR = 30
export const ESST_BALANCE_CAP = 80

export interface EsstSummary {
  accrued: number
  used: number
  balance: number
}

type TimelineEvent = { at: string; order: number; hours: number }

export function esstSummaryFor(instructorId: string, hoursEntries: EsstHoursEntry[], usageEntries: EsstUsageEntry[]): EsstSummary {
  const accrualEvents: TimelineEvent[] = hoursEntries
    .filter((entry) => entry.instructorId === instructorId)
    .map((entry) => ({ at: entry.periodEndsOn, order: 0, hours: entry.hoursWorked / ESST_ACCRUAL_DIVISOR }))
  const usageEvents: TimelineEvent[] = usageEntries
    .filter((entry) => entry.instructorId === instructorId)
    .map((entry) => ({ at: entry.usedOn, order: 1, hours: entry.hours }))

  const events = [...accrualEvents, ...usageEvents].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.order - b.order)

  let balance = 0
  let accrued = 0
  let used = 0
  for (const event of events) {
    if (event.order === 0) {
      const applied = Math.max(0, Math.min(event.hours, ESST_BALANCE_CAP - balance))
      balance += applied
      accrued += applied
    } else {
      balance -= event.hours
      used += event.hours
    }
  }

  return { accrued, used, balance: Math.max(0, Math.min(balance, ESST_BALANCE_CAP)) }
}
