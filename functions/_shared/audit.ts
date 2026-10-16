import type { Env } from './env'
import { supabaseAdmin } from './supabaseAdmin'
import { getAcuityClient } from './acuityClient'
import { chicagoParts, entryTakesSlot, friendlyTime, type ScheduleEntryRow } from './chicago'
import { LOOKAHEAD_DAYS, MIN_LEAD_TIME_HOURS, parseAcuityTime } from './intake'

// "Is Acuity set up the way Apollo thinks it is?" Read-only. Three kinds of check, each a separate request so that
// no single request goes near Cloudflare's per-request limit on outbound calls:
//   setup         - teachers, calendars, lesson types and which calendars each lesson type is assigned to
//   blocks        - one teacher: stray / missing blocks, uncovered time, bookings with no match in Apollo
//   availability  - one teacher + lesson type: flagged openings vs the start times Acuity actually offers

export interface Finding { severity: 'problem' | 'warning' | 'info'; area: string; message: string }
export interface PlanItem { instructorId: string; instructorName: string; typeId: string; typeName: string; instruments: string[] }
export interface AuditPart { findings: Finding[]; checked: string[]; plan?: PlanItem[] }

const DAY = 86_400_000
const SLOT = 30 * 60_000
const WINDOW_END = (now: number) => now + LOOKAHEAD_DAYS * DAY
const MAX_DATES_PER_CHECK = 14 // each date is one Acuity request

type Db = ReturnType<typeof supabaseAdmin>
const when = (ms: number) => friendlyTime(new Date(ms))
const lower = (items: string[] | null | undefined) => (items ?? []).map((item) => item.toLowerCase())

async function loadInstructor(db: Db, instructorId: string) {
  const { data } = await db.from('instructors').select('id, name, instruments, acuity_calendar_id').eq('id', instructorId).single()
  if (!data) throw new Error('Instructor not found.')
  if (!data.acuity_calendar_id) throw new Error(`${data.name} has no Acuity calendar linked.`)
  return data as { id: string; name: string; instruments: string[]; acuity_calendar_id: string }
}

// ---------- setup ----------

export async function auditSetup(env: Env): Promise<AuditPart> {
  const db = supabaseAdmin(env)
  const acuity = getAcuityClient(env)
  const findings: Finding[] = []
  const [{ data: instructors }, { data: typeRows }] = await Promise.all([
    db.from('instructors').select('id, name, instruments, acuity_calendar_id'),
    db.from('acuity_appointment_types').select('instrument, appointment_type_id'),
  ])
  const [calendars, types] = await Promise.all([acuity.listCalendars(), acuity.listAppointmentTypes()])
  const calendarIds = new Set(calendars.map((item) => String(item.id)))
  const typesById = new Map(types.map((item) => [String(item.id), item]))
  const plan: PlanItem[] = []

  const linkedCalendarIds = new Set<string>()
  for (const instructor of instructors ?? []) {
    if (!instructor.acuity_calendar_id) {
      findings.push({ severity: 'warning', area: instructor.name, message: `${instructor.name} isn't linked to an Acuity calendar, so none of their openings are bookable online.` })
      continue
    }
    const calendarId = String(instructor.acuity_calendar_id)
    linkedCalendarIds.add(calendarId)
    if (!calendarIds.has(calendarId)) {
      findings.push({ severity: 'problem', area: instructor.name, message: `${instructor.name} is linked to Acuity calendar ${calendarId}, which doesn't exist in Acuity any more.` })
      continue
    }
    const byType = new Map<string, string[]>()
    for (const instrument of (instructor.instruments ?? []) as string[]) {
      const row = (typeRows ?? []).find((item) => item.instrument.toLowerCase() === instrument.toLowerCase())
      if (!row) {
        findings.push({ severity: 'problem', area: instructor.name, message: `${instructor.name} teaches ${instrument}, but there's no Acuity trial lesson type set up for ${instrument}. Holds and Day 0 emails can't offer it.` })
        continue
      }
      const type = typesById.get(String(row.appointment_type_id))
      if (!type) {
        findings.push({ severity: 'problem', area: instructor.name, message: `The ${instrument} lesson type (${row.appointment_type_id}) no longer exists in Acuity.` })
        continue
      }
      if (type.active === false) findings.push({ severity: 'problem', area: instructor.name, message: `"${type.name}" is inactive in Acuity, so ${instrument} trials can't be booked.` })
      if (type.private === true) findings.push({ severity: 'problem', area: instructor.name, message: `"${type.name}" is private in Acuity, so it's hidden from your public booking page and from "See all open lessons". Links to specific times for it have been unreliable; set it to public.` })
      if (type.calendarIDs && !type.calendarIDs.map(String).includes(calendarId)) {
        findings.push({ severity: 'problem', area: instructor.name, message: `"${type.name}" isn't assigned to ${instructor.name}'s calendar in Acuity, so ${instrument} trials can't be booked with them.` })
        continue
      }
      if (type.duration && type.duration !== 30) findings.push({ severity: 'warning', area: instructor.name, message: `"${type.name}" is ${type.duration} minutes in Acuity; Apollo assumes 30-minute trials.` })
      byType.set(String(row.appointment_type_id), [...(byType.get(String(row.appointment_type_id)) ?? []), instrument])
    }
    for (const [typeId, instruments] of byType) {
      plan.push({ instructorId: instructor.id, instructorName: instructor.name, typeId, typeName: typesById.get(typeId)?.name ?? typeId, instruments })
    }
  }

  for (const calendar of calendars) {
    if (!linkedCalendarIds.has(String(calendar.id))) findings.push({ severity: 'warning', area: 'Calendars', message: `Acuity calendar "${calendar.name}" isn't linked to any instructor in Apollo, so Apollo never blocks it.` })
  }
  const knownTypeIds = new Set((typeRows ?? []).map((row) => String(row.appointment_type_id)))
  for (const type of types) {
    if (/free trial/i.test(type.name) && !knownTypeIds.has(String(type.id))) findings.push({ severity: 'warning', area: 'Lesson types', message: `Acuity has a trial lesson type "${type.name}" that Apollo doesn't know about (no instrument is mapped to it).` })
  }
  return {
    findings, plan,
    checked: [`${instructors?.length ?? 0} instructors, ${calendars.length} Acuity calendars, ${types.length} lesson types`, `${plan.length} teacher + lesson-type pairs to check for availability`],
  }
}

