// The studio runs on Central time, wherever the owner happens to be. The app does its date math with the browser's
// local-time functions (getHours, setDate, new Date(year, month, ...), toLocaleTimeString, <input type="datetime-local">
// values, ...), so a browser in Amsterdam would show and create everything seven hours off.
//
// Importing this file (first, in main.tsx) makes every "local time" operation use America/Chicago instead of the
// computer's zone. Instants (ISO strings with Z, getTime(), Date.now(), UTC) are untouched. Stored data is always an
// instant, so nothing in the database needs to change.

const ZONE = 'America/Chicago'
const NativeDate = Date
const NativeDateTimeFormat = Intl.DateTimeFormat
const DAY = 86_400_000

const partsFormat = new NativeDateTimeFormat('en-US', {
  timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
})

interface Wall { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number; ms: number }
const cache = new Map<number, Wall>()

// The Chicago wall-clock reading of an instant.
function wallOf(time: number): Wall {
  const hit = cache.get(time)
  if (hit) return hit
  const parts = partsFormat.formatToParts(new NativeDate(time))
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const year = get('year'), month = get('month') - 1, day = get('day')
  const wall: Wall = {
    year, month, day, hour: get('hour') % 24, minute: get('minute'), second: get('second'),
    weekday: new NativeDate(NativeDate.UTC(year, month, day)).getUTCDay(), ms: ((time % 1000) + 1000) % 1000,
  }
  if (cache.size > 5000) cache.clear()
  cache.set(time, wall)
  return wall
}

const wallAsUtc = (wall: Wall) => NativeDate.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second, wall.ms)
// Minutes Chicago is behind UTC at an instant (360 in winter, 300 in summer), like getTimezoneOffset.
const offsetMinutesAt = (time: number) => Math.round((time - wallAsUtc(wallOf(time))) / 60_000)

// A Chicago wall-clock time (components may overflow, like the native constructor allows) -> the instant.
function instantOf(year: number, month: number, day: number, hour: number, minute: number, second: number, ms: number): number {
  const wall = NativeDate.UTC(year, month, day, hour, minute, second, ms)
  if (Number.isNaN(wall)) return NaN
  // Try the offsets on either side of any daylight-saving change near this time.
  const before = offsetMinutesAt(wall - DAY) * 60_000
  const after = offsetMinutesAt(wall + DAY) * 60_000
  const exact = [...new Set([wall + before, wall + after])].filter((candidate) => wallAsUtc(wallOf(candidate)) === wall)
  if (exact.length === 1) return exact[0]
  if (exact.length === 2) return Math.min(...exact) // the repeated hour in the fall: the first one, as the native Date does
  return wall + before // the skipped hour in the spring: moves forward, as the native Date does
}

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2}|GMT|UTC)\s*(\([^)]*\))?$/i
const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/

function fromString(text: string): number {
  const trimmed = text.trim()
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(trimmed) || HAS_ZONE.test(trimmed)) return NativeDate.parse(trimmed) // date-only is UTC by spec; explicit zones are exact
  const iso = ISO_LOCAL.exec(trimmed)
  if (iso) return instantOf(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5], +(iso[6] ?? 0), +((iso[7] ?? '0').padEnd(3, '0')))
  // Any other format: let the browser read it as its own local time, then reinterpret that wall-clock reading as Chicago.
  const native = new NativeDate(trimmed)
  if (Number.isNaN(native.getTime())) return NaN
  return instantOf(native.getFullYear(), native.getMonth(), native.getDate(), native.getHours(), native.getMinutes(), native.getSeconds(), native.getMilliseconds())
}

function resolve(args: unknown[]): number {
  if (args.length === 0) return NativeDate.now()
  if (args.length === 1) {
    const value = args[0]
    if (typeof value === 'string') return fromString(value)
    if (value instanceof NativeDate) return value.getTime()
    return new NativeDate(value as number).getTime()
  }
  const [year, month = 0, day = 1, hour = 0, minute = 0, second = 0, ms = 0] = args.map(Number)
  return instantOf(year >= 0 && year <= 99 ? 1900 + year : year, month, day, hour, minute, second, ms)
}

