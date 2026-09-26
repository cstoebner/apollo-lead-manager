import type { Env } from '../_shared/env'
import { supabaseAdmin } from '../_shared/supabaseAdmin'
import { getAcuityClient } from '../_shared/acuityClient'
import { withJsonErrors } from '../_shared/handler'

// Called by the client immediately after it flags/unflags a Trial Opening (the
// existing grid toggle), to keep the corresponding Acuity block in sync. The
// existing trial_openings row itself is still written directly by the client,
// exactly as before -- this route only owns the Acuity side effect.
//
// isNowBookable: true  -> a slot was just flagged as a Trial Opening: delete any
//                         block covering it so the public Acuity page opens up.
//                false -> a slot was just unflagged: re-block it, UNLESS a trial
//                         is already booked there (never silently override one).
interface RequestBody {
  instructorId: string
  startsAt: string
  durationMinutes?: number
  isNowBookable: boolean
}

export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const body = (await context.request.json()) as RequestBody
  const durationMinutes = body.durationMinutes ?? 30
  const start = new Date(body.startsAt)
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  const db = supabaseAdmin(context.env)
  const acuity = getAcuityClient(context.env)

  const { data: instructor, error: instructorError } = await db.from('instructors').select('id, name, acuity_calendar_id').eq('id', body.instructorId).single()
  if (instructorError || !instructor) return Response.json({ error: 'Instructor not found.' }, { status: 404 })
  if (!instructor.acuity_calendar_id) return Response.json({ error: `${instructor.name} has no Acuity calendar mapped yet.` }, { status: 400 })

  if (body.isNowBookable) {
    const { data: overlapping } = await db.from('acuity_blocks')
      .select('id, acuity_block_id')
      .eq('instructor_id', instructor.id)
      .lt('starts_at', end.toISOString())
      .gt('ends_at', start.toISOString())
    for (const block of overlapping ?? []) {
      await acuity.deleteBlock(block.acuity_block_id)
      await db.from('acuity_blocks').delete().eq('id', block.id)
    }
    return Response.json({ ok: true })
  }

  const conflict = await findBookedTrialConflict(db, instructor.id, start, end)
  if (conflict) return Response.json({ error: conflict }, { status: 409 })

  const block = await acuity.createBlock({ calendarID: instructor.acuity_calendar_id, start: start.toISOString(), end: end.toISOString(), notes: 'Apollo Lead Manager: not a trial slot' })
  await db.from('acuity_blocks').insert({ acuity_block_id: block.id, instructor_id: instructor.id, starts_at: start.toISOString(), ends_at: end.toISOString(), reason: 'unflagged' })
  return Response.json({ ok: true })
})

// Checks the two ways a trial can already be sitting in this exact window:
// a confirmed Acuity-booked hold, or a trial lesson booked through the manual
// in-app flow (schedule_entries kind='trial'). NOTE: this does not (yet) check
// for a conflicting *recurring* lesson (schedule_entries kind='regular') -- that
// needs the same day-of-week/biweekly-phase recurrence logic the client already
// has in entryOccursOnDate, which is worth porting here as a follow-up rather
// than duplicating by hand in this first pass.
async function findBookedTrialConflict(db: ReturnType<typeof supabaseAdmin>, instructorId: string, start: Date, end: Date): Promise<string | null> {
  const { data: confirmedHold } = await db.from('holds')
    .select('id, lead_id')
    .eq('instructor_id', instructorId)
    .eq('status', 'confirmed')
    .lt('starts_at', end.toISOString())
    .gte('starts_at', start.toISOString())
    .maybeSingle()
  if (confirmedHold) return 'A trial is already booked in this window via Acuity. Not re-blocking it.'

  const { data: bookedEntry } = await db.from('schedule_entries')
    .select('id, student_name')
    .eq('instructor_id', instructorId)
    .eq('kind', 'trial')
    .lt('starts_at', end.toISOString())
    .gte('starts_at', start.toISOString())
    .maybeSingle()
  if (bookedEntry) return `${bookedEntry.student_name} already has a trial booked in this window. Not re-blocking it.`

  return null
}
