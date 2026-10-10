// Builds Acuity Scheduling booking links. Pure and dependency-free so it can run
// either in the browser (to preview a link before texting it) or in a Cloudflare
// Worker (which has no "local timezone" of its own -- it's always UTC there), so
// every date must be formatted with an explicit IANA timeZone rather than relying
// on the runtime's local clock.

const ACUITY_TIME_ZONE = 'America/Chicago'

// Intl's "longOffset" form reliably returns e.g. "GMT-05:00" / "GMT-06:00" and
// correctly reflects DST for the given instant -- unlike "shortOffset", which some
// engines render as a zone abbreviation ("CDT") instead of a numeric offset.
function offsetFor(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(date)
  const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const match = raw.match(/GMT([+-]\d{2}:\d{2})/)
  return match ? match[1] : '+00:00'
}

function wallClockParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  // Midnight is sometimes rendered as hour "24" with hour12: false in some engines; normalize it.
  const hour = get('hour') === '24' ? '00' : get('hour')
  return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute'), second: get('second') }
}

// e.g. 2026-09-19T14:00:00-05:00 -- the exact format Acuity's booking URL expects.
export function isoWithZoneOffset(date: Date, timeZone: string = ACUITY_TIME_ZONE): string {
  const { year, month, day, hour, minute, second } = wallClockParts(date, timeZone)
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetFor(date, timeZone)}`
}

export interface AcuityBookingLinkOptions {
  schedulerId: string
  appointmentTypeId: string
  calendarId: string
  startsAt: Date
  timeZone?: string
  prefill?: { firstName?: string; lastName?: string; email?: string; phone?: string }
}

export function buildAcuityBookingLink({ schedulerId, appointmentTypeId, calendarId, startsAt, timeZone = ACUITY_TIME_ZONE, prefill }: AcuityBookingLinkOptions): string {
  const datetime = isoWithZoneOffset(startsAt, timeZone)
  const path = `https://app.acuityscheduling.com/schedule/${schedulerId}/appointment/${appointmentTypeId}/calendar/${calendarId}/datetime/${encodeURIComponent(datetime)}`
  const params = new URLSearchParams({ calendarIds: calendarId })
  if (prefill?.firstName) params.set('firstName', prefill.firstName)
  if (prefill?.lastName) params.set('lastName', prefill.lastName)
  if (prefill?.email) params.set('email', prefill.email)
  if (prefill?.phone) params.set('phone', prefill.phone)
  return `${path}?${params.toString()}`
}
