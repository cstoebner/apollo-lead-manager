import type { Env } from '../_shared/env'
import { supabaseAdmin } from '../_shared/supabaseAdmin'
import { getAcuityClient } from '../_shared/acuityClient'
import { withJsonErrors } from '../_shared/handler'
import { requireSignedInUser } from '../_shared/auth'
import { chicagoParts, friendlyTime } from '../_shared/chicago'

const SLOT_MINUTES = 30

const parseAcuityTime = (value: string) => new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
const clock = (date: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(date)

// "Why isn't this slot bookable on Acuity?" Read-only. Lines up what Apollo thinks (flagged opening, our block
// records, holds) against what Acuity itself reports (live blocks, bookings, and the start times it is offering).
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = await requireSignedInUser(context.request, context.env)
  if (authError) return authError
  const { instructorId, startsAt } = (await context.request.json()) as { instructorId: string; startsAt: string }
  const start = new Date(startsAt)
  const end = new Date(start.getTime() + SLOT_MINUTES * 60_000)
  const db = supabaseAdmin(context.env)
  const acuity = getAcuityClient(context.env)

  const { data: instructor } = await db.from('instructors').select('id, name, instruments, acuity_calendar_id').eq('id', instructorId).single()
  if (!instructor) return Response.json({ error: 'Instructor not found.' }, { status: 404 })
  if (!instructor.acuity_calendar_id) return Response.json({ error: `${instructor.name} has no Acuity calendar linked.` }, { status: 400 })
  const calendarId: string = instructor.acuity_calendar_id
  const day = chicagoParts(start).key

  const [{ data: opening }, { data: holds }, { data: trackedBlocks }, { data: types }] = await Promise.all([
    db.from('trial_openings').select('id').eq('instructor_id', instructorId).eq('starts_at', start.toISOString()).maybeSingle(),
    db.from('holds').select('id, status').eq('instructor_id', instructorId).in('status', ['active', 'confirmed']).lt('starts_at', end.toISOString()).gt('starts_at', new Date(start.getTime() - SLOT_MINUTES * 60_000).toISOString()),
    db.from('acuity_blocks').select('acuity_block_id, starts_at, ends_at, reason').eq('instructor_id', instructorId).lt('starts_at', end.toISOString()).gt('ends_at', start.toISOString()),
    db.from('acuity_appointment_types').select('instrument, appointment_type_id'),
  ])
  const trackedIds = new Set((trackedBlocks ?? []).map((row) => String(row.acuity_block_id)))

  const liveBlocks = (await acuity.listBlocks(calendarId))
    .filter((block) => Date.parse(block.start) < end.getTime() && Date.parse(block.end) > start.getTime())
    .map((block) => ({ id: String(block.id), start: block.start, end: block.end, notes: block.notes ?? '', trackedByApollo: trackedIds.has(String(block.id)) }))

  const appointments = (await acuity.listAppointments({ minDate: day, maxDate: day, calendarID: calendarId }))
    .map((appointment) => ({ at: parseAcuityTime(appointment.datetime), name: `${appointment.firstName} ${appointment.lastName}`.trim() }))
    .filter((appointment) => Math.abs(appointment.at.getTime() - start.getTime()) < SLOT_MINUTES * 60_000)
    .map((appointment) => ({ time: clock(appointment.at), name: appointment.name }))

  type TypeRow = { instrument: string; appointment_type_id: string }
  const instrumentTypes: TypeRow[] = []
  for (const instrument of (instructor.instruments ?? []) as string[]) {
    const row = (types ?? []).find((item) => item.instrument.toLowerCase() === instrument.toLowerCase()) as TypeRow | undefined
    if (row && !instrumentTypes.some((other) => other.appointment_type_id === row.appointment_type_id)) instrumentTypes.push(row)
  }
  instrumentTypes.splice(3)
  const availability = []
  for (const type of instrumentTypes) {
    const times = (await acuity.listAvailableTimes({ date: day, appointmentTypeID: type.appointment_type_id, calendarID: calendarId })).map((item) => parseAcuityTime(item.time))
    availability.push({ instrument: type.instrument, offered: times.some((time) => time.getTime() === start.getTime()), times: times.map(clock) })
  }

  const verdict: string[] = []
  if (!opening) verdict.push('Apollo has no flagged trial opening at this time.')
  if (holds?.length) verdict.push('An active or confirmed hold covers this time.')
  if (liveBlocks.length) verdict.push(`Acuity still has ${liveBlocks.length} block${liveBlocks.length === 1 ? '' : 's'} covering this time${liveBlocks.some((block) => !block.trackedByApollo) ? ', including one Apollo has no record of (it can only be removed in Acuity)' : ''}.`)
  if (appointments.length) verdict.push('Someone is already booked at (or overlapping) this time in Acuity.')
  if (!liveBlocks.length && availability.length && availability.every((item) => !item.offered)) verdict.push("Nothing is blocking it, but Acuity isn't offering this start time. That usually means the calendar's weekly availability in Acuity doesn't include it, or the lesson type's start-time interval skips it (see the times Acuity does offer below).")
  if (!verdict.length) verdict.push('Everything lines up: Acuity should be offering this slot.')

  return Response.json({ ok: true, slot: friendlyTime(start), instructor: instructor.name, opening: Boolean(opening), holds: holds?.length ?? 0, trackedBlocks: trackedBlocks ?? [], liveBlocks, appointments, availability, verdict })
})
