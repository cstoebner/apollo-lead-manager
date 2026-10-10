import type { Env } from './env'
import { supabaseAdmin } from './supabaseAdmin'
import { getAcuityClient } from './acuityClient'

const HORIZON_DAYS = 90
const TRIAL_OPENING_DURATION_MINUTES = 30 // trial_openings doesn't store a duration -- every existing opening is a 30-min slot (see toggleOpening in App.tsx).

type Interval = [number, number] // epoch ms

// Runs nightly (~2am Central, triggered by the companion cron Worker) and on demand from Settings -- one
// instructor per call, because Cloudflare caps each invocation at 50 outbound requests (Supabase + Acuity),
// which six instructors in a single call blow through. For each
// instructor's calendar, blocks everything in the 90-day horizon except trial
// openings and active holds -- recomputed from scratch every run, which is what
// actually restores a block after a hold expires (see hold-expiry.ts) rather
// than that cron doing it directly. Also acts as the safety net for the rare
// cases the real-time paths don't cover (a missed webhook, a manual booking
// that happened to land on an already-public slot, etc).
// Every Supabase or Acuity call is an outbound "subrequest". Stay safely under Cloudflare's 50-per-invocation cap
// (the signed-in check and the first queries already used a few); if a calendar needs more, do what fits and
// report `partial` -- the next run picks up the rest, since progress is tracked in acuity_blocks.
const SUBREQUEST_BUDGET = 44

export interface ReconcileResult { created: number; removed: number; recoveredBookings: number; partial?: boolean }

export async function linkedInstructors(env: Env): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabaseAdmin(env).from('instructors').select('id, name').not('acuity_calendar_id', 'is', null)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function reconcileInstructor(env: Env, instructorId: string): Promise<ReconcileResult & { name: string }> {
  const db = supabaseAdmin(env)
  const acuity = getAcuityClient(env)
  const now = Date.now()
  const horizonEnd = now + HORIZON_DAYS * 86_400_000

  const { data: instructor, error: instructorError } = await db.from('instructors').select('id, name, acuity_calendar_id').eq('id', instructorId).single()
  if (instructorError || !instructor) throw new Error('Instructor not found.')
  if (!instructor.acuity_calendar_id) throw new Error(`${instructor.name} has no Acuity calendar mapped yet.`)

  const [{ data: openings }, { data: holds }, { data: existingBlocks }] = await Promise.all([
    db.from('trial_openings').select('starts_at').eq('instructor_id', instructor.id).gte('starts_at', new Date(now).toISOString()).lte('starts_at', new Date(horizonEnd).toISOString()),
    db.from('holds').select('starts_at, duration_minutes').eq('instructor_id', instructor.id).eq('status', 'active').gte('starts_at', new Date(now).toISOString()).lte('starts_at', new Date(horizonEnd).toISOString()),
    db.from('acuity_blocks').select('id, acuity_block_id, starts_at, ends_at').eq('instructor_id', instructor.id),
  ])
  let used = 5 // sign-in check + the instructor lookup + the three queries above

  const openIntervals: Interval[] = [
    ...(openings ?? []).map((row): Interval => { const start = Date.parse(row.starts_at); return [start, start + TRIAL_OPENING_DURATION_MINUTES * 60_000] }),
    ...(holds ?? []).map((row): Interval => { const start = Date.parse(row.starts_at); return [start, start + (row.duration_minutes ?? 30) * 60_000] }),
  ].sort((a, b) => a[0] - b[0])

  const mergedOpenIntervals: Interval[] = []
  for (const [start, end] of openIntervals) {
    const last = mergedOpenIntervals[mergedOpenIntervals.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else mergedOpenIntervals.push([start, end])
  }

  const neededBlocks: Interval[] = []
  let cursor = now
  for (const [start, end] of mergedOpenIntervals) {
    if (start > cursor) neededBlocks.push([cursor, start])
    cursor = Math.max(cursor, end)
  }
  if (cursor < horizonEnd) neededBlocks.push([cursor, horizonEnd])

  const neededKeys = new Set(neededBlocks.map(([start, end]) => `${start}|${end}`))
  const existingByKey = new Map((existingBlocks ?? []).map((row) => [`${Date.parse(row.starts_at)}|${Date.parse(row.ends_at)}`, row]))

  let created = 0
  let removed = 0
  let partial = false
  const SWEEP_RESERVE = 4 // the missed-booking sweep below needs a few calls of its own

  for (const [start, end] of neededBlocks) {
    if (existingByKey.has(`${start}|${end}`)) continue
    if (used + 2 > SUBREQUEST_BUDGET - SWEEP_RESERVE) { partial = true; break }
    const block = await acuity.createBlock({ calendarID: instructor.acuity_calendar_id, start: new Date(start).toISOString(), end: new Date(end).toISOString(), notes: 'Apollo Lead Manager: nightly reconciliation' })
    await db.from('acuity_blocks').insert({ acuity_block_id: block.id, instructor_id: instructor.id, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), reason: 'reconciliation' })
    used += 2
    created += 1
  }

  // Stale blocks are only removed once every needed block exists, so a partial run never leaves a gap.
  if (!partial) {
    for (const [key, row] of existingByKey) {
      if (neededKeys.has(key)) continue
      if (used + 2 > SUBREQUEST_BUDGET - SWEEP_RESERVE) { partial = true; break }
      await acuity.deleteBlock(row.acuity_block_id)
      await db.from('acuity_blocks').delete().eq('id', row.id)
      used += 2
      removed += 1
    }
  }

  // Safety net for missed webhooks: any recent Acuity booking we have no event for becomes a synthetic
  // event, which then shows up as an "Acuity bookings" card like a normal booking would.
  let recoveredBookings = 0
  if (!partial) {
    try {
      const appointments = await acuity.listAppointments({ minDate: new Date(now).toISOString().slice(0, 10), maxDate: new Date(horizonEnd).toISOString().slice(0, 10), calendarID: instructor.acuity_calendar_id })
      const recent = appointments.filter((appointment) => appointment.datetimeCreated && Date.parse(appointment.datetimeCreated.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) > now - 3 * 86_400_000)
      if (recent.length) {
        const { data: known } = await db.from('acuity_events').select('acuity_appointment_id').in('acuity_appointment_id', recent.map((appointment) => String(appointment.id)))
        const knownIds = new Set((known ?? []).map((row) => row.acuity_appointment_id))
        const missing = recent.filter((item) => !knownIds.has(String(item.id)))
        if (missing.length) {
          await db.from('acuity_events').insert(missing.map((appointment) => ({ acuity_appointment_id: String(appointment.id), event_type: 'appointment.reconciled', payload: { form: {}, appointment } })))
          recoveredBookings = missing.length
        }
      }
    } catch (error) {
      console.warn(`Appointment sweep failed for ${instructor.name}:`, error instanceof Error ? error.message : error)
    }
  }

  return { name: instructor.name, created, removed, recoveredBookings, ...(partial ? { partial: true } : {}) }
}