class CentralDate extends NativeDate {
  constructor(...args: unknown[]) { super(resolve(args)) }
  static [Symbol.hasInstance](value: unknown) { return value instanceof NativeDate }
  static parse(text: string) { return fromString(String(text)) }

  getFullYear() { return Number.isNaN(this.getTime()) ? NaN : wallOf(this.getTime()).year }
  getMonth() { return Number.isNaN(this.getTime()) ? NaN : wallOf(this.getTime()).month }
  getDate() { return Number.isNaN(this.getTime()) ? NaN : wallOf(this.getTime()).day }
  getDay() { return Number.isNaN(this.getTime()) ? NaN : wallOf(this.getTime()).weekday }
  getHours() { return Number.isNaN(this.getTime()) ? NaN : wallOf(this.getTime()).hour }
  getMinutes() { return Number.isNaN(this.getTime()) ? NaN : wallOf(this.getTime()).minute }
  getSeconds() { return Number.isNaN(this.getTime()) ? NaN : wallOf(this.getTime()).second }
  getMilliseconds() { return Number.isNaN(this.getTime()) ? NaN : wallOf(this.getTime()).ms }
  getTimezoneOffset() { return Number.isNaN(this.getTime()) ? NaN : offsetMinutesAt(this.getTime()) }

  private setWall(change: Partial<Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'ms', number>>) {
    const base = Number.isNaN(this.getTime()) ? wallOf(0) : wallOf(this.getTime())
    const w = { ...base, ...change }
    return this.setTime(instantOf(w.year, w.month, w.day, w.hour, w.minute, w.second, w.ms))
  }
  setFullYear(year: number, month?: number, day?: number) { return this.setWall({ year, ...(month !== undefined ? { month } : {}), ...(day !== undefined ? { day } : {}) }) }
  setMonth(month: number, day?: number) { return this.setWall({ month, ...(day !== undefined ? { day } : {}) }) }
  setDate(day: number) { return this.setWall({ day }) }
  setHours(hour: number, minute?: number, second?: number, ms?: number) { return this.setWall({ hour, ...(minute !== undefined ? { minute } : {}), ...(second !== undefined ? { second } : {}), ...(ms !== undefined ? { ms } : {}) }) }
  setMinutes(minute: number, second?: number, ms?: number) { return this.setWall({ minute, ...(second !== undefined ? { second } : {}), ...(ms !== undefined ? { ms } : {}) }) }
  setSeconds(second: number, ms?: number) { return this.setWall({ second, ...(ms !== undefined ? { ms } : {}) }) }
  setMilliseconds(ms: number) { return this.setWall({ ms }) }

  toLocaleDateString(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) { return NativeDate.prototype.toLocaleDateString.call(this, locales, { timeZone: ZONE, ...options }) }
  toLocaleTimeString(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) { return NativeDate.prototype.toLocaleTimeString.call(this, locales, { timeZone: ZONE, ...options }) }
  toLocaleString(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) { return NativeDate.prototype.toLocaleString.call(this, locales, { timeZone: ZONE, ...options }) }
}

// Intl.DateTimeFormat (used for the "Tue, Oct 13, 8:15 PM" labels) defaults to Chicago too.
function CentralDateTimeFormat(this: unknown, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
  return new NativeDateTimeFormat(locales, { timeZone: ZONE, ...options })
}
CentralDateTimeFormat.prototype = NativeDateTimeFormat.prototype
CentralDateTimeFormat.supportedLocalesOf = NativeDateTimeFormat.supportedLocalesOf

const root = globalThis as unknown as { Date: unknown; Intl: { DateTimeFormat: unknown } }
root.Date = CentralDate
root.Intl.DateTimeFormat = CentralDateTimeFormat

export {}