// ---------- blocks and bookings (one teacher) ----------

export async function auditBlocks(env: Env, instructorId: string): Promise<AuditPart> {
  const db = supabaseAdmin(env)
  const acuity = getAcuityClient(env)
  const instructor = await loadInstructor(db, instructorId)
  const now = Date.now()
  const end = WINDOW_END(now)
  const iso = (ms: number) => new Date(ms).toISOString()
  const findings: Finding[] = []
  const area = instructor.name

  const [{ data: tracked }, { data: openings }, { data: holds }, { data: trials }] = await Promise.all([
    db.from('acuity_blocks').select('acuity_block_id, starts_at, ends_at').eq('instructor_id', instructorId).gt('ends_at', iso(now)),
    db.from('trial_openings').select('starts_at').eq('instructor_id', instructorId).gte('starts_at', iso(now)).lte('starts_at', iso(end)),
    db.from('holds').select('starts_at, duration_minutes, status, acuity_appointment_id').eq('instructor_id', instructorId).in('status', ['active', 'confirmed']).gte('starts_at', iso(now - DAY)).lte('starts_at', iso(end)),
    db.from('schedule_entries').select('starts_at, student_name').eq('instructor_id', instructorId).eq('kind', 'trial').gte('starts_at', iso(now - DAY)).lte('starts_at', iso(end)),
  ])
  const allBlocks = await acuity.listBlocks(instructor.acuity_calendar_id)
  const appointments = await acuity.listAppointments({ minDate: chicagoParts(new Date(now)).key, maxDate: chicagoParts(new Date(end)).key, calendarID: instructor.acuity_calendar_id })

  // Blocks Apollo didn't make, and blocks Apollo thinks exist that Acuity doesn't have.
  const trackedIds = new Set((tracked ?? []).map((row) => String(row.acuity_block_id)))
  const liveIds = new Set(allBlocks.map((block) => String(block.id)))
  const live = allBlocks.filter((block) => Date.parse(block.end) > now && Date.parse(block.start) < end)
  const strays = live.filter((block) => !trackedIds.has(String(block.id)))
  if (strays.length) {
    findings.push({ severity: 'warning', area, message: `${strays.length} block${strays.length === 1 ? '' : 's'} in Acuity that Apollo didn't create (so Apollo can't remove ${strays.length === 1 ? 'it' : 'them'}): ${strays.slice(0, 4).map((block) => `${when(Date.parse(block.start))} to ${when(Date.parse(block.end))}${block.notes ? ` ("${block.notes.slice(0, 40)}")` : ''}`).join('; ')}${strays.length > 4 ? '; …' : ''}.` })
  }
  const ghosts = (tracked ?? []).filter((row) => !liveIds.has(String(row.acuity_block_id)))
  if (ghosts.length) {
    findings.push({ severity: 'problem', area, message: `Apollo thinks ${ghosts.length === 1 ? 'a block exists' : `${ghosts.length} blocks exist`} that Acuity doesn't have, so that time may be open to the public: ${ghosts.slice(0, 3).map((row) => `${when(Date.parse(row.starts_at))} to ${when(Date.parse(row.ends_at))}`).join('; ')}${ghosts.length > 3 ? '; …' : ''}. "Sync Acuity now" should repair this.` })
  }

  // Time with no block at all over the next 29 days, other than the flagged openings and holds (which should be open).
  const openIntervals: [number, number][] = [
    ...(openings ?? []).map((row): [number, number] => [Date.parse(row.starts_at), Date.parse(row.starts_at) + SLOT]),
    ...(holds ?? []).map((row): [number, number] => [Date.parse(row.starts_at), Date.parse(row.starts_at) + (row.duration_minutes ?? 30) * 60_000]),
  ]
  const covered = [...live.map((block): [number, number] => [Math.max(now, Date.parse(block.start)), Math.min(end, Date.parse(block.end))]), ...openIntervals].sort((a, b) => a[0] - b[0])
  const gaps: [number, number][] = []
  let cursor = now
  for (const [start, stop] of covered) {
    if (start > cursor + 60_000) gaps.push([cursor, start])
    cursor = Math.max(cursor, stop)
  }
  if (cursor < end - 60_000) gaps.push([cursor, end])
  if (gaps.length) {
    findings.push({ severity: 'warning', area, message: `Some time in the next ${LOOKAHEAD_DAYS} days has no block and isn't a flagged opening (${gaps.length} stretch${gaps.length === 1 ? '' : 'es'}, first: ${when(gaps[0][0])} to ${when(gaps[0][1])}). It's only a leak where the calendar's Acuity hours are open; the availability check below shows whether anything is actually offered.` })
  }

  // Bookings in Acuity vs trials/holds in Apollo.
  const confirmedIds = new Set((holds ?? []).map((row) => row.acuity_appointment_id).filter(Boolean).map(String))
  const trialTimes = (trials ?? []).map((row) => Date.parse(row.starts_at!))
  let matched = 0
  for (const appointment of appointments) {
    const at = parseAcuityTime(appointment.datetime).getTime()
    if (at < now - DAY) continue
    if (confirmedIds.has(String(appointment.id)) || trialTimes.some((time) => Math.abs(time - at) < 60_000)) { matched += 1; continue }
    findings.push({ severity: 'warning', area, message: `Acuity has a booking at ${when(at)} (${`${appointment.firstName} ${appointment.lastName}`.trim() || 'no name'}) with no matching trial or hold in Apollo. It should be waiting as a card on Today ("Acuity bookings"), or be linked to a lead.` })
  }
  const appointmentTimes = appointments.map((appointment) => parseAcuityTime(appointment.datetime).getTime())
  for (const row of trials ?? []) {
    const at = Date.parse(row.starts_at!)
    if (at > now && !appointmentTimes.some((time) => Math.abs(time - at) < 60_000)) {
      findings.push({ severity: 'info', area, message: `Apollo has a trial for ${row.student_name} at ${when(at)} with no Acuity booking (fine if it was booked by phone or text).` })
    }
  }
  return { findings, checked: [`${area}: ${live.length} Acuity blocks, ${appointments.length} bookings, ${openings?.length ?? 0} flagged openings, ${matched} bookings matched to Apollo`] }
}

