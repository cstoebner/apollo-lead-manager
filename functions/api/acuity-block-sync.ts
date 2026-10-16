import type { Env } from '../_shared/env'
import { supabaseAdmin } from '../_shared/supabaseAdmin'
import { getAcuityClient } from '../_shared/acuityClient'
import { withJsonErrors } from '../_shared/handler'
import { requireSignedInUser } from '../_shared/auth'
import { openWindow } from '../_shared/blocks'
import { findBookedTrialConflict } from '../_shared/bookedConflict'

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
  const authError = await requireSignedInUser(context.request, context.env)
  if (authError) return authError
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
    await openWindow(db, acuity, { id: instructor.id, acuity_calendar_id: instructor.acuity_calendar_id }, start, end)
    return Response.json({ ok: true })
  }

  const conflict = await findBookedTrialConflict(db, acuity, { id: instructor.id, name: instructor.name, calendarId: instructor.acuity_calendar_id }, start, end)
  if (conflict) return Response.json({ error: conflict }, { status: 409 })

  const block = await acuity.createBlock({ calendarID: instructor.acuity_calendar_id, start: start.toISOString(), end: end.toISOString(), notes: 'Apollo Lead Manager: not a trial slot' })
  await db.from('acuity_blocks').insert({ acuity_block_id: block.id, instructor_id: instructor.id, starts_at: start.toISOString(), ends_at: end.toISOString(), reason: 'unflagged' })
  return Response.json({ ok: true })
})
