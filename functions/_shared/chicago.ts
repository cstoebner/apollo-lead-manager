// The studio runs on Central time, but a Cloudflare Worker's own clock is UTC -- so everything that depends
// on "what day/time is this lesson" (recurring lessons, week phase, email wording) must be computed with an
// explicit time zone. This is a server-side port of the schedule helpers in src/App.tsx (entryOccursOnDate,
// onRecurrencePhase, timesOverlap, entryTakingOpening), which use the browser's local time.

const ZONE = 'America/Chicago'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})

export function chicagoParts(date: Date) {
  const parts = partsFormat.formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0'
  const hour = Number(get('hour')) % 24 // some engines render midnight as 24
  const minute = Number(get('minute'))
  return {
    key: `${get('year')}-${get('month')}-${get('day')}`,
    dayOfWeek: WEEKDAYS.indexOf(get('weekday')),
    minutes: hour * 60 + minute,
  }
}

const dayNumber = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000)
}

// Weeks since Monday 2024-01-01, matching weekIndexSince in the app.
function weekIndex(key: string) {
  const day = dayNumber(key)
  const mondayBased = (((day + 3) % 7) + 7) % 7 // 1970-01-01 was a Thursday; 0 = Monday
  return Math.round((day - mondayBased - dayNumber('2024-01-01')) / 7)
}

export interface ScheduleEntryRow {
  instructor_id: string
  kind: 'regular' | 'trial' | 'one_time' | 'break' | 'vacation'
  duration_minutes: number | null
  day_of_week: number | null
  start_time: string | null // 'HH:MM:SS'
  starts_at: string | null
  starts_on: string | null
  ends_on: string | null
  skipped_dates: string[] | null
  repeat_interval_weeks: number | null
}

function occursOn(entry: ScheduleEntryRow, key: string, dayOfWeek: number) {
  if (entry.kind === 'regular') {
    if (entry.day_of_week !== dayOfWeek) return false
    if (entry.starts_on && key < entry.starts_on) return false
    if (entry.ends_on && key > entry.ends_on) return false
    if (entry.skipped_dates?.includes(key)) return false
    if ((entry.repeat_interval_weeks ?? 1) === 2 && entry.starts_on) {
      return (((weekIndex(key) - weekIndex(entry.starts_on)) % 2) + 2) % 2 === 0
    }
    return true
  }
  return Boolean(entry.starts_at && chicagoParts(new Date(entry.starts_at)).key === key)
}

function entryStartMinutes(entry: ScheduleEntryRow) {
  if (entry.kind === 'regular') {
    const [hour, minute] = (entry.start_time ?? '00:00').split(':').map(Number)
    return hour * 60 + minute
  }
  return chicagoParts(new Date(entry.starts_at!)).minutes
}

// True when a lesson/break/vacation sits on top of [startsAt, startsAt + durationMinutes).
export function entryTakesSlot(entry: ScheduleEntryRow, startsAt: Date, durationMinutes = 30) {
  const slot = chicagoParts(startsAt)
  if (!occursOn(entry, slot.key, slot.dayOfWeek)) return false
  const start = entryStartMinutes(entry)
  return start < slot.minutes + durationMinutes && slot.minutes < start + (entry.duration_minutes ?? 30)
}

// "Tuesday, October 14 at 5:00 PM" -- built by hand because Intl's joiner ("at" vs ",") differs between engines.
export function friendlyTime(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('weekday')}, ${get('month')} ${get('day')} at ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`
}