// ---------- availability (one teacher + lesson type) ----------

export async function auditAvailability(env: Env, instructorId: string, typeId: string): Promise<AuditPart> {
  const db = supabaseAdmin(env)
  const acuity = getAcuityClient(env)
  const instructor = await loadInstructor(db, instructorId)
  const now = Date.now()
  const end = WINDOW_END(now)
  const iso = (ms: number) => new Date(ms).toISOString()
  const calendarId = instructor.acuity_calendar_id
  const findings: Finding[] = []

  const [{ data: typeRows }, { data: openings }, { data: holds }, { data: entries }] = await Promise.all([
    db.from('acuity_appointment_types').select('instrument').eq('appointment_type_id', typeId),
    db.from('trial_openings').select('starts_at, instruments').eq('instructor_id', instructorId).gte('starts_at', iso(now - DAY)).lte('starts_at', iso(end + DAY)),
    db.from('holds').select('starts_at, duration_minutes').eq('instructor_id', instructorId).in('status', ['active', 'confirmed']).gte('starts_at', iso(now - DAY)).lte('starts_at', iso(end + DAY)),
    db.from('schedule_entries').select('instructor_id, kind, duration_minutes, day_of_week, start_time, starts_at, starts_on, ends_on, skipped_dates, repeat_interval_weeks').eq('instructor_id', instructorId),
  ])
  const typeInstruments = lower((typeRows ?? []).map((row) => row.instrument)).filter((item) => lower(instructor.instruments).includes(item))
  const area = `${instructor.name} · ${typeInstruments.join(' / ') || 'this lesson type'}`

  // What Apollo intends to be bookable: flagged openings (any instrument) and active holds, as [start, end) intervals.
  const intended: [number, number][] = [
    ...(openings ?? []).map((row): [number, number] => [Date.parse(row.starts_at), Date.parse(row.starts_at) + SLOT]),
    ...(holds ?? []).map((row): [number, number] => [Date.parse(row.starts_at), Date.parse(row.starts_at) + (row.duration_minutes ?? 30) * 60_000]),
  ]
  const isIntended = (start: number) => intended.some(([from, to]) => start >= from && start + SLOT <= to)
  const expected = (openings ?? []).filter((row) => {
    const at = Date.parse(row.starts_at)
    return at >= now && at <= end && lower(row.instruments).some((item) => typeInstruments.includes(item))
  }).map((row) => Date.parse(row.starts_at))

  // Acuity: which days have anything, then the actual start times on the days that matter.
  const months = [...new Set([chicagoParts(new Date(now)).key.slice(0, 7), chicagoParts(new Date(end)).key.slice(0, 7)])]
  const offeredDays = new Set<string>()
  for (const month of months) {
    for (const item of await acuity.listAvailableDates({ month, appointmentTypeID: typeId, calendarID: calendarId })) offeredDays.add(item.date)
  }
  const inWindow = (day: string) => { const at = Date.parse(`${day}T12:00:00Z`); return at >= now - DAY && at <= end + DAY }
  const expectedDays = new Set(expected.map((at) => chicagoParts(new Date(at)).key))
  const days = [...new Set([...[...offeredDays].filter(inWindow), ...expectedDays])].sort()
  let partial = false
  if (days.length > MAX_DATES_PER_CHECK) { days.splice(MAX_DATES_PER_CHECK); partial = true }
  const offered: number[] = []
  for (const day of days) {
    for (const item of await acuity.listAvailableTimes({ date: day, appointmentTypeID: typeId, calendarID: calendarId })) offered.push(parseAcuityTime(item.time).getTime())
  }
  const offeredSet = new Set(offered)
  const liveBlocks = await acuity.listBlocks(calendarId)

  let matched = 0
  for (const at of expected) {
    if (offeredSet.has(at)) { matched += 1; continue }
    const block = liveBlocks.find((item) => Date.parse(item.start) < at + SLOT && Date.parse(item.end) > at)
    const taken = ((entries ?? []) as ScheduleEntryRow[]).find((entry) => entryTakesSlot(entry, new Date(at)))
    let reason: string
    if (at < now + MIN_LEAD_TIME_HOURS * 3_600_000) { findings.push({ severity: 'info', area, message: `${when(at)} is flagged but is inside Acuity's ${MIN_LEAD_TIME_HOURS}-hour minimum notice, so it can't be booked yet.` }); continue }
    if (block) reason = `Acuity still has a block over it (${when(Date.parse(block.start))} to ${when(Date.parse(block.end))}${trackedNote(block.notes)}).`
    else if (taken) reason = `Apollo has a ${taken.kind === 'regular' ? 'regular lesson' : taken.kind} on that time, so it shouldn't be flagged (the opening is stale).`
    else reason = "Nothing is blocking it, so Acuity's own settings are hiding it: that day's hours don't include it, the start-time interval skips it, or the lesson type isn't offered with this teacher."
    findings.push({ severity: 'problem', area, message: `Flagged opening ${when(at)} is NOT offered on Acuity. ${reason}` })
  }

  const leaks = offered.filter((at) => at >= now && at <= end && !isIntended(at))
  if (leaks.length) {
    findings.push({ severity: 'problem', area, message: `Acuity is offering ${leaks.length === 1 ? 'a time that isn\'t a flagged opening' : `${leaks.length} times that aren't flagged openings`}, so anyone could book ${leaks.length === 1 ? 'it' : 'them'}: ${leaks.slice(0, 5).map(when).join('; ')}${leaks.length > 5 ? '; …' : ''}.` })
  }
  const wrongType = offered.filter((at) => at >= now && at <= end && isIntended(at) && !expected.includes(at))
  if (wrongType.length) {
    findings.push({ severity: 'warning', area, message: `Acuity offers ${wrongType.length === 1 ? 'a flagged time' : `${wrongType.length} flagged times`} for this lesson type that ${wrongType.length === 1 ? 'was' : 'were'} flagged for other instruments: ${wrongType.slice(0, 4).map(when).join('; ')}.` })
  }
  if (partial) findings.push({ severity: 'info', area, message: `Only the first ${MAX_DATES_PER_CHECK} days with availability were checked; run the audit again later for the rest.` })
  return { findings, checked: [`${area}: ${expected.length} flagged openings expected, ${matched} offered by Acuity, ${offered.filter((at) => at >= now && at <= end).length} times offered in total`] }
}

const trackedNote = (notes?: string) => (notes && /^Apollo Lead Manager/i.test(notes) ? ', made by Apollo' : notes ? `, made by hand: "${notes.slice(0, 30)}"` : '')
